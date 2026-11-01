import { appendFileSync, chmodSync, existsSync, readSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function runFakeHost(): void {
	const args = process.argv.slice(2), home = process.env.PSI_HOME ?? process.cwd();
	const log = join(home, "fake-rpc.jsonl"), exitMarker = join(home, "exit-once");
	const emit = (value: unknown) => writeSync(1, `${JSON.stringify(value)}\r\n`);
	const record = (value: unknown) => appendFileSync(log, `${JSON.stringify(value)}\n`);
	let pending = "";
	const nextCommand = (): Record<string, unknown> | undefined => {
		while (!pending.includes("\n")) {
			const chunk = Buffer.alloc(65536), count = readSync(0, chunk, 0, chunk.length, null);
			if (!count) return undefined;
			pending += chunk.subarray(0, count).toString();
		}
		const end = pending.indexOf("\n"), line = pending.slice(0, end).replace(/\r$/, "");
		pending = pending.slice(end + 1);
		return line ? JSON.parse(line) as Record<string, unknown> : nextCommand();
	};
	record({ direction: "start", args, env: { home, readRoot: process.env.PSI_WEB_READ_ROOT, codeExec: process.env.PSI_CODE_EXEC } });
	for (;;) {
		const command = nextCommand();
		if (!command) break;
		record({ direction: "in", command });
		if (command.type !== "prompt") continue;
		const message = String(command.message ?? "");
		if (message === "exit-once" && !existsSync(exitMarker)) { writeFileSync(exitMarker, "1"); process.exit(7); }
		const handled = message === "handled";
		emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: handled ? "handled" : "started" } });
		if (handled) {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
			emit({ type: "agent_start" }); emit({ type: "agent_settled", aborted: false }); continue;
		}
		emit({ type: "agent_start" });
		if (message === "ui") emit({ type: "extension_ui_request", id: "dialog-1", method: "input", title: "Answer" });
		if (message === "model-error") emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "fake provider failure", content: [] } });
		else emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] } });
		if (message === "open") writeFileSync(join(home, "state.json"), JSON.stringify({ activeSkill: "demo", openChallenge: { skill: "demo", id: "c1" }, updatedAt: new Date().toISOString() }));
		if (message === "ui") { const response = nextCommand(); emit({ type: "agent_settled", aborted: response?.cancelled === true }); }
		else emit({ type: "agent_settled", aborted: false });
	}
}

/** Small RPC host used by the eval smoke tests; it exercises retries, dialogs, and CRLF framing. */
export function fakePi(directory: string): string {
	const file = join(directory, "fake-pi.mjs");
	writeFileSync(file, `#!/usr/bin/env node
import { existsSync, appendFileSync, readSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const home = process.env.PSI_HOME;
const log = join(home, "fake-rpc.jsonl");
const exitMarker = join(home, "exit-once");
function emit(value) { writeSync(1, JSON.stringify(value) + "\\r\\n"); }
function record(value) { appendFileSync(log, JSON.stringify(value) + "\\n"); }
let pending = "";
function nextCommand() {
 while (!pending.includes("\\n")) {
  const chunk = Buffer.alloc(65536); const count = readSync(0, chunk, 0, chunk.length, null);
  if (!count) return undefined; pending += chunk.subarray(0, count).toString();
 }
 const end = pending.indexOf("\\n"); const line = pending.slice(0, end).replace(/\\r$/, ""); pending = pending.slice(end + 1);
 return line ? JSON.parse(line) : nextCommand();
}

record({ direction: "start", args, env: { home, readRoot: process.env.PSI_WEB_READ_ROOT, codeExec: process.env.PSI_CODE_EXEC } });
for (;;) {
 const command = nextCommand(); if (!command) break; record({ direction: "in", command });
 if (command.type !== "prompt") continue;
 if (command.message === "exit-once" && !existsSync(exitMarker)) { writeFileSync(exitMarker, "1"); writeSync(2, "first child exit\\n"); process.exit(7); }
 const handled = command.message === "handled";
 emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: handled ? "handled" : "started" } });
 if (handled) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
  emit({ type: "agent_start" }); emit({ type: "agent_settled", aborted: false });
 } else {
  emit({ type: "agent_start" });
  if (command.message === "ui") emit({ type: "extension_ui_request", id: "dialog-1", method: "input", title: "Answer" });
  if (command.message === "model-error") emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "fake provider failure", content: [] } });
  else emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] } });
  if (command.message === "open") writeFileSync(join(home, "state.json"), JSON.stringify({ activeSkill: "demo", openChallenge: { skill: "demo", id: "c1" }, updatedAt: new Date().toISOString() }));
  if (command.message === "ui") {
   const response = nextCommand(); emit({ type: "agent_settled", aborted: response?.cancelled === true });
  } else emit({ type: "agent_settled", aborted: false });
 }
}

`);
	chmodSync(file, 0o755);
	return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runFakeHost();

