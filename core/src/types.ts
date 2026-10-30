/**
 * ψ core contracts.
 *
 * Every module (visual, extension, crew, studio, cli) codes against these
 * types. Change them only through the main thread so parallel work stays in sync.
 * All persisted data is plain JSON; dates are ISO-8601 strings.
 */

// ─────────────────────────────────────────────────────────────── concepts ──

/** Visual style a lesson or artifact is produced in. */
export type VisualStyle =
	/** 3Blue1Brown: dark canvas, precise math animation, "discover it yourself" pacing. */
	| "3b1b"
	/** Kurzgesagt: flat vector, saturated palette, narrative scale-jumps, cute characters. */
	| "kurzgesagt"
	/** Plain diagram: neutral, minimal. */
	| "plain";

/** A single idea in a topic's concept graph. */
export interface Concept {
	/** kebab-case, unique within a topic, e.g. "dot-product". */
	id: string;
	title: string;
	/** One or two sentences, plain language. */
	summary: string;
	/** ids of concepts that must be understood first (edges point prereq → this). */
	prerequisites: string[];
	/** 1 (intro) … 5 (research-level). */
	difficulty: 1 | 2 | 3 | 4 | 5;
	/** The core intuition in one sentence, phrased the way 3b1b would ("a dot product measures how much one vector leans along another"). */
	intuition?: string;
	/** Common wrong mental models the tutor should probe for. */
	misconceptions?: string[];
	/** Concrete visual metaphors that make the idea click. */
	visualHooks?: string[];
	tags?: string[];
}

/** Prerequisite DAG for one topic. */
export interface ConceptGraph {
	/** Topic slug, kebab-case, e.g. "fourier-transform". */
	topic: string;
	title: string;
	/** The "big idea" — what the learner will be able to see/do at the end. */
	bigIdea: string;
	concepts: Concept[];
	createdAt: string;
	updatedAt: string;
}

// ─────────────────────────────────────────────────────────── curriculum ──

/** A short story beat (Kurzgesagt-style narrative structure). */
export interface NarrativeBeat {
	kind: "hook" | "question" | "build" | "reveal" | "zoom-out" | "recap";
	text: string;
}

/** Reference to a rendered or renderable visual. */
export interface VisualRef {
	kind: "storyboard" | "manim" | "explorable" | "diagram";
	style: VisualStyle;
	title: string;
	/** What the visual must make obvious. */
	goal: string;
	/** Path relative to the topic dir once produced, e.g. "artifacts/dot-product.html". */
	path?: string;
}

/** One lesson = one concept taught end-to-end. */
export interface Lesson {
	conceptId: string;
	/** "By the end you can …" */
	objective: string;
	beats: NarrativeBeat[];
	visuals: VisualRef[];
	/** ids of Cards that check this lesson. */
	checks: string[];
	status: "planned" | "in-progress" | "done";
}

/** Ordered learning path through a ConceptGraph. */
export interface LessonPlan {
	topic: string;
	goal: string;
	learnerLevel: "curious" | "student" | "practitioner" | "expert";
	/** In teaching order (a topological order of the graph restricted to unmastered concepts). */
	lessons: Lesson[];
	createdAt: string;
	updatedAt: string;
}

// ───────────────────────────────────────────────── retrieval practice ──

export type CardKind =
	/** Free recall of a fact/definition. */
	| "recall"
	/** "What happens if …?" — predict before seeing. */
	| "predict"
	/** Explain in your own words (Feynman). Graded by the agent. */
	| "explain"
	/** Multiple choice. */
	| "mcq";

/** FSRS memory state of a card. */
export interface FsrsState {
	/** 0 new, 1 learning, 2 review, 3 relearning. */
	state: 0 | 1 | 2 | 3;
	/** Days until retrievability drops to 90%. */
	stability: number;
	/** 1 … 10. */
	difficulty: number;
	reps: number;
	lapses: number;
	/** ISO date the card is next due. */
	due: string;
	/** ISO date of last review, absent for new cards. */
	lastReview?: string;
}

/** 1 Again, 2 Hard, 3 Good, 4 Easy (FSRS/Anki convention). */
export type Rating = 1 | 2 | 3 | 4;

export interface Card {
	id: string;
	topic: string;
	conceptId: string;
	kind: CardKind;
	prompt: string;
	answer: string;
	/** Only for mcq. */
	choices?: string[];
	fsrs: FsrsState;
	createdAt: string;
}

export interface ReviewLog {
	cardId: string;
	rating: Rating;
	reviewedAt: string;
	/** Days since previous review (0 for first). */
	elapsedDays: number;
	scheduledDays: number;
}

// ────────────────────────────────────────────────────────── learner model ──

/** Bayesian Knowledge Tracing estimate for one concept. */
export interface Mastery {
	conceptId: string;
	/** P(learned), 0 … 1. A concept counts as mastered at ≥ 0.95. */
	pKnown: number;
	attempts: number;
	correct: number;
	lastSeen?: string;
}

