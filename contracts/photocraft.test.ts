import { describe, expect, it } from "vitest";
import { createInitialDocument, type DesignNode } from "./invitation";
import {
  compilePhotoCraftEngineSteps,
  photoCraftLayerName,
  type PhotoCraftEngineStep,
} from "./photocraft";

function command(step: PhotoCraftEngineStep) {
  return step.method === "engine.execute" ? step.params.command : step.method;
}

function params(step: PhotoCraftEngineStep): Record<string, unknown> {
  return (step.method === "engine.execute" ? step.params.params : step.params) as Record<string, unknown>;
}

function baseNode(overrides: Partial<DesignNode>): DesignNode {
  return {
    id: "node",
    kind: "shape",
    role: "CONTENT",
    box: { x: 10, y: 12, width: 30, height: 20 },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 1,
    backgroundColor: "#223344",
    ...overrides,
  };
}

describe("PhotoCraft native engine compiler", () => {
  it("keeps blangko out of content-only and locks it in composite", () => {
    const document = createInitialDocument();
    const assets = { "builtin-outside": "assets/blangko.svg" };
    const content = compilePhotoCraftEngineSteps(document, "outside", "content-only", assets);
    const composite = compilePhotoCraftEngineSteps(document, "outside", "composite", assets);

    expect(content.some((step) => params(step).name === "__BLANGKO__")).toBe(false);
    expect(content.some((step) => command(step) === "layer.lockLayers")).toBe(false);
    expect(composite.slice(0, 4).map(command)).toEqual([
      "layer.new.frame",
      "doc.place",
      "layer.select",
      "layer.lockLayers",
    ]);
    expect(params(composite[0])).toMatchObject({ name: "__BLANGKO__", shape: "rectangle" });
    expect(params(composite[1])).toMatchObject({ path: "assets/blangko.svg", fit: true });
  });

  it("compiles native text and shape layers in z-index order and skips hidden nodes", () => {
    const document = createInitialDocument();
    document.sides[0].nodes = [
      baseNode({ id: "top-text", kind: "text", text: "Alya & Rama", zIndex: 4, fontSize: 34, fontFamily: "Georgia", fontWeight: 700, fontStyle: "italic", textAlign: "center", letterSpacing: 1.7, color: "#51483C" }),
      baseNode({ id: "hidden", visible: false, zIndex: 0 }),
      baseNode({ id: "bottom-shape", shapeType: "rounded-rectangle", cornerRadius: 4, borderColor: "#9A6B4F", borderWidth: 0.5, zIndex: 1 }),
    ];

    const steps = compilePhotoCraftEngineSteps(document, "outside", "content-only", {});
    const creators = steps.filter((step) => ["shape.create", "type.create"].includes(String(command(step))));
    expect(creators.map((step) => params(step).name)).toEqual([
      photoCraftLayerName("bottom-shape"),
      photoCraftLayerName("top-text"),
    ]);
    expect(params(creators[0])).toMatchObject({ kind: "roundedRect", fill: "#223344" });
    expect(params(creators[0]).stroke).toMatchObject({ color: "#9A6B4F", align: "inside" });
    expect(params(creators[1])).toMatchObject({
      text: "Alya & Rama",
      font: "Georgia",
      size: 34,
      weight: 700,
      italic: true,
      align: "center",
      color: "#51483C",
      tracking: 50,
    });
    expect(steps.some((step) => params(step).name === photoCraftLayerName("hidden"))).toBe(false);
  });

  it("creates editable framed images with ellipse and rounded clipping", () => {
    const document = createInitialDocument();
    document.sides[0].nodes = [
      baseNode({ id: "oval", kind: "image", assetId: "photo", clipShape: "ellipse", zIndex: 1 }),
      baseNode({ id: "rounded", kind: "image", assetId: "photo", clipShape: "rounded-rectangle", cornerRadius: 5, zIndex: 2 }),
    ];
    const steps = compilePhotoCraftEngineSteps(document, "outside", "content-only", { photo: "assets/photo.png" });
    const frames = steps.filter((step) => command(step) === "layer.new.frame");
    const placements = steps.filter((step) => command(step) === "doc.place");

    expect(frames).toHaveLength(2);
    expect(params(frames[0])).toMatchObject({ name: photoCraftLayerName("oval"), shape: "ellipse" });
    expect(params(frames[1])).toMatchObject({ name: photoCraftLayerName("rounded"), shape: "custom" });
    expect(params(frames[1]).path).toMatchObject({ fillRule: "nonzero" });
    expect(placements).toHaveLength(2);
    expect(placements.every((step) => params(step).fit === true)).toBe(true);
  });

  it("preserves opacity, rotation, and node locking as real engine commands", () => {
    const document = createInitialDocument();
    document.sides[0].nodes = [baseNode({ id: "styled", opacity: 0.625, rotation: 17, locked: true })];
    const steps = compilePhotoCraftEngineSteps(document, "outside", "content-only", {});

    expect(steps.slice(1).map(command)).toEqual([
      "layer.layerStyle.blendingOptions",
      "edit.transform",
      "layer.select",
      "layer.lockLayers",
    ]);
    expect(params(steps[1])).toMatchObject({ layer: photoCraftLayerName("styled"), opacity: 62.5 });
    expect(params(steps[2])).toMatchObject({ layer: photoCraftLayerName("styled"), rotate: 17, reference: "center" });
  });

  it("fails before rendering when a referenced image asset is missing", () => {
    const document = createInitialDocument();
    document.sides[0].nodes = [baseNode({ id: "missing", kind: "image", assetId: "not-uploaded" })];
    expect(() => compilePhotoCraftEngineSteps(document, "outside", "content-only", {}))
      .toThrow("Aset not-uploaded belum tersedia");
  });
});
