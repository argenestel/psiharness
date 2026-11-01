import test from "node:test";
import assert from "node:assert/strict";
import { childEnv } from "../src/child-env.ts";
import { roleTools } from "../src/runner.ts";
import { ROLE_TOOLS } from "../src/roles.ts";
import type { CrewRole } from "../../core/src/types.ts";

test("crew execution tools require both opt-ins for bash/write and stay visualizer-only", () => {
	assert.deepEqual(ROLE_TOOLS.visualizer, ["psi_storyboard", "psi_explorable"]);
	for (const exec of [undefined, "0", "true", "1"]) for (const bash of [undefined, "0", "1"]) {
		for (const role of Object.keys(ROLE_TOOLS) as CrewRole[]) {
			const tools = roleTools(role, "pi", { PSI_CODE_EXEC: exec, PSI_CREW_ALLOW_BASH: bash });
			const enabled = role === "visualizer" && exec === "1" && bash === "1";
			assert.equal(tools.includes("bash"), enabled);
			assert.equal(tools.includes("write"), enabled);
			assert.equal(tools.includes("psi_manim"), role === "visualizer" && exec === "1");
		}
	}
});

test("childEnv preserves documented provider credentials and config, drops unrelated secrets", () => {
	const allowed = { PATH: "/bin", HOME: "/home/psi", LANG: "C", LC_ALL: "C", PSI_HOME: "/data",
		PSI_CODE_EXEC: "1", PSI_CREW_ALLOW_BASH: "1", PI_CODING_AGENT_DIR: "/auth",
		ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", OPENROUTER_API_KEY: "r", XAI_API_KEY: "x",
		GEMINI_API_KEY: "g", COPILOT_GITHUB_TOKEN: "c", HF_TOKEN: "h", ANTHROPIC_OAUTH_TOKEN: "t" };
	const source = { ...allowed, AWS_ACCESS_KEY_ID: "drop", AWS_PROFILE: "drop", AWS_SESSION_TOKEN: "drop",
		GITHUB_TOKEN: "drop", GH_TOKEN: "drop", NPM_TOKEN: "drop", NODE_OPTIONS: "drop", SSH_AUTH_SOCK: "drop",
		UNRELATED: "drop", OTHER_API_KEY: "drop", OTHER_SECRET: "drop", OTHER_TOKEN: "drop", EMPTY: undefined };
	assert.deepEqual(childEnv(source), allowed);
	assert.equal(source.NODE_OPTIONS, "drop");
});

test("crew spawn actually strips unrelated environment variables", async () => {
	const { chmodSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { PsiStore } = await import("../../core/src/store.ts");
	const { runCrewTask } = await import("../src/runner.ts");
	const home = mkdtempSync(join(tmpdir(), "psi-crew-env-"));
	const bin = join(home, "host");
	writeFileSync(bin, `#!${process.execPath}
require("node:fs").writeFileSync(1, JSON.stringify({home:process.env.PSI_HOME, options:process.env.NODE_OPTIONS ?? null,
	keys:Object.keys(process.env)}));
`);
	chmodSync(bin, 0o755);
	const previous = process.env.NODE_OPTIONS;
	process.env.NODE_OPTIONS = "--no-warnings";
	try {
		const result = await runCrewTask({ role: "critic", topic: "test", instructions: "Inspect" },
			{ store: new PsiStore(home), bin });
		assert.equal(result.ok, true);
		const env = JSON.parse(result.output);
		assert.equal(env.home, home);
		assert.equal(env.options, null);
		assert.ok(!env.keys.some((key: string) => /^(AWS_|SSH_)|^(GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN)$/.test(key)));
	} finally {
		if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
		rmSync(home, { recursive: true, force: true });
	}
});
