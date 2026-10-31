import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Executable fake RPC host that persists pi-shaped session entries (v3 tree) and splits Unicode bytes. */
export function fakePi(directory: string): string {
	const file = join(directory, "fake-pi.mjs");
	writeFileSync(file, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const session = args[args.indexOf("--session") + 1];
function emit(record) { process.stdout.write(JSON.stringify(record) + "\\r\\n"); }
let parent = null, n = 0;
function persist(message) {
 const id = "e" + process.pid + "-" + (++n);
 appendFileSync(session, JSON.stringify({type:"message", id, parentId:parent, timestamp:new Date().toISOString(), message})+"\\n");
 parent = id;
}
let pending = "";
process.stdin.on("data", chunk => {
 pending += chunk.toString();
 let i;
 while ((i = pending.indexOf("\\n")) !== -1) {
  const c = JSON.parse(pending.slice(0,i)); pending = pending.slice(i+1);
  if (c.type === "get_state") emit({type:"response", command:c.type, success:true,
   data:{sessionFile:session, pid:process.pid, args, cwd:process.cwd(), home:process.env.PSI_HOME}});
  if (c.type === "prompt") {
   const call = {type:"toolCall", id:"t1", name:"psi_challenge", arguments:{prompt:"6*7?", expected:"42", acceptable:["forty-two"], rubric:["product"], hints:["6*7"]}};
   const widget = {type:"challenge", id:"c1", skill:"mental-math", prompt:"6*7?", hintsCount:1};
   persist({role:"user", content:[{type:"text",text:c.message}]});
   emit({id:c.id, type:"response", command:"prompt", success:true, data:{disposition:"started", streamingBehavior:c.streamingBehavior ?? null}});
   emit({type:"agent_start"});
   emit({type:"message_start",message:{role:"assistant",content:[]}});
   const bytes = Buffer.from(JSON.stringify({type:"message_update",assistantMessageEvent:{type:"text_delta",contentIndex:0,delta:"Hi 🌱\\u2028there"}})+"\\n");
   const split = bytes.indexOf(Buffer.from("🌱"))+1;
   process.stdout.write(bytes.subarray(0,split));
   process.stdout.write(bytes.subarray(split));
   emit({type:"message_update",assistantMessageEvent:{type:"toolcall_delta",contentIndex:1,delta:'{"expected":"42"'}});
   emit({type:"message_update",assistantMessageEvent:{type:"toolcall_end",contentIndex:1,toolCall:call}});
   const assistant = {role:"assistant",content:[{type:"text",text:"Hi 🌱\\u2028there"}, call]};
   persist(assistant);
   emit({type:"message_end",message:assistant});
   emit({type:"tool_execution_start", toolName:"psi_challenge", toolCallId:"t1",args:call.arguments});
   const result = {content:[{type:"text",text:"shown"}],details:{challengeId:"c1", widget}};
   persist({role:"toolResult", toolCallId:"t1", toolName:"psi_challenge", content:result.content, details:result.details, isError:false});
   emit({type:"tool_execution_end",toolName:"psi_challenge",toolCallId:"t1",result,isError:false});
   emit({type:"extension_ui_request",id:"ui1",method:"select",options:["A","B"]});
   emit({type:"extension_ui_request",id:"s1",method:"setStatus",statusKey:"psi",statusText:"ψ " + c.message});
   const final = {role:"assistant",content:[{type:"text",text:"Hi there friend"}]};
   persist(final);
   emit({type:"message_end",message:final});
   emit({type:"agent_end",messages:[assistant, final]});
   emit({type:"agent_settled",aborted:false});
  }
  if (c.type === "extension_ui_response") emit({type:"ui_echo",response:c});
  if (c.type === "abort") { emit({type:"response",command:"abort",success:true}); emit({type:"agent_settled",aborted:true}); }
 }
});
`);
	chmodSync(file, 0o755);
	return file;
}
