import {
  getSide,
  type BlangkoAnalysis,
  type DesignNode,
  type InvitationDocument,
  type SideId,
} from "./invitation";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function scaleNode(node: DesignNode, scaleX: number, scaleY: number): DesignNode {
  const fontScale = Math.min(scaleX, scaleY);
  return {
    ...node,
    box: {
      x: round(node.box.x * scaleX),
      y: round(node.box.y * scaleY),
      width: round(node.box.width * scaleX),
      height: round(node.box.height * scaleY),
    },
    fontSize: node.fontSize ? round(clamp(node.fontSize * fontScale, 4, 240), 1) : undefined,
    letterSpacing: node.letterSpacing !== undefined
      ? round(clamp(node.letterSpacing * fontScale, -5, 20), 1)
      : undefined,
    cornerRadius: node.cornerRadius !== undefined
      ? round(clamp(node.cornerRadius * fontScale, 0, 500))
      : undefined,
  };
}

function resizeDocument(
  document: InvitationDocument,
  width: number,
  height: number,
  physicalSizeConfirmed: boolean,
): InvitationDocument {
  const nextWidth = round(clamp(width, 20, 2000), 1);
  const nextHeight = round(clamp(height, 20, 2000), 1);
  const scaleX = nextWidth / document.stock.width;
  const scaleY = nextHeight / document.stock.height;
  return {
    ...document,
    stock: { ...document.stock, width: nextWidth, height: nextHeight, physicalSizeConfirmed },
    sides: document.sides.map((side) => ({
      ...side,
      foldLines: side.foldLines.map((fold) => ({
        ...fold,
        positionMm: round(fold.positionMm * (fold.axis === "vertical" ? scaleX : scaleY)),
      })),
      nodes: side.nodes.map((node) => scaleNode(node, scaleX, scaleY)),
    })),
  };
}

export function resizeSmartCanvas(
  document: InvitationDocument,
  dimensions: { width?: number; height?: number },
): InvitationDocument {
  return resizeDocument(
    document,
    dimensions.width ?? document.stock.width,
    dimensions.height ?? document.stock.height,
    false,
  );
}

export function applyBlangkoAnalysis(
  document: InvitationDocument,
  sideId: SideId,
  assetId: string,
  suppliedAnalysis?: BlangkoAnalysis,
): InvitationDocument {
  const asset = document.assets.find((item) => item.id === assetId);
  const analysis = suppliedAnalysis ?? asset?.analysis;
  if (!analysis) throw new Error("Hasil analisis blangko tidak ditemukan.");

  const resized = resizeDocument(
    document,
    analysis.widthMm,
    analysis.heightMm,
    analysis.sizeSource === "metadata-dpi",
  );
  return {
    ...resized,
    assets: resized.assets.map((item) => item.id === assetId ? { ...item, analysis } : item),
    sides: resized.sides.map((side) => {
      if (side.id !== sideId) return side;
      const foldLines = analysis.folds.length > 0
        ? analysis.folds.map((fold, index) => ({
            id: `cv-${sideId}-${fold.axis}-${index}`,
            axis: fold.axis,
            positionMm: round(fold.positionRatio * (fold.axis === "vertical" ? analysis.widthMm : analysis.heightMm)),
            kind: "fold" as const,
          }))
        : side.foldLines;
      return { ...side, blangkoAssetId: assetId, foldLines };
    }),
  };
}

export function removeAssetFromDocument(
  document: InvitationDocument,
  assetId: string,
): InvitationDocument {
  return {
    ...document,
    assets: document.assets.filter((asset) => asset.id !== assetId),
    sides: document.sides.map((side) => ({
      ...side,
      blangkoAssetId: side.blangkoAssetId === assetId ? undefined : side.blangkoAssetId,
      nodes: side.nodes.filter((node) => node.assetId !== assetId),
    })),
  };
}

export function getActiveBlangkoAnalysis(document: InvitationDocument, sideId: SideId) {
  const side = getSide(document, sideId);
  return document.assets.find((asset) => asset.id === side.blangkoAssetId)?.analysis;
}
