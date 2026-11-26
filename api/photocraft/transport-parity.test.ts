import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyDesignProposal,
  createInitialDocument,
  type InvitationDocument,
} from "@contracts/invitation";
import { createDeterministicProposal } from "../design";
import { disposePhotoCraftMcpSessions } from "./mcp-session";
import { disposePhotoCraftSessions } from "./session";
import { syncPhotoCraftRuntime, type PhotoCraftRuntimeResult } from "./runtime";

// Opaque 64 × 48 magenta fixture so both transports place real pixels.
const PNG_SOLID_PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAU0lEQVR4nO3PQQ3AIADAQEAIElGMmIngcVnSU9DOu8/4s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaB90aUByG4TJA4AAAAASUVORK5CYII=";

function buildParityFixture(targetPpi: 300 | 600) {
  let document = createInitialDocument();
  document.stock = {
    ...document.stock,
    width: 140,
    height: 100,
    safeMargin: 6,
    targetPpi,
    physicalSizeConfirmed: true,
  };
  document.assets.push({
    id: "photo-cover",
    name: "cover.png",
    kind: "photo",
    source: "storage",
    storageKey: "projects/test/cover.png",
    contentType: "image/png",
    width: 64,
    height: 48,
  });
  document = applyDesignProposal(document, createDeterministicProposal(document, "outside", "rustic"));
  const outside = document.sides[0];
  const title = outside.nodes.find((node) => node.id === "agent-title");
  if (title) {
    title.rotation = -4;
    title.opacity = 0.85;
  }
  const firstShape = outside.nodes.find((node) => node.kind === "shape");
  if (firstShape) firstShape.locked = true;
  outside.nodes.push({
    id: "rounded-photo-parity",
    kind: "image",
    role: "CONTENT",
    box: { x: 8, y: 8, width: 18, height: 22 },
    rotation: 5,
    visible: true,
    locked: false,
    opacity: 0.8,
    zIndex: 8,
    assetId: "photo-cover",
    clipShape: "rounded-rectangle",
    cornerRadius: 3,
  });

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" viewBox="0 0 1400 1000"><rect width="1400" height="1000" fill="#f4efe5"/><path d="M0 800 Q350 600 700 800 T1400 800 V1000 H0Z" fill="#6e7254"/></svg>`).toString("base64");
  return {
    document,
    assets: {
      "builtin-outside": { name: "blangko.svg", contentType: "image/svg+xml", dataBase64: svg },
      "photo-cover": { name: "cover.png", contentType: "image/png", dataBase64: PNG_SOLID_PHOTO },
    },
  };
}

function nodeNames(inspect: unknown): string[] {
  const matches = JSON.stringify(inspect).match(/blangko-node:[a-z0-9-]+/g) ?? [];
  return [...new Set(matches)].sort();
}

function layerKinds(inspect: unknown): string[] {
  const json = JSON.stringify(inspect);
  const matches = [...json.matchAll(/"kind"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  return [...new Set(matches)].sort();
}

function expectNativeParity(result: PhotoCraftRuntimeResult) {
  const inspect = JSON.stringify(result.inspect);
  expect(result.mime).toBe("image/png");
  expect(result.imageBase64.length).toBeGreaterThan(100);
  expect(Buffer.from(result.fileBase64 || "", "base64").byteLength).toBeGreaterThan(1000);
  expect(inspect).toContain("__BLANGKO__");
  expect(inspect).toContain("blangko-node:agent-title");
  expect(inspect).toContain("blangko-node:rounded-photo-parity");
  expect(inspect).toMatch(/"kind"\s*:\s*"Type"/);
  expect(inspect).toMatch(/"kind"\s*:\s*"Shape"/);
  expect(inspect).toMatch(/Smart\s*Object/i);
  expect(result.manifest).toMatchObject({
    schema: "blangko.photocraft.semantic.v2",
    projection: "composite",
    sideId: "outside",
  });
}

afterAll(async () => {
  await disposePhotoCraftSessions();
  await disposePhotoCraftMcpSessions();
});

describe("PhotoCraft transport parity (RPC versus MCP)", () => {
  it.each([300, 600] as const)("menghasilkan dokumen yang setara secara semantik pada PPI %i", async (targetPpi) => {
    const fixture = buildParityFixture(targetPpi);
    const shared = {
      sideId: "outside" as const,
      projection: "composite" as const,
      includeDocument: true,
      maxSide: 1600,
    };
    const rpc = await syncPhotoCraftRuntime({
      ...shared,
      document: structuredClone(fixture.document) as InvitationDocument,
      assets: fixture.assets,
      transport: "rpc",
    });
    const mcp = await syncPhotoCraftRuntime({
      ...shared,
      document: structuredClone(fixture.document) as InvitationDocument,
      assets: fixture.assets,
      transport: "mcp",
    });

    expectNativeParity(rpc);
    expectNativeParity(mcp);

    // Preview dimensions must match (±1 px for rounding); bytes may differ.
    const rpcImage = PNG.sync.read(Buffer.from(rpc.imageBase64, "base64"));
    const mcpImage = PNG.sync.read(Buffer.from(mcp.imageBase64, "base64"));
    expect(Math.abs(rpcImage.width - mcpImage.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rpcImage.height - mcpImage.height)).toBeLessThanOrEqual(1);

    // Same native layer names and kinds on both transports.
    expect(nodeNames(mcp.inspect)).toEqual(nodeNames(rpc.inspect));
    expect(layerKinds(mcp.inspect)).toEqual(layerKinds(rpc.inspect));

    // The semantic manifest is compiled client-side and must be identical.
    const { runtime: rpcRuntime, ...rpcManifest } = rpc.manifest as Record<string, unknown>;
    const { runtime: mcpRuntime, ...mcpManifest } = mcp.manifest as Record<string, unknown>;
    expect(mcpManifest).toEqual(rpcManifest);
    expect(mcpRuntime).toBe(rpcRuntime);
  }, 240_000);
});
