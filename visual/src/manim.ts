import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderResult, Storyboard, StoryElement } from "../../core/src/types.ts";

const py = (s: unknown): string => JSON.stringify(String(s ?? ""));
const num = (v: unknown, fallback = 0): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const unitX = (x: unknown): number => Number(((num(x) - 800) * 14.22 / 1600).toFixed(6));
const unitY = (y: unknown): number => Number((4 - num(y) * 8 / 900).toFixed(6));
const point = (x: unknown, y: unknown): string => `[${unitX(x)}, ${unitY(y)}, 0]`;
const width = (n: unknown): number => num(n) * 14.22 / 1600;
const height = (n: unknown): number => num(n) * 8 / 900;
const colors: Record<string, string> = {
	bg: "#0f0f0f", deep: "#090b21", fg: "#ffffff", muted: "#888888",
	blue: "#58C4DD", yellow: "#FFF39A", green: "#83C167", red: "#FC6255",
};
const color = (v: unknown, fallback = "#58C4DD"): string => py(colors[String(v)] ?? v ?? fallback);

function expression(fn: unknown): string {
	const functions: Record<string, string> = { asin: "arcsin", acos: "arccos", atan: "arctan", pow: "power" };
	const translated = String(fn ?? "x").replace(/Math\.(PI|E)\b/g, (_, k: string) => k === "PI" ? "np.pi" : "np.e")
		.replace(/Math\.(sin|cos|tan|asin|acos|atan|sqrt|abs|exp|log|log10|floor|ceil|pow)\b/g,
			(_, k: string) => `np.${functions[k] ?? k}`);
	// Expressions are math only: no strings, attributes other than the numpy whitelist, or statements.
	const stripped = translated
		.replace(/np\.(?:arcsin|arccos|arctan|sin|cos|tan|sqrt|abs|exp|log10|log|floor|ceil|power|pi|e)\b/g, "")
		.replace(/\bx\b/g, "").replace(/\b\d+(?:\.\d*)?(?:e[+-]?\d+)?\b/gi, "");
	return translated.trim() && /^[\s+\-*/%(),.]*$/.test(stripped) ? translated : "0";
}

