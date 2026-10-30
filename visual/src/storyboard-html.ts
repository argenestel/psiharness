import type { Storyboard, StoryElement } from "../../core/src/types.ts";
import { paletteFor } from "./palettes.ts";
import type { Palette } from "./palettes.ts";

const FUNCTIONS = new Set([
	"sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "log", "log2", "log10", "sqrt",
	"abs", "pow", "min", "max", "floor", "ceil", "round", "sign", "cbrt", "hypot",
]);
const ANIMS = new Set(["fade", "pop", "slide", "draw", "pulse", "orbit", "float", "grow", "typewriter"]);
const NUMBERS: Record<string, string[]> = {
	circle: ["x", "y", "r"], rect: ["x", "y", "w", "h"], text: ["x", "y"],
	arrow: ["x1", "y1", "x2", "y2"], path: [], equation: ["x", "y"], graph: ["x", "y", "w", "h"],
	vector: ["x", "y", "dx", "dy"], creature: ["x", "y"], particles: ["x", "y", "w", "h", "count"], group: [],
};
type Expr = (x: number) => number;

// Parse the entire expression into closures. No eval / Function, member access, or arbitrary calls.
function graphExpression(source: unknown): Expr {
	if (typeof source !== "string" || !source.trim() || source.length > 4096) {
		throw Error("empty or oversized expression");
	}
	const tokens: string[] = [];
	let rest = source;
	while (rest.length) {
		const match =
			/^(\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Math\.[A-Za-z][A-Za-z0-9]*|x|\*\*|[+*/%(),-])/.exec(rest);
		if (!match) throw Error("unsupported expression token");
		if (match[0].trim()) tokens.push(match[0]);
		rest = rest.slice(match[0].length);
	}
	let i = 0;
	const take = (token: string) => {
		if (tokens[i] !== token) throw Error("expected " + token);
		i++;
	};
	function primary(): Expr {
		const token = tokens[i++];
		if (token === "x") return (x) => x;
		if (token === "(") { const inner = sum(); take(")"); return inner; }
		if (token && /^(?:\d|\.)/.test(token)) {
			const value = Number(token);
			if (!Number.isFinite(value)) throw Error("non-finite literal");
			return () => value;
		}
		if (token?.startsWith("Math.")) {
			const name = token.slice(5);
			if (name === "PI" || name === "E") return () => Math[name];
			if (!FUNCTIONS.has(name)) throw Error("unknown Math member");
			take("(");
			const args: Expr[] = [];
			if (tokens[i] !== ")") {
				args.push(sum());
				while (tokens[i] === ",") { i++; args.push(sum()); }
			}
			take(")");
			const fn = (Math as unknown as Record<string, (...a: number[]) => number>)[name]!;
			return (x) => fn(...args.map((arg) => arg(x)));
		}
		throw Error("expected number, x, or allowed Math call");
	}
	function unary(): Expr {
		if (tokens[i] === "+" || tokens[i] === "-") {
			const sign = tokens[i++] === "-" ? -1 : 1;
			const right = unary(); return (x) => sign * right(x);
		}
		const left = primary();
		if (tokens[i] === "**") { i++; const right = unary(); return (x) => left(x) ** right(x); }
		return left;
	}
	function product(): Expr {
		let left = unary();
		while (["*", "/", "%"].includes(tokens[i] ?? "")) {
			const op = tokens[i++], a = left, b = unary();
			left = (x) => op === "*" ? a(x) * b(x) : op === "/" ? a(x) / b(x) : a(x) % b(x);
		}
		return left;
	}
	function sum(): Expr {
		let left = product();
		while (tokens[i] === "+" || tokens[i] === "-") {
			const op = tokens[i++], a = left, b = product();
			left = (x) => op === "+" ? a(x) + b(x) : a(x) - b(x);
		}
		return left;
	}
	const result = sum();
	if (i !== tokens.length) throw Error("unexpected expression suffix");
	return result;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && !!v.trim();

/** Validate untrusted storyboard data, including nested elements and graph expressions. */
export function validateStoryboard(sb: unknown): string[] {
	const errors: string[] = [];
	if (!record(sb)) return ["Storyboard must be an object"];
	for (const key of ["id", "title", "topic"]) if (!nonempty(sb[key])) errors.push(key + " must be non-empty");
	if (!["3b1b", "kurzgesagt", "plain"].includes(String(sb.style))) errors.push("style is invalid");
	if (!Array.isArray(sb.scenes) || !sb.scenes.length) return [...errors, "scenes must be a non-empty array"];
	const sceneIds = new Set<string>(), elementIds = new Set<string>(), visiting = new Set<unknown>();
	function elements(items: unknown, context: string): void {
		if (!Array.isArray(items)) { errors.push(context + ": elements/children must be an array"); return; }
		for (const item of items) {
			if (!record(item)) { errors.push(context + ": element must be an object"); continue; }
			if (visiting.has(item)) { errors.push(context + ": cyclic group"); continue; }
			visiting.add(item);
			const at = context + "/" + String(item.id);
			if (!nonempty(item.id) || elementIds.has(item.id)) errors.push(at + ": missing or duplicate element id");
			else elementIds.add(item.id);
			if (typeof item.kind !== "string" || !Object.hasOwn(NUMBERS, item.kind)) {
				errors.push(at + ": unknown element kind"); visiting.delete(item); continue;
			}
			if (!record(item.props)) { errors.push(at + ": props must be an object"); visiting.delete(item); continue; }
			const p = item.props;
			for (const key of NUMBERS[item.kind]!) if (!finite(p[key])) errors.push(at + ": " + key + " must be finite");
			for (const [key, value] of Object.entries(p)) {
				if (typeof value === "number" && !finite(value)) errors.push(at + ": " + key + " must be finite");
			}
			for (const [kind, key] of [["text", "text"], ["path", "d"], ["equation", "tex"]]) {
				if (item.kind === kind && typeof p[key!] !== "string") errors.push(at + ": " + key + " must be a string");
			}
			if (item.kind === "graph") {
				try { graphExpression(p.fn); } catch { errors.push(at + ": graph.fn must be a safe math expression"); }
				for (const key of ["domain", "range"]) {
					if (key === "range" && p.range === undefined) continue;
					const pair = p[key];
					if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(finite) || pair[0] >= pair[1]) {
						errors.push(at + ": " + key + " must be two increasing finite numbers");
					}
				}
			}
			for (const key of ["enter", "exit", "loop"]) {
				const anim = item[key];
				if (anim === undefined) continue;
				if (!record(anim) || !ANIMS.has(String(anim.type))) errors.push(at + ": invalid " + key + " animation");
				if (record(anim)) for (const field of ["delay", "duration"]) {
					if (anim[field] !== undefined && (!finite(anim[field]) || Number(anim[field]) < 0)) {
						errors.push(at + ": animation " + field + " must be finite and non-negative");
					}
				}
			}
			if (item.kind === "group") elements(p.children, at);
			visiting.delete(item);
		}
	}
	for (const scene of sb.scenes) {
		if (!record(scene)) { errors.push("scene must be an object"); continue; }
		if (!nonempty(scene.id) || sceneIds.has(scene.id)) errors.push("missing or duplicate scene id");
		else sceneIds.add(scene.id);
		if (!finite(scene.durationSec) || scene.durationSec <= 0) errors.push(String(scene.id) + ": durationSec must be > 0");
		if (typeof scene.narration !== "string") errors.push(String(scene.id) + ": narration must be a string");
		if (scene.camera !== undefined) {
			if (!record(scene.camera)) errors.push("camera must be an object");
			else for (const key of ["x", "y", "zoom"]) {
				const v = scene.camera[key];
				if (v !== undefined && (!finite(v) || (key === "zoom" && v <= 0))) errors.push("invalid camera " + key);
			}
		}
		elements(scene.elements, String(scene.id));
	}
	return errors;
}

