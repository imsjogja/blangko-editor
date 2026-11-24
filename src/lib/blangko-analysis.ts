import exifr from "exifr";
import type { BlangkoAnalysis } from "@contracts/invitation";

export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface AnalysisOptions {
  sourceWidth: number;
  sourceHeight: number;
  dpi?: number;
}

const STANDARD_SHEETS = [
  { name: "A3", width: 420, height: 297 },
  { name: "A4", width: 297, height: 210 },
  { name: "A5", width: 210, height: 148 },
  { name: "Letter", width: 279.4, height: 215.9 },
  { name: "Square", width: 210, height: 210 },
];

function round(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function estimatePhysicalSize(
  sourceWidth: number,
  sourceHeight: number,
  dpi?: number,
): Pick<BlangkoAnalysis, "widthMm" | "heightMm" | "sizeSource" | "dpi" | "confidence" | "warnings"> {
  if (dpi && dpi >= 30 && dpi <= 2400) {
    return {
      widthMm: round(sourceWidth / dpi * 25.4),
      heightMm: round(sourceHeight / dpi * 25.4),
      sizeSource: "metadata-dpi",
      dpi: round(dpi),
      confidence: 0.95,
      warnings: ["Ukuran dihitung dari metadata DPI. Periksa kembali dengan blangko fisik sebelum produksi."],
    };
  }

  const imageRatio = sourceWidth / sourceHeight;
  let best: { width: number; height: number; difference: number; name: string } | null = null;
  for (const sheet of STANDARD_SHEETS) {
    for (const rotated of [false, true]) {
      const width = rotated ? sheet.height : sheet.width;
      const height = rotated ? sheet.width : sheet.height;
      const difference = Math.abs(Math.log(imageRatio / (width / height)));
      if (!best || difference < best.difference) best = { width, height, difference, name: sheet.name };
    }
  }

  if (best && best.difference <= 0.025) {
    return {
      widthMm: best.width,
      heightMm: best.height,
      sizeSource: "standard-aspect",
      confidence: 0.68,
      warnings: [`Rasio mendekati ${best.name}. Ukuran fisik masih berupa estimasi dan perlu dikonfirmasi.`],
    };
  }

  const landscape = imageRatio >= 1;
  const longEdge = landscape ? 297 : 210;
  return {
    widthMm: landscape ? longEdge : round(longEdge * imageRatio),
    heightMm: landscape ? round(longEdge / imageRatio) : longEdge,
    sizeSource: "aspect-preserved",
    confidence: 0.36,
    warnings: ["DPI dan ukuran standar tidak dikenali. Rasio gambar dipertahankan; masukkan ukuran fisik blangko untuk kalibrasi."],
  };
}

function grayscale(raster: RasterImage) {
  const values = new Float32Array(raster.width * raster.height);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    const alpha = raster.data[offset + 3] / 255;
    values[index] = (
      raster.data[offset] * 0.2126 +
      raster.data[offset + 1] * 0.7152 +
      raster.data[offset + 2] * 0.0722
    ) * alpha + 255 * (1 - alpha);
  }
  return values;
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function edgeProjection(gray: Float32Array, width: number, height: number, axis: "vertical" | "horizontal") {
  const length = axis === "vertical" ? width : height;
  const scores = new Array<number>(length).fill(0);
  const continuity = new Array<number>(length).fill(0);
  const rowStart = Math.floor((axis === "vertical" ? height : width) * 0.05);
  const rowEnd = Math.ceil((axis === "vertical" ? height : width) * 0.95);
  const allEdges: number[] = [];

  for (let outer = rowStart; outer < rowEnd; outer += 1) {
    for (let inner = 2; inner < length - 2; inner += 1) {
      const left = axis === "vertical" ? gray[outer * width + inner - 1] : gray[(outer - 1) * width + inner];
      const right = axis === "vertical" ? gray[outer * width + inner + 1] : gray[(outer + 1) * width + inner];
      allEdges.push(Math.abs(right - left));
    }
  }
  const edgeThreshold = Math.max(8, mean(allEdges) * 1.35);

  for (let inner = 2; inner < length - 2; inner += 1) {
    let total = 0;
    let continuous = 0;
    for (let outer = rowStart; outer < rowEnd; outer += 1) {
      const left = axis === "vertical" ? gray[outer * width + inner - 1] : gray[(outer - 1) * width + inner];
      const right = axis === "vertical" ? gray[outer * width + inner + 1] : gray[(outer + 1) * width + inner];
      const edge = Math.abs(right - left);
      total += edge;
      if (edge >= edgeThreshold) continuous += 1;
    }
    scores[inner] = total / Math.max(1, rowEnd - rowStart);
    continuity[inner] = continuous / Math.max(1, rowEnd - rowStart);
  }
  return { scores, continuity };
}

function detectFolds(
  gray: Float32Array,
  width: number,
  height: number,
): BlangkoAnalysis["folds"] {
  const folds: BlangkoAnalysis["folds"] = [];
  for (const axis of ["vertical", "horizontal"] as const) {
    const length = axis === "vertical" ? width : height;
    const { scores, continuity } = edgeProjection(gray, width, height, axis);
    const start = Math.floor(length * 0.12);
    const end = Math.ceil(length * 0.88);
    const central = scores.slice(start, end);
    const average = mean(central);
    const deviation = Math.sqrt(mean(central.map((value) => (value - average) ** 2)));
    const maximum = Math.max(...central);
    if (maximum < 10 || maximum <= average + deviation * 1.4) continue;

    const candidates: Array<{ index: number; confidence: number }> = [];
    for (let index = start; index < end; index += 1) {
      const value = scores[index];
      if (value < average + deviation * 1.4) continue;
      const localMaximum = Math.max(...scores.slice(Math.max(start, index - 2), Math.min(end, index + 3)));
      if (value !== localMaximum) continue;
      const prominence = (value - average) / Math.max(1, maximum - average);
      const confidence = clamp(0.3 + prominence * 0.42 + continuity[index] * 0.3, 0, 0.97);
      if (confidence >= 0.48) candidates.push({ index, confidence });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const selected: typeof candidates = [];
    for (const candidate of candidates) {
      if (selected.every((item) => Math.abs(item.index - candidate.index) > length * 0.08)) {
        selected.push(candidate);
      }
      if (selected.length === 2) break;
    }
    for (const candidate of selected) {
      folds.push({
        axis,
        positionRatio: candidate.index / length,
        confidence: round(candidate.confidence, 2),
        source: "edge-projection",
      });
    }
  }
  return folds.sort((a, b) => b.confidence - a.confidence).slice(0, 2);
}

interface ColorBucket {
  count: number;
  score: number;
  r: number;
  g: number;
  b: number;
}

function colorHex(color: { r: number; g: number; b: number }) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function relativeLuminance(color: { r: number; g: number; b: number }) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function readableColor(
  color: { r: number; g: number; b: number },
  paper: { r: number; g: number; b: number },
  minimumContrast: number,
) {
  const result = { ...color };
  for (let iteration = 0; iteration < 16 && contrastRatio(result, paper) < minimumContrast; iteration += 1) {
    result.r *= 0.88;
    result.g *= 0.88;
    result.b *= 0.88;
  }
  return result;
}

function bucketColor(bucket?: ColorBucket, fallback = { r: 36, g: 39, b: 32 }) {
  if (!bucket?.count) return fallback;
  return { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count };
}

function extractVisualPalette(raster: RasterImage) {
  const light = new Map<number, ColorBucket>();
  const dark = new Map<number, ColorBucket>();
  const saturated = new Map<number, ColorBucket>();
  const add = (map: Map<number, ColorBucket>, key: number, r: number, g: number, b: number, score: number) => {
    const bucket = map.get(key) ?? { count: 0, score: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.score += score;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    map.set(key, bucket);
  };

  for (let offset = 0; offset < raster.data.length; offset += 4) {
    if (raster.data[offset + 3] < 32) continue;
    const r = raster.data[offset];
    const g = raster.data[offset + 1];
    const b = raster.data[offset + 2];
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    const saturation = maximum ? (maximum - minimum) / maximum : 0;
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    if (luminance > 0.62) add(light, key, r, g, b, 1 - Math.abs(luminance - 0.87));
    if (luminance < 0.46) add(dark, key, r, g, b, 0.6 + saturation);
    if (saturation > 0.14 && luminance > 0.14 && luminance < 0.72) {
      add(saturated, key, r, g, b, 0.35 + saturation * 1.4);
    }
  }

  const best = (map: Map<number, ColorBucket>) => [...map.values()]
    .sort((a, b) => (b.score / b.count) * Math.log2(b.count + 2) - (a.score / a.count) * Math.log2(a.count + 2))[0];
  const paper = bucketColor(best(light), { r: 244, g: 240, b: 229 });
  const primary = readableColor(bucketColor(best(dark)), paper, 4.5);
  const accent = readableColor(bucketColor(best(saturated), primary), paper, 2.4);
  return { paper: colorHex(paper), primary: colorHex(primary), accent: colorHex(accent) };
}

function analyzeVisualProfile(raster: RasterImage): NonNullable<BlangkoAnalysis["visual"]> {
  const columns = 18;
  const rows = 32;
  const density = new Array<number>(columns * rows).fill(0);
  const palette = extractVisualPalette(raster);
  const paperHex = palette.paper;
  const paper = {
    r: Number.parseInt(paperHex.slice(1, 3), 16),
    g: Number.parseInt(paperHex.slice(3, 5), 16),
    b: Number.parseInt(paperHex.slice(5, 7), 16),
  };

  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor(row * raster.height / rows);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * raster.height / rows));
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor(column * raster.width / columns);
      const x1 = Math.max(x0 + 1, Math.floor((column + 1) * raster.width / columns));
      let samples = 0;
      let edgeTotal = 0;
      let distanceTotal = 0;
      for (let y = y0; y < Math.min(y1, raster.height); y += 1) {
        for (let x = x0; x < Math.min(x1, raster.width); x += 1) {
          const offset = (y * raster.width + x) * 4;
          const right = (y * raster.width + Math.min(raster.width - 1, x + 1)) * 4;
          const below = (Math.min(raster.height - 1, y + 1) * raster.width + x) * 4;
          const alpha = raster.data[offset + 3] / 255;
          const r = raster.data[offset] * alpha + 255 * (1 - alpha);
          const g = raster.data[offset + 1] * alpha + 255 * (1 - alpha);
          const b = raster.data[offset + 2] * alpha + 255 * (1 - alpha);
          const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
          const rightGray = raster.data[right] * 0.2126 + raster.data[right + 1] * 0.7152 + raster.data[right + 2] * 0.0722;
          const belowGray = raster.data[below] * 0.2126 + raster.data[below + 1] * 0.7152 + raster.data[below + 2] * 0.0722;
          edgeTotal += (Math.abs(rightGray - gray) + Math.abs(belowGray - gray)) / 2;
          distanceTotal += Math.sqrt((r - paper.r) ** 2 + (g - paper.g) ** 2 + (b - paper.b) ** 2) / 255;
          samples += 1;
        }
      }
      const edge = edgeTotal / Math.max(1, samples) / 32;
      const distance = distanceTotal / Math.max(1, samples) / 0.48;
      density[row * columns + column] = round(clamp(edge * 0.58 + distance * 0.42), 3);
    }
  }
  return { columns, rows, density, palette };
}

