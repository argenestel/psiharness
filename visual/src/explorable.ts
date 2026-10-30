import type { ExplorableSpec, VisualStyle } from "../../core/src/types.ts";

const MATH_MEMBERS = [
	"abs", "acos", "asin", "atan", "atan2", "cos", "sin", "tan", "exp", "log", "log2", "log10", "sqrt",
	"cbrt", "pow", "floor", "ceil", "round", "min", "max", "sign", "hypot", "PI", "E", "LN2", "LN10", "trunc",
];
const RESERVED = new Set((
	"break case catch class const continue debugger default delete do else export extends finally for function if " +
	"import in instanceof new return super switch this throw try typeof var void while with yield let static enum " +
	"await implements interface package private protected public null true false eval arguments undefined NaN Infinity " +
	"constructor prototype __proto__ x y t Math"
).split(" "));
const TEMPLATES = [
	"function-plot", "linear-transform", "vector-field", "fourier-epicycles", "probability-sim", "exponential-growth",
];
const COLORS: Record<VisualStyle, { bg: string; fg: string; grid: string; accents: string[]; panel: string }> = {
	"3b1b": { bg: "#0b101c", fg: "#edf3ff", grid: "#23456b", accents: ["#58b8ff", "#ffe36d", "#6ee7a0", "#ff6c85"],
		panel: "#151f30" },
	kurzgesagt: { bg: "#24164d", fg: "#fff5e9", grid: "#59427c", accents: ["#36d5ee", "#ffc857", "#57e6a5", "#ff668e"],
		panel: "#382360" },
	plain: { bg: "#f7f8fa", fg: "#202c3b", grid: "#d5dde7", accents: ["#2166ac", "#a86500", "#17804c", "#c43748"],
		panel: "#ffffff" },
};