function escapeHtml(value: unknown): string {
	return String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
		'"': "&quot;", "'": "&#39;" })[s]!);
}
function safeJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function renderElement(e: StoryElement, palette: Palette): string {
	const p = e.props, h = escapeHtml;
	const n = (key: string, fallback = 0) => finite(p[key]) ? p[key] as number : fallback;
	const color = (key: string, fallback: string) => h(p[key] ?? fallback);
	const fill = color("fill", palette.accent[0]!), stroke = color("stroke", palette.fg);
	const x = n("x"), y = n("y");
	const line = (x1: number, y1: number, x2: number, y2: number) =>
		`<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${stroke}"
		stroke-width="${n("width", 4)}" marker-end="url(#psi-arrow)"/>`;
	let body = "";
	switch (e.kind) {
		case "circle": body = `<circle cx="${x}" cy="${y}" r="${n("r")}" fill="${fill}"
			stroke="${color("stroke", "none")}"/>`; break;
		case "rect": body = `<rect x="${x}" y="${y}" width="${n("w")}" height="${n("h")}" rx="${n("rx")}" fill="${fill}"
			stroke="${color("stroke", "none")}"/>`; break;
		case "text": body = `<text x="${x}" y="${y}" font-size="${n("size", 44)}" fill="${color("fill", palette.fg)}"
			font-weight="${h(p.weight ?? 500)}" text-anchor="${h(p.align ?? "start")}">${h(p.text)}</text>`; break;
		case "arrow": body = line(n("x1"), n("y1"), n("x2"), n("y2")); break;
		case "path": body = `<path d="${h(p.d)}" fill="${color("fill", "none")}" stroke="${stroke}"
			stroke-width="${n("width", 3)}"/>`; break;
		case "vector": body = line(x, y, x + n("dx"), y + n("dy")) +
			`<text x="${x + n("dx") + 16}" y="${y + n("dy")}" fill="${stroke}" font-size="28">${h(p.label ?? "")}</text>`; break;
		case "equation": body = `<foreignObject x="${x}" y="${y - n("size", 48)}"
			width="${n("w", 1000)}" height="${n("h", 180)}"><div xmlns="http://www.w3.org/1999/xhtml"
			class="equation" style="font-size:${n("size", 48)}px;color:${color("fill", palette.fg)}"
			><code>${h(p.tex)}</code></div></foreignObject>`; break;
		case "graph": {
			const fn = graphExpression(p.fn), [a, b] = p.domain as number[];
			const values = Array.from({ length: 201 }, (_, i) => fn(a! + (b! - a!) * i / 200));
			const valid = values.filter(Number.isFinite);
			let [lo, hi] = (p.range as number[] | undefined) ??
				[valid.length ? Math.min(...valid) : -1, valid.length ? Math.max(...valid) : 1];
			if (lo === hi) { lo! -= 1; hi! += 1; }
			let pen = false, d = "";
			values.forEach((v, i) => {
				if (!Number.isFinite(v) || v < lo! || v > hi!) { pen = false; return; }
				const px = x + n("w") * i / 200, py = y + n("h") * (1 - (v - lo!) / (hi! - lo!));
				d += `${pen ? "L" : "M"}${px.toFixed(2)} ${py.toFixed(2)} `; pen = true;
			});
			body = `<path d="${d}" fill="none" stroke="${color("stroke", palette.accent[0]!)}" stroke-width="3"/>`;
			break;
		}
		case "group": body = `<g transform="translate(${x} ${y}) scale(${n("scale", 1)}) rotate(${n("rotate")})">` +
			(p.children as StoryElement[]).map((child) => renderElement(child, palette)).join("") + "</g>"; break;
		case "creature": {
			const mouth = p.mood === "surprised" ? '<ellipse cx="0" cy="32" rx="14" ry="22"/>' :
				p.mood === "curious" ? '<ellipse cx="8" cy="30" rx="9" ry="10"/>' :
				'<path d="M -24 22 Q 0 52 24 22" fill="none" stroke="#182044" stroke-width="6" stroke-linecap="round"/>';
			body = `<g transform="translate(${x} ${y}) scale(${n("size", 100) / 100})">
			<path d="M -85 10 C -120 -100 90 -135 100 -10 C 130 110 -100 120 -85 10"
			fill="${color("color", palette.accent[0]!)}"/>
			<ellipse cx="-65" cy="85" rx="22" ry="12" fill="${color("color", palette.accent[0]!)}"/>
			<ellipse cx="65" cy="85" rx="22" ry="12" fill="${color("color", palette.accent[0]!)}"/>
			${[-34, 34].map((cx) => `<ellipse cx="${cx}" cy="-20" rx="28" ry="34" fill="white"/>
			<ellipse cx="${cx + 6}" cy="-16" rx="13" ry="19" fill="#182044"/>
			<circle cx="${cx + 10}" cy="-24" r="5" fill="white"/>`).join("")}
			<ellipse cx="-65" cy="22" rx="18" ry="9" fill="#f465a9" opacity=".65"/>
			<ellipse cx="65" cy="22" rx="18" ry="9" fill="#f465a9" opacity=".65"/>
			<g fill="#182044">${mouth}</g></g>`;
			break;
		}
		case "particles": {
			let seed = Array.from(e.id).reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 17);
			const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
			for (let i = 0; i < Math.min(300, Math.max(0, Math.floor(n("count")))); i++) {
				body += `<g data-drift="${(4 + random() * 6).toFixed(2)}" data-speed="${n("speed", 1)}">
				<circle cx="${(x + random() * n("w")).toFixed(2)}" cy="${(y + random() * n("h")).toFixed(2)}"
				r="${(2 + random() * 5).toFixed(2)}" fill="${color("color", palette.accent[0]!)}" opacity=".65"/></g>`;
			}
			break;
		}
	}
	// Independent wrapper layers prevent enter/exit/loop transforms overwriting each other or group transforms.
	return `<g data-element="${h(e.id)}"><g data-layer="enter"><g data-layer="exit">
		<g data-layer="loop">${body}</g></g></g></g>`;
}