/** Transpile a storyboard into a single importable Manim scene. */
export function storyboardToManim(sb: Storyboard): string {
	let className = sb.id.split(/[^a-zA-Z0-9]+/).filter(Boolean)
		.map((s) => s[0]!.toUpperCase() + s.slice(1)).join("") || "Storyboard";
	if (/^\d/.test(className)) className = `Story${className}`;
	if (["None", "True", "False"].includes(className)) className += "Story";
	const lines = ["from manim import *", "import numpy as np", "from psi_manim import PsiScene", "",
		"config.frame_width = 14.22", "config.frame_height = 8", "", `class ${className}(PsiScene):`,
		"    def construct(self):"];
	const emit = (s: string): void => { lines.push(`        ${s}`); };
	let serial = 0;
	function element(el: StoryElement): string {
		const p = el.props;
		const name = `obj_${serial++}`;
		let code: string;
		const pos = `.move_to(${point(p.x, p.y)})`;
		switch (el.kind) {
			case "circle": code = `Circle(radius=${width(p.r)}, color=${color(p.stroke ?? p.fill)})${pos}`; break;
			case "rect": code = `Rectangle(width=${width(p.w)}, height=${height(p.h)}, color=${color(p.stroke ?? p.fill)})`
				+ `.move_to(${point(num(p.x) + num(p.w) / 2, num(p.y) + num(p.h) / 2)})`; break;
			case "text": {
				const edge = p.align === "start" ? ", aligned_edge=LEFT" : p.align === "end" ? ", aligned_edge=RIGHT" : "";
				code = `Text(${py(p.text)}, font_size=${num(p.size, 36) * 0.64}, color=${color(p.fill, "#ffffff")})`
					+ `.move_to(${point(p.x, p.y)}${edge})`;
				break;
			}
			case "equation":
				code = `MathTex(${py(p.tex)}, font_size=${num(p.size, 40) * 0.64}, `
					+ `color=${color(p.fill, "#ffffff")})${pos}`;
				break;
			case "arrow":
				code = `Arrow(${point(p.x1, p.y1)}, ${point(p.x2, p.y2)}, buff=0, `
					+ `color=${color(p.stroke)}, stroke_width=${num(p.width, 4)})`;
				break;
			case "vector":
				code = `Arrow(${point(p.x, p.y)}, ${point(num(p.x) + num(p.dx), num(p.y) + num(p.dy))}, `
					+ `buff=0, color=${color(p.stroke)})`;
				break;
			case "graph": {
				const domain = Array.isArray(p.domain) ? p.domain : [-5, 5];
				const range = Array.isArray(p.range) ? p.range : [-3, 3];
				emit(`${name}_axes = Axes(x_range=[${num(domain[0], -5)}, ${num(domain[1], 5)}], `
					+ `y_range=[${num(range[0], -3)}, ${num(range[1], 3)}], `
					+ `x_length=${width(p.w)}, y_length=${height(p.h)}, tips=False)`
					+ `.move_to(${point(num(p.x) + num(p.w) / 2, num(p.y) + num(p.h) / 2)})`);
				code = `VGroup(${name}_axes, ${name}_axes.plot(lambda x: ${expression(p.fn)}, color=${color(p.stroke)}))`;
				break;
			}
			case "group": {
				const children = Array.isArray(p.children) ? (p.children as StoryElement[]).map(element) : [];
				code = `VGroup(${children.join(", ")}).scale(${num(p.scale, 1)}).rotate(${-num(p.rotate)} * DEGREES)`
					+ `.shift([${width(p.x)}, ${-height(p.y)}, 0])`;
				break;
			}
			default:
				emit(`# Unsupported kind: ${el.kind}; simple placeholder`);
				code = `Dot(${point(p.x, p.y)}, color=${color(p.color)})`;
		}
		emit(`${name} = ${code}`);
		if ((el.kind === "circle" || el.kind === "rect") && p.fill && p.fill !== "none") {
			emit(`${name}.set_fill(${color(p.fill)}, opacity=1)`);
		}
		return name;
	}
	if (!sb.scenes.length) emit("pass");
	for (const scene of sb.scenes) {
		emit("self.clear()");
		emit(`self.camera.background_color = ${color(scene.background, sb.style === "kurzgesagt" ? "#10143b" : "#0f0f0f")}`);
		const duration = Math.max(0, num(scene.durationSec));
		const anims: string[] = [];
		let elapsed = 0;
		for (const el of scene.elements) {
			const name = element(el);
			if (!el.enter || duration === 0) { emit(`self.add(${name})`); continue; }
			const delay = Math.min(duration, Math.max(0, num(el.enter.delay)));
			const time = Math.min(duration - delay, Math.max(0, num(el.enter.duration, 0.6)));
			if (!time) { emit(`self.add(${name})`); continue; }
			const animation = ({ draw: "Create", fade: "FadeIn", grow: "GrowFromCenter", pop: "GrowFromCenter",
				typewriter: "Write", pulse: "DrawBorderThenFill" } as Record<string, string>)[el.enter.type] ?? "FadeIn";
			const directions: Record<string, string> = { left: "LEFT", right: "RIGHT", top: "UP", bottom: "DOWN" };
			const direction = directions[el.enter.from ?? "left"];
			const shift = el.enter.type === "slide" ? `, shift=-${direction}` : "";
			const a = `${animation}(${name}, run_time=${time}${shift})`;
			anims.push(delay ? `Succession(Wait(${delay}), ${a})` : a);
			elapsed = Math.max(elapsed, delay + time);
		}
		emit(`self.caption(${py(scene.narration)})`);
		if (anims.length) emit(`self.play(AnimationGroup(${anims.join(", ")}, lag_ratio=0))`);
		emit(`self.narrate(${py(scene.narration)}, run_time=${Math.max(0, duration - elapsed)})`);
	}
	return `${lines.join("\n")}\n`;
}

interface CommandResult { ok: boolean; log: string }
function run(command: string, args: string[], timeout: number, signal?: AbortSignal,
	env = process.env): Promise<CommandResult> {
	return new Promise((done) => {
		if (signal?.aborted) { done({ ok: false, log: "Render aborted" }); return; }
		let log = "";
		let reason = "";
		const child = spawn(command, args, {
			env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
		});
		const append = (chunk: Buffer): void => { log = (log + chunk.toString()).slice(-16000); };
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const kill = (why: string): void => {
			reason = why;
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch { /* Process already exited. */ }
		};
		const abort = (): void => kill("Render aborted");
		const timer = setTimeout(() => kill("Command timed out"), timeout);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		const finish = (ok: boolean, error = ""): void => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			done({ ok, log: [log, reason, error].filter(Boolean).join("\n") });
		};
		child.on("error", (error) => finish(false, error.message));
		child.on("close", (code) => finish(code === 0 && !reason, code ? `Exit code ${code}` : ""));
	});
}

/** Manim release used by the uv fallback and Docker images. */
export const MANIM_VERSION = "0.22.1";
type Runner = "auto" | "local" | "docker";
type LocalCommand = { command: string; prefix: string[]; via: "manim" | "uv" };
const uvCommand = (): LocalCommand => ({
	command: "uv", prefix: ["run", "--no-project", "--with", `manim==${process.env.PSI_MANIM_VERSION || MANIM_VERSION}`,
		"manim"], via: "uv",
});

/** Resolve a local manim: the `manim` binary, else `uv run --with manim==…` when uv exists. */
async function localManim(signal?: AbortSignal): Promise<LocalCommand | undefined> {
	if ((await run("manim", ["--version"], 10000, signal)).ok) return { command: "manim", prefix: [], via: "manim" };
	if ((await run("uv", ["--version"], 10000, signal)).ok) return uvCommand();
	return undefined;
}

