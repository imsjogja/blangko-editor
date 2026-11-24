import { PDFDocument } from "pdf-lib";
import { getSide, type DesignNode, type InvitationDocument, type SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "./builtin-assets";

const MM_PER_INCH = 25.4;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function mmToPx(value: number, dpi: number): number {
  return value / MM_PER_INCH * dpi;
}

function mmToPt(value: number): number {
  return value / MM_PER_INCH * 72;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  if (!url) return Promise.reject(new Error("URL aset kosong"));
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      if (!url.startsWith("data:")) image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Aset gambar tidak dapat dimuat"));
      image.src = url;
    }));
  }
  return imageCache.get(url)!;
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function traceGeometry(
  context: CanvasRenderingContext2D,
  geometry: DesignNode["shapeType"] | DesignNode["clipShape"],
  width: number,
  height: number,
  cornerRadius: number,
) {
  context.beginPath();
  if (geometry === "ellipse") {
    context.ellipse(width / 2, height / 2, width / 2, Math.max(0.5, height / 2), 0, 0, Math.PI * 2);
    return;
  }
  if (geometry === "rounded-rectangle") {
    const radius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));
    context.moveTo(radius, 0);
    context.lineTo(width - radius, 0);
    context.quadraticCurveTo(width, 0, width, radius);
    context.lineTo(width, height - radius);
    context.quadraticCurveTo(width, height, width - radius, height);
    context.lineTo(radius, height);
    context.quadraticCurveTo(0, height, 0, height - radius);
    context.lineTo(0, radius);
    context.quadraticCurveTo(0, 0, radius, 0);
    context.closePath();
    return;
  }
  context.rect(0, 0, width, height);
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: DesignNode,
  dpi: number,
  image?: HTMLImageElement,
) {
  const x = mmToPx(node.box.x, dpi);
  const y = mmToPx(node.box.y, dpi);
  const width = mmToPx(node.box.width, dpi);
  const height = mmToPx(node.box.height, dpi);
  context.save();
  context.globalAlpha = node.opacity;
  context.translate(x + width / 2, y + height / 2);
  context.rotate(node.rotation * Math.PI / 180);
  context.translate(-width / 2, -height / 2);

  if (node.kind === "shape") {
    context.fillStyle = node.backgroundColor || "#6E7254";
    traceGeometry(context, node.shapeType, width, Math.max(height, 1), mmToPx(node.cornerRadius ?? 3, dpi));
    if (node.backgroundColor !== "transparent") context.fill();
    if (node.borderWidth && node.borderColor) {
      context.strokeStyle = node.borderColor;
      context.lineWidth = mmToPx(node.borderWidth, dpi);
      traceGeometry(context, node.shapeType, width, Math.max(height, 1), mmToPx(node.cornerRadius ?? 3, dpi));
      context.stroke();
    }
  } else if (node.kind === "image" && image) {
    traceGeometry(context, node.clipShape, width, height, mmToPx(node.cornerRadius ?? 3, dpi));
    context.clip();
    drawImageCover(context, image, 0, 0, width, height);
  } else if (node.kind === "text") {
    const fontSize = (node.fontSize || 12) / 72 * dpi;
    const lineHeight = fontSize * 1.35;
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.fillStyle = node.color || "#2D2A26";
    context.font = `${node.fontStyle || "normal"} ${node.fontWeight || 400} ${fontSize}px ${node.fontFamily || "Arial"}`;
    (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${(node.letterSpacing || 0) / 72 * dpi}px`;
    context.textAlign = node.textAlign || "left";
    context.textBaseline = "top";
    const lines = wrapText(context, node.text || "", width);
    const textX = node.textAlign === "center" ? width / 2 : node.textAlign === "right" ? width : 0;
    const totalHeight = lines.length * lineHeight;
    const startY = Math.max(0, (height - totalHeight) / 2);
    lines.forEach((line, index) => context.fillText(line, textX, startY + index * lineHeight, width));
  }
  context.restore();
}

export async function renderSideToCanvas(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
  includeGuides?: boolean;
  dpi: number;
}): Promise<HTMLCanvasElement> {
  const { document, sideId, assets, includeBlangko, includeGuides = false, dpi } = options;
  const side = getSide(document, sideId);
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.round(mmToPx(document.stock.width, dpi));
  canvas.height = Math.round(mmToPx(document.stock.height, dpi));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D tidak tersedia");

  if (includeBlangko) {
    context.fillStyle = "#F4EBDD";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (side.blangkoAssetId && assets[side.blangkoAssetId]) {
      const background = await loadImage(assets[side.blangkoAssetId]);
      drawImageCover(context, background, 0, 0, canvas.width, canvas.height);
    }
  }

  for (const node of [...side.nodes].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!node.visible) continue;
    const image = node.kind === "image" && node.assetId && assets[node.assetId]
      ? await loadImage(assets[node.assetId])
      : undefined;
    drawNode(context, node, dpi, image);
  }

  if (includeGuides) {
    context.save();
    context.strokeStyle = "#C45C26";
    context.lineWidth = Math.max(1, dpi / 150);
    context.setLineDash([dpi / 24, dpi / 36]);
    for (const fold of side.foldLines) {
      context.beginPath();
      if (fold.axis === "vertical") {
        const x = mmToPx(fold.positionMm, dpi);
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
      } else {
        const y = mmToPx(fold.positionMm, dpi);
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
      }
      context.stroke();
    }
    const margin = mmToPx(document.stock.safeMargin, dpi);
    context.strokeStyle = "#357A72";
    context.strokeRect(margin, margin, canvas.width - margin * 2, canvas.height - margin * 2);
    context.restore();
  }
  return canvas;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "undangan";
}

export async function exportPng(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
  dpi?: number;
}) {
  const canvas = await renderSideToCanvas({ ...options, dpi: options.dpi || options.document.stock.targetPpi });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG gagal dibuat")), "image/png"));
  downloadBlob(blob, `${safeName(options.document.title)}-${options.sideId}-${options.includeBlangko ? "preview" : "isi"}.png`);
}

export async function exportPrintPdf(options: {
  document: InvitationDocument;
  sideIds: SideId[];
  assets: AssetUrlMap;
  includeBlangko?: boolean;
}) {
  const { document, sideIds, assets, includeBlangko = false } = options;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${document.title} — ${includeBlangko ? "Preview" : "Cetak isi"}`);
  pdf.setCreator("Blangko Editor");
  for (const sideId of sideIds) {
    const canvas = await renderSideToCanvas({
      document,
      sideId,
      assets,
      includeBlangko,
      dpi: document.stock.targetPpi,
    });
    const embedded = await pdf.embedPng(canvas.toDataURL("image/png"));
    const width = mmToPt(document.stock.width);
    const height = mmToPt(document.stock.height);
    const page = pdf.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }
  const bytes = await pdf.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: "application/pdf" }), `${safeName(document.title)}-${includeBlangko ? "preview" : "isi-print"}.pdf`);
}

export function exportMaster(document: InvitationDocument) {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${safeName(document.title)}-master.json`);
}
