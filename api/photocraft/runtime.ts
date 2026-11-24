import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compilePhotoCraftBatch,
  compilePhotoCraftEngineSteps,
  type PhotoCraftRuntimeAssets,
  type PrintProjection,
} from "@contracts/photocraft";
import { getSide, type InvitationDocument, type SideId } from "@contracts/invitation";
import { getPhotoCraftSession, resolvePhotoCraftBinary } from "./session";

const CLI_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 40_000_000;

let runtimeQueue: Promise<unknown> = Promise.resolve();

export interface PhotoCraftStatus {
  available: boolean;
  mode: "headless-engine";
  handoff: "native-pcraft";
  editableLayers: true;
  version?: string;
  message: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

function execute(binaryPath: string, args: string[], timeoutMs = CLI_TIMEOUT_MS): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      shell: false,
      env: { ...process.env, PHOTOCRAFT_NO_DESKTOP_INTEGRATION: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`PhotoCraft CLI melewati batas waktu ${Math.round(timeoutMs / 1000)} detik.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT_BYTES); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_BYTES); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PhotoCraft CLI keluar dengan kode ${code ?? "unknown"}: ${stderr.slice(-500)}`));
    });
  });
}

function cliArguments(binaryPath: string, args: string[]) {
  return binaryPath.toLowerCase().endsWith(".appimage") ? ["--cli", ...args] : args;
}

export async function probePhotoCraft(binaryPath?: string): Promise<PhotoCraftStatus> {
  try {
    const binary = await resolvePhotoCraftBinary(binaryPath);
    const { stdout, stderr } = await execute(binary, cliArguments(binary, ["--version"]));
    const version = (stdout || stderr).trim().split("\n")[0]?.slice(0, 120) || "versi tidak dilaporkan";
    return {
      available: true,
      mode: "headless-engine",
      handoff: "native-pcraft",
      editableLayers: true,
      version,
      message: "Engine PhotoCraft aktif: render, transformasi, dan layer editable tersinkronisasi.",
    };
  } catch (error) {
    return {
      available: false,
      mode: "headless-engine",
      handoff: "native-pcraft",
      editableLayers: true,
      message: error instanceof Error
        ? `Runtime PhotoCraft belum tersedia: ${error.message}`
        : "Runtime PhotoCraft belum tersedia.",
    };
  }
}

function extensionForAsset(asset: PhotoCraftRuntimeAssets[string]): string {
  const type = asset.contentType?.toLowerCase();
  if (type === "image/jpeg" || /\.jpe?g$/i.test(asset.name)) return ".jpg";
  if (type === "image/webp" || /\.webp$/i.test(asset.name)) return ".webp";
  if (type === "image/svg+xml" || /\.svg$/i.test(asset.name)) return ".svg";
  if (type === "image/gif" || /\.gif$/i.test(asset.name)) return ".gif";
  if (type === "image/tiff" || /\.tiff?$/i.test(asset.name)) return ".tif";
  return ".png";
}

function validateAssetBytes(asset: PhotoCraftRuntimeAssets[string]): Buffer {
  const bytes = Buffer.from(asset.dataBase64, "base64");
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`Aset ${asset.name} kosong atau melebihi 32 MB.`);
  }
  return bytes;
}

export interface PhotoCraftRuntimeResult {
  mime: string;
  imageBase64: string;
  inspect: unknown;
  runtime: string;
  editableLayers: true;
  fileBase64?: string;
  fileName?: string;
  manifest?: unknown;
}

export interface PhotoCraftSyncOptions {
  document: InvitationDocument;
  sideId: SideId;
  projection: PrintProjection;
  assets: PhotoCraftRuntimeAssets;
  includeDocument?: boolean;
  maxSide?: number;
  binaryPath?: string;
}

export function syncPhotoCraftRuntime(options: PhotoCraftSyncOptions): Promise<PhotoCraftRuntimeResult> {
  const run = runtimeQueue.then(() => syncPhotoCraftRuntimeExclusive(options));
  runtimeQueue = run.catch(() => undefined);
  return run;
}

