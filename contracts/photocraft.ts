import { z } from "zod";
import { getSide, type DesignNode, type InvitationDocument, type SideId } from "./invitation";

export type PrintProjection = "composite" | "content-only";

export interface PhotoCraftSemanticCommand {
  command: string;
  params: Record<string, unknown>;
}

/**
 * Stable semantic batch consumed by a PhotoCraft runtime adapter.
 * The runtime must resolve these operations against `engine.commands` from the
 * pinned PhotoCraft build; the model never receives raw engine command IDs.
 */
export function compilePhotoCraftBatch(
  document: InvitationDocument,
  sideId: SideId,
  projection: PrintProjection,
): PhotoCraftSemanticCommand[] {
  const side = getSide(document, sideId);
  const commands: PhotoCraftSemanticCommand[] = [
    {
      command: "document.create",
      params: {
        widthMm: document.stock.width,
        heightMm: document.stock.height,
        targetPpi: document.stock.targetPpi,
        metadata: { title: `${document.title} — ${side.label}`, schemaVersion: 1 },
      },
    },
  ];

  if (projection === "composite" && side.blangkoAssetId) {
    commands.push({ command: "group.create", params: { id: "__BLANGKO__", locked: true, printable: false } });
    commands.push({
      command: "image.place",
      params: {
        groupId: "__BLANGKO__",
        assetId: side.blangkoAssetId,
        boxMm: { x: 0, y: 0, width: document.stock.width, height: document.stock.height },
        locked: true,
        printable: false,
      },
    });
  }

  commands.push({ command: "group.create", params: { id: "__CONTENT__", locked: false, printable: true } });
  for (const node of [...side.nodes].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!node.visible) continue;
    commands.push({
      command: node.kind === "text" ? "text.create" : node.kind === "image" ? "image.place" : "shape.create",
      params: { ...node, groupId: "__CONTENT__", boxMm: node.box, printable: true },
    });
  }

  if (projection === "composite") {
    commands.push({ command: "group.create", params: { id: "__GUIDES__", locked: true, printable: false } });
    for (const fold of side.foldLines) {
      commands.push({ command: "guide.fold", params: { ...fold, groupId: "__GUIDES__", printable: false } });
    }
  }

  commands.push({ command: "document.commit", params: { transaction: `agent-${sideId}-${projection}` } });
  return commands;
}

export const photoCraftRuntimeAssetSchema = z.object({
  name: z.string().min(1).max(255),
  contentType: z.string().max(120).optional(),
  dataBase64: z.string().min(8).max(45_000_000),
});

export const photoCraftRuntimeAssetsSchema = z.record(
  z.string().min(1),
  photoCraftRuntimeAssetSchema,
).refine((assets) => Object.keys(assets).length <= 200, "Maksimal 200 aset per sinkronisasi.");

export type PhotoCraftRuntimeAsset = z.infer<typeof photoCraftRuntimeAssetSchema>;
export type PhotoCraftRuntimeAssets = z.infer<typeof photoCraftRuntimeAssetsSchema>;

export interface PhotoCraftEngineStep {
  method: "engine.execute" | "doc.place";
  params: Record<string, unknown>;
}

function engineCommand(command: string, params: Record<string, unknown>): PhotoCraftEngineStep {
  return { method: "engine.execute", params: { command, params } };
}

export function photoCraftLayerName(nodeId: string): string {
  return `blangko-node:${nodeId}`;
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  const k = 0.5522847498307936;
  const knot = (anchor: [number, number], incoming: [number, number], outgoing: [number, number]) => ({
    anchor, in: incoming, out: outgoing, smooth: false,
  });
  return {
    fillRule: "nonzero",
    inverted: false,
    subpaths: [{
      closed: true,
      op: "combine",
      knots: [
        knot([x + r, y], [x + r - k * r, y], [x + r, y]),
        knot([x + width - r, y], [x + width - r, y], [x + width - r + k * r, y]),
        knot([x + width, y + r], [x + width, y + r - k * r], [x + width, y + r]),
        knot([x + width, y + height - r], [x + width, y + height - r], [x + width, y + height - r + k * r]),
        knot([x + width - r, y + height], [x + width - r + k * r, y + height], [x + width - r, y + height]),
        knot([x + r, y + height], [x + r, y + height], [x + r - k * r, y + height]),
        knot([x, y + height - r], [x, y + height - r + k * r], [x, y + height - r]),
        knot([x, y + r], [x, y + r], [x, y + r - k * r]),
      ],
    }],
  };
}

