import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentArgs, agentEnv, AgentHub } from "../src/agent.ts";

test("web tools are explicit and execution requires opt-in on both hosts, including override", () => {
	const before = { exec: process.env.PSI_CODE_EXEC, tools: process.env.PSI_WEB_TOOLS };
	try {
		for (const enabled of [undefined, "0", "true", "1"]) for (const omp of [false, true]) {
			if (enabled === undefined) delete process.env.PSI_CODE_EXEC; else process.env.PSI_CODE_EXEC = enabled;
			delete process.env.PSI_WEB_TOOLS;
			const args = agentArgs({ omp, directory: "/data", file: "/data/chat" });
			const tools = args[args.indexOf("--tools") + 1].split(",");
			assert.ok(tools.includes("read") && tools.includes("psi_challenge"));
			assert.ok(tools.every((name) => !name.includes("*")));
			for (const name of ["psi_run", "psi_manim", "psi_crew"]) assert.equal(tools.includes(name), enabled === "1");
			process.env.PSI_WEB_TOOLS = "read,psi_*,bash,psi_run,psi_manim,psi_crew";
			const narrowed = agentArgs({ omp, directory: "/data", file: "/data/chat" });
			assert.equal(narrowed[narrowed.indexOf("--tools") + 1], enabled === "1"
				? "read,psi_crew,psi_manim,psi_run" : "read");
		}
	} finally {
		if (before.exec === undefined) delete process.env.PSI_CODE_EXEC; else process.env.PSI_CODE_EXEC = before.exec;
		if (before.tools === undefined) delete process.env.PSI_WEB_TOOLS; else process.env.PSI_WEB_TOOLS = before.tools;
	}
});

test("web environment is minimal and fixes the read root to the server data home", () => {
	assert.deepEqual(agentEnv("/data", { PATH: "/bin", HOME: "/home/psi", OPENAI_API_KEY: "key",
		PSI_WEB_READ_ROOT: "/", AWS_PROFILE: "drop", GH_TOKEN: "drop", NODE_OPTIONS: "drop", RANDOM: "drop" }),
	{ PATH: "/bin", HOME: "/home/psi", OPENAI_API_KEY: "key", PSI_HOME: "/data", PSI_WEB_READ_ROOT: "/data" });
});

test("RPC spawn actually receives the minimal environment", async () => {
	const home = mkdtempSync(join(tmpdir(), "psi-spawn-env-"));
	const bin = join(home, "host");
	const output = join(home, "env.json");
	writeFileSync(bin, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.env));\n`);
	chmodSync(bin, 0o755);
	const previous = process.env.NODE_OPTIONS;
	process.env.NODE_OPTIONS = "--no-warnings";
	const hub = new AgentHub(home, { bin });
	try {
		hub.create();
		for (let i = 0; !existsSync(output) && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
		const env = JSON.parse(readFileSync(output, "utf8"));
		assert.equal(env.NODE_OPTIONS, undefined);
		assert.equal(env.PSI_HOME, home);
		assert.equal(env.PSI_WEB_READ_ROOT, home);
	} finally {
		await hub.close();
		if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
		rmSync(home, { recursive: true, force: true });
	}
});