const CLIENT = String.raw`
(() => {
"use strict";
const data = JSON.parse(document.getElementById("psi-data").textContent);
const sb = data.storyboard, stage = document.getElementById("stage");
const scenes = Array.from(document.querySelectorAll(".scene"));
const play = document.getElementById("play"), scrub = document.getElementById("scrub");
const caption = document.getElementById("caption"), clock = document.getElementById("clock");
const title = document.getElementById("title-card");
const starts = [0];
sb.scenes.forEach(s => starts.push(starts[starts.length - 1] + s.durationSec));
const total = starts[starts.length - 1];
scrub.max = total;
let time = 0, playing = false, active = -1, last = 0, animations = [], started = false;
const speech = window.speechSynthesis;
function cancelSpeech() { if (speech) { try { speech.cancel(); } catch (_) {} } }
function speak(index) {
 if (data.speech && speech && window.SpeechSynthesisUtterance && playing) {
  cancelSpeech();
  try { speech.speak(new SpeechSynthesisUtterance(sb.scenes[index].narration)); } catch (_) {}
 }
}
function addAnimation(node, frames, offset, duration, loop) {
 if (!node.animate) return;
 const animation = node.animate(frames, { duration: Math.max(1, duration * 1000),
  iterations: loop ? Infinity : 1, fill: "both", easing: "ease-in-out" });
 animation.pause(); animations.push({ animation, offset });
}
function animate(node, anim, phase, sceneDuration) {
 const a = anim || {type:"fade"}, duration = a.duration === undefined ? .6 : a.duration;
 const delay = a.delay || 0;
 const offset = phase === "exit" ? Math.max(0, sceneDuration - duration - delay) : delay;
 let frames;
 switch (a.type) {
  case "pop": frames = [{transform:"scale(0)",opacity:0},{transform:"scale(1.12)",opacity:1},
   {transform:"scale(1)",opacity:1}]; break;
  case "grow": frames = [{transform:"scale(0)"},{transform:"scale(1)"}]; break;
  case "slide": {
   const shifts = {left:"-160px,0",right:"160px,0",top:"0,-120px",bottom:"0,120px"};
   frames = [{transform:"translate(" + (shifts[a.from] || shifts.left) + ")",opacity:0},
    {transform:"translate(0,0)",opacity:1}]; break;
  }
  case "pulse": frames = [{transform:"scale(1)"},{transform:"scale(1.07)"},{transform:"scale(1)"}]; break;
  case "orbit": frames = [{transform:"rotate(0deg)"},{transform:"rotate(360deg)"}]; break;
  case "float": frames = [{transform:"translateY(0)"},{transform:"translateY(-18px)"},
   {transform:"translateY(0)"}]; break;
  case "typewriter": frames = [{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)"}]; break;
  case "draw": {
   node.querySelectorAll("path,polyline,line,circle,rect").forEach(shape => {
    if (!shape.getTotalLength) return;
    const length = shape.getTotalLength();
    shape.style.strokeDasharray = length;
    const f = [{strokeDashoffset:length},{strokeDashoffset:0}];
    addAnimation(shape, phase === "exit" ? f.reverse() : f, offset, duration, phase === "loop");
   }); return;
  }
  default: frames = [{opacity:0},{opacity:1}];
 }
 node.style.transformBox = "fill-box"; node.style.transformOrigin = "center";
 if (phase === "exit") frames.reverse();
 addAnimation(node, frames, offset, duration, phase === "loop");
}
function activate(index) {
 animations.forEach(a => a.animation.cancel()); animations = [];
 scenes.forEach((s, i) => { s.style.display = i === index ? "inline" : "none"; });
 active = index;
 const scene = sb.scenes[index], nodes = new Map();
 scenes[index].querySelectorAll("[data-element]").forEach(n => nodes.set(n.dataset.element, n));
 function visit(elements) {
  elements.forEach(e => {
   const node = nodes.get(e.id), enter = node.firstElementChild;
   animate(enter, e.enter, "enter", scene.durationSec);
   if (e.exit) animate(enter.firstElementChild, e.exit, "exit", scene.durationSec);
   if (e.loop) animate(enter.firstElementChild.firstElementChild, e.loop, "loop", scene.durationSec);
   if (e.kind === "group") visit(e.props.children);
  });
 }
 visit(scene.elements);
 scenes[index].querySelectorAll("[data-drift]").forEach(n => {
  const speed = Number(n.dataset.speed), d = 24 * speed;
  addAnimation(n, [{transform:"translate(0,0)"},{transform:"translate(" + d + "px,-18px)"},
   {transform:"translate(0,0)"}], 0, Number(n.dataset.drift), true);
 });
 caption.textContent = scene.narration; speak(index);
}
// Camera x/y are absolute canvas centers when supplied; absent centers use (800,450).
// Thus the default camera produces viewBox 0 0 1600 900, and zoom z gives 1600/z by 900/z.
function camera(c) {
 c = c || {}; const z = c.zoom || 1, w = 1600/z, h = 900/z;
 return [(c.x === undefined ? 800 : c.x)-w/2,(c.y === undefined ? 450 : c.y)-h/2,w,h];
}
function update() {
 let index = sb.scenes.length - 1;
 for (let i=0; i<sb.scenes.length; i++) if (time < starts[i+1]) {index=i;break;}
 if (index !== active) activate(index);
 const local = time-starts[index], progress = Math.min(1, local/sb.scenes[index].durationSec);
 const from = camera(index ? sb.scenes[index-1].camera : undefined), to = camera(sb.scenes[index].camera);
 stage.setAttribute("viewBox", from.map((v,i) => v+(to[i]-v)*progress).join(" "));
 animations.forEach(a => { a.animation.currentTime = (local-a.offset)*1000; });
 scrub.value = time; clock.textContent = time.toFixed(1) + " / " + total.toFixed(1) + " s";
 title.hidden = started; play.textContent = playing ? "Pause" : "Play";
}
function setPlaying(value) {
 playing = value; cancelSpeech();
 if (playing) { started=true; if(time>=total) time=0; last=performance.now(); }
 const old = active; update(); if (playing && old === active) speak(active);
}
function seek(value) {
 cancelSpeech(); time=Math.max(0,Math.min(total,value)); started=true;
 update(); if (playing) { cancelSpeech(); speak(active); }
}
function move(delta) {
 seek(starts[Math.max(0,Math.min(sb.scenes.length-1,active+delta))]);
}
play.addEventListener("click", () => setPlaying(!playing));
document.getElementById("prev").addEventListener("click", () => move(-1));
document.getElementById("next").addEventListener("click", () => move(1));
scrub.addEventListener("input", () => seek(Number(scrub.value)));
document.addEventListener("keydown", e => {
 if (e.target.matches("input,textarea,button,select") || e.target.isContentEditable) return;
 if (e.code === "Space") {e.preventDefault();setPlaying(!playing);}
 if (e.code === "ArrowLeft") {e.preventDefault();move(-1);}
 if (e.code === "ArrowRight") {e.preventDefault();move(1);}
});
function frame(now) {
 if (playing) {
  time=Math.min(total,time+(now-last)/1000);
  if(time>=total) {playing=false;cancelSpeech();}
  update();
 }
 last=now; requestAnimationFrame(frame);
}
window.addEventListener("pagehide", cancelSpeech);
function typeset() {
 if (!window.katex) return;
 document.querySelectorAll(".equation").forEach(node => {
  const tex=node.textContent;
  try { window.katex.render(tex,node,{throwOnError:false,trust:false}); } catch (_) { node.textContent=tex; }
 });
}
const katexScript=document.getElementById("katex-script");
katexScript.addEventListener("load", typeset); typeset();
update(); requestAnimationFrame(frame);
if(data.autoplay) setPlaying(true);
})();
`;

