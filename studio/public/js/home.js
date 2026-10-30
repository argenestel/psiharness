import { api } from "./api.js";

/** Mount the practice-first landing page with independently loaded sections. */
export function mountHome(el, { navigate }) {
	let disposed = false;
	el.innerHTML = `<div class="psi-home"><section class="psi-hero">
		<span class="eyebrow">A LITTLE CURIOSITY. A LOT OF POSSIBILITY.</span>
		<h1>Learn any complex concept — by doing.</h1>
		<p>Build intuition with small challenges. Try, make mistakes, and level up.<br>Every attempt is progress.</p>
		<form class="psi-learn-form"><label for="learning-goal">What do you want to learn?</label>
		<input id="learning-goal" name="goal" placeholder="What do you want to learn?" required maxlength="2000">
		<div class="psi-actions"><button class="primary" type="submit" data-mode="concept">Understand a concept ↗</button>
		<button type="submit" data-mode="skill">Build a skill →</button></div></form>
		<div class="psi-chips" aria-label="Try a starting point"></div></section>
		<div class="psi-home-columns"><section class="psi-section"><h2>Pick up where you left off</h2>
		<div id="home-continue" class="psi-card" aria-live="polite">Loading your last session…</div></section>
		<section class="psi-section"><h2>Keep it fresh</h2><div id="home-reviews" class="psi-card" aria-live="polite">Checking due reviews…</div></section></div>
		<section class="psi-section"><div class="section-heading"><h2>Your first 20 hours start here</h2>
		<span>Ready-to-practice skill packs</span></div><div id="home-packs" class="psi-grid" aria-live="polite">Finding practice packs…</div></section></div>`;
	const input = el.querySelector("#learning-goal");
	el.querySelector("form").onsubmit = (event) => {
		event.preventDefault();
		const text = input.value.trim();
		if (!text) { input.focus(); return; }
		const command = event.submitter?.dataset.mode === "skill" ? "/skill" : "/learn";
		navigate(`#/new?prompt=${encodeURIComponent(`${command} ${text}`)}`);
	};
	for (const label of ["Python functions", "Recursion", "SQL joins", "Derivatives", "Vectors & matrices",
		"Probability", "Newton's laws", "Big-O"]) {
		const chip = document.createElement("button"); chip.type = "button"; chip.textContent = label;
		chip.onclick = () => { input.value = label; input.focus(); };
		el.querySelector(".psi-chips").append(chip);
	}
	const load = async (path, selector, build) => {
		const target = el.querySelector(selector);
		try {
			const data = await api.get(path);
			if (disposed) return;
			target.replaceChildren(); build(target, data);
		} catch (error) {
			if (!disposed) target.textContent = `Could not load this section. ${error.message}`;
		}
	};
	const text = (tag, value, parent) => {
		const node = document.createElement(tag); node.textContent = value; parent.append(node); return node;
	};
	void load("/api/memory", "#home-continue", (target, memory) => {
		const recap = [...(memory.recaps || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
		if (!recap) { text("p", "Your next discovery starts above. After a session, your next step will be waiting here.", target); return; }
		text("h3", recap.skill || recap.topic || "Your last session", target);
		text("p", recap.summary, target);
		text("p", recap.next || "Ready for another small step?", target);
		const button = text("button", "Continue learning →", target);
		button.onclick = () => {
			const q = new URLSearchParams({ prompt: recap.next || "/practice" });
			if (recap.skill) q.set("skill", recap.skill);
			if (recap.topic) q.set("topic", recap.topic);
			navigate(`#/new?${q}`);
		};
	});
	void load("/api/topics", "#home-reviews", (target, topics) => {
		const due = topics.filter((topic) => topic.due > 0);
		if (!due.length) { text("p", "All caught up. Ideas stick with a little practice, spaced over time.", target); return; }
		for (const topic of due) {
			const a = text("a", `${topic.title} · ${topic.due} due →`, target);
			a.className = "psi-review-link"; a.href = `#/${encodeURIComponent(topic.topic)}/review`;
		}
	});
	void load("/api/packs", "#home-packs", (target, packs) => {
		if (!packs.length) { text("p", "No packs available yet. Build a skill of your own above.", target); return; }
		for (const pack of packs) {
			const slug = typeof pack === "string" ? pack : pack.slug || pack.skill;
			const card = document.createElement("article"); card.className = "psi-card";
			text("span", "PRACTICE PACK", card).className = "eyebrow";
			text("h3", pack.title || slug.replaceAll("-", " "), card);
			text("p", pack.targetPerformance || pack.description || "Small challenges. A skill you can use.", card);
			const button = text("button", "Import & practice →", card);
			const status = text("p", "", card); status.setAttribute("role", "status");
			button.onclick = async () => {
				button.disabled = true;
				try {
					await api.post(`/api/packs/${encodeURIComponent(slug)}/import`, {});
					if (!disposed) navigate(`#/skills/${encodeURIComponent(slug)}`);
				} catch (error) { if (!disposed) { status.textContent = error.message; button.disabled = false; } }
			};
			target.append(card);
		}
	});
	return { destroy() { disposed = true; el.replaceChildren(); } };
}