/** The runner preference from PSI_MANIM_RUNNER (auto|local|docker), defaulting to auto. */
export function envRunner(value = process.env.PSI_MANIM_RUNNER): Runner {
	const runner = value?.trim().toLowerCase();
	return runner === "local" || runner === "docker" ? runner : "auto";
}

/** Check local manim (binary or uv fallback) and the configured Docker image independently. */
export async function manimAvailable(): Promise<{ local: boolean; docker: boolean; via?: "manim" | "uv" }> {
	const [local, docker] = await Promise.all([
		localManim(),
		run("docker", ["image", "inspect", process.env.PSI_MANIM_IMAGE ?? "psi-manim:latest"], 10000),
	]);
	return { local: Boolean(local), docker: docker.ok, ...(local ? { via: local.via } : {}) };
}

async function videos(dir: string): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	async function scan(current: string): Promise<void> {
		let items;
		try { items = await readdir(current, { withFileTypes: true }); } catch { return; }
		for (const item of items) {
			const path = join(current, item.name);
			if (item.isDirectory() && item.name !== "partial_movie_files") await scan(path);
			else if (item.isFile() && item.name.endsWith(".mp4")) {
				const info = await stat(path).catch(() => undefined);
				if (info) found.set(path, `${info.mtimeMs}:${info.size}`);
			}
		}
	}
	await scan(dir);
	return found;
}

/** Render Python locally or in Docker; render and filesystem failures are returned as diagnostics. */
export async function renderManim(opts: {
	code: string; scene?: string; outDir: string; quality?: "l" | "m" | "h";
	runner?: Runner; signal?: AbortSignal;
}): Promise<RenderResult> {
	let temp: string | undefined;
	let container: string | undefined;
	try {
		if (opts.signal?.aborted) return { ok: false, outputs: [], log: "Render aborted" };
		const scene = opts.scene ?? opts.code.match(/^\s*class\s+(\w+)\s*\([^\n)]*\b\w*Scene\b[^\n)]*\)\s*:/m)?.[1];
		if (!scene || !/^[A-Za-z_]\w*$/.test(scene)) return { ok: false, outputs: [], log: "No valid Scene class found" };
		const out = resolve(opts.outDir);
		await mkdir(out, { recursive: true });
		temp = await mkdtemp(join(tmpdir(), "psi-manim-"));
		await writeFile(join(temp, "scene.py"), opts.code);
		let runner = opts.runner ?? envRunner();
		let local: LocalCommand | undefined;
		if (runner === "auto") {
			local = await localManim(opts.signal);
			if (opts.signal?.aborted) return { ok: false, outputs: [], log: "Render aborted" };
			const docker = local ? false : (await run("docker",
				["image", "inspect", process.env.PSI_MANIM_IMAGE ?? "psi-manim:latest"], 10000, opts.signal)).ok;
			if (!local && !docker) return {
				ok: false, outputs: [],
				log: "Manim is unavailable: no `manim` or `uv` on PATH, and the Docker image is unavailable",
			};
			runner = local ? "local" : "docker";
		} else if (runner === "local") {
			// Explicit local: still fall back to uv when the manim binary is missing.
			local = await localManim(opts.signal) ?? { command: "manim", prefix: [], via: "manim" };
		}
		const pythonDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../python");
		const media = join(out, "media");
		const before = await videos(media);
		const args = [`-q${opts.quality ?? "l"}`, "--media_dir", runner === "local" ? media : "/out/media",
			runner === "local" ? join(temp, "scene.py") : "/work/scene.py", scene];
		if (runner === "docker") container = `psi-manim-${process.pid}-${temp.split(/[\\/]/).at(-1)}`;
		const result = runner === "local"
			? await run(local!.command, [...local!.prefix, ...args], 600000, opts.signal, {
				...process.env,
				PYTHONPATH: [pythonDir, process.env.PYTHONPATH].filter(Boolean)
					.join(process.platform === "win32" ? ";" : ":"),
			})
			: await run("docker", ["run", "--rm", "--name", container!, "-v", `${temp}:/work:ro`, "-v", `${out}:/out`,
				"-v", `${pythonDir}:/psi-python:ro`, "-e", "PYTHONPATH=/psi-python",
				process.env.PSI_MANIM_IMAGE ?? "psi-manim:latest", "manim", ...args], 600000, opts.signal);
		// Report only videos this render created or rewrote, never stale MP4s from earlier renders.
		const outputs = [...await videos(media)].filter(([path, stamp]) => before.get(path) !== stamp)
			.map(([path]) => path).sort();
		const via = runner === "local" ? local!.via : "docker";
		return result.ok && outputs.length ? { ok: true, outputs } : {
			ok: false, outputs, log: [result.ok ? "Manim produced no new MP4 output" : "", result.log, `runner: ${via}`]
				.filter(Boolean).join("\n"),
		};
	} catch (error) {
		return { ok: false, outputs: [], log: error instanceof Error ? error.message : String(error) };
	} finally {
		// Killing the Docker client does not stop its container; clean up after aborts/timeouts too.
		if (container) await run("docker", ["rm", "-f", container], 10000);
		if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
	}
}