function nodePropertySteps(node: DesignNode, name: string): PhotoCraftEngineStep[] {
  const steps: PhotoCraftEngineStep[] = [];
  if (node.opacity < 1) {
    steps.push(engineCommand("layer.layerStyle.blendingOptions", {
      layer: name,
      opacity: Math.round(node.opacity * 1000) / 10,
    }));
  }
  if (node.rotation) {
    steps.push(engineCommand("edit.transform", {
      layer: name,
      rotate: node.rotation,
      reference: "center",
    }));
  }
  if (node.locked) {
    steps.push(engineCommand("layer.select", { layer: name }));
    steps.push(engineCommand("layer.lockLayers", { all: true }));
  }
  return steps;
}

/**
 * Compiles the canonical document to commands from PhotoCraft's real engine.
 * Every printable node remains a native Type, Shape or framed Smart Object
 * layer. The blangko exists only in composite projection and is locked.
 */
export function compilePhotoCraftEngineSteps(
  document: InvitationDocument,
  sideId: SideId,
  projection: PrintProjection,
  assetPaths: Record<string, string>,
): PhotoCraftEngineStep[] {
  const side = getSide(document, sideId);
  const pxPerMm = document.stock.targetPpi / 25.4;
  const px = (mm: number) => Math.round(mm * pxPerMm * 1000) / 1000;
  const steps: PhotoCraftEngineStep[] = [];

  const placeImage = (assetId: string, name: string, node?: DesignNode) => {
    const sourcePath = assetPaths[assetId];
    if (!sourcePath) throw new Error(`Aset ${assetId} belum tersedia untuk runtime PhotoCraft.`);
    const box = node?.box ?? { x: 0, y: 0, width: document.stock.width, height: document.stock.height };
    const x = px(box.x);
    const y = px(box.y);
    const width = Math.max(1, px(box.width));
    const height = Math.max(1, px(box.height));
    const clip = node?.clipShape ?? "rectangle";
    const frameParams: Record<string, unknown> = {
      x: Math.round(x), y: Math.round(y),
      width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)),
      shape: clip === "ellipse" ? "ellipse" : clip === "rounded-rectangle" ? "custom" : "rectangle",
      name,
    };
    if (clip === "rounded-rectangle") {
      frameParams.path = roundedRectPath(x, y, width, height, px(node?.cornerRadius ?? 3));
    }
    steps.push(engineCommand("layer.new.frame", frameParams));
    steps.push({
      method: "doc.place",
      params: { path: sourcePath, fit: true, center: [x + width / 2, y + height / 2] },
    });
  };

  if (projection === "composite" && side.blangkoAssetId) {
    placeImage(side.blangkoAssetId, "__BLANGKO__");
    steps.push(engineCommand("layer.select", { layer: "__BLANGKO__" }));
    steps.push(engineCommand("layer.lockLayers", { all: true }));
  }

  for (const node of [...side.nodes].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!node.visible) continue;
    const name = photoCraftLayerName(node.id);
    const x = px(node.box.x);
    const y = px(node.box.y);
    const width = Math.max(1, px(node.box.width));
    const height = Math.max(1, px(node.box.height));

    if (node.kind === "image") {
      if (!node.assetId) throw new Error(`Layer gambar ${node.id} tidak memiliki aset.`);
      placeImage(node.assetId, name, node);
    } else if (node.kind === "text") {
      const fontSize = node.fontSize ?? 12;
      steps.push(engineCommand("type.create", {
        box: [x, y, width, height],
        text: node.text ?? "",
        name,
        align: node.textAlign ?? "left",
        font: node.fontFamily ?? "Arial",
        size: fontSize,
        weight: node.fontWeight ?? 400,
        italic: node.fontStyle === "italic",
        color: node.color ?? "#000000",
        leading: fontSize * 1.35,
        tracking: Math.round(((node.letterSpacing ?? 0) / fontSize) * 1000),
      }));
    } else {
      const shapeType = node.shapeType ?? "rectangle";
      steps.push(engineCommand("shape.create", {
        kind: shapeType === "ellipse" ? "ellipse" : shapeType === "rounded-rectangle" ? "roundedRect" : "rect",
        rect: [x, y, width, height],
        radii: shapeType === "rounded-rectangle" ? px(node.cornerRadius ?? 3) : undefined,
        fill: node.backgroundColor || null,
        stroke: node.borderColor && (node.borderWidth ?? 0) > 0 ? {
          width: px(node.borderWidth ?? 0),
          color: node.borderColor,
          opacity: 100,
          align: "inside",
        } : null,
        name,
      }));
    }
    steps.push(...nodePropertySteps(node, name));
  }
  return steps;
}