export function analyzeBlangkoRaster(raster: RasterImage, options: AnalysisOptions): BlangkoAnalysis {
  if (raster.width < 16 || raster.height < 16) throw new Error("Gambar terlalu kecil untuk dianalisis.");
  const size = estimatePhysicalSize(options.sourceWidth, options.sourceHeight, options.dpi);
  const folds = detectFolds(grayscale(raster), raster.width, raster.height);
  const warnings = [...size.warnings];

  if (folds.length === 0) {
    folds.push({
      axis: options.sourceWidth >= options.sourceHeight ? "vertical" : "horizontal",
      positionRatio: 0.5,
      confidence: 0.25,
      source: "layout-heuristic",
    });
    warnings.push("Lipatan dominan tidak terdeteksi. Garis tengah ditambahkan sebagai panduan heuristic dan dapat digeser manual.");
  } else if (folds.some((fold) => fold.confidence < 0.65)) {
    warnings.push("Sebagian kandidat lipatan memiliki confidence rendah. Periksa garis bantu sebelum menyusun isi.");
  }

  return {
    ...size,
    confidence: round(Math.min(size.confidence, ...folds.map((fold) => fold.confidence)), 2),
    folds,
    visual: analyzeVisualProfile(raster),
    warnings,
  };
}

function averageResolution(x: number, y: number, multiplier: number) {
  const values = [x, y]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value * multiplier);
  return values.length ? mean(values) : undefined;
}

