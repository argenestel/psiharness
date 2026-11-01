import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve a read to an existing canonical path beneath the web data root; fail closed on errors. */
export function webReadPath(root: string, path: unknown, cwd: string): string | undefined {
	if (typeof path !== "string") return undefined;
	try {
		// Resolve once and replace the tool input, avoiding pi's alternate filename resolution after the check.
		let value = path.startsWith("@") ? path.slice(1) : path;
		value = value.replace(/[\u00a0\u2007\u202f]/g, " ");
		if (value === "~" || value.startsWith("~/")) value = homedir() + value.slice(1);
		const canonicalRoot = realpathSync(root);
		const canonicalPath = realpathSync(resolve(cwd, value));
		const inside = relative(canonicalRoot, canonicalPath);
		return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) ? canonicalPath : undefined;
	} catch { return undefined; }
}
