import test from "node:test";
import assert from "node:assert/strict";

// Variable specifiers keep the untyped browser modules outside the TS project.
const formatPath = "../public/js/format.js", sourcesPath = "../public/js/sources.js";
const youPath = "../public/js/you.js", trailPath = "../public/js/trail.js";
const format = await import(formatPath);
const sources = await import(sourcesPath);
const you = await import(youPath);
const trail = await import(trailPath);

test("legacy and new verdicts map to the same conservative wording", () => {
	const cites = [{ sourceId: "a" }];
	const words = (v: string, c: unknown[] = cites) => sources.verdictWords(v, c).words;
	assert.equal(words("supported"), "The sources likely support this");
	assert.equal(words("likely-supported"), "The sources likely support this");
	assert.equal(words("contradicted"), "A source may contradict this");
	assert.equal(words("possibly-contradicted"), "A source may contradict this");
	assert.equal(words("unclear"), "Couldn't confirm from the sources");
	assert.equal(words("anything-else"), "Couldn't confirm from the sources");
	// Support needs something to point at.
	assert.equal(words("likely-supported", []), "Couldn't confirm from the sources");
	for (const v of ["supported", "contradicted", "unclear", "likely-supported", "possibly-contradicted"]) {
		const out = sources.verdictWords(v, cites);
		assert.equal(out.note, "Matched by wording, not meaning — read the passages.");
		assert.ok(["check", "cross", "query"].includes(out.mark));
		assert.doesNotMatch(out.words, /proves|confirmed|true|false|supported by/i);
	}
	assert.deepEqual(["supported", "contradicted", "x"].map(sources.normalizeVerdict),
		["likely-supported", "possibly-contradicted", "unclear"]);
});

test("evidence segments mark the matched sentence inside its context", () => {
	const ctx = "Lists are ordered. Lists are mutable, so you can change them. Tuples are not.";
	assert.deepEqual(sources.evidenceSegments(ctx, "Lists are mutable, so you can change them."), [
		{ text: "Lists are ordered. ", match: false },
		{ text: "Lists are mutable, so you can change them.", match: true },
		{ text: " Tuples are not.", match: false },
	]);
	// Whitespace and case differences still find it, keeping the page's own text.
	const loose = sources.evidenceSegments("A b.  LISTS  are\nmutable. C.", "lists are mutable.");
	assert.deepEqual(loose.map((p: { match: boolean }) => p.match), [false, true, false]);
	assert.equal(loose[1].text, "LISTS  are\nmutable.");
	// Missing from the context: only the sentence, so nothing reads twice.
	assert.deepEqual(sources.evidenceSegments("Other words.", "Lists are mutable."), [{ text: "Lists are mutable.", match: true }]);
	assert.deepEqual(sources.evidenceSegments("", "Only this."), [{ text: "Only this.", match: true }]);
	assert.deepEqual(sources.evidenceSegments("Regex (a+)? chars.", "(a+)? chars."),
		[{ text: "Regex ", match: false }, { text: "(a+)? chars.", match: true }]);
});

test("evidence rows: at most six, numbered like the citations, legacy quotes as fallback", () => {
	const passage = (i: number, sourceId: string) => ({ sourceId, title: `T${sourceId}`, url: `https://x.test/${sourceId}`,
		rank: 80, sentenceIndex: i, text: `Sentence ${i}.`, context: `Before. Sentence ${i}. After.`, bm25: 1, score: 1 });
	const d = { claim: "c", verdict: "unclear",
		citations: [{ n: 1, sourceId: "b" }, { n: 2, sourceId: "a" }],
		evidence: [passage(0, "a"), passage(1, "b"), passage(2, "c"), passage(3, "a"), passage(4, "a"), passage(5, "a"), passage(6, "a")] };
	const rows = sources.evidenceRows(d);
	assert.equal(rows.length, 6);
	assert.deepEqual(rows.map((r: { n: number }) => r.n), [2, 1, 3, 2, 2, 2]);
	assert.equal(rows[0].locator, "Sentence 1");
	assert.equal(rows[0].segments.find((s: { match: boolean }) => s.match).text, "Sentence 0.");
	const legacy = sources.evidenceRows({ citations: [{ sourceId: "a", quote: "Quoted words." }, { sourceId: "b" }] });
	assert.deepEqual(legacy.map((r: { n: number }) => r.n), [1]);
	assert.deepEqual(legacy[0].segments, [{ text: "Quoted words.", match: true }]);
	assert.deepEqual(sources.evidenceRows({}), []);
});

