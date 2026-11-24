import { describe, expect, it } from "vitest";
import { createInitialDocument, getSide, type BlangkoAnalysis } from "./invitation";
import { applyBlangkoAnalysis, removeAssetFromDocument, resizeSmartCanvas } from "./smart-canvas";

const analysis: BlangkoAnalysis = {
  widthMm: 210,
  heightMm: 148,
  sizeSource: "standard-aspect",
  confidence: 0.68,
  folds: [{ axis: "vertical", positionRatio: 0.5, confidence: 0.9, source: "edge-projection" }],
  warnings: [],
};

describe("smart canvas", () => {
  it("mengubah ukuran kertas, node, dan lipatan secara proporsional", () => {
    const document = createInitialDocument();
    const original = getSide(document, "outside").nodes[0];
    const resized = resizeSmartCanvas(document, { width: 210, height: 148 });
    const node = getSide(resized, "outside").nodes[0];
    expect(resized.stock.width).toBe(210);
    expect(resized.stock.height).toBe(148);
    expect(node.box.x).toBeCloseTo(original.box.x * 210 / 297, 1);
    expect(getSide(resized, "outside").foldLines[0].positionMm).toBe(105);
  });

  it("menerapkan hasil analisis dan memasang blangko pada sisi aktif", () => {
    const document = createInitialDocument();
    document.assets.push({ id: "uploaded", name: "Blangko A5", kind: "blangko", source: "storage", analysis });
    const result = applyBlangkoAnalysis(document, "inside", "uploaded");
    expect(result.stock.width).toBe(210);
    expect(result.stock.height).toBe(148);
    expect(result.stock.physicalSizeConfirmed).toBe(false);
    expect(getSide(result, "inside").blangkoAssetId).toBe("uploaded");
    expect(getSide(result, "inside").foldLines[0].positionMm).toBe(105);
  });

  it("menghapus aset, blangko, dan semua node terkait sebagai satu revisi", () => {
    const document = createInitialDocument();
    document.assets.push({ id: "ornament", name: "Ornamen", kind: "ornament", source: "storage" });
    document.sides[0].nodes.push({
      id: "image-1", kind: "image", role: "CONTENT", assetId: "ornament",
      box: { x: 1, y: 1, width: 10, height: 10 }, rotation: 0, visible: true,
      locked: false, opacity: 1, zIndex: 5,
    });
    const result = removeAssetFromDocument(document, "ornament");
    expect(result.assets.some((asset) => asset.id === "ornament")).toBe(false);
    expect(result.sides[0].nodes.some((node) => node.assetId === "ornament")).toBe(false);
  });
});
