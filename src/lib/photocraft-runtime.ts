import type { InvitationDocument, SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "./builtin-assets";
import { renderSideToCanvas } from "./export";

export interface PhotoCraftRuntimeStatus {
  available: boolean;
  mode: "cli";
  handoff: "raster-pcraft";
  editableLayers: false;
  version?: string;
  message: string;
}

export async function getPhotoCraftStatus(): Promise<PhotoCraftRuntimeStatus> {
  const response = await fetch("/api/photocraft/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Status PhotoCraft tidak dapat dibaca.");
  return response.json() as Promise<PhotoCraftRuntimeStatus>;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function exportPhotoCraftHandoff(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
}) {
  const canvas = await renderSideToCanvas({
    ...options,
    dpi: options.document.stock.targetPpi,
    includeGuides: false,
  });
  const pngBase64 = canvas.toDataURL("image/png").split(",")[1];
  if (!pngBase64) throw new Error("Raster canvas gagal dibuat.");
  const response = await fetch("/api/photocraft/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document: options.document,
      sideId: options.sideId,
      projection: options.includeBlangko ? "composite" : "content-only",
      pngBase64,
    }),
  });
  const result = await response.json() as {
    fileBase64?: string;
    fileName?: string;
    manifest?: unknown;
    runtime?: string;
    error?: string;
  };
  if (!response.ok || !result.fileBase64 || !result.fileName) {
    throw new Error(result.error || "PhotoCraft gagal membuat dokumen.");
  }
  const bytes = base64Bytes(result.fileBase64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), result.fileName);
  downloadBlob(new Blob([JSON.stringify(result.manifest, null, 2)], { type: "application/json" }), `${result.fileName}.semantic.json`);
  return result.runtime || "PhotoCraft CLI";
}