async function syncPhotoCraftRuntimeExclusive(options: PhotoCraftSyncOptions): Promise<PhotoCraftRuntimeResult> {
  const status = await probePhotoCraft(options.binaryPath);
  if (!status.available) throw new Error(status.message);
  const binary = await resolvePhotoCraftBinary(options.binaryPath);
  const session = getPhotoCraftSession(binary);
  const root = await session.getRoot();
  const width = Math.round(options.document.stock.width * options.document.stock.targetPpi / 25.4);
  const height = Math.round(options.document.stock.height * options.document.stock.targetPpi / 25.4);
  if (width < 1 || height < 1 || width * height > MAX_CANVAS_PIXELS) {
    throw new Error(`Canvas ${width} × ${height} px melebihi batas runtime ${MAX_CANVAS_PIXELS.toLocaleString("id-ID")} px.`);
  }

  const assetPaths: Record<string, string> = {};
  for (const [assetId, asset] of Object.entries(options.assets)) {
    const digest = createHash("sha256").update(assetId).digest("hex").slice(0, 24);
    const relativePath = path.join("assets", `${digest}${extensionForAsset(asset)}`);
    await writeFile(path.join(root, relativePath), validateAssetBytes(asset), { flag: "w" });
    assetPaths[assetId] = relativePath;
  }

  const side = getSide(options.document, options.sideId);
  const requiredAssetIds = new Set(
    side.nodes.filter((node) => node.visible && node.kind === "image").map((node) => node.assetId),
  );
  if (options.projection === "composite" && side.blangkoAssetId) requiredAssetIds.add(side.blangkoAssetId);
  for (const assetId of requiredAssetIds) {
    if (!assetId || !assetPaths[assetId]) throw new Error(`Aset ${assetId || "tanpa ID"} belum dikirim ke runtime.`);
  }

  const steps = compilePhotoCraftEngineSteps(options.document, options.sideId, options.projection, assetPaths);
  const created = await session.request<{ document: number }>("doc.new", {
    width, height,
    resolution: options.document.stock.targetPpi,
    background: "transparent",
    name: `${options.document.title} — ${side.label}`,
  });
  try {
    if (steps.length) {
      const batch = await session.request<{
        completed?: number;
        failed?: number;
        results?: Array<{ ok?: boolean; error?: string }>;
      }>("batch", { steps, stopOnError: true });
      const failedIndex = batch.results?.findIndex((result) => result.ok === false) ?? -1;
      if (failedIndex >= 0) {
        const step = steps[failedIndex];
        const command = step.method === "engine.execute" ? step.params.command : step.method;
        const detail = batch.results?.[failedIndex]?.error || "perintah ditolak engine";
        throw new Error(`PhotoCraft menghentikan batch pada langkah ${failedIndex + 1} (${command}): ${detail}`);
      }
      if (batch.results && batch.results.length !== steps.length) {
        throw new Error(`PhotoCraft hanya menyelesaikan ${batch.results.length} dari ${steps.length} langkah batch.`);
      }
    }
    const [inspect, render] = await Promise.all([
      session.request("doc.inspect", { index: created.document }),
      session.request<{ mime: string; base64: string }>("doc.render", {
        index: created.document,
        maxSide: Math.max(64, Math.min(2400, Math.round(options.maxSide ?? 1600))),
      }),
    ]);
    let fileBase64: string | undefined;
    let fileName: string | undefined;
    let manifest: unknown;
    if (options.includeDocument) {
      const outputName = `blangko-${options.sideId}-${options.projection}-${randomUUID()}.pcraft`;
      const relativeOutput = outputName;
      await session.request("doc.save", {
        index: created.document,
        path: relativeOutput,
        format: "pcraft",
        pcraftFullComposite: false,
      });
      fileBase64 = (await readFile(path.join(root, relativeOutput))).toString("base64");
      await rm(path.join(root, relativeOutput), { force: true });
      fileName = `blangko-${options.sideId}-${options.projection}.pcraft`;
      manifest = {
        schema: "blangko.photocraft.semantic.v2",
        runtime: status.version,
        editableLayers: true,
        projection: options.projection,
        sideId: options.sideId,
        commands: compilePhotoCraftBatch(options.document, options.sideId, options.projection),
      };
    }
    return {
      mime: render.mime,
      imageBase64: render.base64,
      inspect,
      runtime: status.version || "PhotoCraft",
      editableLayers: true,
      fileBase64,
      fileName,
      manifest,
    };
  } finally {
    await session.request("doc.close", { index: created.document }).catch(() => undefined);
  }
}
