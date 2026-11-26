import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialDocument } from "@contracts/invitation";
import { syncPhotoCraftRuntime } from "./runtime";
import { disposePhotoCraftMcpSessions } from "./mcp-session";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const fixtureDirectories: string[] = [];

async function createFakeMcpCli(behavior: "success" | "step-failure" = "success") {
  const directory = await mkdtemp(path.join(tmpdir(), "blangko-mcp-test-"));
  fixtureDirectories.push(directory);
  const binaryPath = path.join(directory, "photocraft.cjs");
  const logPath = path.join(directory, "requests.json");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  console.log("PhotoCraft CLI MCP test 1.0");
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
      serverInfo: { name: "photocraft", version: "test" },
    });
  }
  if (method !== "tools/call") return;
  const args = params.arguments;
  if (params.name === "doc_new") return text(id, { index: 0, width: args.width, height: args.height });
  if (params.name === "command_run") return text(id, { width: args.params.width, height: args.params.height });
  if (params.name === "command_batch") {
    const results = args.steps.map((step, index) => (${JSON.stringify(behavior)} === "step-failure" && index === 1)
      ? { ok: false, error: "synthetic MCP step failure" }
      : { ok: true, result: { id: step.id } });
    return text(id, { completed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, results });
  }
  if (params.name === "doc_place") return text(id, { placed: args.path });
  if (params.name === "doc_inspect") return text(id, { layers: [{ name: "blangko-node:outside-names", kind: "Type" }] });
  if (params.name === "render_preview") {
    return reply(id, { content: [{ type: "image", data: ${JSON.stringify(PNG_1X1)}, mimeType: "image/png" }] });
  }
  if (params.name === "doc_save") {
    fs.writeFileSync(args.path, "native-mcp-pcraft");
    return text(id, { path: args.path });
  }
  if (params.name === "doc_close") return text(id, { closed: args.index });
  text(id, { error: "unknown tool" }, true);
});
`;
  await writeFile(binaryPath, script, "utf8");
  await chmod(binaryPath, 0o755);
  return { binaryPath, logPath };
}

function runtimeOptions(binaryPath: string) {
  return {
    document: createInitialDocument(),
    sideId: "outside" as const,
    projection: "composite" as const,
    assets: {
      "builtin-outside": {
        name: "blangko.png",
        contentType: "image/png",
        dataBase64: PNG_1X1,
      },
    },
    includeDocument: true,
    binaryPath,
    transport: "mcp" as const,
  };
}

afterEach(async () => {
  await disposePhotoCraftMcpSessions();
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("PhotoCraft MCP runtime adapter", () => {
  it("memetakan PPI, Smart Object, render, save, dan close melalui MCP resmi", async () => {
    const fake = await createFakeMcpCli();
    const result = await syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath));
    const requests = JSON.parse(await readFile(fake.logPath, "utf8")) as Array<{
      method: string;
      params: Record<string, unknown>;
    }>;
    const tools = requests.filter((request) => request.method === "tools/call");
    const names = tools.map((request) => request.params.name);

    expect(requests[0]).toMatchObject({ method: "initialize" });
    expect(names[0]).toBe("doc_new");
    expect(tools[1]).toMatchObject({
      params: {
        name: "command_run",
        arguments: {
          id: "image.imageSize",
          params: { width: 3508, height: 2480, resolution: 300, resample: "none" },
        },
      },
    });
    expect(names).toContain("command_batch");
    expect(names).toContain("doc_place");
    expect(names.indexOf("doc_place")).toBeGreaterThan(names.indexOf("command_batch"));
    expect(names.at(-4)).toBe("doc_inspect");
    expect(names.at(-3)).toBe("render_preview");
    expect(names.at(-2)).toBe("doc_save");
    expect(names.at(-1)).toBe("doc_close");
    expect(result.imageBase64).toBe(PNG_1X1);
    expect(Buffer.from(result.fileBase64 || "", "base64").toString()).toBe("native-mcp-pcraft");
    expect(result.manifest).toMatchObject({ schema: "blangko.photocraft.semantic.v2" });
  });

  it("menolak dokumen parsial dan menutup staging ketika batch MCP gagal", async () => {
    const fake = await createFakeMcpCli("step-failure");
    await expect(syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath))).rejects.toThrow(
      /PhotoCraft menghentikan batch pada langkah \d+ \(.*\): synthetic MCP step failure/,
    );
    const requests = JSON.parse(await readFile(fake.logPath, "utf8")) as Array<{
      method: string;
      params: { name?: string };
    }>;
    const tools = requests.filter((request) => request.method === "tools/call");
    expect(tools.at(-1)?.params.name).toBe("doc_close");
    expect(tools.some((request) => request.params.name === "doc_save")).toBe(false);
  });
});
