import type { InvitationDocument, SideId } from "@contracts/invitation";
import type { PhotoCraftRuntimeAssets, PrintProjection } from "@contracts/photocraft";
import { getSide } from "@contracts/invitation";
import type { AssetUrlMap } from "./builtin-assets";

export interface PhotoCraftRuntimeStatus {
  available: boolean;
  mode: "headless-engine";
  handoff: "native-pcraft";
  editableLayers: true;
  version?: string;
  message: string;
}

export interface PhotoCraftRuntimeSnapshot {
  mime: string;
  imageBase64: string;
  inspect: unknown;
  runtime: string;
  editableLayers: true;
  fileBase64?: string;
  fileName?: string;
  manifest?: unknown;
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

function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function referencedRuntimeAssetIds(
  document: InvitationDocument,
  sideId: SideId,
  projection: PrintProjection,
): string[] {
  const side = getSide(document, sideId);
  const ids = new Set(side.nodes.filter((node) => node.visible && node.kind === "image").map((node) => node.assetId));
  if (projection === "composite" && side.blangkoAssetId) ids.add(side.blangkoAssetId);
  return [...ids].filter((id): id is string => Boolean(id));
}

/**
 * Cheap, stable fingerprint of everything that changes the server render for one
 * side: the side itself, stock, document title (used as the native document
 * name), the projection, and the URLs of the referenced assets (asset bytes are
 * immutable per id; a URL change signals new content). Used to skip renders when
 * switching back to a side whose content has not changed.
 */
export function sideContentKey(
  document: InvitationDocument,
  sideId: SideId,
  assets: AssetUrlMap,
  includeBlangko: boolean,
): string {
  const projection: PrintProjection = includeBlangko ? "composite" : "content-only";
  const referenced = referencedRuntimeAssetIds(document, sideId, projection);
  return JSON.stringify({
    v: 1,
    side: getSide(document, sideId),
    stock: document.stock,
    title: document.title,
    includeBlangko,
    assets: referenced.map((id) => [id, assets[id] ?? null]),
  });
}

async function collectRuntimeAssets(
  document: InvitationDocument,
  sideId: SideId,
  projection: PrintProjection,
  assets: AssetUrlMap,
): Promise<PhotoCraftRuntimeAssets> {
  const result: PhotoCraftRuntimeAssets = {};
  await Promise.all(referencedRuntimeAssetIds(document, sideId, projection).map(async (assetId) => {
    const url = assets[assetId];
    if (!url) throw new Error(`URL aset ${assetId} belum tersedia.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Aset ${assetId} gagal dibaca untuk runtime.`);
    const blob = await response.blob();
    if (blob.size > 32 * 1024 * 1024) throw new Error(`Aset ${assetId} melebihi 32 MB.`);
    const source = document.assets.find((asset) => asset.id === assetId);
    result[assetId] = {
      name: source?.name || `${assetId}.png`,
      contentType: blob.type || source?.contentType,
      dataBase64: bytesBase64(new Uint8Array(await blob.arrayBuffer())),
    };
  }));
  return result;
}

export async function syncPhotoCraftRuntime(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
  maxSide?: number;
  signal?: AbortSignal;
}): Promise<PhotoCraftRuntimeSnapshot> {
  const projection = options.includeBlangko ? "composite" : "content-only";
  const runtimeAssets = await collectRuntimeAssets(options.document, options.sideId, projection, options.assets);
  const response = await fetch("/api/photocraft/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      document: options.document,
      sideId: options.sideId,
      projection,
      assets: runtimeAssets,
      maxSide: options.maxSide,
    }),
  });
  const result = await response.json() as PhotoCraftRuntimeSnapshot & { error?: string };
  if (!response.ok || !result.imageBase64) {
    throw new Error(result.error || "Runtime PhotoCraft gagal merender dokumen.");
  }
  return result;
}

export async function exportPhotoCraftHandoff(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
}) {
  const projection = options.includeBlangko ? "composite" : "content-only";
  const runtimeAssets = await collectRuntimeAssets(options.document, options.sideId, projection, options.assets);
  const response = await fetch("/api/photocraft/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document: options.document,
      sideId: options.sideId,
      projection,
      assets: runtimeAssets,
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
    throw new Error(result.error || "PhotoCraft gagal membuat dokumen native.");
  }
  const bytes = base64Bytes(result.fileBase64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), result.fileName);
  downloadBlob(new Blob([JSON.stringify(result.manifest, null, 2)], { type: "application/json" }), `${result.fileName}.semantic.json`);
  return result.runtime || "PhotoCraft CLI";
}