/** Render a portable SVG storyboard player with deterministic, seekable scene timelines. */
export function renderStoryboardHtml(sb: Storyboard, opts: { autoplay?: boolean; speech?: boolean } = {}): string {
	const errors = validateStoryboard(sb);
	if (errors.length) throw Error("Invalid storyboard:\n" + errors.join("\n"));
	const p = paletteFor(sb.style, sb.palette), h = escapeHtml, kurz = sb.style === "kurzgesagt";
	let elapsed = 0;
	const ticks = sb.scenes.map((s) => {
		const value = elapsed; elapsed += s.durationSec;
		return `<option value="${value}"></option>`;
	}).join("");
	const scenes = sb.scenes.map((scene, i) => {
		const bg = scene.background === "deep" ? p.deep :
			!scene.background || scene.background === "bg" ? p.bg : scene.background;
		return `<g class="scene" data-scene="${h(scene.id)}" style="display:${i ? "none" : "inline"}">
		<rect x="-100000" y="-100000" width="200000" height="200000" fill="${h(bg)}"/>
		${scene.elements.map((e) => renderElement(e, p)).join("\n")}</g>`;
	}).join("\n");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(sb.title)}</title>
<link href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:${h(p.deep)};color:${h(p.fg)};font-family:system-ui,sans-serif}
main{max-width:1280px;margin:3vh auto;padding:16px}.screen{position:relative;aspect-ratio:16/9;overflow:hidden;
border-radius:18px;background:${h(p.bg)};box-shadow:0 18px 70px #0005}svg{display:block;width:100%;height:100%}
.equation{font-family:monospace;white-space:pre-wrap}
#title-card{position:absolute;inset:0;display:grid;place-content:center;
text-align:center;padding:5%;background:${h(p.bg)}ed}#title-card[hidden]{display:none}
h1{font-size:clamp(24px,4vw,56px);margin:0 0 12px}
#title-card p{color:${h(p.muted)}}.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 0}
button{background:${h(p.bg)};color:${h(p.fg)};border:1px solid ${h(p.muted)};
padding:10px 18px;border-radius:24px;cursor:pointer}
button:focus-visible,input:focus-visible{outline:3px solid ${h(p.accent[0])};outline-offset:3px}
input{flex:1;min-width:140px;accent-color:${h(p.accent[0])}}#clock{font-variant-numeric:tabular-nums;font-size:14px}
#caption{min-height:4em;line-height:1.6;font-size:clamp(16px,2vw,21px);margin:0;padding:16px 22px;
border-left:3px solid ${h(p.accent[0])};background:${h(p.bg)};border-radius:6px}text{font-family:system-ui,sans-serif}
${kurz ? '.scene>[data-element]{filter:url(#psi-glow)}' : ''}
</style></head><body><main><div class="screen">
<svg id="stage" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"
role="img" aria-label="${h(sb.title)}">
<defs><marker id="psi-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker>
<radialGradient id="psi-vignette"><stop offset="40%" stop-color="#000" stop-opacity="0"/>
<stop offset="100%" stop-color="#000" stop-opacity=".4"/></radialGradient>
<filter id="psi-glow" x="-30%" y="-30%" width="160%" height="160%">
<feFlood flood-color="${h(p.glow)}" flood-opacity=".15"/><feComposite in2="SourceAlpha" operator="in"/>
<feGaussianBlur stdDeviation="5"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="psi-grain"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" seed="12"/>
<feColorMatrix type="saturate" values="0"/></filter></defs>
${scenes}</svg>
${kurz ? `<svg aria-hidden="true" viewBox="0 0 1600 900" style="position:absolute;inset:0;pointer-events:none">
<rect width="1600" height="900" fill="url(#psi-vignette)"/>
<rect width="1600" height="900" filter="url(#psi-grain)" opacity=".035"/></svg>` : ""}
<div id="title-card"><h1>${h(sb.title)}</h1><p>${h(sb.topic)}</p><p>Press Play to begin</p></div></div>
<div class="controls"><button id="prev" aria-label="Previous scene">Previous</button>
<button id="play">Play</button><button id="next" aria-label="Next scene">Next</button>
<input id="scrub" aria-label="Timeline" type="range" min="0" max="${elapsed}" value="0" step="0.01" list="scene-ticks">
<datalist id="scene-ticks">${ticks}</datalist><output id="clock"></output></div>
<p id="caption" aria-live="polite">${h(sb.scenes[0]!.narration)}</p>
<noscript>${sb.scenes.map((s) => `<p>${h(s.narration)}</p>`).join("")}</noscript></main>
<script type="application/json" id="psi-data">${safeJson({
	storyboard: sb, autoplay: !!opts.autoplay, speech: !!opts.speech,
})}</script>
<script id="katex-script" src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" async></script>
<script>${CLIENT}</script></body></html>`;
}
