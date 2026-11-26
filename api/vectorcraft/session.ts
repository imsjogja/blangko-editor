import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../lib/env";
import { McpStdioClient } from "../lib/mcp-stdio";

const MAX_STEPS_PER_BATCH = 256;

export interface VectorCraftBatchStep {
  id: string;
  params?: Record<string, unknown>;
}

export interface VectorCraftBatchResult {
  ok?: boolean;
  result?: unknown;
  error?: string;
}

export interface VectorCraftPreview {
  mime: string;
  base64: string;
}

/**
 * Sidecar session for VectorCraft's official MCP server (`vectorcraft-cli mcp`).
 * Shares the generic stdio transport with PhotoCraft because both CLIs follow the
 * same MCP conventions; `--automation-read-root/--automation-write-root` confine
 * file access to this session's temporary directory and force headless mode.
 *
 * One session is reused across ornament operations; each operation opens its own
 * SVG, refines it via `command_batch`, exports, and the next operation starts from
 * a fresh `open_file`. Processes are disposed on server shutdown.
 */
export class VectorCraftMcpSession {
  private client: McpStdioClient | null = null;
  private starting: Promise<McpStdioClient> | null = null;
  private root: string | null = null;

  constructor(private readonly binaryPath: string) {}

  async getRoot(): Promise<string> {
    await this.ensureClient();
    if (!this.root) throw new Error("Workspace runtime VectorCraft MCP belum dibuat.");
    return this.root;
  }

  async openSvg(name: string, bytes: Buffer): Promise<Record<string, unknown>> {
    const client = await this.ensureClient();
    const safeName = /^[\w.-]+\.svg$/i.test(name) ? name : "ornamen.svg";
    const assetsDirectory = path.join(this.root!, "assets");
    const target = path.join(assetsDirectory, `${Date.now()}-${safeName}`);
    await writeFile(target, bytes);
    return client.callTool("open_file", { path: target });
  }

  async refine(steps: VectorCraftBatchStep[], stopOnError = true): Promise<{
    completed: number;
    failed: number;
    results: VectorCraftBatchResult[];
  }> {
    if (steps.length === 0) return { completed: 0, failed: 0, results: [] };
    if (steps.length > MAX_STEPS_PER_BATCH) {
      throw new Error(`Batch VectorCraft dibatasi ${MAX_STEPS_PER_BATCH} langkah.`);
    }
    const client = await this.ensureClient();
    const response = await client.callTool<{ results?: VectorCraftBatchResult[] }>("command_batch", {
      // Kontrak terverifikasi terhadap vectorcraft-cli 0.24.1: langkah hanya
      // menerima {id, params} — tidak ada flag `wait` seperti di PhotoCraft.
      steps: steps.map((step) => ({ id: step.id, params: step.params ?? {} })),
      stop_on_error: stopOnError,
    });
    const results = steps.map((_, index) => response.results?.[index] ?? {
      ok: false,
      error: "VectorCraft MCP tidak mengembalikan hasil untuk seluruh langkah batch.",
    });
    return {
      completed: results.filter((result) => result.ok !== false).length,
      failed: results.filter((result) => result.ok === false).length,
      results,
    };
  }

  /** Exports the active document; the extension of `name` selects the format. */
  async exportDocument(name: string): Promise<{ path: string; bytes: Buffer }> {
    const client = await this.ensureClient();
    const safeName = /^[\w.-]+\.(svg|png|pdf|jpe?g)$/i.test(name) ? name : "ornamen.svg";
    const target = path.join(this.root!, "out", safeName);
    await client.callTool("export", { path: target });
    return { path: target, bytes: await readFile(target) };
  }

  async renderPreview(maxSide = 1024): Promise<VectorCraftPreview> {
    const client = await this.ensureClient();
    return client.callTool<VectorCraftPreview>("render_preview", { max_side: maxSide });
  }

  async inspect(): Promise<Record<string, unknown>> {
    const client = await this.ensureClient();
    return client.callTool("inspect_document", {});
  }

  private ensureClient(): Promise<McpStdioClient> {
    if (this.client?.running) return Promise.resolve(this.client);
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<McpStdioClient> {
    const temporaryDirectory = env.photocraftTmpdir || tmpdir();
    const root = await mkdtemp(path.join(temporaryDirectory, "blangko-vectorcraft-mcp-"));
    this.root = root;
    await mkdir(path.join(root, "assets"), { recursive: true });
    await mkdir(path.join(root, "out"), { recursive: true });
    const client = new McpStdioClient({
      executable: this.binaryPath,
      args: [
        "mcp",
        "--automation-read-root", root,
        "--automation-write-root", root,
      ],
      cwd: root,
      env: { ...process.env },
      label: "VectorCraft MCP",
    });
    try {
      await client.ensureReady();
    } catch (error) {
      await client.dispose();
      await rm(root, { recursive: true, force: true });
      this.root = null;
      throw error;
    }
    this.client = client;
    return client;
  }

  async dispose(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.dispose();
    if (this.root) await rm(this.root, { recursive: true, force: true });
    this.root = null;
  }
}

const sessions = new Map<string, VectorCraftMcpSession>();

export function getVectorCraftMcpSession(binaryPath: string): VectorCraftMcpSession {
  let session = sessions.get(binaryPath);
  if (!session) {
    session = new VectorCraftMcpSession(binaryPath);
    sessions.set(binaryPath, session);
  }
  return session;
}

export async function disposeVectorCraftMcpSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.dispose()));
  sessions.clear();
}
