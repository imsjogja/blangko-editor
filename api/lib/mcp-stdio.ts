import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024;

interface JsonRpcReply {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface McpContent {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpToolResult {
  content?: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpStdioLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Nama untuk pesan error, mis. "PhotoCraft MCP". */
  label: string;
  clientInfo?: { name: string; version: string };
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * Generic MCP client over stdio (JSON-RPC, newline-delimited): spawn, initialize
 * handshake, serialized `tools/call`, timeouts and teardown. Both the PhotoCraft
 * and VectorCraft sessions are built on this transport because the two CLIs share
 * the same MCP conventions (`command_batch`, roots-confined automation, headless
 * stdio server).
 */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private stderr = "";
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly launch: McpStdioLaunch) {
    this.timeoutMs = launch.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = launch.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  }

  get running(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /** Starts the process and completes the MCP handshake without calling a tool. */
  ensureReady(): Promise<void> {
    return this.ensureStarted();
  }

  /** Recent stderr, for diagnostics after a failure. */
  get recentStderr(): string {
    return this.stderr;
  }

  callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const run = this.queue.then(() => this.invokeTool<T>(name, args));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<void> {
    const { label } = this.launch;
    const child = spawn(this.launch.executable, this.launch.args, {
      shell: false,
      cwd: this.launch.cwd,
      env: this.launch.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.buffer = "";
    this.stderr = "";
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-this.maxOutputBytes);
    });
    child.on("error", (error) => this.failPending(error));
    child.on("close", (code) => {
      if (this.child === child) this.child = null;
      this.failPending(new Error(`Runtime ${label} berhenti (${code ?? "unknown"}): ${this.stderr.slice(-400)}`));
    });

    try {
      await this.sendRpc("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: this.launch.clientInfo ?? { name: "blangko-editor", version: "0.1.0" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    } catch (error) {
      child.kill("SIGTERM");
      if (this.child === child) this.child = null;
      throw error;
    }
  }

  private sendRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    const { label } = this.launch;
    if (!child) return Promise.reject(new Error(`Runtime ${label} gagal dimulai.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        child.kill("SIGTERM");
        reject(new Error(`${label} ${method} melewati batas waktu ${this.timeoutMs / 1000} detik.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private async invokeTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureStarted();
    const reply = await this.sendRpc("tools/call", { name, arguments: args }) as McpToolResult;
    const content = reply.content ?? [];
    const text = content.filter((item) => item.type === "text" && item.text)
      .map((item) => item.text).join("\n");
    if (reply.isError) throw new Error(text || `${this.launch.label} ${name} gagal.`);
    const image = content.find((item) => item.type === "image" && item.data);
    if (image) {
      return {
        mime: image.mimeType || "image/png",
        base64: image.data,
      } as T;
    }
    if (reply.structuredContent !== undefined) return reply.structuredContent as T;
    if (text) {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }
    return reply as T;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > this.maxOutputBytes * 4 && !this.buffer.includes("\n")) {
      this.failPending(new Error(`Respons ${this.launch.label} melebihi batas buffer.`));
      this.child?.kill("SIGTERM");
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let reply: JsonRpcReply;
      try {
        reply = JSON.parse(line) as JsonRpcReply;
      } catch {
        continue;
      }
      if (typeof reply.id !== "number") continue;
      const pending = this.pending.get(reply.id);
      if (!pending) continue;
      this.pending.delete(reply.id);
      clearTimeout(pending.timeout);
      if (reply.error) pending.reject(new Error(reply.error.message || JSON.stringify(reply.error)));
      else pending.resolve(reply.result);
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
    this.failPending(new Error(`Runtime ${this.launch.label} ditutup.`));
  }
}
