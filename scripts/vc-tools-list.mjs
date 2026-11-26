/* Sekali jalan: tools/list terhadap vectorcraft-cli asli untuk validasi kontrak POC. */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BIN = path.resolve(process.argv[2]);
if (!process.argv[2]) { console.error("usage: node vc-tools-list.mjs <binary>"); process.exit(2); }

const root = await mkdtemp(path.join(tmpdir(), "vc-probe-"));
const child = spawn(BIN, ["mcp", "--automation-read-root", root, "--automation-write-root", root], {
  cwd: root, stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const nl = buffer.indexOf("\n");
    if (nl < 0) break;
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (typeof msg.id === "number" && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on("data", (c) => console.error("[stderr]", c.toString().trim().slice(0, 200)));

const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error("timeout " + method)), 240000);
  pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

const list = await rpc("tools/list", {});
const names = (list.tools ?? []).map((t) => t.name);
console.log("TOOLS(" + names.length + "):", names.join(", "));

for (const wanted of ["open_file", "command_batch", "export", "render_preview", "inspect_document", "doc_inspect", "list_commands", "command_list", "save_file"]) {
  const tool = (list.tools ?? []).find((t) => t.name === wanted);
  if (!tool) { console.log(`\n## ${wanted}: TIDAK ADA`); continue; }
  const schema = tool.inputSchema ?? {};
  console.log(`\n## ${wanted}`);
  console.log("props:", Object.keys(schema.properties ?? {}).join(", ") || "(kosong)");
  console.log("required:", JSON.stringify(schema.required ?? []));
}

child.kill("SIGTERM");
process.exit(0);
