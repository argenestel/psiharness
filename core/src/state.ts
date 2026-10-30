import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { newId, nowIso } from "./slug.ts";
import type { PsiState } from "./types.ts";

function validate(state: PsiState): void {
	for (const [key, value] of [["activeSkill", state.activeSkill], ["activeTopic", state.activeTopic],
		["openChallenge.skill", state.openChallenge?.skill]] as const) {
		if (value !== undefined && (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) {
			throw new Error(`Invalid ${key} slug: ${value}`);
		}
	}
	if (state.openChallenge !== undefined && (!state.openChallenge ||
		typeof state.openChallenge.skill !== "string" || typeof state.openChallenge.id !== "string" ||
		!state.openChallenge.id.trim())) throw new Error("Invalid openChallenge");
}

/** Persist the learner's current skill, topic and challenge between processes. */
export class StateStore {
	readonly root: string;
	private readonly file: string;

	/** Resolve the home without creating it. */
	constructor(home = process.env.PSI_HOME ?? path.join(os.homedir(), ".psi")) {
		this.root = path.resolve(home);
		this.file = path.join(this.root, "state.json");
	}

	private assertFile(): void {
		try {
			if (fs.lstatSync(this.file).isSymbolicLink()) throw new Error(`Refusing symlink: ${this.file}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	/** Return persisted state, or an empty timestamped state when absent. */
	read(): PsiState {
		this.assertFile();
		let text: string;
		try {
			text = fs.readFileSync(this.file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { updatedAt: nowIso() };
			throw error;
		}
		const state: PsiState = JSON.parse(text);
		validate(state);
		return state;
	}

	/** Merge fields, delete explicit undefined values, and atomically replace state.json. */
	update(patch: Partial<Omit<PsiState, "updatedAt">>): PsiState {
		const state = { ...this.read(), ...patch, updatedAt: nowIso() };
		for (const key of ["activeSkill", "activeTopic", "openChallenge"] as const) {
			if (state[key] === undefined) delete state[key];
		}
		validate(state);
		fs.mkdirSync(this.root, { recursive: true });
		this.assertFile();
		const temporary = `${this.file}.${process.pid}.${newId("tmp")}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify(state, null, "\t") + "\n", { flag: "wx" });
			fs.renameSync(temporary, this.file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		return state;
	}
}
