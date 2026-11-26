import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialDocument } from "@contracts/invitation";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c0392b"/></svg>';
const fixtureDirectories: string[] = [];

async function createFakeVectorCraftCli() {
  const directory = await mkdtemp(path.join(tmpdir(), "blangko-vc-agent-test-"));
  fixtureDirectories.push(directory);
  const binaryPath = path.join(directory, "vectorcraft.cjs");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  console.log("VectorCraft CLI MCP test 1.0");
  process.exit(0);
}
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
function text(id, value, isError = false) { reply(id, { content: [{ type: "text", text: JSON.stringify(value) }], isError }); }
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === "initialize") {
    return reply(id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "vectorcraft", version: "test" } });
  }
  if (method !== "tools/call") return;
  const args = params.arguments;
  if (params.name === "open_file") return text(id, { opened: args.path, document: 0 });
  if (params.name === "command_batch") {
    const results = args.steps.map((step) => ({ ok: true, result: { id: step.id } }));
    return text(id, { completed: results.length, failed: 0, results });
  }
  if (params.name === "export") {
    fs.writeFileSync(args.path, "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 10 10\\"><rect width=\\"10\\" height=\\"10\\" fill=\\"#2c3e50\\"/></svg>");
    return text(id, { path: args.path });
  }
  if (params.name === "render_preview") {
    return reply(id, { content: [{ type: "image", data: ${JSON.stringify(PNG_1X1)}, mimeType: "image/png" }] });
  }
  text(id, { error: "unknown tool" }, true);
});
`;
  await writeFile(binaryPath, script, "utf8");
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

function documentWithOrnament() {
  const document = createInitialDocument();
  document.assets.push({
    id: "asset-ornamen-1",
    name: "Botanical Line",
    kind: "ornament",
    source: "generated",
    contentType: "image/svg+xml",
    generatedSvg: SVG_SOURCE,
    width: 800,
    height: 800,
  });
  return document;
}

function runBody(intent: string, extra: Record<string, unknown> = {}) {
  return {
    forwardedProps: {
      document: documentWithOrnament(),
      request: { sideId: "outside", style: "rustic", prompt: "", intent, ...extra },
    },
  };
}

async function readSseEvents(response: Response) {
  const text = await response.text();
  return text.split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as { type: string; [key: string]: unknown });
}

function assistantText(events: Awaited<ReturnType<typeof readSseEvents>>) {
  return events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => (event as { delta?: string }).delta ?? "").join("");
}

afterEach(async () => {
  const { disposeVectorCraftMcpSessions } = await import("../vectorcraft/session");
  await disposeVectorCraftMcpSessions();
  delete process.env.VECTORCRAFT_CLI_BIN;
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("agent ornament-refine", () => {
  it("menolak halus bila aset ornamen tidak dipilih", async () => {
    const { agentRoutes } = await import("./agent");
    const response = await agentRoutes.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody("ornament-refine", { prompt: "ubah warna jadi #2c3e50" })),
    });
    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    expect(assistantText(events)).toContain("Pilih ornamen vektor");
    expect(events.some((event) => event.type === "RUN_FINISHED")).toBe(true);
  });

  it("melaporkan sidecar belum aktif bila binary tidak dikonfigurasi", async () => {
    const { env } = await import("../lib/env");
    env.vectorcraftCliBin = "";
    const { agentRoutes } = await import("./agent");
    const response = await agentRoutes.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody("ornament-refine", { prompt: "ubah warna jadi #2c3e50", assetId: "asset-ornamen-1" })),
    });
    const events = await readSseEvents(response);
    expect(assistantText(events)).toContain("Sidecar VectorCraft belum aktif");
    expect(events.some((event) => event.type === "RUN_FINISHED")).toBe(true);
  });

  it("menghasilkan proposal refine lewat fallback deterministik dan sidecar", async () => {
    const binaryPath = await createFakeVectorCraftCli();
    process.env.VECTORCRAFT_CLI_BIN = binaryPath;
    const { env } = await import("../lib/env");
    env.vectorcraftCliBin = binaryPath;
    const { agentRoutes } = await import("./agent");
    const response = await agentRoutes.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody("ornament-refine", { prompt: "ubah warna jadi #2c3e50", assetId: "asset-ornamen-1" })),
    });
    expect(response.status).toBe(200);
    const events = await readSseEvents(response);

    const proposalEvent = events.find((event) =>
      event.type === "ACTIVITY_SNAPSHOT"
      && (event as { activityType?: string }).activityType === "blangko.ornament.proposal"
    ) as { content?: { proposal?: { summary: string; asset: { id: string; generatedSvg?: string; name: string }; node: { assetId: string } } } } | undefined;
    expect(proposalEvent).toBeDefined();
    const proposal = proposalEvent!.content!.proposal!;
    expect(proposal.summary).toContain("#2c3e50");
    expect(proposal.asset.name).toContain("VectorCraft");
    expect(proposal.asset.generatedSvg).toContain("#2c3e50");
    expect(proposal.node.assetId).toBe(proposal.asset.id);
    expect(events.some((event) => event.type === "RUN_FINISHED")).toBe(true);
    expect(events.some((event) => event.type === "RUN_ERROR")).toBe(false);
  });
});