test("game layer visibility rules", () => {
	assert.deepEqual(format.GAME_LAYERS, ["on", "quiet", "off"]);
	assert.deepEqual(["on", "quiet", "off", "OFF", "loud", undefined].map(format.normalizeGameLayer),
		["on", "quiet", "off", "off", "on", "on"]);
	const on = format.gameRules("on"), quiet = format.gameRules("quiet"), off = format.gameRules("off");
	assert.deepEqual([on.numbers, on.motion, on.announce, on.fills, on.goal], [true, true, true, true, true]);
	// Quiet keeps the numbers (and the goal count) but nothing animates, announces or fills.
	assert.deepEqual([quiet.numbers, quiet.motion, quiet.announce, quiet.fills, quiet.goal], [true, false, false, false, true]);
	// Off hides every game number; learning progress always stays.
	assert.deepEqual([off.numbers, off.motion, off.announce, off.fills, off.goal], [false, false, false, false, false]);
	for (const r of [on, quiet, off]) assert.equal(r.learning, true);
	assert.equal(format.currentGameLayer(), "on");
	for (const layer of format.GAME_LAYERS) assert.ok(format.GAME_LAYER_WORDS[layer].label && format.GAME_LAYER_WORDS[layer].note);
});

test("level labels say whose level it is", () => {
	assert.equal(format.skillLevelLabel(4), "Skill level 4");
	assert.equal(format.overallLevelLabel(5), "Your level 5");
	assert.equal(format.skillLevelLabel(undefined), "Skill level 1");
	assert.equal(you.pickAnnouncement({ leveledUp: true, progress: { level: 3 } }).title, "Skill level 3");
});

test("hints are help: no cost wording, a kind note after a hinted solve, help-seeking badge names", () => {
	assert.equal(format.hintedSolveNote("success", 1), "Solved with a hint — that's how learning works.");
	assert.equal(format.hintedSolveNote("success", 0), "");
	assert.equal(format.hintedSolveNote("fail", 2), "");
	assert.equal(format.badgeLabel("help-then-solve"), "Asked for help, then solved it");
	assert.equal(format.badgeLabel("no-hints"), "Solved without hints");
	// Legacy no-hints never shows as newly earned and is never announced.
	assert.deepEqual(format.freshBadges(["no-hints", "comeback", "help-then-solve"]), ["comeback", "help-then-solve"]);
	assert.ok(!("no-hints" in you.BADGE_COPY));
	assert.equal(you.pickAnnouncement({ badges: ["no-hints"] }), null);
	assert.equal(you.pickAnnouncement({ badges: ["help-then-solve"] }).title, "New: Asked for help, then solved it");
	assert.match(trail.markLabel({ outcome: "success", hintsUsed: 1, xp: 10 }, 0), /^Attempt 1, solved, with a hint, \+10 XP\.$/);
	for (const text of Object.values(format.GAME_LAYER_WORDS).map((w) => (w as { note: string }).note)) {
		assert.doesNotMatch(text, /−|-\d+ XP|penalt|cost/i);
	}
});

test("scheduler reasons become one quiet line; new challenges get none", () => {
	const now = Date.parse("2026-11-01T12:00:00Z");
	const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
	assert.equal(format.reasonLine("review", { subskill: "Strings", lastSeen: ago(72), now }),
		"Review: from Strings, last seen 3 days ago");
	assert.equal(format.reasonLine("review", { subskill: "Strings", lastSeen: ago(30), now }), "Review: from Strings, last seen yesterday");
	assert.equal(format.reasonLine("review", { subskill: "Strings", now }), "Review: from Strings");
	assert.equal(format.reasonLine("review", { lastSeen: ago(5), now }), "Review: last seen 5 hours ago");
	assert.equal(format.reasonLine("review"), "Review: one you've seen before");
	assert.equal(format.reasonLine("retry"), "Another go at one you missed");
	assert.equal(format.reasonLine("stretch"), "A step up");
	assert.equal(format.reasonLine("new"), "");
	assert.equal(format.reasonLine(undefined), "");
	assert.equal(format.agoWords(ago(24 * 15), now), "2 weeks ago");
	assert.equal(format.agoWords(ago(1 / 120), now), "just now");
	assert.equal(format.agoWords("nope", now), "");
});
