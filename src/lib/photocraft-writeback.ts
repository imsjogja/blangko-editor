import { getSide, type DesignNode, type InvitationDocument, type SideId } from "@contracts/invitation";
import type { PhotoCraftNativeInspect, PhotoCraftNativeInspectLayer } from "./photocraft-canvas";

export interface NativeNodePatch {
  id: string;
  patch: Partial<DesignNode>;
}

export interface NativeWriteBack {
  document: InvitationDocument;
  patches: NativeNodePatch[];
}

/** layer name -> content bounds [x, y, width, height] in pixels at open/write-back time. */
export type NativeBoundsBaseline = Map<string, [number, number, number, number]>;

const NODE_LAYER_PREFIX = "blangko-node:";
const BOX_TOLERANCE_MM = 0.05;
const OPACITY_TOLERANCE = 0.005;
const FONT_SIZE_TOLERANCE_PT = 0.05;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isBounds(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function flattenLayers(layers: PhotoCraftNativeInspectLayer[]): PhotoCraftNativeInspectLayer[] {
  const flat: PhotoCraftNativeInspectLayer[] = [];
  const stack = [...layers];
  while (stack.length) {
    const layer = stack.pop();
    if (!layer) continue;
    flat.push(layer);
    if (Array.isArray(layer.children)) stack.push(...layer.children);
  }
  return flat;
}

/**
 * Snapshot of the native layers' content bounds, captured right after a
 * canonical open and after each applied write-back. Deltas against this
 * baseline translate native drags/resizes into canonical box changes without
 * depending on how a layer kind insets its content (text glyphs, frames).
 */
export function captureBoundsBaseline(inspect: PhotoCraftNativeInspect): NativeBoundsBaseline {
  const baseline: NativeBoundsBaseline = new Map();
  for (const layer of flattenLayers(inspect.layers ?? [])) {
    if (typeof layer.name === "string" && layer.name.startsWith(NODE_LAYER_PREFIX) && isBounds(layer.bounds)) {
      baseline.set(layer.name, layer.bounds);
    }
  }
  return baseline;
}

/**
 * Map a native document inspect onto canonical node patches. Returns null when
 * the inspect payload is unusable. Deliberate scope limits (documented in
 * docs/REALTIME-CANVAS-CONSOLIDATION.md):
 * - rotated nodes keep their canonical box: content bounds of a rotated layer
 *   are the rotated AABB and cannot be mapped back unambiguously;
 * - native-only layers (no `blangko-node:` name) and natively deleted nodes are
 *   ignored — the canonical document stays authoritative for structure.
 */
export function mapInspectToWriteBack(
  document: InvitationDocument,
  sideId: SideId,
  inspect: PhotoCraftNativeInspect,
  baseline: NativeBoundsBaseline,
): NativeWriteBack | null {
  if (!Array.isArray(inspect.layers)) return null;
  const resolution = typeof inspect.resolution === "number" && inspect.resolution > 0
    ? inspect.resolution
    : document.stock.targetPpi;
  const pxPerMm = resolution / 25.4;
  const side = getSide(document, sideId);
  const patches: NativeNodePatch[] = [];

  for (const layer of flattenLayers(inspect.layers)) {
    const name = typeof layer.name === "string" ? layer.name : "";
    if (!name.startsWith(NODE_LAYER_PREFIX)) continue;
    const nodeId = name.slice(NODE_LAYER_PREFIX.length);
    const node = side.nodes.find((item) => item.id === nodeId);
    if (!node) continue;

    const patch: Partial<DesignNode> = {};

    if (typeof layer.visible === "boolean" && layer.visible !== node.visible) {
      patch.visible = layer.visible;
    }
    if (typeof layer.opacity === "number" && Number.isFinite(layer.opacity)) {
      const opacity = round2(Math.min(1, Math.max(0, layer.opacity)));
      if (Math.abs(opacity - node.opacity) > OPACITY_TOLERANCE) patch.opacity = opacity;
    }

    if (node.kind === "text" && layer.text) {
      if (typeof layer.text.text === "string" && layer.text.text !== node.text) {
        patch.text = layer.text.text;
      }
      if (typeof layer.text.font === "string" && layer.text.font && layer.text.font !== node.fontFamily) {
        patch.fontFamily = layer.text.font;
      }
      if (typeof layer.text.sizePt === "number" && Number.isFinite(layer.text.sizePt)) {
        const fontSize = Math.round(layer.text.sizePt * 10) / 10;
        if (Math.abs(fontSize - (node.fontSize ?? 12)) > FONT_SIZE_TOLERANCE_PT) patch.fontSize = fontSize;
      }
    }

    // Geometry: translate the delta from the open-time baseline into mm. Text
    // keeps its canonical size (glyph bounds are not the layout box); other
    // kinds take the size delta too. Rotated nodes are skipped entirely.
    const current = isBounds(layer.bounds) ? layer.bounds : null;
    const base = baseline.get(name);
    if (current && base && node.rotation === 0) {
      const dx = (current[0] - base[0]) / pxPerMm;
      const dy = (current[1] - base[1]) / pxPerMm;
      const dw = node.kind === "text" ? 0 : (current[2] - base[2]) / pxPerMm;
      const dh = node.kind === "text" ? 0 : (current[3] - base[3]) / pxPerMm;
      if (Math.abs(dx) > BOX_TOLERANCE_MM || Math.abs(dy) > BOX_TOLERANCE_MM
        || Math.abs(dw) > BOX_TOLERANCE_MM || Math.abs(dh) > BOX_TOLERANCE_MM) {
        patch.box = {
          x: round2(node.box.x + dx),
          y: round2(node.box.y + dy),
          width: round2(Math.max(1, node.box.width + dw)),
          height: round2(Math.max(1, node.box.height + dh)),
        };
      }
    }

    if (Object.keys(patch).length) patches.push({ id: node.id, patch });
  }

  if (!patches.length) return { document, patches };

  const next: InvitationDocument = {
    ...document,
    sides: document.sides.map((item) => item.id === sideId
      ? {
          ...item,
          nodes: item.nodes.map((node) => {
            const found = patches.find((entry) => entry.id === node.id);
            return found ? { ...node, ...found.patch } : node;
          }),
        }
      : item),
  };
  return { document: next, patches };
}
