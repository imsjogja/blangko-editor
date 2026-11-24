import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDesignProposal,
  createInitialDocument,
  type InvitationDocument,
} from "@contracts/invitation";
import { createDeterministicProposal } from "../design";
import { disposePhotoCraftSessions } from "./session";
import { probePhotoCraft, syncPhotoCraftRuntime } from "./runtime";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// Opaque 64 × 48 magenta fixture: transparent one-pixel images cannot prove
// that a framed Smart Object is visible in the rendered pixels.
const PNG_SOLID_PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAU0lEQVR4nO3PQQ3AIADAQEAIElGMmIngcVnSU9DOu8/4s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaB90aUByG4TJA4AAAAASUVORK5CYII=";
const fixtureDirectories: string[] = [];

async function createFakeCli(behavior: "success" | "failure" | "step-failure" = "success", appImage = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "blangko-cli-test-"));
  fixtureDirectories.push(directory);
  const binaryPath = path.join(directory, appImage ? "photocraft.AppImage" : "photocraft.cjs");
  const logPath = path.join(directory, "requests.json");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const args = process.argv.slice(2);
if (args[0] === "--cli") args.shift();
if (args[0] === "--version") {
  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(args));
  console.log("PhotoCraft CLI test 1.0");
  process.exit(0);
}
const requests = [];
function record(request) {
  requests.push(request);
  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(requests));
}
function reply(id, result) {
  process.stdout.write(JSON.stringify({ id, ok: true, result }) + "\\n");
}
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  record(request);
  const { id, method, params } = request;
  if (method === "methods") return reply(id, { methods: ["doc.new", "doc.render"] });
  if (method === "doc.new") return reply(id, { document: 0 });
  if (method === "batch") {
    if (${JSON.stringify(behavior)} === "failure") {
      process.stdout.write(JSON.stringify({ id, ok: false, error: { message: "synthetic engine failure" } }) + "\\n");
      return;
    }
    if (${JSON.stringify(behavior)} === "step-failure") {
      return reply(id, { completed: 1, failed: 1, results: [{ ok: true }, { ok: false, error: "synthetic step failure" }] });
    }
    return reply(id, { completed: params.steps.length, failed: 0, results: params.steps.map(() => ({ ok: true })) });
  }
  if (method === "doc.inspect") return reply(id, { layers: [{ name: "blangko-node:outside-names", kind: "Type" }] });
  if (method === "doc.render") return reply(id, { mime: "image/png", base64: ${JSON.stringify(PNG_1X1)} });
  if (method === "doc.save") {
    fs.writeFileSync(params.path, "native-pcraft");
    return reply(id, { path: params.path });
  }
  if (method === "doc.close") return reply(id, { closed: params.index });
  reply(id, {});
});
`;
  await writeFile(binaryPath, script, "utf8");
  await chmod(binaryPath, 0o755);
  return { binaryPath, logPath };
}

function runtimeOptions(binaryPath: string, document: InvitationDocument = createInitialDocument()) {
  return {
    document,
    sideId: "outside" as const,
    projection: "content-only" as const,
    assets: {},
    includeDocument: true,
    binaryPath,
  };
}

afterEach(async () => {
  await disposePhotoCraftSessions();
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("PhotoCraft runtime protocol", () => {
  it("melaporkan binary yang tidak tersedia tanpa melempar error", async () => {
    const status = await probePhotoCraft(path.join(tmpdir(), "photocraft-binary-tidak-ada"));
    expect(status.available).toBe(false);
    expect(status.mode).toBe("headless-engine");
    expect(status.handoff).toBe("native-pcraft");
    expect(status.message).toContain("Runtime PhotoCraft belum tersedia");
  });

  it("menambahkan prefix --cli untuk AppImage dan membaca versi", async () => {
    const fake = await createFakeCli("success", true);
    const status = await probePhotoCraft(fake.binaryPath);
    expect(status.available).toBe(true);
    expect(status.version).toBe("PhotoCraft CLI test 1.0");
    expect(JSON.parse(await readFile(fake.logPath, "utf8"))).toEqual(["--version"]);
  });

  it("menjalankan persistent RPC dan menghasilkan dokumen serta manifest native v2", async () => {
    const fake = await createFakeCli();
    const result = await syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath));
    const requests = JSON.parse(await readFile(fake.logPath, "utf8")) as Array<{
      method: string;
      params: Record<string, unknown>;
    }>;

    expect(requests.map((request) => request.method)).toEqual([
      "methods", "doc.new", "batch", "doc.inspect", "doc.render", "doc.save", "doc.close",
    ]);
    expect(requests[1].params).toMatchObject({ width: 3508, height: 2480, resolution: 300, background: "transparent" });
    expect(JSON.stringify(requests[2])).toContain("type.create");
    expect(JSON.stringify(requests[2])).toContain("shape.create");
    expect(JSON.stringify(requests[2])).not.toContain("__BLANGKO__");
    expect(Buffer.from(result.fileBase64 || "", "base64").toString()).toBe("native-pcraft");
    expect(result.imageBase64).toBe(PNG_1X1);
    expect(result.runtime).toBe("PhotoCraft CLI test 1.0");
    expect(result.manifest).toMatchObject({
      schema: "blangko.photocraft.semantic.v2",
      editableLayers: true,
      projection: "content-only",
      sideId: "outside",
    });
    expect(result.editableLayers).toBe(true);
  });

  it("menjalankan seluruh transaksi dokumen secara eksklusif saat request bersamaan", async () => {
    const fake = await createFakeCli();
    await Promise.all([
      syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath)),
      syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath)),
    ]);
    const requests = JSON.parse(await readFile(fake.logPath, "utf8")) as Array<{ method: string }>;
    const methods = requests.map((request) => request.method);

    expect(methods).toEqual([
      "methods",
      "doc.new", "batch", "doc.inspect", "doc.render", "doc.save", "doc.close",
      "doc.new", "batch", "doc.inspect", "doc.render", "doc.save", "doc.close",
    ]);
  });

  it("menutup dokumen ketika batch engine gagal", async () => {
    const fake = await createFakeCli("failure");
    await expect(syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath))).rejects.toThrow("synthetic engine failure");
    const requests = JSON.parse(await readFile(fake.logPath, "utf8")) as Array<{ method: string }>;
    expect(requests.at(-1)?.method).toBe("doc.close");
  });

  it("menolak dokumen parsial ketika satu langkah di dalam batch gagal", async () => {
    const fake = await createFakeCli("step-failure");
    await expect(syncPhotoCraftRuntime(runtimeOptions(fake.binaryPath))).rejects.toThrow(
      /PhotoCraft menghentikan batch pada langkah 2 \(.*\): synthetic step failure/,
    );
    const requests = JSON.parse(await readFile(fake.logPath, "utf8")) as Array<{ method: string }>;
    expect(requests.at(-1)?.method).toBe("doc.close");
  });
});

describe("PhotoCraft real engine regression", () => {
  it("merender komposisi kaya dan menyimpan Type, Shape, serta Smart Object native", async () => {
    let document = createInitialDocument();
    document.stock = { ...document.stock, width: 140, height: 100, safeMargin: 6, physicalSizeConfirmed: true };
    document.assets.push({
      id: "photo-cover",
      name: "cover.png",
      kind: "photo",
      source: "storage",
      storageKey: "projects/test/cover.png",
      contentType: "image/png",
      width: 64,
      height: 64,
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
      id: "rounded-photo-regression",
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
    const result = await syncPhotoCraftRuntime({
      document,
      sideId: "outside",
      projection: "composite",
      assets: {
        "builtin-outside": { name: "blangko.svg", contentType: "image/svg+xml", dataBase64: svg },
        "photo-cover": { name: "cover.png", contentType: "image/png", dataBase64: PNG_1X1 },
      },
      includeDocument: true,
      maxSide: 1000,
    });
    const inspect = JSON.stringify(result.inspect);

    expect(result.mime).toBe("image/png");
    expect(result.imageBase64.length).toBeGreaterThan(100);
    expect(Buffer.from(result.fileBase64 || "", "base64").byteLength).toBeGreaterThan(1000);
    expect(inspect).toContain("__BLANGKO__");
    expect(inspect).toContain("blangko-node:agent-title");
    expect(inspect).toContain("blangko-node:rounded-photo-regression");
    expect(inspect).toMatch(/"kind"\s*:\s*"Type"/);
    expect(inspect).toMatch(/"kind"\s*:\s*"Shape"/);
    expect(inspect).toMatch(/Smart\s*Object/i);
    expect(result.manifest).toMatchObject({ schema: "blangko.photocraft.semantic.v2", projection: "composite" });
  }, 120_000);

  it("menampilkan piksel foto di pusat frame rectangle, ellipse, dan rounded", async () => {
    const document = createInitialDocument();
    document.stock = {
      ...document.stock,
      width: 90,
      height: 40,
      targetPpi: 300,
      physicalSizeConfirmed: true,
    };
    document.assets.push({
      id: "opaque-photo",
      name: "opaque-photo.png",
      kind: "photo",
      source: "storage",
      storageKey: "projects/test/opaque-photo.png",
      contentType: "image/png",
      width: 64,
      height: 48,
    });
    const clips = ["rectangle", "ellipse", "rounded-rectangle"] as const;
    document.sides[0].nodes = clips.map((clipShape, index) => ({
      id: `visual-${clipShape}`,
      kind: "image" as const,
      role: "CONTENT" as const,
      box: { x: 5 + index * 30, y: 10, width: 20, height: 20 },
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: index + 1,
      assetId: "opaque-photo",
      clipShape,
      cornerRadius: clipShape === "rounded-rectangle" ? 3 : undefined,
    }));

    const result = await syncPhotoCraftRuntime({
      document,
      sideId: "outside",
      projection: "content-only",
      assets: {
        "opaque-photo": {
          name: "opaque-photo.png",
          contentType: "image/png",
          dataBase64: PNG_SOLID_PHOTO,
        },
      },
      maxSide: 2000,
    });
    const image = PNG.sync.read(Buffer.from(result.imageBase64, "base64"));
    const pxPerMm = 300 / 25.4;
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const pixel = (x: number, y: number) => {
      const offset = (Math.round(y) * image.width + Math.round(x)) * 4;
      return [...image.data.subarray(offset, offset + 4)];
    };

    for (const [index, clip] of clips.entries()) {
      const center = pixel((15 + index * 30) * pxPerMm * scale, 20 * pxPerMm * scale);
      expect(center, `foto ${clip} harus terlihat di pusat frame`).toSatisfy(
        ([r, g, b, a]) => r > 180 && g < 100 && b > 60 && b < 170 && a > 240,
      );
    }
  }, 120_000);
});
