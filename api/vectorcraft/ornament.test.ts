import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeVectorCraft, refineOrnament } from "./ornament";
import { disposeVectorCraftMcpSessions } from "./session";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SVG_FIXTURE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c00"/></svg>',
  "utf8",
).toString("base64");
const fixtureDirectories: string[] = [];

async function createFakeVectorCraftCli(behavior: "success" | "step-failure" = "success") {
  const directory = await mkdtemp(path.join(tmpdir(), "blangko-vc-test-"));
  fixtureDirectories.push(directory);
  const binaryPath = path.join(directory, "vectorcraft.cjs");
  const logPath = path.join(directory, "requests.json");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  console.log("VectorCraft CLI MCP test 1.0");
  process.exit(0);
}
const requests = [];
function record(request) {
  requests.push(request);
  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(requests));
}
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
function text(id, value, isError = false) {
  reply(id, { content: [{ type: "text", text: JSON.stringify(value) }], isError });
}
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  record(request);
  const { id, method, params } = request;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "vectorcraft", version: "test" },
    });
  }
  if (method !== "tools/call") return;
  const args = params.arguments;
  if (params.name === "open_file") {
    if (!fs.existsSync(args.path)) return text(id, { error: "file tidak ada" }, true);
    return text(id, { opened: args.path, document: 0 });
  }
  if (params.name === "command_batch") {
    const results = args.steps.map((step, index) => (${JSON.stringify(behavior)} === "step-failure" && index === 1)
      ? { ok: false, error: "synthetic VectorCraft step failure" }
      : { ok: true, result: { id: step.id } });
    return text(id, { completed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, results });
  }
  if (params.name === "export") {
    fs.writeFileSync(args.path, "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 10 10\\"><rect width=\\"10\\" height=\\"10\\" fill=\\"#0c0\\"/></svg>");
    return text(id, { path: args.path });
  }
  if (params.name === "render_preview") {
    return reply(id, { content: [{ type: "image", data: ${JSON.stringify(PNG_1X1)}, mimeType: "image/png" }] });
  }
  if (params.name === "inspect_document") return text(id, { artboards: [{ name: "Artboard 1" }] });
  text(id, { error: "unknown tool" }, true);
});
`;
  await writeFile(binaryPath, script, "utf8");
  await chmod(binaryPath, 0o755);
  return { binaryPath, logPath };
}

async function readRequests(logPath: string) {
  return JSON.parse(await readFile(logPath, "utf8")) as Array<{
    method: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  }>;
}

function toolCalls(requests: Awaited<ReturnType<typeof readRequests>>) {
  return requests.filter((request) => request.method === "tools/call");
}

afterEach(async () => {
  await disposeVectorCraftMcpSessions();
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("probeVectorCraft", () => {
  it("melaporkan tidak tersedia bila binary tidak ada", async () => {
    const status = await probeVectorCraft(path.join(tmpdir(), "tidak-ada-vectorcraft-cli"));
    expect(status.available).toBe(false);
    expect(status.message).toContain("tidak ditemukan");
  });

  it("melaporkan versi bila binary merespons --version", async () => {
    const { binaryPath } = await createFakeVectorCraftCli();
    const status = await probeVectorCraft(binaryPath);
    expect(status.available).toBe(true);
    expect(status.version).toContain("VectorCraft CLI MCP test");
  });
});

describe("refineOrnament", () => {
  it("menjalankan open → batch → export → preview dan mengembalikan SVG hasil", async () => {
    const { binaryPath, logPath } = await createFakeVectorCraftCli();
    const result = await refineOrnament({
      binaryPath,
      name: "ornamen.svg",
      svgBase64: SVG_FIXTURE,
      commands: [
        { id: "select.all" },
        { id: "set.paint", params: { fill: "#0c0" } },
      ],
    });

    expect(result.completed).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(Buffer.from(result.svgBase64, "base64").toString("utf8")).toContain("#0c0");
    expect(result.previewPngBase64).toBe(PNG_1X1);

    const calls = toolCalls(await readRequests(logPath));
    expect(calls.map((call) => call.params?.name)).toEqual([
      "open_file", "command_batch", "export", "render_preview",
    ]);
    const batch = calls[1].params?.arguments as { steps: Array<{ id: string; params: Record<string, unknown> }>; stop_on_error: boolean };
    expect(batch.steps).toEqual([
      { id: "select.all", params: {} },
      { id: "set.paint", params: { fill: "#0c0" } },
    ]);
    expect(batch.stop_on_error).toBe(true);

    // open_file dan export tetap di dalam root sesi (automation roots).
    const sessionRoot = path.dirname(path.dirname((calls[0].params?.arguments as { path: string }).path));
    expect((calls[2].params?.arguments as { path: string }).path.startsWith(sessionRoot)).toBe(true);
  });

  it("menolak dan tidak mengekspor bila satu langkah batch gagal", async () => {
    const { binaryPath, logPath } = await createFakeVectorCraftCli("step-failure");
    await expect(refineOrnament({
      binaryPath,
      svgBase64: SVG_FIXTURE,
      commands: [{ id: "select.all" }, { id: "rusak" }, { id: "set.paint" }],
    })).rejects.toThrow(/langkah 2.*synthetic VectorCraft step failure/);

    const calls = toolCalls(await readRequests(logPath));
    expect(calls.map((call) => call.params?.name)).not.toContain("export");
  });

  it("menolak payload yang bukan SVG", async () => {
    const { binaryPath, logPath } = await createFakeVectorCraftCli();
    await expect(refineOrnament({
      binaryPath,
      svgBase64: Buffer.from("bukan svg", "utf8").toString("base64"),
      commands: [],
    })).rejects.toThrow(/bukan dokumen SVG/);
    expect(toolCalls(await readRequests(logPath).catch(() => []))).toEqual([]);
  });
});
