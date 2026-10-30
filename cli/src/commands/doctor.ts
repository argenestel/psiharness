import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { arity } from "../args.ts";
import type { ParsedArgs } from "../args.ts";
import { ompInstallHint } from "../host.ts";
import { color } from "../term.ts";

function probe(bin: string, args: string[]): { ok: boolean; detail: string } {
	const capture = mkdtempSync(join(tmpdir(), "psi-doctor-"));
	const path = join(capture, "version");
	const fd = openSync(path, "w");
	try {
		const result = spawnSync(bin, args, { stdio: ["ignore", fd, fd], timeout: 10_000 });
		const lines = readFileSync(path, "utf8").trim().split("\n");
		const detail = lines.find((line) => /\d+\.\d+/.test(line) && !line.startsWith("Warning:")) ?? lines[0];
		return { ok: !result.error && result.status === 0,
			detail: result.error?.message ?? (detail || "unavailable") };
	} finally {
		closeSync(fd);
		rmSync(capture, { recursive: true, force: true });
	}
}

/** Diagnose required and optional runtimes with actionable fixes for failures. */
export async function doctor(args: ParsedArgs): Promise<number> {
	arity(args, 0, 0, "doctor");
	let failures = 0;
	const report = (name: string, ok: boolean, detail: string, fix: string) => {
		if (!ok) failures++;
		console.log(`${color(ok ? "✓" : "✗", ok ? "green" : "red")} ${name}: ${detail}`);
		if (!ok) console.log(`  Fix: ${fix}`);
	};
	const [major, minor] = process.versions.node.split(".").map(Number);
	report("Node >= 22.18", major > 22 || (major === 22 && minor >= 18),
		process.versions.node, "Install Node.js >= 22.18.");
	for (const [name, argv, fix] of [
		["pi", ["--version"], "npm install -g @earendil-works/pi-coding-agent"],
		["omp", ["--version"], ompInstallHint],
		["latex", ["--version"], "Install TeX Live (e.g. apt install texlive-latex-extra)."],
		["ffmpeg", ["-version"], "Install ffmpeg (e.g. apt install ffmpeg)."],
		["docker", ["--version"], "Install Docker and start its daemon."],
	] as const) {
		const result = probe(name, [...argv]);
		report(name, result.ok, result.detail, fix);
	}
	if (process.env.PSI_BIN) {
		const result = probe(process.env.PSI_BIN, ["--version"]);
		report("PSI_BIN", result.ok, `${process.env.PSI_BIN}: ${result.detail}`, "Set PSI_BIN to an executable host binary.");
	}
	try {
		const { manimAvailable } = await import("../../../visual/src/manim.ts");
		const available = await manimAvailable();
		report("manim local", available.local, available.local ? "available" : "unavailable",
			"Install manim: pip install manim");
		report("manim docker", available.docker, available.docker ? "available" : "unavailable",
			"Start Docker and build the psi-manim:latest image (or set PSI_MANIM_IMAGE).");
	} catch (error) {
		report("manim local/docker", false, error instanceof Error ? error.message : String(error),
			"Ensure visual/src/manim.ts is present; install manim locally or build the Docker image.");
	}
	const home = resolve(process.env.PSI_HOME ?? join(homedir(), ".psi"));
	let checkDir: string | undefined;
	try {
		mkdirSync(home, { recursive: true });
		checkDir = mkdtempSync(join(home, ".psi-doctor-"));
		writeFileSync(join(checkDir, "probe"), "psi");
		report("PSI_HOME writable", true, home, "");
	} catch (error) {
		report("PSI_HOME writable", false, `${home}: ${error instanceof Error ? error.message : String(error)}`,
			"Set PSI_HOME to a writable directory or correct its permissions.");
	} finally {
		if (checkDir) rmSync(checkDir, { recursive: true, force: true });
	}
	const summary = failures ? `${failures} check(s) failed` : "All checks passed";
	console.log(`${summary}. Optional tools are needed only for their features.`);
	return failures ? 1 : 0;
}
