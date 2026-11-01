/**
 * Learner settings that live in the profile. Today: the game layer (On / Quiet / Off).
 *
 * API
 * - `loadGameLayer()` → Promise<layer>: GET /api/me, then applyGameLayer (keeps the cached layer when offline).
 * - `saveGameLayer(layer)` → Promise<layer>: PUT /api/me/profile { gameLayer } and apply it.
 * - `gameLayerControl({ id })` → HTMLElement: a segmented control "Game layer: On / Quiet / Off" with a one-line
 *   note. Several controls stay in sync through the "psi:game" event.
 */
import { api } from "./api.js";
import { el, on, toast, applyGameLayer, currentGameLayer } from "./ui.js";
import { GAME_LAYERS, GAME_LAYER_WORDS, normalizeGameLayer } from "./format.js";

/** Read the layer from the learner profile and apply it. */
export async function loadGameLayer() {
	try {
		const me = await api.get("/api/me");
		return applyGameLayer(me?.gameLayer);
	} catch { return currentGameLayer(); }
}

/** Save a new layer to the profile, applying it first so the page answers at once. */
export async function saveGameLayer(layer) {
	const previous = currentGameLayer(), next = normalizeGameLayer(layer);
	applyGameLayer(next);
	try {
		await api.put("/api/me/profile", { gameLayer: next });
		return next;
	} catch (error) {
		applyGameLayer(previous);
		throw error;
	}
}

let controls = 0;
/** "Game layer: On / Quiet / Off" as radio buttons drawn as one segmented control.
 * @param {{ id?: string, compact?: boolean }} [options]
 */
export function gameLayerControl({ id, compact = false } = {}) {
	const name = id ?? `psi-game-layer-${++controls}`;
	const note = el("p", { class: "psi-seg-note", id: `${name}-note` });
	const status = el("p", { class: "psi-seg-status", role: "status" });
	const radios = GAME_LAYERS.map((layer) => el("input", { type: "radio", name, value: layer, id: `${name}-${layer}`,
		class: "psi-seg-input" }));
	const group = el("div", { class: "psi-seg-options" }, GAME_LAYERS.map((layer, i) => [radios[i],
		el("label", { for: `${name}-${layer}`, class: "psi-seg-option" }, GAME_LAYER_WORDS[layer].label)]));
	const root = el("fieldset", { class: `psi-seg${compact ? " is-compact" : ""}`, "aria-describedby": note.id },
		el("legend", { class: "psi-seg-legend" }, "Game layer"), group, note, status);
	const sync = (layer = currentGameLayer()) => {
		radios.forEach((r) => { r.checked = r.value === layer; });
		note.textContent = GAME_LAYER_WORDS[layer].note;
	};
	radios.forEach((radio) => radio.addEventListener("change", async () => {
		if (!radio.checked) return;
		status.textContent = "";
		try { await saveGameLayer(radio.value); } catch (error) {
			sync();
			status.textContent = `Couldn't save that. ${String(error?.message ?? error).replace(/\.$/, "")}. Try again.`;
			toast("Couldn't save the game layer. Check that psi web is running, then try again.", { kind: "error" });
		}
	}));
	const off = on("psi:game", (detail) => sync(normalizeGameLayer(detail?.layer)));
	sync();
	return Object.assign(root, { destroy: off });
}
