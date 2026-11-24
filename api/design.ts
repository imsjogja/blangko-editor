import { randomUUID } from "node:crypto";
import {
  getSide,
  type DesignDirection,
  type DesignNode,
  type DesignProposal,
  type DesignStyle,
  type InvitationDocument,
  type SideId,
} from "@contracts/invitation";
import { evaluateProposalQuality } from "./design-quality";

const palettes: Record<DesignStyle, DesignDirection["palette"]> = {
  modern: { paper: "#F2F2F0", primary: "#202522", accent: "#C45C26" },
  rustic: { paper: "#F4EBDD", primary: "#51483C", accent: "#6E7254" },
  classic: { paper: "#F3EFE7", primary: "#342E2A", accent: "#8A6A3D" },
};

export function deterministicDirection(
  document: InvitationDocument,
  style: DesignStyle,
  prompt = "",
  sideId: SideId = "outside",
): DesignDirection {
  const copy = {
    modern: {
      eyebrow: "SELEBRASI PERNIKAHAN",
      subtitle: "Satu hari istimewa, satu cerita untuk selamanya.",
      ornament: "none" as const,
      layout: "asymmetric" as const,
      heading: "Noto Serif",
    },
    rustic: {
      eyebrow: "DENGAN HORMAT",
      subtitle: "Bersama keluarga dan sahabat, kami mengundang Anda dalam perayaan kami.",
      ornament: "botanical" as const,
      layout: "center" as const,
      heading: "Great Vibes",
    },
    classic: {
      eyebrow: "THE WEDDING CELEBRATION",
      subtitle: "Dengan penuh syukur kami mengundang Anda untuk menjadi bagian dari hari bahagia ini.",
      ornament: "lines" as const,
      layout: "editorial" as const,
      heading: "Great Vibes",
    },
  }[style];
  const layout = /asimetr|asymmetric/i.test(prompt)
    ? "asymmetric" as const
    : /editorial/i.test(prompt)
      ? "editorial" as const
      : /tengah|center|simetris/i.test(prompt)
        ? "center" as const
        : copy.layout;
  const ornament = /tanpa ornamen|minimalis|minimal/i.test(prompt)
    ? "none" as const
    : /botani|daun|floral/i.test(prompt)
      ? "botanical" as const
      : /garis|line/i.test(prompt)
        ? "lines" as const
        : copy.ornament;

  const activeSide = getSide(document, sideId);
  const measuredPalette = document.assets.find((asset) => asset.id === activeSide.blangkoAssetId)
    ?.analysis?.visual?.palette;

  return {
    summary: `Komposisi ${layout} dengan dua focal point terkendali, hierarki nama yang kuat, dan ornamen ${ornament}${measuredPalette ? "; palet mengikuti blangko" : ""}.`,
    layout,
    palette: measuredPalette ?? palettes[style],
    typography: { heading: copy.heading, body: "Inter" },
    content: {
      eyebrow: copy.eyebrow,
      title: document.design.coupleNames,
      subtitle: copy.subtitle,
      body: `${document.design.eventDate}\n${document.design.venue}`,
    },
    ornament,
  };
}

