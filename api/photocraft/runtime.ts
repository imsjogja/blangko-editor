import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compilePhotoCraftBatch, type PrintProjection } from "@contracts/photocraft";
import type { InvitationDocument, SideId } from "@contracts/invitation";

const CLI_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface PhotoCraftStatus {
  available: boolean;
  mode: "cli";
  handoff: "raster-pcraft";
  editableLayers: false;
  version?: string;
  message: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

function execute(
  binaryPath: string,
  args: string[],
  cwd?: string,
  timeoutMs = CLI_TIMEOUT_MS,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      cwd,
      shell: false,
      env: {
        ...process.env,
        PHOTOCRAFT_NO_DESKTOP_INTEGRATION: "1",
        PHOTOCRAFT_CONFIG_DIR: cwd ? path.join(cwd, "config") : process.env.PHOTOCRAFT_CONFIG_DIR,
      },
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
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PhotoCraft CLI keluar dengan kode ${code ?? "unknown"}: ${stderr.slice(-500)}`));
    });
  });
}

function configuredBinary(explicitPath?: string) {
  return explicitPath?.trim() || process.env.PHOTOCRAFT_CLI_BIN?.trim() || "photocraft-cli";
}

function cliArguments(binaryPath: string, args: string[]) {
  return binaryPath.toLowerCase().endsWith(".appimage") ? ["--cli", ...args] : args;
}

export async function probePhotoCraft(binaryPath?: string): Promise<PhotoCraftStatus> {
  const binary = configuredBinary(binaryPath);
  try {
    const { stdout, stderr } = await execute(binary, cliArguments(binary, ["--version"]));
    const version = (stdout || stderr).trim().split("\n")[0]?.slice(0, 120) || "versi tidak dilaporkan";
    return {
      available: true,
      mode: "cli",
      handoff: "raster-pcraft",
      editableLayers: false,
      version,
      message: "CLI siap membuat dokumen .pcraft dari raster canvas.",
    };
  } catch {
    return {
      available: false,
      mode: "cli",
      handoff: "raster-pcraft",
      editableLayers: false,
      message: "PhotoCraft CLI belum tersedia. Pasang runtime dan atur PHOTOCRAFT_CLI_BIN pada server.",
    };
  }
}

export async function runPhotoCraftHandoff(options: {
  document: InvitationDocument;
  sideId: SideId;
  projection: PrintProjection;
  pngBase64: string;
  binaryPath?: string;
  timeoutMs?: number;
}) {
  const binary = configuredBinary(options.binaryPath);
  const bytes = Buffer.from(options.pngBase64, "base64");
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.byteLength < 8
    || bytes.byteLength > 32 * 1024 * 1024
    || !bytes.subarray(0, 8).equals(pngSignature)
  ) {
    throw new Error("Raster harus berupa PNG valid dan tidak melebihi 32 MB.");
  }
  const manifest = compilePhotoCraftBatch(options.document, options.sideId, options.projection);
  const directory = await mkdtemp(path.join(tmpdir(), "blangko-photocraft-"));
  const inputPath = path.join(directory, "canvas.png");
  const outputPath = path.join(directory, "document.pcraft");
  try {
    await Promise.all([
      writeFile(inputPath, bytes),
      writeFile(path.join(directory, "semantic-manifest.json"), JSON.stringify({
        schema: "blangko.photocraft.semantic.v1",
        projection: options.projection,
        sideId: options.sideId,
        commands: manifest,
      }, null, 2)),
    ]);
    const status = await probePhotoCraft(binary);
    if (!status.available) throw new Error(status.message);
    await execute(
      binary,
      cliArguments(binary, ["run", inputPath, "--out", outputPath]),
      directory,
      options.timeoutMs,
    );
    const output = await readFile(outputPath);
    return {
      fileBase64: output.toString("base64"),
      fileName: `blangko-${options.sideId}-${options.projection}.pcraft`,
      manifest: { schema: "blangko.photocraft.semantic.v1", commands: manifest },
      runtime: status.version || "PhotoCraft CLI",
      editableLayers: false as const,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
