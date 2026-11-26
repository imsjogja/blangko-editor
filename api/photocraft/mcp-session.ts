import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PhotoCraftEngineStep } from "@contracts/photocraft";
import { env } from "../lib/env";
import { McpStdioClient } from "../lib/mcp-stdio";
import { prepareFontEnvironment, resolvePhotoCraftLaunch } from "./session";

interface BatchResult {
  ok?: boolean;
  result?: unknown;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adapts the existing headless runtime operations to PhotoCraft's official MCP.
 * The browser bridge is intentionally unrelated to this transport.
 * Transport stdio generik hidup di `api/lib/mcp-stdio.ts` dan dipakai bersama
 * dengan sidecar VectorCraft.
 */
export class PhotoCraftMcpSession {
  private client: McpStdioClient | null = null;
  private starting: Promise<McpStdioClient> | null = null;
  private root: string | null = null;

  constructor(private readonly binaryPath: string) {}

  async getRoot(): Promise<string> {
    await this.ensureClient();
    if (!this.root) throw new Error("Workspace runtime PhotoCraft MCP belum dibuat.");
    return this.root;
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.ensureClient().then((client) => this.mapRequest<T>(client, method, params));
  }

  private ensureClient(): Promise<McpStdioClient> {
    if (this.client?.running) return Promise.resolve(this.client);
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<McpStdioClient> {
    const temporaryDirectory = env.photocraftTmpdir || tmpdir();
    const root = await mkdtemp(path.join(temporaryDirectory, "blangko-photocraft-mcp-"));
    this.root = root;
    await mkdir(path.join(root, "assets"), { recursive: true });
    const fontEnvironment = await prepareFontEnvironment(root);
    const launch = await resolvePhotoCraftLaunch(this.binaryPath);
    const client = new McpStdioClient({
      executable: launch.executable,
      args: [
        ...launch.prefixArgs,
        "mcp", "--no-gpu",
        "--automation-read-root", root,
        "--automation-write-root", root,
      ],
      cwd: root,
      env: {
        ...process.env,
        PHOTOCRAFT_NO_DESKTOP_INTEGRATION: "1",
        MALLOC_TRIM_THRESHOLD_: "131072",
        PHOTOCRAFT_CONFIG_DIR: path.join(root, "config"),
        ...fontEnvironment,
      },
      label: "PhotoCraft MCP",
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

  private async mapRequest<T>(client: McpStdioClient, method: string, params: Record<string, unknown>): Promise<T> {
    if (method === "doc.new") return this.createDocument(client, params) as Promise<T>;
    if (method === "batch") return this.runBatch(client, params) as Promise<T>;
    if (method === "doc.place") return client.callTool("doc_place", params);
    if (method === "doc.inspect") return client.callTool("doc_inspect", params);
    if (method === "doc.render") {
      return client.callTool("render_preview", {
        index: params.index,
        max_side: params.maxSide,
      });
    }
    if (method === "doc.save") return client.callTool("doc_save", params);
    if (method === "doc.close") return client.callTool("doc_close", params);
    throw new Error(`Operasi ${method} belum didukung adapter PhotoCraft MCP.`);
  }

  private async createDocument(client: McpStdioClient, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { resolution, ...input } = params;
    const created = await client.callTool<Record<string, unknown>>("doc_new", input);
    const document = typeof created.document === "number"
      ? created.document
      : typeof created.index === "number" ? created.index : null;
    if (document === null) throw new Error("PhotoCraft MCP tidak mengembalikan indeks dokumen.");
    try {
      if (typeof resolution === "number") {
        await client.callTool("command_run", {
          id: "image.imageSize",
          params: {
            width: params.width,
            height: params.height,
            resolution,
            resample: "none",
          },
          wait: true,
        });
      }
    } catch (error) {
      await client.callTool("doc_close", { index: document }).catch(() => undefined);
      throw error;
    }
    return { ...created, document };
  }

  private async runBatch(client: McpStdioClient, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const steps = params.steps as PhotoCraftEngineStep[];
    const stopOnError = params.stopOnError !== false;
    const results: BatchResult[] = [];
    let stopped = false;

    for (let index = 0; index < steps.length && !stopped;) {
      const step = steps[index];
      try {
        if (step.method === "doc.place") {
          const result = await client.callTool("doc_place", step.params);
          results.push({ ok: true, result });
          index += 1;
          continue;
        }

        const engineSteps: PhotoCraftEngineStep[] = [];
        let end = index;
        while (end < steps.length && steps[end].method === "engine.execute") {
          engineSteps.push(steps[end]);
          end += 1;
        }
        const response = await client.callTool<{ results?: BatchResult[] }>("command_batch", {
          steps: engineSteps.map((item) => ({
            id: item.params.command,
            params: item.params.params,
            wait: true,
          })),
          stop_on_error: true,
        });
        for (let offset = 0; offset < engineSteps.length; offset += 1) {
          const result = response.results?.[offset] ?? {
            ok: false,
            error: "PhotoCraft MCP tidak mengembalikan hasil untuk seluruh langkah batch.",
          };
          results.push(result);
          if (result.ok === false && stopOnError) {
            stopped = true;
            break;
          }
        }
        index = end;
      } catch (error) {
        results.push({ ok: false, error: errorMessage(error) });
        if (!stopOnError) {
          index += 1;
          continue;
        }
        stopped = true;
      }
    }

    return {
      completed: results.filter((result) => result.ok !== false).length,
      failed: results.filter((result) => result.ok === false).length,
      results,
    };
  }

  async dispose(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.dispose();
    if (this.root) await rm(this.root, { recursive: true, force: true });
    this.root = null;
  }
}

const sessions = new Map<string, PhotoCraftMcpSession>();

export function getPhotoCraftMcpSession(binaryPath: string): PhotoCraftMcpSession {
  let session = sessions.get(binaryPath);
  if (!session) {
    session = new PhotoCraftMcpSession(binaryPath);
    sessions.set(binaryPath, session);
  }
  return session;
}

export async function disposePhotoCraftMcpSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.dispose()));
  sessions.clear();
}

// Backwards-compatible alias kept for older imports.
export const disposePhotoSessions = disposePhotoCraftMcpSessions;