export interface LearnerProfile {
	topic: string;
	mastery: Record<string, Mastery>;
	/** Free-form notes the tutor keeps about how this learner thinks. */
	notes: string[];
	updatedAt: string;
}

// ─────────────────────────────────────────────── storyboard (explainers) ──

/** Entry/exit/loop animation applied to a storyboard element. */
export interface Anim {
	type: "fade" | "pop" | "slide" | "draw" | "pulse" | "orbit" | "float" | "grow" | "typewriter";
	/** Seconds from scene start (enter) or before scene end (exit). Default 0. */
	delay?: number;
	/** Seconds. Default 0.6. */
	duration?: number;
	/** For slide. */
	from?: "left" | "right" | "top" | "bottom";
}

/**
 * A drawable element. Coordinates are in a 1600×900 virtual canvas, origin
 * top-left. `props` is per-kind; renderers ignore unknown keys.
 *
 * kind → props:
 *  circle    { x, y, r, fill?, stroke? }
 *  rect      { x, y, w, h, rx?, fill?, stroke? }
 *  text      { x, y, text, size?, fill?, weight?, align?: "start"|"middle"|"end" }
 *  arrow     { x1, y1, x2, y2, stroke?, width?, curve? }
 *  path      { d, fill?, stroke?, width? }               // SVG path data
 *  equation  { x, y, tex, size?, fill? }                   // LaTeX source; HTML renderer may show it via KaTeX
 *  graph     { x, y, w, h, fn, domain: [a,b], range?: [c,d], stroke? }  // fn: JS expression in x, e.g. "Math.sin(x)"
 *  vector    { x, y, dx, dy, stroke?, label? }             // math vector from (x,y)
 *  creature  { x, y, size?, color?, mood?: "happy"|"curious"|"surprised" }  // Kurzgesagt-style blob character
 *  particles { x, y, w, h, count, color?, speed? }
 *  group     { children: StoryElement[], x?, y?, scale?, rotate? }
 */
export interface StoryElement {
	id: string;
	kind:
		| "circle"
		| "rect"
		| "text"
		| "arrow"
		| "path"
		| "equation"
		| "graph"
		| "vector"
		| "creature"
		| "particles"
		| "group";
	props: Record<string, unknown>;
	enter?: Anim;
	exit?: Anim;
	loop?: Anim;
}

export interface StoryScene {
	id: string;
	/** Voice-over / caption text for this scene. */
	narration: string;
	durationSec: number;
	/** CSS color or palette token like "bg" / "deep". */
	background?: string;
	elements: StoryElement[];
	/** Camera at scene end (renderers animate from previous scene's camera). */
	camera?: { zoom?: number; x?: number; y?: number };
}

/** A complete animated explainer, renderable to HTML (and roughly to manim). */
export interface Storyboard {
	id: string;
	title: string;
	topic: string;
	conceptId?: string;
	style: VisualStyle;
	/** Named palette from visual/src/palettes.ts; defaults per style. */
	palette?: string;
	scenes: StoryScene[];
}

// ─────────────────────────────────────────────────────────── explorables ──

/** A slider-driven interactive (Bret Victor / 3b1b-style "play with it"). */
export interface ExplorableSpec {
	id: string;
	title: string;
	topic: string;
	conceptId?: string;
	style: VisualStyle;
	template:
		| "function-plot"     // y = f(x; params) with sliders
		| "linear-transform"  // 2×2 matrix acting on the grid (Essence of Linear Algebra)
		| "vector-field"      // F(x,y; params)
		| "fourier-epicycles" // sum of rotating circles drawing a path
		| "probability-sim"   // repeated random trials, histogram converging
		| "exponential-growth"; // compounding / doubling
	/** Template-specific parameters; see visual/src/explorable.ts. */
	params: Record<string, unknown>;
	sliders: { name: string; label: string; min: number; max: number; step: number; value: number }[];
	/** Shown beside the canvas: what to try, what to notice. */
	prompts: string[];
}

// ───────────────────────────────────────────────────────────── renders ──

export interface RenderResult {
	ok: boolean;
	/** Absolute output path(s): .html, .mp4, .png, .py */
	outputs: string[];
	/** Human-readable log tail on failure. */
	log?: string;
}

// ─────────────────────────────────────────────────────────────── crew ──

/** A role in the multi-agent lesson studio. */
export type CrewRole =
	| "architect"   // decomposes a big idea into a ConceptGraph + LessonPlan
	| "intuition"   // finds the 3b1b-style core insight and visual metaphor
	| "storyteller" // writes Kurzgesagt-style narrative beats and narration
	| "visualizer"  // turns beats into Storyboards / manim scenes / explorables
	| "quizmaster"  // writes retrieval-practice Cards
	| "critic";     // fact-checks and flags misconceptions or hand-waving

export interface CrewTask {
	role: CrewRole;
	topic: string;
	conceptId?: string;
	instructions: string;
	/** Paths (relative to topic dir) the role should read first. */
	inputs?: string[];
}

export interface CrewResult {
	role: CrewRole;
	ok: boolean;
	/** Final text output of the role agent. */
	output: string;
	/** Files the role wrote, relative to topic dir. */
	files: string[];
	durationMs: number;
	error?: string;
}