export interface DesignPanel {
  id: string;
  role: "primary" | "secondary";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GridCell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundUp(value: number) {
  return Math.ceil(value * 100) / 100;
}

function roundDown(value: number) {
  return Math.floor(value * 100) / 100;
}

function insetCell(cell: GridCell, document: InvitationDocument): GridCell {
  const margin = Math.min(
    Math.max(4, document.stock.safeMargin),
    Math.min(cell.width, cell.height) / 5,
  );
  const x = roundUp(cell.x + margin);
  const y = roundUp(cell.y + margin);
  const right = roundDown(cell.x + cell.width - margin);
  const bottom = roundDown(cell.y + cell.height - margin);
  return {
    ...cell,
    x,
    y,
    width: Math.max(2, round(right - x)),
    height: Math.max(2, round(bottom - y)),
  };
}

/** Builds semantic panels from every detected fold axis, not only vertical folds. */
export function getDesignPanelMap(document: InvitationDocument, sideId: SideId): DesignPanel[] {
  const side = getSide(document, sideId);
  const vertical = side.foldLines
    .filter((fold) => fold.axis === "vertical" && fold.positionMm > 0 && fold.positionMm < document.stock.width)
    .map((fold) => fold.positionMm)
    .sort((a, b) => a - b);
  const horizontal = side.foldLines
    .filter((fold) => fold.axis === "horizontal" && fold.positionMm > 0 && fold.positionMm < document.stock.height)
    .map((fold) => fold.positionMm)
    .sort((a, b) => a - b);
  const xs = [0, ...vertical, document.stock.width];
  const ys = [0, ...horizontal, document.stock.height];
  const cells: GridCell[] = [];

  for (let row = 0; row < ys.length - 1; row += 1) {
    for (let column = 0; column < xs.length - 1; column += 1) {
      cells.push({
        id: `panel-${row + 1}-${column + 1}`,
        x: xs[column],
        y: ys[row],
        width: xs[column + 1] - xs[column],
        height: ys[row + 1] - ys[row],
      });
    }
  }

  const ordered = [...cells].sort((a, b) => {
    if (sideId === "outside") {
      const centerDifference = (b.x + b.width / 2) - (a.x + a.width / 2);
      return Math.abs(centerDifference) > 0.01
        ? centerDifference
        : (a.y + a.height / 2) - (b.y + b.height / 2);
    }
    const verticalDifference = (a.y + a.height / 2) - (b.y + b.height / 2);
    return Math.abs(verticalDifference) > 0.01
      ? verticalDifference
      : (a.x + a.width / 2) - (b.x + b.width / 2);
  });
  const primary = insetCell(ordered[0], document);
  const secondary = ordered.slice(1).sort((a, b) =>
    b.width * b.height - a.width * a.height
  )[0];
  return [
    { ...primary, role: "primary" },
    ...(secondary ? [{ ...insetCell(secondary, document), role: "secondary" as const }] : []),
  ];
}

function panelDensity(
  document: InvitationDocument,
  sideId: SideId,
  panel: GridCell,
) {
  const side = getSide(document, sideId);
  const visual = document.assets.find((asset) => asset.id === side.blangkoAssetId)?.analysis?.visual;
  if (!visual) return { average: 0, peak: 0 };
  const values: number[] = [];
  const x0 = clamp(panel.x / document.stock.width, 0, 1);
  const x1 = clamp((panel.x + panel.width) / document.stock.width, 0, 1);
  const y0 = clamp(panel.y / document.stock.height, 0, 1);
  const y1 = clamp((panel.y + panel.height) / document.stock.height, 0, 1);
  for (let row = 0; row < visual.rows; row += 1) {
    const cellY0 = row / visual.rows;
    const cellY1 = (row + 1) / visual.rows;
    if (cellY1 <= y0 || cellY0 >= y1) continue;
    for (let column = 0; column < visual.columns; column += 1) {
      const cellX0 = column / visual.columns;
      const cellX1 = (column + 1) / visual.columns;
      if (cellX1 <= x0 || cellX0 >= x1) continue;
      values.push(visual.density[row * visual.columns + column] ?? 0);
    }
  }
  return {
    average: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    peak: Math.max(0, ...values),
  };
}

function fitPanelToQuietZone(
  document: InvitationDocument,
  sideId: SideId,
  panel: DesignPanel,
): DesignPanel {
  const side = getSide(document, sideId);
  const hasVisual = document.assets.some((asset) => asset.id === side.blangkoAssetId && asset.analysis?.visual);
  if (!hasVisual) return panel;
  let best = panel;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const widthRatio of [1, 0.86, 0.72]) {
    for (const heightRatio of [1, 0.88, 0.76]) {
      for (const xRatio of widthRatio === 1 ? [0] : [0, 0.5, 1]) {
        for (const yRatio of heightRatio === 1 ? [0] : [0, 0.5, 1]) {
          const x = roundUp(panel.x + panel.width * (1 - widthRatio) * xRatio);
          const y = roundUp(panel.y + panel.height * (1 - heightRatio) * yRatio);
          const right = roundDown(panel.x + panel.width * (1 - widthRatio) * xRatio + panel.width * widthRatio);
          const bottom = roundDown(panel.y + panel.height * (1 - heightRatio) * yRatio + panel.height * heightRatio);
          const candidate: DesignPanel = {
            ...panel,
            x,
            y,
            width: Math.max(2, round(right - x)),
            height: Math.max(2, round(bottom - y)),
          };
          const density = panelDensity(document, sideId, candidate);
          const shift = Math.abs(candidate.x + candidate.width / 2 - panel.x - panel.width / 2) / panel.width
            + Math.abs(candidate.y + candidate.height / 2 - panel.y - panel.height / 2) / panel.height;
          const score = density.average + density.peak * 0.12
            + (1 - widthRatio * heightRatio) * 0.35 + shift * 0.018;
          if (score < bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
      }
    }
  }
  return best;
}

/** Fold-safe panels refined by measured whitespace and ornament density. */
export function getDesignCompositionPanelMap(document: InvitationDocument, sideId: SideId): DesignPanel[] {
  return getDesignPanelMap(document, sideId).map((panel) => fitPanelToQuietZone(document, sideId, panel));
}

function node(
  id: string,
  kind: DesignNode["kind"],
  x: number,
  y: number,
  width: number,
  height: number,
  values: Partial<DesignNode>,
): DesignNode {
  return {
    id,
    kind,
    role: "CONTENT",
    box: { x: round(x), y: round(y), width: round(width), height: round(height) },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 2,
    ...values,
  };
}

function text(
  id: string,
  value: string,
  panel: GridCell,
  y: number,
  height: number,
  fontSize: number,
  direction: DesignDirection,
  values: Partial<DesignNode> = {},
): DesignNode {
  return node(id, "text", panel.x, y, panel.width, height, {
    text: value,
    fontSize: round(fontSize),
    fontFamily: direction.typography.body,
    fontWeight: 400,
    textAlign: "center",
    color: direction.palette.primary,
    ...values,
  });
}

function initials(coupleNames: string): string {
  const parts = coupleNames.split(/\s+(?:&|dan)\s+/i).map((part) => part.trim()).filter(Boolean);
  const letters = parts.length >= 2
    ? parts.slice(0, 2).map((part) => part[0])
    : coupleNames.trim().split(/\s+/).slice(0, 2).map((part) => part[0]);
  return letters.filter(Boolean).join(" • ").toUpperCase() || "•";
}

function addMonogram(
  nodes: DesignNode[],
  id: string,
  panel: GridCell,
  y: number,
  size: number,
  document: InvitationDocument,
  direction: DesignDirection,
) {
  const x = panel.x + (panel.width - size) / 2;
  nodes.push(node(`${id}-ring`, "shape", x, y, size, size, {
    shapeType: "ellipse",
    semanticRole: "monogram",
    backgroundColor: direction.palette.paper,
    borderColor: direction.palette.accent,
    borderWidth: 0.45,
    zIndex: 1,
  }));
  nodes.push(node(id, "text", x + 2, y + 2, size - 4, size - 4, {
    text: initials(document.design.coupleNames),
    semanticRole: "monogram",
    fontSize: clamp(size * 0.62, 10, 17),
    fontFamily: direction.typography.heading,
    fontWeight: 400,
    letterSpacing: 0.7,
    textAlign: "center",
    color: direction.palette.accent,
    zIndex: 2,
  }));
}

function addDivider(
  nodes: DesignNode[],
  id: string,
  centerX: number,
  y: number,
  width: number,
  color: string,
) {
  const gap = 3;
  nodes.push(node(`${id}-left`, "shape", centerX - width / 2, y, width / 2 - gap, 0.45, {
    semanticRole: "divider", backgroundColor: color, zIndex: 1,
  }));
  nodes.push(node(`${id}-right`, "shape", centerX + gap, y, width / 2 - gap, 0.45, {
    semanticRole: "divider", backgroundColor: color, zIndex: 1,
  }));
  nodes.push(node(`${id}-dot`, "shape", centerX - 1.25, y - 1, 2.5, 2.5, {
    shapeType: "ellipse", semanticRole: "ornament", backgroundColor: color, zIndex: 2,
  }));
}

function addBotanical(
  nodes: DesignNode[],
  id: string,
  centerX: number,
  y: number,
  color: string,
  scale = 1,
) {
  const stemWidth = 24 * scale;
  for (const direction of [-1, 1]) {
    nodes.push(node(`${id}-stem-${direction}`, "shape",
      centerX + direction * 3 * scale - stemWidth / 2, y, stemWidth, 0.4 * scale, {
        semanticRole: "ornament", backgroundColor: color, rotation: direction * 24, opacity: 0.72, zIndex: 1,
      }));
    for (let index = 0; index < 2; index += 1) {
      nodes.push(node(`${id}-leaf-${direction}-${index}`, "shape",
        centerX + direction * (8 + index * 7) * scale - 2.5 * scale,
        y - 3 * scale + index * 2 * scale, 5 * scale, 2.2 * scale, {
          shapeType: "ellipse",
          semanticRole: "ornament",
          backgroundColor: color,
          rotation: direction * (35 + index * 12),
          opacity: 0.68,
          zIndex: 1,
        }));
    }
  }
}

function buildCoverPanel(
  nodes: DesignNode[],
  document: InvitationDocument,
  panel: DesignPanel,
  direction: DesignDirection,
  hasSecondaryPanel: boolean,
) {
  const { width: w, height: h } = panel;
  const centerX = panel.x + w / 2;
  const align = direction.layout === "asymmetric" ? "left" : "center";
  const bodyFont = clamp(w * 0.072, 9, 12);
  const titleLength = document.design.coupleNames.length;
  const scriptTitle = direction.typography.heading === "Great Vibes";
  const titleFont = clamp(
    w * (scriptTitle ? 0.37 : 0.25) * Math.min(1, 20 / Math.max(20, titleLength)),
    scriptTitle ? 25 : 20,
    scriptTitle ? 52 : 38,
  );
  const detailsHeight = hasSecondaryPanel ? clamp(h * 0.11, 12, 16) : clamp(h * 0.15, 20, 30);
  const detailsY = panel.y + h - detailsHeight;
  const photo = document.assets.find((asset) => asset.kind === "photo");
  const eyebrowY = panel.y + h * 0.10;
  const eyebrowHeight = clamp(h * 0.048, 6, 10);

  nodes.push(text("agent-eyebrow", direction.content.eyebrow, panel, eyebrowY, eyebrowHeight,
    clamp(bodyFont - 0.5, 8, 10.5), direction, {
      semanticRole: "eyebrow",
      fontWeight: 500,
      letterSpacing: 1.7,
      textAlign: align,
      color: direction.palette.primary,
    }));

  if (photo && h > 55) {
    const ringSize = clamp(w * 0.075, 7, 11);
    const ringY = eyebrowY - ringSize - h * 0.025;
    if (ringY >= panel.y - 1) {
      for (const [index, offset] of [-0.28, 0.28].entries()) {
        nodes.push(node(`agent-rings-${index}`, "shape",
          centerX - ringSize / 2 + offset * ringSize, ringY, ringSize, ringSize, {
            shapeType: "ellipse",
            semanticRole: "ornament",
            borderColor: direction.palette.accent,
            borderWidth: 0.45,
            zIndex: 1,
          }));
      }
    }
    const photoHeight = clamp(h * 0.40, 20, 58);
    const photoWidth = Math.min(w * 0.58, photoHeight * 0.82);
    const photoX = direction.layout === "asymmetric"
      ? panel.x + w * 0.08
      : centerX - photoWidth / 2;
    const photoY = panel.y + h * 0.23;
    nodes.push(node("agent-photo-ring", "shape", photoX - 2.5, photoY - 2.5,
      photoWidth + 5, photoHeight + 5, {
        shapeType: "ellipse",
        semanticRole: "frame",
        borderColor: direction.palette.accent,
        borderWidth: 0.35,
        zIndex: 1,
      }));
    nodes.push(node("agent-photo-frame", "shape", photoX - 1.25, photoY - 1.25,
      photoWidth + 2.5, photoHeight + 2.5, {
        shapeType: "ellipse",
        semanticRole: "frame",
        borderColor: direction.palette.accent,
        borderWidth: 0.55,
        zIndex: 1,
      }));
    nodes.push(node("agent-photo", "image", photoX, photoY, photoWidth, photoHeight, {
      assetId: photo.id,
      clipShape: "ellipse",
      semanticRole: "photo",
      zIndex: 2,
    }));
    if (direction.ornament === "botanical") {
      addBotanical(nodes, "agent-cover-botanical", centerX, photoY + photoHeight * 0.96,
        direction.palette.accent, 0.72);
    }
  } else if (h > 75) {
    const monogramSize = clamp(Math.min(w, h) * 0.18, 17, 28);
    addMonogram(nodes, "agent-cover-monogram", panel, panel.y + h * 0.22,
      monogramSize, document, direction);
  }

  const dividerY = panel.y + h * 0.66;
  addDivider(nodes, "agent-divider", centerX, dividerY, Math.min(58, w * 0.52), direction.palette.accent);

  const titleY = panel.y + h * 0.70;
  const titleHeight = Math.min(clamp(h * 0.135, 15, 30), detailsY - titleY - 2);
  nodes.push(text("agent-title", document.design.coupleNames, panel, titleY, titleHeight,
    titleFont, direction, {
      semanticRole: "title",
      fontFamily: direction.typography.heading,
      fontWeight: 400,
      textAlign: align,
      color: direction.palette.primary,
    }));

  const cardWidth = hasSecondaryPanel ? clamp(w * 0.64, 44, 62) : w * 0.92;
  const cardX = direction.layout === "asymmetric" ? panel.x : centerX - cardWidth / 2;
  const filledCard = hasSecondaryPanel;
  nodes.push(node("agent-date-pill", "shape", cardX, detailsY, cardWidth, detailsHeight, {
    shapeType: "rounded-rectangle",
    cornerRadius: filledCard ? 1.8 : direction.layout === "asymmetric" ? 2.5 : 4,
    semanticRole: "card",
    backgroundColor: filledCard ? direction.palette.primary : direction.palette.paper,
    borderColor: direction.palette.accent,
    borderWidth: filledCard ? 0 : 0.35,
    opacity: 0.96,
    zIndex: 1,
  }));
  nodes.push(text("agent-details",
    `${document.design.eventDate}\n${document.design.venue}`,
    { ...panel, x: cardX + 3, width: cardWidth - 6 },
    detailsY + 1.5, detailsHeight - 3, clamp(bodyFont - 0.5, 8, 10), direction, {
      semanticRole: "details",
      fontWeight: 500,
      textAlign: "center",
      color: filledCard ? direction.palette.paper : direction.palette.primary,
      zIndex: 2,
    }));
}

function buildQuotePanel(
  nodes: DesignNode[],
  document: InvitationDocument,
  panel: DesignPanel,
  direction: DesignDirection,
) {
  const { width: w, height: h } = panel;
  const centerX = panel.x + w / 2;
  nodes.push(text("agent-subtitle", direction.content.subtitle,
    { ...panel, x: panel.x + w * 0.08, width: w * 0.84 },
    panel.y + h * 0.20, h * 0.30, clamp(w * 0.092, 10, 15), direction, {
      semanticRole: "quote",
      fontFamily: "Noto Serif",
      fontStyle: "italic",
      letterSpacing: 0.1,
      color: direction.palette.primary,
    }));
  addDivider(nodes, "agent-quote-divider", centerX, panel.y + h * 0.61,
    Math.min(54, w * 0.48), direction.palette.accent);
  nodes.push(text("agent-quote-monogram", initials(document.design.coupleNames),
    panel, panel.y + h * 0.68, clamp(h * 0.13, 12, 24),
    clamp(w * 0.19, 20, 34), direction, {
      semanticRole: "monogram",
      fontFamily: "Noto Serif",
      fontStyle: "italic",
      letterSpacing: 1.2,
      color: direction.palette.accent,
    }));
  if (direction.ornament === "botanical") {
    addBotanical(nodes, "agent-quote-botanical", centerX, panel.y + h * 0.90,
      direction.palette.accent, 0.65);
  }
}

function buildInsidePrimary(
  nodes: DesignNode[],
  document: InvitationDocument,
  panel: DesignPanel,
  direction: DesignDirection,
) {
  const { width: w, height: h } = panel;
  const centerX = panel.x + w / 2;
  const bodyFont = clamp(w * 0.085, 9, 12);
  nodes.push(text("agent-eyebrow", direction.content.eyebrow, panel,
    panel.y + h * 0.04, clamp(h * 0.06, 6, 10), clamp(bodyFont - 1, 8, 10), direction, {
      semanticRole: "eyebrow",
      fontWeight: 600,
      letterSpacing: 1.3,
      color: direction.palette.accent,
    }));
  nodes.push(text("agent-opening", "Dengan hormat", panel,
    panel.y + h * 0.15, clamp(h * 0.14, 15, 28), clamp(w * 0.18, 18, 27), direction, {
      semanticRole: "subtitle",
      fontFamily: direction.typography.heading,
      fontWeight: 400,
    }));
  nodes.push(text("agent-subtitle", direction.content.subtitle,
    { ...panel, x: panel.x + w * 0.06, width: w * 0.88 },
    panel.y + h * 0.33, h * 0.22, bodyFont, direction, {
      semanticRole: "body",
      fontStyle: direction.ornament === "lines" ? "italic" : "normal",
    }));
  addDivider(nodes, "agent-inside-divider", centerX, panel.y + h * 0.61,
    Math.min(48, w * 0.44), direction.palette.accent);
  nodes.push(text("agent-title", document.design.coupleNames, panel,
    panel.y + h * 0.66, h * 0.17,
    clamp(w * 0.24 * Math.min(1, 18 / Math.max(18, document.design.coupleNames.length)), 18, 32),
    direction, {
      semanticRole: "title",
      fontFamily: direction.typography.heading,
      color: direction.palette.accent,
    }));
  if (h > 95) {
    const size = clamp(Math.min(w, h) * 0.11, 13, 21);
    addMonogram(nodes, "agent-inside-monogram", panel, panel.y + h - size - 1,
      size, document, direction);
  }
}

function buildInsideDetails(
  nodes: DesignNode[],
  document: InvitationDocument,
  panel: DesignPanel,
  direction: DesignDirection,
) {
  const { width: w, height: h } = panel;
  const bodyFont = clamp(w * 0.085, 9, 12);
  const centerX = panel.x + w / 2;
  nodes.push(text("agent-details-label", "TANGGAL & LOKASI", panel,
    panel.y + h * 0.07, clamp(h * 0.07, 6, 10), clamp(bodyFont - 1, 8, 10), direction, {
      semanticRole: "label",
      fontWeight: 600,
      letterSpacing: 1.2,
      color: direction.palette.accent,
    }));
  const cardY = panel.y + h * 0.22;
  const cardHeight = h * 0.42;
  const cardInset = w * 0.04;
  nodes.push(node("agent-event-card", "shape", panel.x + cardInset, cardY,
    w - cardInset * 2, cardHeight, {
      shapeType: "rounded-rectangle",
      cornerRadius: direction.layout === "asymmetric" ? 2 : 4,
      semanticRole: "card",
      backgroundColor: direction.palette.paper,
      borderColor: direction.palette.accent,
      borderWidth: 0.35,
      opacity: 0.94,
      zIndex: 1,
    }));
  nodes.push(text("agent-details", `${document.design.eventDate}\n${document.design.venue}`,
    { ...panel, x: panel.x + cardInset + 5, width: w - (cardInset + 5) * 2 },
    cardY + 3, cardHeight - 6, bodyFont + 0.5, direction, {
      semanticRole: "details",
      fontWeight: 600,
      zIndex: 2,
    }));
  addDivider(nodes, "agent-details-divider", centerX, panel.y + h * 0.71,
    Math.min(42, w * 0.40), direction.palette.accent);
  nodes.push(text("agent-closing",
    "Merupakan kehormatan bagi kami apabila Anda berkenan hadir dan memberikan doa restu.",
    { ...panel, x: panel.x + w * 0.06, width: w * 0.88 },
    panel.y + h * 0.76, h * 0.19, bodyFont - 0.5, direction, {
      semanticRole: "body",
      fontStyle: direction.ornament === "lines" ? "italic" : "normal",
    }));
  if (direction.ornament === "botanical" && h > 135) {
    addBotanical(nodes, "agent-details-botanical", centerX, panel.y + h * 0.97,
      direction.palette.accent);
  }
}

export function buildNodesFromDirection(
  document: InvitationDocument,
  sideId: SideId,
  direction: DesignDirection,
): DesignNode[] {
  const panels = getDesignCompositionPanelMap(document, sideId);
  const primary = panels[0];
  const secondary = panels[1];
  const nodes: DesignNode[] = [];

  if (sideId === "outside") {
    buildCoverPanel(nodes, document, primary, direction, Boolean(secondary));
    if (secondary) buildQuotePanel(nodes, document, secondary, direction);
  } else if (secondary) {
    buildInsidePrimary(nodes, document, primary, direction);
    buildInsideDetails(nodes, document, secondary, direction);
  } else {
    const primaryArea: DesignPanel = {
      ...primary,
      height: round(primary.height * 0.58),
    };
    const detailsArea: DesignPanel = {
      ...primary,
      id: "panel-details",
      y: round(primary.y + primary.height * 0.64),
      height: round(primary.height * 0.36),
    };
    buildInsidePrimary(nodes, document, primaryArea, direction);
    buildInsideDetails(nodes, document, detailsArea, direction);
  }

  return nodes;
}

function finalizeProposal(
  document: InvitationDocument,
  proposal: DesignProposal,
): DesignProposal {
  const quality = evaluateProposalQuality(document, proposal);
  const warnings = [...proposal.warnings];
  if (quality.status === "needs-revision") {
    warnings.push("Sebagian gate struktural belum lolos. Tinjau objek dan panel sebelum menerapkan proposal.");
  }
  return { ...proposal, quality, warnings };
}

export function createDeterministicProposal(
  document: InvitationDocument,
  sideId: SideId,
  style: DesignStyle,
  warning?: string,
  prompt = "",
): DesignProposal {
  const direction = deterministicDirection(document, style, prompt, sideId);
  return finalizeProposal(document, {
    id: randomUUID(),
    mode: "deterministic",
    summary: direction.summary,
    sideId,
    style,
    nodes: buildNodesFromDirection(document, sideId, direction),
    baseNodeIds: getSide(document, sideId).nodes.map((node) => node.id),
    warnings: warning ? [warning] : [],
  });
}

export function createAiProposal(
  document: InvitationDocument,
  sideId: SideId,
  style: DesignStyle,
  direction: DesignDirection,
): DesignProposal {
  const fallback = deterministicDirection(document, style, "", sideId);
  const productionNotes = /preflight|size_|\bmm\b|koordinat|lipatan|panel|warna|font|layout|produksi|bleed/i;
  const visualClaims = /melihat gambar|menginspeksi (gambar|visual)|sudah print.?ready|siap cetak final/i;
  const safeDirection: DesignDirection = {
    ...direction,
    summary: visualClaims.test(direction.summary) ? fallback.summary : direction.summary,
    palette: fallback.palette,
    typography: {
      heading: ["Great Vibes", "Noto Serif", "Inter"].includes(direction.typography.heading)
        ? direction.typography.heading
        : fallback.typography.heading,
      body: ["Noto Serif", "Inter"].includes(direction.typography.body)
        ? direction.typography.body
        : fallback.typography.body,
    },
    content: {
      eyebrow: direction.content.eyebrow && !productionNotes.test(direction.content.eyebrow)
        ? direction.content.eyebrow
        : fallback.content.eyebrow,
      title: document.design.coupleNames,
      subtitle: direction.content.subtitle.length <= 180 && !productionNotes.test(direction.content.subtitle)
        ? direction.content.subtitle
        : fallback.content.subtitle,
      body: `${document.design.eventDate}\n${document.design.venue}`,
    },
  };
  return finalizeProposal(document, {
    id: randomUUID(),
    mode: "ai",
    summary: safeDirection.summary,
    sideId,
    style,
    nodes: buildNodesFromDirection(document, sideId, safeDirection),
    baseNodeIds: getSide(document, sideId).nodes.map((node) => node.id),
    warnings: [],
  });
}
