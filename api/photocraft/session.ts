import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const RPC_TIMEOUT_MS = 120_000;
const MAX_RPC_OUTPUT = 2 * 1024 * 1024;

interface RpcReply {
  id?: number;
  ok?: boolean;
  result?: unknown;
  error?: { message?: string } | string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class PhotoCraftSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private stderr = "";
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private root: string | null = null;

  constructor(private readonly binaryPath: string) {}

  async getRoot(): Promise<string> {
    await this.ensureStarted();
    if (!this.root) throw new Error("Workspace runtime PhotoCraft belum dibuat.");
    return this.root;
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const run = this.queue.then(() => this.send<T>(method, params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.ensureStarted();
    const child = this.child;
    if (!child) throw new Error("Runtime PhotoCraft tidak berjalan.");
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`PhotoCraft ${method} melewati batas waktu ${RPC_TIMEOUT_MS / 1000} detik.`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<void> {
    this.root = await mkdtemp(path.join(tmpdir(), "blangko-photocraft-session-"));
    await mkdir(path.join(this.root, "assets"), { recursive: true });
    const fontEnvironment = await prepareFontEnvironment(this.root);
    const launch = await resolvePhotoCraftLaunch(this.binaryPath);
    const child = spawn(launch.executable, [
      ...launch.prefixArgs,
      "serve", "--no-gpu",
      "--automation-read-root", this.root,
      "--automation-write-root", this.root,
    ], {
      shell: false,
      cwd: this.root,
      env: {
        ...process.env,
        PHOTOCRAFT_NO_DESKTOP_INTEGRATION: "1",
        // Keep the CLI's intended malloc tuning without re-executing the loader.
        MALLOC_TRIM_THRESHOLD_: "131072",
        PHOTOCRAFT_CONFIG_DIR: path.join(this.root, "config"),
        ...fontEnvironment,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.buffer = "";
    this.stderr = "";
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-MAX_RPC_OUTPUT);
    });
    child.on("error", (error) => this.failPending(error));
    child.on("close", (code) => {
      if (this.child === child) this.child = null;
      this.failPending(new Error(`Runtime PhotoCraft berhenti (${code ?? "unknown"}): ${this.stderr.slice(-400)}`));
    });
    await this.sendDirect("methods", {});
  }

  private sendDirect<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("Runtime PhotoCraft gagal dimulai."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        child.kill("SIGTERM");
        reject(new Error("Runtime PhotoCraft tidak merespons saat startup."));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T), reject, timeout,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_RPC_OUTPUT * 4 && !this.buffer.includes("\n")) {
      this.failPending(new Error("Respons runtime PhotoCraft melebihi batas buffer."));
      this.child?.kill("SIGTERM");
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let reply: RpcReply;
      try {
        reply = JSON.parse(line) as RpcReply;
      } catch {
        continue;
      }
      if (typeof reply.id !== "number") continue;
      const pending = this.pending.get(reply.id);
      if (!pending) continue;
      this.pending.delete(reply.id);
      clearTimeout(pending.timeout);
      if (reply.ok) {
        pending.resolve(reply.result);
      } else {
        const message = typeof reply.error === "string"
          ? reply.error
          : reply.error?.message || JSON.stringify(reply.error || "Perintah ditolak runtime.");
        pending.reject(new Error(message));
      }
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this.failPending(new Error("Runtime PhotoCraft ditutup."));
    if (this.root) await rm(this.root, { recursive: true, force: true });
    this.root = null;
  }
}

function bundledFontDirectory(): string | null {
  const candidates = [
    path.join(process.cwd(), "public", "fonts"),
    path.join(process.cwd(), "dist", "fonts"),
    path.join(process.cwd(), "dist", "public", "fonts"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fonts"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "Inter-Regular.ttf"))) ?? null;
}

async function prepareFontEnvironment(root: string): Promise<Record<string, string>> {
  const fonts = bundledFontDirectory();
  if (!fonts) return {};
  const escapedFonts = fonts.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("\"", "&quot;");
  const escapedCache = path.join(root, "font-cache").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("\"", "&quot;");
  const configPath = path.join(root, "fonts.conf");
  await writeFile(configPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${escapedFonts}</dir>
  <cachedir>${escapedCache}</cachedir>
</fontconfig>
`, "utf8");
  return { FONTCONFIG_FILE: configPath, XDG_CACHE_HOME: path.join(root, "cache") };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function sha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function bundledDirectory(): string | null {
  const candidates = [
    path.join(process.cwd(), "vendor", "photocraft"),
    path.join(process.cwd(), "dist", "vendor", "photocraft"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "photocraft"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "photocraft-cli.gz"))) ?? null;
}

interface SharedLibraryMetadata {
  name: string;
  binarySha256: string;
  compressedSha256: string;
}

async function materializeVerifiedGzip(
  archive: string,
  target: string,
  compressedSha256: string,
  binarySha256: string,
  mode: number,
): Promise<void> {
  if (await sha256(archive) !== compressedSha256) {
    throw new Error(`Checksum paket runtime ${path.basename(archive)} tidak cocok.`);
  }
  if (await fileExists(target) && await sha256(target) === binarySha256) return;
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `${randomUUID()}.tmp`);
  try {
    await pipeline(createReadStream(archive), createGunzip(), createWriteStream(temporary));
    if (await sha256(temporary) !== binarySha256) {
      throw new Error(`Checksum executable ${path.basename(target)} tidak cocok dengan rilis yang dipin.`);
    }
    await chmod(temporary, mode);
    await rm(target, { force: true });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function resolvePhotoCraftBinary(explicitPath?: string): Promise<string> {
  const configured = explicitPath?.trim() || process.env.PHOTOCRAFT_CLI_BIN?.trim();
  if (configured) return configured;
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Runtime bawaan tersedia untuk Linux x86_64. Atur PHOTOCRAFT_CLI_BIN pada platform ini.");
  }
  const directory = bundledDirectory();
  if (!directory) throw new Error("Paket runtime PhotoCraft tidak ditemukan.");
  const metadata = JSON.parse(await readFile(path.join(directory, "RUNTIME.json"), "utf8")) as {
    binarySha256: string;
    compressedSha256: string;
    sharedLibraries?: SharedLibraryMetadata[];
  };
  const targetDirectory = path.join(tmpdir(), `blangko-photocraft-${metadata.binarySha256.slice(0, 16)}`);
  const target = path.join(targetDirectory, "photocraft-cli");
  await materializeVerifiedGzip(
    path.join(directory, "photocraft-cli.gz"),
    target,
    metadata.compressedSha256,
    metadata.binarySha256,
    0o700,
  );
  for (const library of metadata.sharedLibraries ?? []) {
    if (!/^[a-z0-9._-]+$/i.test(library.name)) throw new Error("Nama shared library PhotoCraft tidak valid.");
    await materializeVerifiedGzip(
      path.join(directory, "glibc", `${library.name}.gz`),
      path.join(targetDirectory, "glibc", library.name),
      library.compressedSha256,
      library.binarySha256,
      library.name.startsWith("ld-linux") ? 0o700 : 0o600,
    );
  }
  return target;
}

export interface PhotoCraftLaunch {
  executable: string;
  prefixArgs: string[];
}

export async function resolvePhotoCraftLaunch(binaryPath: string): Promise<PhotoCraftLaunch> {
  const libraryDirectory = path.join(path.dirname(binaryPath), "glibc");
  const loader = path.join(libraryDirectory, "ld-linux-x86-64.so.2");
  if (!await fileExists(loader)) return { executable: binaryPath, prefixArgs: [] };
  return {
    executable: loader,
    // The published runtime can have an older glibc than the official CLI.
    // Its pinned loader and libraries make execution independent of that host version.
    prefixArgs: ["--inhibit-cache", "--library-path", libraryDirectory, binaryPath],
  };
}

const sessions = new Map<string, PhotoCraftSession>();

export function getPhotoCraftSession(binaryPath: string): PhotoCraftSession {
  let session = sessions.get(binaryPath);
  if (!session) {
    session = new PhotoCraftSession(binaryPath);
    sessions.set(binaryPath, session);
  }
  return session;
}

export async function disposePhotoCraftSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.dispose()));
  sessions.clear();
}