export function readRasterContainerDpi(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker === 0xe0 && length >= 14) {
        const payload = offset + 2;
        const signature = String.fromCharCode(...bytes.slice(payload, payload + 5));
        if (signature === "JFIF\0") {
          const unit = bytes[payload + 7];
          const multiplier = unit === 1 ? 1 : unit === 2 ? 2.54 : 0;
          if (multiplier) {
            return averageResolution(
              view.getUint16(payload + 8),
              view.getUint16(payload + 10),
              multiplier,
            );
          }
        }
      }
      offset += length;
    }
  }

  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 8 && pngSignature.every((value, index) => bytes[index] === value)) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (offset + 12 + length > bytes.length) break;
      if (type === "pHYs" && length >= 9) {
        const unit = bytes[offset + 16];
        if (unit === 1) {
          return averageResolution(
            view.getUint32(offset + 8),
            view.getUint32(offset + 12),
            0.0254,
          );
        }
        return undefined;
      }
      if (type === "IDAT") break;
      offset += 12 + length;
    }
  }
  return undefined;
}

async function readDpi(file: File): Promise<number | undefined> {
  try {
    const metadata = await exifr.parse(file, ["XResolution", "YResolution", "ResolutionUnit"]);
    if (metadata) {
      const unit = Number(metadata.ResolutionUnit || 2);
      const multiplier = unit === 3 ? 2.54 : unit === 2 ? 1 : 0;
      const dpi = multiplier
        ? averageResolution(Number(metadata.XResolution), Number(metadata.YResolution), multiplier)
        : undefined;
      if (dpi) return dpi;
    }
  } catch {
    // Container metadata below still provides DPI for JPEG JFIF and PNG pHYs.
  }
  try {
    const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    return readRasterContainerDpi(bytes);
  } catch {
    return undefined;
  }
}

async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("Dimensi gambar tidak valid.");
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("Gambar tidak dapat didekode untuk analisis.");
    }
  }
}

export async function analyzeBlangkoFile(file: File): Promise<BlangkoAnalysis> {
  const [decoded, dpi] = await Promise.all([decodeImage(file), readDpi(file)]);
  try {
    const scale = Math.min(1, 640 / Math.max(decoded.width, decoded.height));
    const width = Math.max(16, Math.round(decoded.width * scale));
    const height = Math.max(16, Math.round(decoded.height * scale));
    const canvas = window.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas analisis tidak tersedia.");
    context.drawImage(decoded.source, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return analyzeBlangkoRaster(
      { data: image.data, width, height },
      { sourceWidth: decoded.width, sourceHeight: decoded.height, dpi },
    );
  } finally {
    decoded.close();
  }
}
