import * as fs from "node:fs";
import * as path from "node:path";

/** Options for the synchronous filesystem lock. */
export type FileLockOptions = {
	/** Maximum time to wait for another process to release the lock. Defaults to two seconds. */
	timeoutMs?: number;
	/** Age after which a lock is considered stale. Defaults to ten seconds. */
	staleMs?: number;
};

type LockIdentity = {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
};

type HeldLock = { depth: number; identity: LockIdentity };

const held = new Map<string, HeldLock>();
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_STALE_MS = 10_000;

function numberOption(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
	return value;
}

function resolveLockPath(file: string, options: FileLockOptions): string {
	if (typeof file !== "string" || !file) throw new Error("Lock path must not be empty");
	void options;
	return `${path.resolve(file)}.lock`;
}

function identity(stat: fs.Stats): LockIdentity {
	return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameIdentity(left: LockIdentity, right: LockIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
		left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function lockStat(lockPath: string): LockIdentity | undefined {
	try {
		// lstat prevents an attacker-controlled lock symlink from making identity checks
		// refer to a different file. Unlinking a stale symlink only removes the symlink.
		return identity(fs.lstatSync(lockPath));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function pidFromLock(lockPath: string): number | undefined {
	let text: string;
	try { text = fs.readFileSync(lockPath, "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		return undefined;
	}
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("{")) {
		try {
			const value: unknown = JSON.parse(trimmed);
			if (value && typeof value === "object" && "pid" in value &&
				typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0) return value.pid;
		} catch { /* A malformed lock can still be reclaimed by the age check. */ }
	}
	const match = /^\s*(\d+)\b/.exec(trimmed);
	if (!match) return undefined;
	const pid = Number(match[1]);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function processIsDead(pid: number | undefined): boolean {
	if (pid === undefined) return false;
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

/**
 * Remove a stale lock only when the file observed during inspection is still
 * the same inode. The second identity check avoids deleting a lock acquired
 * while this process was reading the stale one.
 */
function reclaim(lockPath: string, observed: LockIdentity): boolean {
	const current = lockStat(lockPath);
	if (!current || !sameIdentity(observed, current)) return false;
	try {
		fs.unlinkSync(lockPath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		return false;
	}
}

function waitForLock(delayMs: number): void {
	Atomics.wait(sleepBuffer, 0, 0, delayMs);
}

function acquire(lockPath: string, timeoutMs: number, staleMs: number): LockIdentity {
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	const deadline = Date.now() + timeoutMs;
	let delay = 10;
	for (;;) {
		let descriptor: number | undefined;
		try {
			descriptor = fs.openSync(lockPath, "wx", 0o600);
			fs.writeSync(descriptor, `${process.pid}\n`);
			fs.fsyncSync(descriptor);
			const acquired = identity(fs.fstatSync(descriptor));
			fs.closeSync(descriptor);
			return acquired;
		} catch (error) {
			if (descriptor !== undefined) {
				try { fs.closeSync(descriptor); } catch { /* Best effort; the failed acquisition is retried below. */ }
			}
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}

		const observed = lockStat(lockPath);
		if (observed) {
			const age = Math.max(0, Date.now() - observed.mtimeMs);
			if (age > staleMs || processIsDead(pidFromLock(lockPath))) {
				if (reclaim(lockPath, observed)) continue;
			}
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			const error = new Error(`Timed out waiting for file lock: ${lockPath}`) as NodeJS.ErrnoException;
			error.code = "ELOCKTIMEOUT";
			throw error;
		}
		waitForLock(Math.min(delay, remaining));
		delay = Math.min(100, delay * 2);
	}
}

function release(lockPath: string, expected: LockIdentity): void {
	const current = lockStat(lockPath);
	if (!current || !sameIdentity(expected, current)) return;
	try { fs.unlinkSync(lockPath); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/**
 * Run a synchronous callback while holding a cross-process PID lock.
 *
 * Locks are process-reentrant: a nested call for the same path in this process
 * increments a depth counter and runs without reacquiring the file. Callbacks
 * must be synchronous; a returned Promise does not extend the lock lifetime.
 */
export function withFileLock<T>(file: string, fn: () => T, options: FileLockOptions = {}): T {
	if (typeof fn !== "function") throw new TypeError("Lock callback must be a function");
	const lockPath = resolveLockPath(file, options);
	const timeoutMs = numberOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
	const staleMs = numberOption(options.staleMs, DEFAULT_STALE_MS, "staleMs");
	const existing = held.get(lockPath);
	if (existing) {
		existing.depth++;
		try { return fn(); }
		finally { existing.depth--; }
	}

	const acquired = acquire(lockPath, timeoutMs, staleMs);
	held.set(lockPath, { depth: 1, identity: acquired });
	try { return fn(); }
	finally {
		const current = held.get(lockPath);
		if (current) {
			current.depth--;
			if (current.depth === 0) {
				held.delete(lockPath);
				release(lockPath, current.identity);
			}
		}
	}
}
