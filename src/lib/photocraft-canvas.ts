export interface PhotoCraftNativeRevision {
  type: "revision";
  document: string | number | null;
  revision?: number;
  pixelRevision?: number;
  selected?: Array<{ id: string | number; name: string }>;
}

interface BridgeReply {
  type: "reply";
  id: string;
  ok: boolean;
  payload: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: number;
}

/** Native document JSON served by the fork's `inspect` request (protocol 2). */
export interface PhotoCraftNativeInspect {
  width?: number;
  height?: number;
  resolution?: number;
  layers?: PhotoCraftNativeInspectLayer[];
}

export interface PhotoCraftNativeInspectLayer {
  id?: string | number;
  name?: string;
  kind?: string;
  visible?: boolean;
  opacity?: number;
  bounds?: [number, number, number, number] | null;
  text?: { text?: string; font?: string; sizePt?: number };
  children?: PhotoCraftNativeInspectLayer[];
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try { return JSON.parse(payload) as unknown; } catch { return payload; }
}

/** Binary/JSON transport for the same-origin PhotoCraft fork. */
export class PhotoCraftCanvasBridge {
  private iframe: HTMLIFrameElement | null = null;
  private pending = new Map<string, PendingRequest>();
  private ready = false;
  private protocol = 0;
  private readyCallbacks: Array<() => void> = [];
  private readyGeneration = 0;
  private revisionCallback: ((revision: PhotoCraftNativeRevision) => void) | null = null;
  private exportCallback: ((value: { id: string; format: string; bytes: Uint8Array; warnings: string[] }) => void) | null = null;
  private listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== this.iframe?.contentWindow) return;
    const envelope = event.data as { channel?: string; payload?: unknown };
    if (envelope.channel !== "blangko-photocraft" || !envelope.payload) return;
    const raw = typeof envelope.payload === "string" ? parsePayload(envelope.payload) : envelope.payload;
    if (!raw || typeof raw !== "object") return;
    const message = raw as { type?: string; id?: string; bytes?: Uint8Array; format?: string; warnings?: string; protocol?: number };
    if (message.type === "ready") {
      this.ready = true;
      this.protocol = typeof message.protocol === "number" ? message.protocol : 1;
      this.readyCallbacks.splice(0).forEach((callback) => callback());
      return;
    }
    if (message.type === "export" && message.id && message.bytes) {
      this.exportCallback?.({
        id: message.id,
        format: message.format || "pcraft",
        bytes: message.bytes,
        warnings: message.warnings ? JSON.parse(message.warnings) as string[] : [],
      });
      return;
    }
    if (message.type === "revision") {
      this.revisionCallback?.(message as PhotoCraftNativeRevision);
      return;
    }
    if (message.type === "reply" && message.id) {
      const reply = raw as unknown as BridgeReply;
      const request = this.pending.get(reply.id);
      if (!request) return;
      this.pending.delete(reply.id);
      window.clearTimeout(request.timer);
      if (reply.ok) request.resolve(parsePayload(reply.payload));
      else {
        const payload = parsePayload(reply.payload) as { message?: string };
        request.reject(new Error(payload?.message || "Perintah PhotoCraft ditolak."));
      }
    }
  };

  attach(iframe: HTMLIFrameElement) {
    this.detach();
    this.iframe = iframe;
    window.addEventListener("message", this.listener);
  }

  detach() {
    window.removeEventListener("message", this.listener);
    this.ready = false;
    this.protocol = 0;
    this.readyGeneration += 1;
    this.readyCallbacks = [];
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timer);
      request.reject(new Error("Canvas PhotoCraft dilepas."));
    }
    this.pending.clear();
    this.iframe = null;
  }

  onRevision(callback: (revision: PhotoCraftNativeRevision) => void) {
    this.revisionCallback = callback;
  }

  onExport(callback: (value: { id: string; format: string; bytes: Uint8Array; warnings: string[] }) => void) {
    this.exportCallback = callback;
  }

  whenReady(timeoutMs = 90_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    const generation = this.readyGeneration;
    return new Promise((resolve, reject) => {
      const callback = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        this.readyCallbacks = this.readyCallbacks.filter((item) => item !== callback);
        // A React Strict Mode remount discards this bridge and creates a fresh one.
        // The discarded waiter must not turn the new, healthy canvas into an error.
        if (generation !== this.readyGeneration) {
          resolve();
          return;
        }
        reject(new Error("PhotoCraft WASM tidak selesai dimuat. Periksa koneksi lalu muat ulang canvas."));
      }, timeoutMs);
      this.readyCallbacks.push(callback);
    });
  }

  private request(payload: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    if (!this.iframe?.contentWindow) return Promise.reject(new Error("Canvas PhotoCraft belum tersedia."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("PhotoCraft tidak merespons tepat waktu."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.iframe?.contentWindow?.postMessage({
        channel: "blangko-photocraft",
        payload: { id, ...payload },
      }, window.location.origin);
    });
  }

  open(name: string, bytes: Uint8Array): Promise<{ document: number | null; warnings: unknown }> {
    return this.request({ type: "open", name, bytes }, 120_000).then((payload) => {
      const reply = (payload ?? {}) as { document?: number; warnings?: unknown };
      return { document: typeof reply.document === "number" ? reply.document : null, warnings: reply.warnings };
    });
  }

  /** Whether the running WASM build serves the `inspect` request (protocol ≥ 2). */
  get supportsInspect(): boolean {
    return this.ready && this.protocol >= 2;
  }

  /** Whether the running WASM build keeps documents open as tabs (protocol ≥ 3). */
  get supportsMultiDocument(): boolean {
    return this.ready && this.protocol >= 3;
  }

  inspect(document?: number): Promise<PhotoCraftNativeInspect> {
    return this.request(document === undefined ? { type: "inspect" } : { type: "inspect", document }) as Promise<PhotoCraftNativeInspect>;
  }

  activate(document: number): Promise<unknown> {
    return this.request({ type: "activate", document });
  }

  close(document: number): Promise<unknown> {
    return this.request({ type: "close", document });
  }

  command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request({ type: "command", method, params: JSON.stringify(params) });
  }

  export(format: "pcraft" | "png"): Promise<{ bytes: Uint8Array; warnings: string[] }> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Ekspor native tidak selesai tepat waktu."));
      }, 120_000);
      this.pending.set(id, { resolve: () => undefined, reject, timer });
      const previous = this.exportCallback;
      this.exportCallback = (value) => {
        if (value.id !== id) { previous?.(value); return; }
        this.exportCallback = previous;
        const request = this.pending.get(id);
        if (request) {
          window.clearTimeout(request.timer);
          this.pending.delete(id);
        }
        resolve({ bytes: value.bytes, warnings: value.warnings });
      };
      this.iframe?.contentWindow?.postMessage({
        channel: "blangko-photocraft",
        payload: { id, type: "export", format },
      }, window.location.origin);
    });
  }
}

export function photoCraftBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadNativeBytes(bytes: Uint8Array, fileName: string, mime: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