// ═════════════════════════════════════════════ practice-first learning ══
// psi is a text-first learning agent: long-term learner memory, Josh Kaufman's
// "first 20 hours" skill deconstruction, and Mark Rober's "Super Mario effect"
// (failure is cheap and still earns progress) for interactive practice.

// ───────────────────────────────────────────────────────── learner memory ──

export type MemoryKind =
	| "goal"          // what the learner wants to be able to do, and why
	| "background"    // what they already know / do
	| "preference"    // how they like to learn (examples first, short sessions, analogies from cooking…)
	| "strength"      // things that come easily
	| "struggle"      // recurring difficulty
	| "misconception" // a specific wrong mental model observed
	| "insight"       // an explanation/analogy/drill that clicked
	| "motivation"    // what keeps them going, what drains them
	| "constraint";   // time, tools, environment limits

/** One durable fact about the learner. Global across topics and skills. */
export interface MemoryItem {
	id: string;
	kind: MemoryKind;
	/** One sentence, written so a future tutor can act on it. */
	text: string;
	topic?: string;
	skill?: string;
	/** 0 … 1; observed facts start lower than learner-stated ones. */
	confidence: number;
	source: "learner" | "observed" | "inferred";
	createdAt: string;
	updatedAt: string;
	lastUsedAt?: string;
}

/** End-of-session recap, the episodic half of memory. */
export interface SessionRecap {
	id: string;
	date: string;
	skill?: string;
	topic?: string;
	minutes: number;
	summary: string;
	wins: string[];
	struggles: string[];
	/** The very next thing to do when they come back. */
	next: string;
}

export interface LearnerMemory {
	name?: string;
	items: MemoryItem[];
	recaps: SessionRecap[];
	updatedAt: string;
}

// ─────────────────────────────────────────── skills (first 20 hours) ──

export interface Subskill {
	/** kebab-case, unique within the skill. */
	id: string;
	title: string;
	/** Why this subskill matters for the target performance. */
	why: string;
	/** 1 = core (the vital 20%), 2 = useful, 3 = later. */
	priority: 1 | 2 | 3;
	prerequisites: string[];
	/** How the learner can notice their own mistakes ("learn enough to self-correct"). */
	selfCorrection: string;
	/** Drill ideas the tutor can turn into challenges. */
	drills: string[];
	status: "locked" | "active" | "practicing" | "solid";
}

export interface SkillPlan {
	/** kebab-case slug, e.g. "sql-queries". */
	skill: string;
	title: string;
	/** Concrete, testable "good enough" level, e.g. "write a 3-table JOIN with GROUP BY in under 5 minutes". */
	targetPerformance: string;
	whyItMatters: string;
	subskills: Subskill[];
	/** 3–5 resources max — just enough to self-correct. */
	resources: { title: string; url?: string; why: string }[];
	/** Things that stop practice from starting, and the fix. */
	barriers: { barrier: string; fix: string; done: boolean }[];
	/** Default 20. */
	hoursGoal: number;
	createdAt: string;
	updatedAt: string;
}

// ───────────────────────────────────────────────────────────── practice ──

export type ChallengeKind =
	| "quickfire" // fast recall/compute, usually auto-gradable
	| "predict"   // what happens if…?
	| "debug"     // find and fix the mistake
	| "apply"     // use the subskill on a fresh problem
	| "explain"   // teach it back
	| "build"     // micro-project / quest with milestones (Mark Rober: learn by building)
	| "boss";     // mixed, harder, end-of-level challenge

export interface Challenge {
	id: string;
	skill: string;
	subskillId?: string;
	kind: ChallengeKind;
	/** 1 … 5 */
	level: 1 | 2 | 3 | 4 | 5;
	prompt: string;
	/** For auto-grading: canonical answer. */
	expected?: string;
	/** Other accepted answers (normalized comparison). */
	acceptable?: string[];
	/** Numeric answers: absolute tolerance. */
	tolerance?: number;
	/** For open answers: what a good answer must contain. */
	rubric?: string[];
	/** Hint ladder, vaguest first. */
	hints: string[];
	createdAt: string;
}

export type Outcome = "success" | "partial" | "fail" | "skipped";

export interface Attempt {
	id: string;
	challengeId: string;
	skill: string;
	subskillId?: string;
	at: string;
	answer: string;
	outcome: Outcome;
	hintsUsed: number;
	/** For fails: what the learner says they'll try differently (earns bonus XP — Super Mario effect). */
	lesson?: string;
	feedback?: string;
	xp: number;
}

export interface PracticeSession {
	id: string;
	skill: string;
	focus?: string;
	startedAt: string;
	endedAt?: string;
	minutes?: number;
	attemptIds: string[];
}

export interface Progress {
	skill: string;
	xp: number;
	level: number;
	streakDays: number;
	lastPracticeDate?: string;
	minutesLogged: number;
	attempts: number;
	successes: number;
	/** Failures are counted and celebrated, not hidden. */
	failures: number;
	badges: string[];
}
