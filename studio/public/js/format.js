// Pure display helpers shared by the shell, chat and widgets (no DOM; imported by Node tests).

/** Core gamify levels: level L starts at 25·(L−1)·L XP and spans 50·L XP. */
export function levelInfo(xp) {
	const total = Number.isFinite(Number(xp)) ? Math.max(0, Number(xp)) : 0;
	const level = Math.floor((1 + Math.sqrt(1 + 4 * total / 25)) / 2);
	const start = 25 * (level - 1) * level, span = 50 * level;
	const into = total - start;
	return { level, into, span, toNext: span - into, percent: Math.round(Math.min(1, into / span) * 100) };
}

/** Short relative time such as "just now", "5m", "3h", "yesterday", "4d" or a date for older items. */
export function relativeTime(iso, now = Date.now()) {
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return "";
	const seconds = Math.max(0, (Number(now) - then) / 1000);
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	if (seconds < 172800) return "yesterday";
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
	return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Readable chat title: expanded /learn and /skill templates collapse to their subject; long text is clipped. */
export function chatTitle(raw, max = 60) {
	let text = String(raw ?? "").replace(/\s+/g, " ").trim();
	const subject = text.match(/^(?:help me (?:learn|understand|build)|teach me|i want to learn)\s+["“]([^"”]{1,80})["”]/i)
		?? text.match(/^\/(?:learn|skill|practice|quest|explore|lesson)\s+(.{1,80})$/i);
	if (subject) text = subject[1].trim();
	if (!text || text === "New chat") return "New chat";
	text = text[0].toUpperCase() + text.slice(1);
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const BADGES = {
	"first-fail": "First fail — mistakes are data", comeback: "Comeback", "streak-3": "3-day streak",
	"streak-7": "7-day streak", "hour-1": "First hour", "hour-5": "5 hours in", "hour-10": "10 hours in",
	"hour-20": "20 hours — skill unlocked", "boss-slayer": "Boss slayer", "no-hints": "No hints needed",
};
/** Friendly badge name for a core badge id. */
export function badgeLabel(id) {
	const key = String(id ?? "");
	if (BADGES[key]) return BADGES[key];
	const words = key.replace(/[-_]+/g, " ").trim();
	return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/** Recognize the challenge card's chat notification ("Answered challenge <id>: <answer> (<outcome>, +N XP)"). */
export function parseAttemptMessage(text) {
	const match = String(text ?? "").match(/^Answered challenge (\S+): ([\s\S]*) \((success|partial|fail|skipped), \+(\d+) XP\)$/);
	if (match) return { kind: "attempt", id: match[1], answer: match[2], outcome: match[3], xp: Number(match[4]) };
	const lesson = String(text ?? "").match(/^My answer to challenge (\S+): ([\s\S]*) — result: (\w+)\. Lesson: ([\s\S]+)$/);
	if (lesson) return { kind: "lesson", id: lesson[1], answer: lesson[2], outcome: lesson[3], lesson: lesson[4] };
	return null;
}
