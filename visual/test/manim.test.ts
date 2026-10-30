import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Storyboard, StoryElement } from "../../core/src/types.ts";
import { manimAvailable, renderManim, storyboardToManim } from "../src/manim.ts";

function storyboard(elements: StoryElement[] = []): Storyboard {
	return { id: "my-math-story", title: "Math", topic: "math", style: "3b1b", scenes: [
		{ id: "start", narration: 'A "quote"\nand a \\ slash', durationSec: 3, elements },
	] };
}

test("transpiles scene class, captions, coordinates and Python string escapes", () => {
	const code = storyboardToManim(storyboard([
		{ id: "dot", kind: "circle", props: { x: 1200, y: 225, r: 40 }, enter: { type: "draw", duration: 1 } },
		{ id: "label", kind: "text", props: { x: 800, y: 450, text: 'say "hello"\nnext\\line' } },
	]));
	assert.match(code, /class MyMathStory\(PsiScene\):/);
	assert.match(code, /move_to\(\[3\.555, 2, 0\]\)/);
	assert.match(code, /move_to\(\[0, 0, 0\]\)/);
	assert.ok(code.includes('self.narrate("A \\"quote\\"\\nand a \\\\ slash", run_time=2)'));
	assert.ok(code.includes('Text("say \\"hello\\"\\nnext\\\\line"'));
	assert.match(code, /Create\(obj_0, run_time=1\)/);
});

test("maps shapes, math, graph expressions, nested groups and unsupported placeholders", () => {
	const code = storyboardToManim(storyboard([
		{ id: "rect", kind: "rect", props: { x: 0, y: 0, w: 1600, h: 900, fill: "red" } },
		{ id: "eq", kind: "equation", props: { x: 800, y: 450, tex: "\\frac{1}{2}" } },
		{ id: "vec", kind: "vector", props: { x: 800, y: 450, dx: 400, dy: -225 } },
		{ id: "arrow", kind: "arrow", props: { x1: 0, y1: 0, x2: 800, y2: 450 } },
		{ id: "plot", kind: "graph", props: {
			x: 0, y: 0, w: 800, h: 450, fn: "Math.sin(x) ** 2 + Math.pow(x, 2) + Math.PI", domain: [-2, 2],
		} },
		{ id: "group", kind: "group", props: { children: [
			{ id: "creature", kind: "creature", props: { x: 800, y: 450 } },
		] } },
	]));
	assert.match(code, /Rectangle\(width=14\.22, height=8/);
	assert.match(code, /MathTex\("\\\\frac\{1\}\{2\}"/);
	assert.match(code, /Arrow\(\[0, 0, 0\], \[3\.555, 2, 0\]/);
	assert.match(code, /np\.sin\(x\) \*\* 2 \+ np\.power\(x, 2\) \+ np\.pi/);
	assert.match(code, /# Unsupported kind: creature/);
	assert.match(code, /VGroup\(obj_6\)/);
});

test("entry delays overlap and fit the scene duration", () => {
	const code = storyboardToManim(storyboard([
		{ id: "a", kind: "text", props: { text: "a" }, enter: { type: "typewriter", delay: 1, duration: 1 } },
		{ id: "b", kind: "circle", props: { r: 20 }, enter: { type: "pop", duration: 5 } },
	]));
	assert.match(code, /Succession\(Wait\(1\), Write\(obj_0, run_time=1\)\)/);
	assert.match(code, /GrowFromCenter\(obj_1, run_time=3\)/);
	assert.match(code, /lag_ratio=0/);
	assert.match(code, /self.narrate\(.*run_time=0\)/);
});

test("graph expressions cannot inject Python statements", () => {
	const code = storyboardToManim(storyboard([
		{ id: "plot", kind: "graph", props: { fn: '__import__("os").system("bad")', w: 600, h: 300 } },
	]));
	assert.ok(!code.includes("__import__"));
	assert.match(code, /lambda x: 0/);
});

test("runner reports missing binaries, validates scene classes and supports cancellation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "psi-manim-test-"));
	const previous = process.env.PATH;
	try {
		process.env.PATH = dir;
		assert.deepEqual(await manimAvailable(), { local: false, docker: false });
		const result = await renderManim({ code: "class Broken(PsiScene):\n    broken code", outDir: dir, runner: "local" });
		assert.equal(result.ok, false);
		assert.deepEqual(result.outputs, []);
		assert.match(result.log!, /manim|ENOENT/i);
		const invalid = await renderManim({ code: "broken", outDir: dir });
		assert.equal(invalid.ok, false);
		assert.match(invalid.log!, /Scene/);
		const controller = new AbortController();
		controller.abort();
		const aborted = await renderManim({ code: "class Fine(Scene): pass", outDir: dir, signal: controller.signal });
		assert.match(aborted.log!, /abort/i);
	} finally {
		if (previous === undefined) delete process.env.PATH;
		else process.env.PATH = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("local runner passes scene, media path and PYTHONPATH and collects finished videos", async () => {
	if (process.platform === "win32") return;
	const dir = await mkdtemp(join(tmpdir(), "psi-manim-fake-"));
	const previous = process.env.PATH;
	try {
		const bin = join(dir, "manim");
		// A stub renderer checks orchestration without importing or rendering Manim.
		await writeFile(bin, `#!${process.execPath}\n` +
			'import fs from "node:fs"; import path from "node:path";\n' +
			'const args = process.argv.slice(2); const media = args[args.indexOf("--media_dir") + 1];\n' +
			'fs.mkdirSync(media, { recursive: true }); fs.writeFileSync(path.join(media, "Demo.mp4"), "video");\n' +
			'fs.writeFileSync(path.join(media, "args.json"), JSON.stringify({ args, python: process.env.PYTHONPATH }));\n');
		await chmod(bin, 0o755);
		process.env.PATH = dir;
		const result = await renderManim({
			code: "class Demo(PsiScene): pass", outDir: join(dir, "out"), runner: "local", quality: "m",
		});
		assert.equal(result.ok, true, result.log);
		assert.deepEqual(result.outputs, [join(dir, "out/media/Demo.mp4")]);
		const invocation = JSON.parse(await readFile(join(dir, "out/media/args.json"), "utf8"));
		assert.equal(invocation.args[0], "-qm");
		assert.equal(invocation.args.at(-1), "Demo");
		assert.ok(invocation.python.includes("/python"));
	} finally {
		if (previous === undefined) delete process.env.PATH;
		else process.env.PATH = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("abort stops an active renderer and returns diagnostics promptly", async () => {
	if (process.platform === "win32") return;
	const dir = await mkdtemp(join(tmpdir(), "psi-manim-abort-"));
	const previous = process.env.PATH;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const bin = join(dir, "manim");
		await writeFile(bin, `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`);
		await chmod(bin, 0o755);
		process.env.PATH = dir;
		timer = setTimeout(() => controller.abort(), 100);
		const start = Date.now();
		const result = await renderManim({
			code: "class Demo(Scene): pass", outDir: join(dir, "out"), runner: "local", signal: controller.signal,
		});
		assert.equal(result.ok, false);
		assert.match(result.log!, /abort/i);
		assert.ok(Date.now() - start < 5000);
	} finally {
		clearTimeout(timer);
		if (previous === undefined) delete process.env.PATH;
		else process.env.PATH = previous;
		await rm(dir, { recursive: true, force: true });
	}
});
