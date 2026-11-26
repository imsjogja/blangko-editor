import { describe, expect, it } from "vitest";
import { createInitialDocument, type DesignNode, type InvitationDocument } from "@contracts/invitation";
import { captureBoundsBaseline, mapInspectToWriteBack } from "./photocraft-writeback";
import type { PhotoCraftNativeInspect } from "./photocraft-canvas";

const PX_PER_MM = 300 / 25.4;
const px = (mm: number) => mm * PX_PER_MM;

function node(partial: Partial<DesignNode> & { id: string }): DesignNode {
  return {
    kind: "shape",
    role: "CONTENT",
    box: { x: 10, y: 20, width: 30, height: 12 },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 1,
    ...partial,
  } as DesignNode;
}

function documentWith(nodes: DesignNode[]): InvitationDocument {
  const document = createInitialDocument();
  return {
    ...document,
    stock: { ...document.stock, targetPpi: 300 },
    sides: document.sides.map((side) => side.id === "outside" ? { ...side, nodes } : side),
  };
}

function inspectWith(layers: PhotoCraftNativeInspect["layers"]): PhotoCraftNativeInspect {
  return { width: 3508, height: 2480, resolution: 300, layers };
}

describe("mapInspectToWriteBack", () => {
  it("menulis balik perpindahan posisi sebagai delta mm", () => {
    const document = documentWith([node({ id: "photo-1", kind: "image", assetId: "a1" })]);
    const baseline = new Map([["blangko-node:photo-1", [px(10), px(20), px(30), px(12)] as [number, number, number, number]]]);
    // Geser +5 mm ke kanan dan -2.5 mm ke atas pada canvas native.
    const inspect = inspectWith([
      { name: "blangko-node:photo-1", kind: "Smart Object", visible: true, opacity: 1, bounds: [px(15), px(17.5), px(30), px(12)] },
    ]);

    const result = mapInspectToWriteBack(document, "outside", inspect, baseline);
    expect(result).not.toBeNull();
    expect(result?.patches).toHaveLength(1);
    expect(result?.patches[0].patch.box).toEqual({ x: 15, y: 17.5, width: 30, height: 12 });
    const side = result!.document.sides.find((item) => item.id === "outside")!;
    expect(side.nodes[0].box.x).toBe(15);
  });

  it("menulis balik resize untuk layer non-teks tetapi tidak untuk teks", () => {
    const document = documentWith([
      node({ id: "img-1", kind: "image", assetId: "a1" }),
      node({ id: "txt-1", kind: "text", text: "Halo", fontSize: 18, fontFamily: "Arial" }),
    ]);
    const baseline = new Map([
      ["blangko-node:img-1", [px(10), px(20), px(30), px(12)] as [number, number, number, number]],
      ["blangko-node:txt-1", [px(10), px(20), px(28), px(6)] as [number, number, number, number]],
    ]);
    const inspect = inspectWith([
      { name: "blangko-node:img-1", kind: "Smart Object", visible: true, opacity: 1, bounds: [px(10), px(20), px(40), px(20)] },
      // Glyph bounds tumbuh karena konten teks berubah; lebar/tinggi box tidak boleh ikut.
      { name: "blangko-node:txt-1", kind: "Type", visible: true, opacity: 1, bounds: [px(13), px(20), px(50), px(9)], text: { text: "Halo Dunia", font: "Georgia", sizePt: 22 } },
    ]);

    const result = mapInspectToWriteBack(document, "outside", inspect, baseline);
    const image = result?.patches.find((entry) => entry.id === "img-1");
    const text = result?.patches.find((entry) => entry.id === "txt-1");

    expect(image?.patch.box).toEqual({ x: 10, y: 20, width: 40, height: 20 });
    expect(text?.patch.box).toEqual({ x: 13, y: 20, width: 30, height: 12 });
    expect(text?.patch.text).toBe("Halo Dunia");
    expect(text?.patch.fontFamily).toBe("Georgia");
    expect(text?.patch.fontSize).toBe(22);
  });

  it("menulis balik opacity dan visibilitas dengan toleransi", () => {
    const document = documentWith([node({ id: "n1" }), node({ id: "n2", zIndex: 2 })]);
    const inspect = inspectWith([
      { name: "blangko-node:n1", kind: "Shape", visible: false, opacity: 0.42, bounds: null },
      { name: "blangko-node:n2", kind: "Shape", visible: true, opacity: 1.0001, bounds: null },
    ]);

    const result = mapInspectToWriteBack(document, "outside", inspect, new Map());
    const first = result?.patches.find((entry) => entry.id === "n1");
    expect(first?.patch.visible).toBe(false);
    expect(first?.patch.opacity).toBe(0.42);
    // Perubahan di bawah toleransi tidak menghasilkan patch.
    expect(result?.patches.find((entry) => entry.id === "n2")).toBeUndefined();
  });

  it("melewati box untuk node berotasi tetapi tetap memetakan properti lain", () => {
    const document = documentWith([node({ id: "rot-1", rotation: 15 })]);
    const baseline = new Map([["blangko-node:rot-1", [px(10), px(20), px(30), px(12)] as [number, number, number, number]]]);
    const inspect = inspectWith([
      { name: "blangko-node:rot-1", kind: "Shape", visible: true, opacity: 0.5, bounds: [px(8), px(18), px(34), px(16)] },
    ]);

    const result = mapInspectToWriteBack(document, "outside", inspect, baseline);
    expect(result?.patches[0].patch.box).toBeUndefined();
    expect(result?.patches[0].patch.opacity).toBe(0.5);
  });

  it("mengabaikan layer tanpa prefix, node yang hilang, dan layer baru native", () => {
    const document = documentWith([node({ id: "known" })]);
    const inspect = inspectWith([
      { name: "__BLANGKO__", kind: "Smart Object", visible: true, opacity: 1, bounds: [0, 0, px(297), px(210)] },
      { name: "blangko-node:dihapus-di-native", kind: "Type", visible: true, opacity: 1 },
      { name: "Layer 1", kind: "Pixel", visible: true, opacity: 0.3 },
      { name: "blangko-node:known", kind: "Shape", visible: true, opacity: 1, bounds: null },
    ]);

    const result = mapInspectToWriteBack(document, "outside", inspect, new Map());
    expect(result?.patches).toHaveLength(0);
    expect(result?.document).toBe(document);
  });

  it("mengembalikan null untuk payload inspect yang tidak dapat dipakai", () => {
    const document = documentWith([node({ id: "n1" })]);
    expect(mapInspectToWriteBack(document, "outside", {}, new Map())).toBeNull();
  });

  it("memakai resolusi dari inspect untuk konversi px ke mm", () => {
    const document = documentWith([node({ id: "n1" })]);
    const px600 = 600 / 25.4;
    const baseline = new Map([["blangko-node:n1", [10 * px600, 20 * px600, 30 * px600, 12 * px600] as [number, number, number, number]]]);
    const inspect: PhotoCraftNativeInspect = {
      width: 7016,
      height: 4961,
      resolution: 600,
      layers: [{ name: "blangko-node:n1", kind: "Shape", visible: true, opacity: 1, bounds: [16 * px600, 20 * px600, 30 * px600, 12 * px600] }],
    };

    const result = mapInspectToWriteBack(document, "outside", inspect, baseline);
    expect(result?.patches[0].patch.box?.x).toBe(16);
  });
});

describe("captureBoundsBaseline", () => {
  it("hanya merekam bounds layer blangko-node termasuk di dalam grup", () => {
    const inspect = inspectWith([
      { name: "__BLANGKO__", kind: "Smart Object", bounds: [0, 0, 100, 100] },
      {
        name: "grup",
        kind: "Group",
        children: [
          { name: "blangko-node:a", kind: "Type", bounds: [1, 2, 3, 4] },
          { name: "blangko-node:tanpa-bounds", kind: "Type", bounds: null },
        ],
      },
    ]);

    const baseline = captureBoundsBaseline(inspect);
    expect(baseline.get("blangko-node:a")).toEqual([1, 2, 3, 4]);
    expect(baseline.has("__BLANGKO__")).toBe(false);
    expect(baseline.has("blangko-node:tanpa-bounds")).toBe(false);
  });
});
