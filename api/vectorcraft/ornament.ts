import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { env } from "../lib/env";
import { getVectorCraftMcpSession, type VectorCraftBatchStep } from "./session";

const CLI_TIMEOUT_MS = 30_000;
const MAX_SVG_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_SIDE = 4096;

export interface VectorCraftStatus {
  available: boolean;
  mode: "headless-engine";
  version?: string;
  message: string;
}

export interface OrnamentRefineRequest {
  binaryPath?: string;
  name?: string;
  svgBase64: string;
  commands: VectorCraftBatchStep[];
  maxSide?: number;
}

export interface OrnamentRefineResult {
  svgBase64: string;
  previewPngBase64?: string;
  completed: number;
  warnings: string[];
}

export async function resolveVectorCraftBinary(explicitPath?: string): Promise<string> {
  const configured = explicitPath?.trim() || env.vectorcraftCliBin;
  if (!configured) {
    throw new Error("Binary vectorcraft-cli belum dikonfigurasi. Atur VECTORCRAFT_CLI_BIN.");
  }
  // Sessions spawn with a per-session cwd, so a relative binary path would break.
  const resolved = path.resolve(configured);
  await access(resolved).catch(() => {
    throw new Error(`Binary vectorcraft-cli tidak ditemukan: ${configured}`);
  });
  return resolved;
}

function execute(binaryPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("vectorcraft-cli melewati batas waktu."));
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(0, 8192); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(0, 8192); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `vectorcraft-cli keluar dengan kode ${code ?? "unknown"}.`));
    });
  });
}

export async function probeVectorCraft(binaryPath?: string): Promise<VectorCraftStatus> {
  try {
    const binary = await resolveVectorCraftBinary(binaryPath);
    const { stdout, stderr } = await execute(binary, ["--version"]);
    const version = (stdout || stderr).trim().split("\n")[0]?.slice(0, 120) || "versi tidak dilaporkan";
    return {
      available: true,
      mode: "headless-engine",
      version,
      message: "VectorCraft MCP siap sebagai sidecar ornamen vektor.",
    };
  } catch (error) {
    return {
      available: false,
      mode: "headless-engine",
      message: error instanceof Error ? error.message : "VectorCraft tidak tersedia.",
    };
  }
}

/**
 * Refine an SVG ornament through the VectorCraft MCP sidecar: open → command_batch
 * (stop on first failure) → export SVG → PNG preview. The refined SVG can then be
 * placed into the canonical document and flows into PhotoCraft as a Smart Object
 * through the existing runtime pipeline.
 */
export async function refineOrnament(request: OrnamentRefineRequest): Promise<OrnamentRefineResult> {
  const binary = await resolveVectorCraftBinary(request.binaryPath);
  const bytes = Buffer.from(request.svgBase64, "base64");
  if (bytes.length === 0) throw new Error("SVG ornamen kosong.");
  if (bytes.length > MAX_SVG_BYTES) throw new Error("SVG ornamen melebihi batas 8 MB.");
  if (!bytes.subarray(0, 512).toString("utf8").toLowerCase().includes("<svg") ) {
    throw new Error("Payload bukan dokumen SVG yang valid.");
  }

  const session = getVectorCraftMcpSession(binary);
  await session.openSvg(request.name ?? "ornamen.svg", bytes);

  const batch = await session.refine(request.commands, true);
  if (batch.failed > 0) {
    const failedIndex = batch.results.findIndex((result) => result.ok === false);
    const first = batch.results[failedIndex];
    throw new Error(`Refine ornamen gagal pada langkah ${failedIndex + 1}: ${first?.error ?? "kesalahan tidak dikenal"}`);
  }

  const exported = await session.exportDocument(request.name ?? "ornamen.svg");

  const warnings: string[] = [];
  const maxSide = Math.min(Math.max(request.maxSide ?? 1024, 64), MAX_PREVIEW_SIDE);
  let previewPngBase64: string | undefined;
  try {
    const preview = await session.renderPreview(maxSide);
    if (preview.base64) previewPngBase64 = preview.base64;
  } catch (error) {
    warnings.push(`Pratinjau PNG dilewati: ${error instanceof Error ? error.message : "gagal"}`);
  }

  return {
    svgBase64: exported.bytes.toString("base64"),
    previewPngBase64,
    completed: batch.completed,
    warnings,
  };
}
