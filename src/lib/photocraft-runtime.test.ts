import { describe, expect, it } from "vitest";
import { createInitialDocument, getSide } from "@contracts/invitation";
import { sideContentKey } from "./photocraft-runtime";

function keyOutside(document = createInitialDocument(), includeBlangko = true) {
  return sideContentKey(document, "outside", {}, includeBlangko);
}

describe("sideContentKey", () => {
  it("stabil untuk dokumen yang sama dan berubah saat konten sisi itu berubah", () => {
    const document = createInitialDocument();
    const before = keyOutside(document);

    expect(keyOutside(document)).toBe(before);

    const edited = {
      ...document,
      sides: document.sides.map((side) => side.id === "outside"
        ? { ...side, nodes: side.nodes.map((node, index) => index === 0 ? { ...node, rotation: 7 } : node) }
        : side),
    };
    expect(keyOutside(edited)).not.toBe(before);
  });

  it("tidak berubah ketika hanya sisi lain yang diedit", () => {
    const document = createInitialDocument();
    const before = keyOutside(document);

    const editedOtherSide = {
      ...document,
      sides: document.sides.map((side) => side.id === "inside"
        ? { ...side, nodes: side.nodes.map((node, index) => index === 0 ? { ...node, rotation: 12, opacity: 0.5 } : node) }
        : side),
    };
    expect(keyOutside(editedOtherSide)).toBe(before);
  });

  it("berubah saat proyeksi blangko, stock, atau judul berubah", () => {
    const document = createInitialDocument();
    const before = keyOutside(document);

    expect(keyOutside(document, false)).not.toBe(before);

    const denser = { ...document, stock: { ...document.stock, targetPpi: 600 as const } };
    expect(keyOutside(denser)).not.toBe(before);

    const renamed = { ...document, title: "Undangan Baru" };
    expect(keyOutside(renamed)).not.toBe(before);
  });

  it("tidak berubah saat field desain yang tidak dirender berubah", () => {
    const document = createInitialDocument();
    const before = keyOutside(document);

    const renamed = {
      ...document,
      design: { ...document.design, coupleNames: "Alpha & Omega", venue: "Gedung Serbaguna" },
    };
    expect(keyOutside(renamed)).toBe(before);
  });

  it("hanya berubah saat URL aset yang benar-benar direferensikan berubah", () => {
    const document = createInitialDocument();
    const withBlangko = {
      ...document,
      sides: document.sides.map((side) => side.id === "outside" ? { ...side, blangkoAssetId: "blangko-1" } : side),
    };
    const assetsA = { "blangko-1": "data:image/png;base64,AAAA", "other-asset": "data:image/png;base64,BBBB" };

    const before = sideContentKey(withBlangko, "outside", assetsA, true);

    // URL baru untuk blangko yang direferensikan mengubah key pada proyeksi composite…
    const assetsB = { ...assetsA, "blangko-1": "data:image/png;base64,CCCC" };
    expect(sideContentKey(withBlangko, "outside", assetsB, true)).not.toBe(before);

    // …tetapi tidak pada proyeksi content-only yang tidak menyertakan blangko.
    const contentOnly = sideContentKey(withBlangko, "outside", assetsA, false);
    expect(sideContentKey(withBlangko, "outside", assetsB, false)).toBe(contentOnly);

    // Aset yang tidak direferensikan sisi ini tidak memengaruhi key.
    const assetsC = { ...assetsA, "other-asset": "data:image/png;base64,DDDD" };
    expect(sideContentKey(withBlangko, "outside", assetsC, true)).toBe(before);
  });

  it("membedakan key antar sisi pada dokumen yang sama", () => {
    const document = createInitialDocument();
    expect(getSide(document, "inside").id).toBe("inside");
    expect(keyOutside(document)).not.toBe(sideContentKey(document, "inside", {}, true));
  });
});