/** Tokenize the entire expression before any compilation; dots belong exclusively to Math members. */
function expressionSource(expression: string, names: string[], members: string[]): string {
	const allowed = new Set(names);
	let source = "";
	let rest = expression;
	if (!rest.trim()) throw new Error("Expression must not be empty");
	while (rest.length) {
		const whitespace = /^\s+/.exec(rest);
		if (whitespace) { rest = rest.slice(whitespace[0].length); continue; }
		const math = /^Math\s*\.\s*([A-Za-z_$][\w$]*)/.exec(rest);
		const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
		const identifier = /^[A-Za-z_$][\w$]*/.exec(rest);
		const operator = /^(?:===|!==|<=|>=|==|!=|\*\*|[+*/%()?,:<>^\-])/.exec(rest);
		let token: string;
		if (math) {
			if (!members.includes(math[1])) throw new Error("Forbidden Math member: " + math[1]);
			token = math[0];
		} else if (number) token = number[0];
		else if (identifier) {
			if (!allowed.has(identifier[0])) throw new Error("Unknown or forbidden identifier: " + identifier[0]);
			token = identifier[0];
		} else if (operator) {
			if (rest.startsWith("++") || rest.startsWith("--")) throw new Error("Increment/decrement is forbidden");
			token = operator[0];
		} else throw new Error("Forbidden expression token near: " + rest.slice(0, 16));
		source += (token === "^" ? "**" : token) + " ";
		rest = rest.slice(token.length);
	}
	return source;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function pair(value: unknown): value is [number, number] {
	return Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
}

/** Return all structural, slider, and expression errors; malformed input never throws. */
export function validateExplorable(spec: ExplorableSpec | unknown): string[] {
	const errors: string[] = [];
	try {
		if (!record(spec)) return ["spec must be an object"];
		for (const key of ["id", "title", "topic"]) {
			if (typeof spec[key] !== "string") errors.push(key + " must be a string");
		}
		if (spec.conceptId !== undefined && typeof spec.conceptId !== "string") errors.push("conceptId must be a string");
		if (!["3b1b", "kurzgesagt", "plain"].includes(spec.style as string)) errors.push("Unknown style");
		if (!TEMPLATES.includes(spec.template as string)) errors.push("Unknown template");
		if (!Array.isArray(spec.prompts) || !Array.from(spec.prompts).every((p) => typeof p === "string")) {
			errors.push("prompts must be an array of strings");
		}
		const names: string[] = [];
		if (!Array.isArray(spec.sliders)) errors.push("sliders must be an array");
		else for (const [index, slider] of spec.sliders.entries()) {
			const prefix = "slider " + index + ": ";
			if (!record(slider)) { errors.push(prefix + "must be an object"); continue; }
			if (typeof slider.name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(slider.name) ||
				RESERVED.has(slider.name) || names.includes(slider.name)) {
				errors.push(prefix + "name must be a unique, non-reserved identifier");
			} else names.push(slider.name);
			if (typeof slider.label !== "string") errors.push(prefix + "label must be a string");
			if (![slider.min, slider.max, slider.step, slider.value].every(finite)) {
				errors.push(prefix + "min/max/step/value must be finite numbers");
			} else {
				if ((slider.min as number) >= (slider.max as number)) errors.push(prefix + "min must be less than max");
				if ((slider.step as number) <= 0) errors.push(prefix + "step must be positive");
				if ((slider.value as number) < (slider.min as number) || (slider.value as number) > (slider.max as number)) {
					errors.push(prefix + "value must be within min/max");
				}
			}
		}
		if (!record(spec.params)) { errors.push("params must be an object"); return errors; }
		const p = spec.params;
		const expr = (key: string, variables: string[], optional = false) => {
			if (optional && p[key] === undefined) return;
			if (typeof p[key] !== "string") { errors.push("params." + key + " must be an expression string"); return; }
			try {
				const source = expressionSource(p[key], [...variables, ...names], MATH_MEMBERS);
				// Token validation above is mandatory even when only checking JavaScript syntax.
				new Function("x", "y", "t", ...names, '"use strict"; return (' + source + ");");
			} catch (error) { errors.push("params." + key + ": " + (error as Error).message); }
		};
		const required = (wanted: string[], exact = false) => {
			if (wanted.some((name) => !names.includes(name)) || (exact && names.length !== wanted.length)) {
				errors.push("Required sliders" + (exact ? " (exactly)" : "") + ": " + wanted.join(", "));
			}
		};
		const points = (key: string, minimum: number) => {
			if (!Array.isArray(p[key]) || p[key].length < minimum || !Array.from(p[key]).every(pair)) {
				errors.push("params." + key + " must contain at least " + minimum + " numeric [x,y] pairs");
			}
		};
		switch (spec.template) {
			case "function-plot":
				expr("fn", ["x"]); expr("compare", ["x"], true);
				for (const key of ["domain", "range"]) {
					if (key === "range" && p[key] === undefined) continue;
					if (!pair(p[key]) || p[key][0] >= p[key][1]) errors.push("params." + key + " must be [min,max], min < max");
				}
				break;
			case "linear-transform":
				required(["a", "b", "c", "d"], true);
				for (const key of ["showDeterminant", "showEigen"]) {
					if (p[key] !== undefined && typeof p[key] !== "boolean") errors.push("params." + key + " must be boolean");
				}
				if (p.vectors !== undefined) points("vectors", 0);
				break;
			case "vector-field": expr("fx", ["x", "y"]); expr("fy", ["x", "y"]); break;
			case "fourier-epicycles":
				required(["terms", "speed"]);
				if (!["square", "sawtooth", "heart", "custom"].includes(p.shape as string)) errors.push("Unknown params.shape");
				if (p.shape === "custom" || p.points !== undefined) points("points", 3);
				break;
			case "probability-sim":
				required(["trials", "p"]);
				if (!["coin", "dice", "galton"].includes(p.experiment as string)) errors.push("Unknown params.experiment");
				break;
			case "exponential-growth":
				required(["rate", "steps", "capacity"]);
				if (!["compound", "doubling", "logistic"].includes(p.mode as string)) errors.push("Unknown params.mode");
				break;
		}
	} catch { errors.push("Unable to read malformed spec"); }
	return errors;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function safeJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Render a validated spec into a self-contained, responsive canvas laboratory. */
export function renderExplorableHtml(spec: ExplorableSpec): string {
	const errors = validateExplorable(spec);
	if (errors.length) throw new Error("Invalid explorable: " + errors.join("; "));
	const theme = COLORS[spec.style];
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(spec.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:${theme.bg};color:${theme.fg};font:16px system-ui,sans-serif}
main{display:grid;grid-template-columns:minmax(0,1fr) 320px;min-height:100dvh}
.stage{position:relative;min-width:0;height:100dvh;padding:16px}
canvas{display:block;width:100%;height:100%;touch-action:none}
aside{padding:32px 26px;background:${theme.panel};overflow:auto;border-left:1px solid ${theme.grid}}
h1{font-size:1.65rem;line-height:1.2;letter-spacing:-.035em;margin:12px 0 32px}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;color:${theme.accents[0]}}
.stage{background:radial-gradient(ellipse at center,${theme.panel},${theme.bg})}
canvas{border-radius:18px;border:1px solid ${theme.grid}}
label{display:flex;justify-content:space-between;gap:12px;margin:24px 0 10px;font-size:14px}output{float:right;font-variant-numeric:tabular-nums}
input{width:100%;min-height:28px;cursor:pointer;accent-color:${theme.accents[0]}}ul{padding-left:20px;line-height:1.6}li{margin:16px 0}
button{background:${theme.bg};color:inherit;border:1px solid ${theme.grid};border-radius:10px;padding:9px;margin:4px}
#status{white-space:pre-line;line-height:1.8;font-size:13px;padding:16px;border:1px solid ${theme.grid};border-radius:12px;font-variant-numeric:tabular-nums}
li{font-size:14px}button{min-height:44px;cursor:pointer}button:hover{border-color:${theme.accents[0]}}
button:focus-visible,input:focus-visible{outline:2px solid ${theme.accents[0]};outline-offset:3px}
canvas:focus-visible{outline:2px solid ${theme.accents[0]}}
@media(max-width:760px){main{grid-template-columns:1fr}.stage{height:52dvh;min-height:340px;padding:12px}aside{padding:22px;border-left:0;border-top:1px solid ${theme.grid}}h1{margin-bottom:20px}}
</style></head><body><main><section class="stage" aria-label="Interactive visualization">
<canvas tabindex="0" aria-label="${escapeHtml(spec.title)}">
Interactive visualization requires JavaScript and canvas.</canvas>
</section><aside><span class="eyebrow">ψ · INTERACTIVE LAB</span><h1>${escapeHtml(spec.title)}</h1><div id="sliders"></div><div id="controls"></div>
<p id="status" role="status" aria-live="polite"></p>
<ul>${spec.prompts.map((p) => `<li>Try: ${escapeHtml(p)}</li>`).join("")}</ul>
</aside></main><script id="spec" type="application/json">${safeJson(spec)}</script>
<script>
"use strict";
const spec = JSON.parse(document.getElementById("spec").textContent);
const palette = ${safeJson(theme)};
const expressionSource = ${expressionSource.toString()};
const mathMembers = ${safeJson(MATH_MEMBERS)};
${BROWSER_RUNTIME}
</script></body></html>`;
}

const BROWSER_RUNTIME = String.raw`
const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
const status = document.getElementById("status"), values = Object.create(null);
const names = spec.sliders.map(s => s.name), p = spec.params;
let width = 600, height = 500, clock = 0, previous = 0, hover = null, running = false;
let trace = [], particles = [], histogram = [], total = 0, successes = 0, probabilityElapsed = 0;
const accent = palette.accents, tau = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = v => Number.isFinite(v) ? Number(v.toPrecision(5)).toString() : "undefined";
const tickLabel = v => fmt(v).length > 7 ? v.toExponential(1) : fmt(v);
function message(text) { if (status.textContent !== text) status.textContent = text; }
function compile(expr, variables) {
	const source = expressionSource(expr, variables.concat(names), mathMembers);
	const fn = new Function("x", "y", "t", ...names, '"use strict"; return (' + source + ');');
	return (x, y = 0, t = clock) => {
		try { const n = fn(x, y, t, ...names.map(name => values[name])); return Number.isFinite(n) ? n : NaN; }
		catch { return NaN; }
	};
}
const presets = new URLSearchParams(window.location?.search || "");
for (const [i, slider] of spec.sliders.entries()) {
	const raw = presets.get(slider.name), requested = raw !== null && raw.trim() ? Number(raw) : NaN;
	const bounded = clamp(Number.isFinite(requested) ? requested : slider.value, slider.min, slider.max);
	const steps = Math.floor((slider.max - slider.min) / slider.step + 1e-9);
	const value = Number((slider.min + clamp(Math.round((bounded - slider.min) / slider.step), 0, steps)
		* slider.step).toPrecision(12));
	values[slider.name] = value;
	const label = document.createElement("label"), input = document.createElement("input");
	const readout = document.createElement("output"), text = document.createElement("span");
	input.id = "slider-" + i; input.type = "range"; label.htmlFor = input.id;
	readout.htmlFor = input.id; text.textContent = slider.label; readout.textContent = fmt(value);
	for (const key of ["min", "max", "step"]) input[key] = String(slider[key]);
	input.value = String(value);
	label.append(text, readout); document.getElementById("sliders").append(label, input);
	input.addEventListener("input", () => {
		values[slider.name] = Number(input.value); readout.textContent = fmt(values[slider.name]);
		trace = []; clock = 0; particles = [];
		if (spec.template === "probability-sim") resetProbability();
		draw(0);
	});
}
const fn = spec.template === "function-plot" ? compile(p.fn, ["x"]) : null;
const comparison = spec.template === "function-plot" && p.compare !== undefined ? compile(p.compare, ["x"]) : null;
const fx = spec.template === "vector-field" ? compile(p.fx, ["x", "y"]) : null;
const fy = spec.template === "vector-field" ? compile(p.fy, ["x", "y"]) : null;
function line(x1, y1, x2, y2, color = palette.grid, weight = 1) {
	if (![x1,y1,x2,y2].every(Number.isFinite)) return;
	ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
}
function label(text, x, y, color = palette.fg) { ctx.fillStyle = color; ctx.fillText(text, x, y); }
function circle(x, y, r, color, fill = false) {
	if (![x,y,r].every(Number.isFinite) || r < 0) return;
	ctx.beginPath(); ctx.arc(x,y,r,0,tau); ctx.strokeStyle = color; ctx.fillStyle = color;
	if (fill) ctx.fill(); else ctx.stroke();
}
function arrow(x1,y1,x2,y2,color) {
	line(x1,y1,x2,y2,color,2); const angle = Math.atan2(y2-y1,x2-x1), size = 7;
	line(x2,y2,x2-size*Math.cos(angle-.45),y2-size*Math.sin(angle-.45),color,2);
	line(x2,y2,x2-size*Math.cos(angle+.45),y2-size*Math.sin(angle+.45),color,2);
}
function plane(domain = [-5,5], range = [-5,5]) {
	const left = 48, right = width-24, top = 32, bottom = height-40;
	const X = x => left + (x-domain[0])/(domain[1]-domain[0])*(right-left);
	const Y = y => bottom - (y-range[0])/(range[1]-range[0])*(bottom-top);
	const tick = span => { const power = 10**Math.floor(Math.log10(span/8));
		return [1,2,5,10].map(n => n*power).find(n => span/n <= 10) || power*10; };
	const dx = tick(domain[1]-domain[0]), dy = tick(range[1]-range[0]);
	for (let i=0; i<=12; i++) {
		const x = Math.ceil(domain[0]/dx)*dx+i*dx, y = Math.ceil(range[0]/dy)*dy+i*dy;
		if (x <= domain[1]) { line(X(x),top,X(x),bottom); label(tickLabel(x),X(x)-8,bottom+20); }
		if (y <= range[1]) { line(left,Y(y),right,Y(y)); label(tickLabel(y),3,Y(y)+4); }
	}
	if (domain[0]<=0 && domain[1]>=0) line(X(0),top,X(0),bottom,palette.fg);
	if (range[0]<=0 && range[1]>=0) line(left,Y(0),right,Y(0),palette.fg);
	return { X, Y, left, right, top, bottom };
}
/** function-plot params: fn, domain:[min,max], range?:[min,max], compare?:expression. */
function functionPlot() {
	const domain = p.domain, range = p.range || [-5,5], view = plane(domain,range), {X,Y} = view;
	ctx.save(); ctx.beginPath(); ctx.rect(view.left,view.top,view.right-view.left,view.bottom-view.top); ctx.clip();
	for (const [f,color,dash] of [[fn,accent[1],[]],[comparison,accent[0],[7,6]]]) {
		if (!f) continue;
		ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.setLineDash(dash);
		let last = null;
		for (let i=0;i<=1000;i++) {
			const x=domain[0]+i/1000*(domain[1]-domain[0]), y=Y(f(x)), px=X(x);
			if (!Number.isFinite(y)) { last=null; continue; }
			if (last === null || Math.abs(y-last)>height) ctx.moveTo(px,y); else ctx.lineTo(px,y);
			last=y;
		}
		ctx.stroke();
	}
	ctx.restore();
	if (hover !== null) {
		const x=domain[0]+clamp((hover-view.left)/(view.right-view.left),0,1)*(domain[1]-domain[0]);
		line(X(x),view.top,X(x),view.bottom,accent[2]);
		const y = fn(x); if (Number.isFinite(y) && y>=range[0] && y<=range[1]) circle(X(x),Y(y),5,accent[1],true);
		message("x = "+fmt(x)+"\nf(x) = "+fmt(y)+(comparison ? "\ncompare = "+fmt(comparison(x)) : ""));
	} else message("Move over the curve to inspect x and f(x).");
}
/** linear-transform params: showDeterminant?:boolean, showEigen?:boolean, vectors?:[x,y][]. */
function linearTransform() {
	const {a,b,c,d}=values, scale=Math.min(width,height)/12, X=x=>width/2+x*scale, Y=y=>height/2-y*scale;
	const transformed=(x,y)=>[a*x+b*y,c*x+d*y];
	for(let i=-12;i<=12;i++) {
		line(X(i),Y(-12),X(i),Y(12),palette.grid); line(X(-12),Y(i),X(12),Y(i),palette.grid);
		let u=transformed(i,-12),v=transformed(i,12); line(X(u[0]),Y(u[1]),X(v[0]),Y(v[1]),accent[0]);
		u=transformed(-12,i);v=transformed(12,i);line(X(u[0]),Y(u[1]),X(v[0]),Y(v[1]),accent[0]);
	}
	ctx.beginPath();ctx.moveTo(X(0),Y(0));ctx.lineTo(X(a),Y(c));ctx.lineTo(X(a+b),Y(c+d));
	ctx.lineTo(X(b),Y(d));ctx.closePath();ctx.globalAlpha=.22;ctx.fillStyle=accent[1];ctx.fill();ctx.globalAlpha=1;
	arrow(X(0),Y(0),X(a),Y(c),accent[2]);label("î",X(a)+8,Y(c),accent[2]);
	arrow(X(0),Y(0),X(b),Y(d),accent[3]);label("ĵ",X(b)+8,Y(d),accent[3]);
	for(const vector of p.vectors || []) { const [x,y]=transformed(...vector);arrow(X(0),Y(0),X(x),Y(y),accent[1]); }
	const det=a*d-b*c, discriminant=(a+d)**2-4*det;
	let text="A = [["+fmt(a)+", "+fmt(b)+"], ["+fmt(c)+", "+fmt(d)+"]]";
	if(p.showDeterminant) text+="\ndet(A) = "+fmt(det)+" (signed area)";
	if(p.showEigen && discriminant>=0) {
		const lambdas=[(a+d+Math.sqrt(discriminant))/2,(a+d-Math.sqrt(discriminant))/2];
		for(const [i,lambda] of lambdas.entries()) {
			let vx=b,vy=lambda-a;
			if(Math.hypot(vx,vy)<1e-8) { vx=lambda-d;vy=c; }
			if(Math.hypot(vx,vy)<1e-8) { vx=i===0?1:0;vy=i===0?0:1; }
			const norm=Math.hypot(vx,vy);vx/=norm;vy/=norm;
			ctx.setLineDash([6,5]);line(X(-vx*20),Y(-vy*20),X(vx*20),Y(vy*20),accent[1]);ctx.setLineDash([]);
			label("λ = "+fmt(lambda),X(vx*(2+i)),Y(vy*(2+i)),accent[1]);
		}
		text+="\nReal eigenvalues: "+lambdas.map(fmt).join(", ");
	} else if(p.showEigen) text+="\nNo real eigenvector directions";
	message(text);
}
/** vector-field params: fx, fy expressions in x,y and sliders; RK2 advection on [-5,5]². */
function vectorField(dt) {
	const {X,Y}=plane();
	for(let x=-4.5;x<=4.5;x+=.75) for(let y=-4.5;y<=4.5;y+=.75) {
		const u=fx(x,y),v=fy(x,y),m=Math.hypot(u,v);if(!Number.isFinite(m)||m===0) continue;
		const color=accent[Math.min(3,Math.floor(Math.log1p(m)))];
		arrow(X(x-u/m*.23),Y(y-v/m*.23),X(x+u/m*.23),Y(y+v/m*.23),color);
	}
	while(particles.length<90) particles.push({x:Math.random()*10-5,y:Math.random()*10-5,age:Math.random()*8});
	for(const q of particles) {
		const h=Math.min(dt,.035),u=fx(q.x,q.y),v=fy(q.x,q.y);
		const nx=q.x+h*fx(q.x+u*h/2,q.y+v*h/2),ny=q.y+h*fy(q.x+u*h/2,q.y+v*h/2);
		q.x=nx;q.y=ny;q.age+=h;
		if(!Number.isFinite(nx+ny)||Math.abs(nx)>5||Math.abs(ny)>5||q.age>10) {
			q.x=Math.random()*10-5;q.y=Math.random()*10-5;q.age=0;
		}
		circle(X(q.x),Y(q.y),2.5,accent[1],true);
	}
	message("Arrows show direction; colors show magnitude.\nParticles follow the field using midpoint integration.");
}
/** fourier-epicycles params: shape:square|sawtooth|heart|custom, points?:[x,y][] (custom required). */
function fourierCoefficients() {
	const count=128;let path=[];
	if(p.shape==="custom" || p.shape==="square" || p.shape==="sawtooth") {
		const vertices=p.shape==="custom"?p.points:p.shape==="square"?[[-1,-1],[1,-1],[1,1],[-1,1]]:
			[[-1,-1],[1,1],[1,-1]];
		const lengths=vertices.map((v,i)=>Math.hypot(v[0]-vertices[(i+1)%vertices.length][0],
			v[1]-vertices[(i+1)%vertices.length][1]));
		const perimeter=lengths.reduce((a,b)=>a+b,0);
		for(let n=0;n<count;n++) {
			let distance=n/count*perimeter,index=0;
			while(index<vertices.length-1 && distance>lengths[index]) { distance-=lengths[index];index++; }
			const f=lengths[index]?distance/lengths[index]:0,a=vertices[index],b=vertices[(index+1)%vertices.length];
			path.push([a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])]);
		}
	} else for(let n=0;n<count;n++) {
		const t=n/count*tau;path.push([Math.sin(t)**3,(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/16]);
	}
	const center=path.reduce((a,b)=>[a[0]+b[0]/count,a[1]+b[1]/count],[0,0]);
	const radius=Math.max(...path.map(v=>Math.hypot(v[0]-center[0],v[1]-center[1])),.01);
	path=path.map(v=>[(v[0]-center[0])/radius,(v[1]-center[1])/radius]);
	return path.map((_,k)=>{
		let re=0,im=0;
		for(let n=0;n<count;n++) { const a=-tau*k*n/count;
			re+=(path[n][0]*Math.cos(a)-path[n][1]*Math.sin(a))/count;
			im+=(path[n][0]*Math.sin(a)+path[n][1]*Math.cos(a))/count;
		}
		return {frequency:k>count/2?k-count:k,amplitude:Math.hypot(re,im),phase:Math.atan2(im,re)};
	}).sort((a,b)=>b.amplitude-a.amplitude);
}
const coefficients=spec.template==="fourier-epicycles"?fourierCoefficients():[];
function fourier(dt) {
	clock+=dt*values.speed*.6;
	const scale=Math.min(width,height)*.30, n=clamp(Math.round(values.terms),1,coefficients.length);
	// A faint reconstruction gives context before the animated pen completes its first lap.
	ctx.beginPath();ctx.strokeStyle=palette.grid;ctx.lineWidth=1;ctx.setLineDash([3,5]);
	for(let i=0;i<=256;i++) {
		let px=width/2,py=height/2;
		for(const c of coefficients.slice(0,n)) {
			const angle=c.frequency*i/256*tau+c.phase;
			px+=c.amplitude*scale*Math.cos(angle);py-=c.amplitude*scale*Math.sin(angle);
		}
		if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);
	}
	ctx.stroke();ctx.setLineDash([]);
	let x=width/2,y=height/2;
	for(const c of coefficients.slice(0,n)) {
		const angle=c.frequency*clock+c.phase,r=c.amplitude*scale;
		circle(x,y,r,palette.grid);const nx=x+r*Math.cos(angle),ny=y-r*Math.sin(angle);
		line(x,y,nx,ny,accent[0],1.5);x=nx;y=ny;
	}
	if(dt>0) { trace.push([x,y]);if(trace.length>2400) trace.shift(); }
	ctx.beginPath();ctx.strokeStyle=accent[1];ctx.lineWidth=2;
	trace.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.stroke();circle(x,y,4,accent[3],true);
	message(n+" rotating Fourier coefficients\nDashed: full reconstruction · yellow: pen trace\nFrequencies retain their signs after sorting by amplitude.");
}
/** probability-sim params: experiment:coin|dice|galton; coin is Binomial(1,p), Galton Binomial(10,p). */
function resetProbability() {
	histogram=Array(p.experiment==="dice"?6:p.experiment==="coin"?2:11).fill(0);
	total=0;successes=0;probabilityElapsed=0;
}
if(spec.template==="probability-sim") {
	resetProbability();
	for(const [text,action] of [["Start",()=>{running=true;}],["Pause",()=>{running=false;}],
		["Reset",()=>{resetProbability();running=false;draw(0);}]]) {
		const button=document.createElement("button");button.textContent=text;button.addEventListener("click",action);
		document.getElementById("controls").append(button);
	}
}
function probability(dt) {
	const bias=clamp(values.p,0,1), levels=p.experiment==="galton"?10:1;
	if(running) probabilityElapsed+=dt;
	if(running && probabilityElapsed>=.05) {
		const ticks=Math.min(4,Math.floor(probabilityElapsed/.05));probabilityElapsed%=.05;
		for(let i=0;i<clamp(Math.round(values.trials),1,10000)*ticks;i++) {
			let result=0;
			if(p.experiment==="dice") result=Math.floor(Math.random()*6);
			else for(let j=0;j<levels;j++) if(Math.random()<bias) result++;
			histogram[result]++;total++;successes+=p.experiment==="dice"?(result===5?1:0):result/levels;
		}
	}
	const expected=histogram.map((_,k)=>{
		if(p.experiment==="dice") return 1/6;
		let choose=1;for(let j=1;j<=k;j++) choose*= (levels-j+1)/j;
		return choose*bias**k*(1-bias)**(levels-k);
	});
	const max=Math.max(.1,...expected,...histogram.map(n=>n/Math.max(total,1)))*1.15;
	const left=48,bottom=height-55,top=45,bar=(width-left-25)/histogram.length;
	line(left,top,left,bottom,palette.fg);line(left,bottom,width-25,bottom,palette.fg);
	label("Proportion",left,25);label(fmt(max),3,top+5);label("0",20,bottom);
	ctx.beginPath();
	expected.forEach((v,i)=>{
		const h=histogram[i]/Math.max(total,1)/max*(bottom-top),x=left+i*bar+bar*.1;
		ctx.fillStyle=accent[0];
		if(spec.style==="kurzgesagt") { ctx.beginPath();ctx.roundRect(x,bottom-h,bar*.8,h,5);ctx.fill(); }
		else ctx.fillRect(x,bottom-h,bar*.8,h);
		label(String(p.experiment==="dice"?i+1:i),x+bar*.3,bottom+22);
	});
	ctx.beginPath();ctx.strokeStyle=accent[1];ctx.lineWidth=3;
	expected.forEach((v,i)=>{const x=left+(i+.5)*bar,y=bottom-v/max*(bottom-top);
		if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
	expected.forEach((v,i)=>circle(left+(i+.5)*bar,bottom-v/max*(bottom-top),4,accent[1],true));
	message((running?"Running":"Paused")+" · "+total+" trials\n"+
		(p.experiment==="dice"?"Proportion of sixes: ":"Proportion of right / heads: ")+
		fmt(total?successes/total:0)+"\nExpected: "+fmt(p.experiment==="dice"?1/6:bias)+"\nYellow: expected distribution");
}
/** exponential-growth params: mode:compound|doubling|logistic. Starts at 1; linear=1+r*t;
 * compound=(1+r)^t; doubling=2^(r*t); logistic=K/(1+(K-1)*exp(-r*t)). */
function growth() {
	const steps=Math.max(1,Math.round(values.steps)),rate=values.rate,K=Math.max(1,values.capacity);
	const linear=t=>1+rate*t;
	const exponential=t=>p.mode==="doubling"?2**(rate*t):(1+rate)**t;
	const logistic=t=>K/(1+(K-1)*Math.exp(-rate*t));
	const series=[[linear,accent[0],"Linear"],[exponential,accent[1],"Exponential"]];
	if(p.mode==="logistic") series.push([logistic,accent[2],"Logistic"]);
	const plotBottom=height*.62,left=55,right=width-25,top=45;
	// A shared linear scale makes the contrast explicit; clip runaway values for a readable axis.
	const maximum=Math.min(1e12,Math.max(2,...series.flatMap(([f])=>[f(0),f(steps)]).filter(Number.isFinite)));
	const X=t=>left+t/steps*(right-left),Y=n=>plotBottom-n/maximum*(plotBottom-top);
	for(let i=0;i<=4;i++) { const n=i/4*maximum,y=Y(n);line(left,y,right,y);label(tickLabel(n),2,y+4);
		label(fmt(i/4*steps),X(i/4*steps)-5,plotBottom+20); }
	label("Value",left,22);label("Steps",right-40,plotBottom+38);
	ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,plotBottom-top);ctx.clip();
	for(const [f,color] of series) {
		ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();let started=false;
		for(let i=0;i<=600;i++) { const t=i/600*steps,n=f(t);if(!Number.isFinite(n)){started=false;continue;}
			if(started)ctx.lineTo(X(t),Y(n));else ctx.moveTo(X(t),Y(n));started=true; }
		ctx.stroke();
	}ctx.restore();
	series.forEach((s,i)=>label(s[2],left+i*(right-left)/series.length,top+18,s[1]));
	const target=p.mode==="logistic"?logistic(steps):exponential(steps);
	const count=clamp(Math.floor(Number.isFinite(target)?target:1024),0,1024);
	const cols=Math.max(1,Math.floor((width-70)/10)),dotTop=height*.75;
	for(let i=0;i<count;i++) { const x=40+(i%cols)*10,y=dotTop+Math.floor(i/cols)*10;
		if(y<height-18)circle(x,y,3,accent[2],true); }
	label(width < 440 ? "Population cells · up to 1,024" : "Population cells (display capped at 1,024)",40,height*.72);
	message("After "+steps+" steps\n"+series.map(([f,color,name])=>name+": "+fmt(f(steps))).join("\n")+
		(p.mode==="doubling"?"\nDoubling time: "+fmt(1/rate)+" steps":"")+
		(p.mode==="logistic"?"\nCarrying capacity K = "+fmt(K):""));
}
function draw(dt) {
	ctx.clearRect(0,0,width,height);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,width,height);
	ctx.font="12px system-ui, sans-serif";ctx.lineCap=spec.style==="kurzgesagt"?"round":"butt";
	switch(spec.template) {
		case "function-plot":functionPlot();break;
		case "linear-transform":linearTransform();break;
		case "vector-field":vectorField(dt);break;
		case "fourier-epicycles":fourier(dt);break;
		case "probability-sim":probability(dt);break;
		case "exponential-growth":growth();break;
	}
}
function resize() {
	const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio || 1;
	width=Math.max(120,rect.width);height=Math.max(120,rect.height);
	canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
	trace=[];draw(0);
}
canvas.addEventListener("pointermove",event=>{hover=event.clientX-canvas.getBoundingClientRect().left;draw(0);});
canvas.addEventListener("pointerleave",()=>{hover=null;draw(0);});
window.addEventListener("resize",resize);
if(typeof ResizeObserver!=="undefined") new ResizeObserver(resize).observe(canvas);
resize();
function frame(now) {
	const dt=previous?Math.min(.05,(now-previous)/1000):0;previous=now;
	if(spec.template==="vector-field"||spec.template==="fourier-epicycles"||spec.template==="probability-sim") draw(dt);
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`;
