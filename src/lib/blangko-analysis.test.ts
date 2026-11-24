import { describe, expect, it } from "vitest";
import {
  analyzeBlangkoRaster,
  estimatePhysicalSize,
  readRasterContainerDpi,
  type RasterImage,
} from "./blangko-analysis";

function syntheticRaster(withFold: boolean): RasterImage {
  const width = 240;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const line = withFold && (x === 119 || x === 120);
      data[offset] = line ? 70 : 235;
      data[offset + 1] = line ? 70 : 235;
      data[offset + 2] = line ? 70 : 235;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("analisis computer vision blangko", () => {
  it("menghitung ukuran fisik dari DPI tanpa menebak rasio", () => {
    const result = estimatePhysicalSize(3508, 2480, 300);
    expect(result.sizeSource).toBe("metadata-dpi");
    expect(result.widthMm).toBeCloseTo(297, 0);
    expect(result.heightMm).toBeCloseTo(210, 0);
  });

  it("mengenali rasio A4 dan menandai ukuran sebagai estimasi", () => {
    const result = estimatePhysicalSize(1403, 992);
    expect(result.sizeSource).toBe("standard-aspect");
    expect(result.widthMm).toBe(297);
    expect(result.heightMm).toBe(210);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it("mendeteksi garis lipat vertikal melalui proyeksi edge", () => {
    const result = analyzeBlangkoRaster(syntheticRaster(true), { sourceWidth: 1403, sourceHeight: 992 });
    const fold = result.folds.find((item) => item.source === "edge-projection");
    expect(fold?.axis).toBe("vertical");
    expect(fold?.positionRatio).toBeCloseTo(0.5, 1);
    expect(fold?.confidence).toBeGreaterThan(0.65);
  });

  it("tidak mengarang edge pada gambar polos", () => {
    const result = analyzeBlangkoRaster(syntheticRaster(false), { sourceWidth: 1403, sourceHeight: 992 });
    expect(result.folds).toHaveLength(1);
    expect(result.folds[0].source).toBe("layout-heuristic");
    expect(result.folds[0].confidence).toBe(0.25);
  });

  it("mengukur zona tenang dan mengekstrak palet visual blangko", () => {
    const raster = syntheticRaster(false);
    for (let y = 0; y < 46; y += 1) {
      for (let x = 194; x < 240; x += 1) {
        const offset = (y * raster.width + x) * 4;
        const line = (x + y) % 6 < 2;
        raster.data[offset] = line ? 58 : 103;
        raster.data[offset + 1] = line ? 67 : 112;
        raster.data[offset + 2] = line ? 45 : 72;
      }
    }
    const result = analyzeBlangkoRaster(raster, { sourceWidth: 1403, sourceHeight: 992 });
    const visual = result.visual;
    expect(visual?.density).toHaveLength(18 * 32);
    expect(visual?.palette.paper).toBe("#EBEBEB");
    const quietCenter = visual!.density[16 * visual!.columns + 7];
    const busyCorner = Math.max(...visual!.density.slice(0, visual!.columns * 3));
    expect(busyCorner).toBeGreaterThan(quietCenter + 0.1);
  });

  it("membaca resolusi JPEG dari metadata JFIF", () => {
    const bytes = new Uint8Array(18);
    const view = new DataView(bytes.buffer);
    bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
    view.setUint16(4, 14);
    bytes.set([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01], 6);
    view.setUint16(14, 300);
    view.setUint16(16, 300);
    expect(readRasterContainerDpi(bytes)).toBe(300);
  });

  it("membaca resolusi PNG dari piksel per meter pHYs", () => {
    const bytes = new Uint8Array(29);
    const view = new DataView(bytes.buffer);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    view.setUint32(8, 9);
    bytes.set([0x70, 0x48, 0x59, 0x73], 12);
    const pixelsPerMeter = Math.round(300 / 0.0254);
    view.setUint32(16, pixelsPerMeter);
    view.setUint32(20, pixelsPerMeter);
    bytes[24] = 1;
    expect(readRasterContainerDpi(bytes)).toBeCloseTo(300, 0);
  });
});
