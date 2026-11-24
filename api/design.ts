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
): DesignDirection {
  const copy = {
    modern: {
      eyebrow: "SELEBRASI PERNIKAHAN",
      subtitle: "Satu hari istimewa, satu cerita untuk selamanya.",
      ornament: "none" as const,
      layout: "asymmetric" as const,
      heading: "Arial",
    },
    rustic: {
      eyebrow: "DENGAN HORMAT",
      subtitle: "Bersama keluarga dan sahabat, kami mengundang Anda dalam perayaan kami.",
      ornament: "botanical" as const,
      layout: "center" as const,
      heading: "Georgia",
    },
    classic: {
      eyebrow: "THE WEDDING CELEBRATION",
      subtitle: "Dengan penuh syukur kami mengundang Anda untuk menjadi bagian dari hari bahagia ini.",
      ornament: "lines" as const,
      layout: "editorial" as const,
      heading: "Georgia",
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

  return {
    summary: `Komposisi ${layout} dengan dua focal point terkendali, hierarki nama yang kuat, dan ornamen ${ornament}.`,
    layout,
    palette: palettes[style],
    typography: { heading: copy.heading, body: "Arial" },
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

function insetCell(cell: GridCell, document: InvitationDocument): GridCell {
  const margin = Math.min(
    Math.max(4, document.stock.safeMargin),
    Math.min(cell.width, cell.height) / 5,
  );
  return {
    ...cell,
    x: round(cell.x + margin),
    y: round(cell.y + margin),
    width: round(Math.max(2, cell.width - margin * 2)),
    height: round(Math.max(2, cell.height - margin * 2)),
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
) {
  for (const direction of [-1, 1]) {
    nodes.push(node(`${id}-stem-${direction}`, "shape", centerX + direction * 3 - 12, y, 24, 0.4, {
      semanticRole: "ornament", backgroundColor: color, rotation: direction * 24, opacity: 0.8, zIndex: 1,
    }));
    for (let index = 0; index < 2; index += 1) {
      nodes.push(node(`${id}-leaf-${direction}-${index}`, "shape",
        centerX + direction * (8 + index * 7) - 2.5, y - 3 + index * 2, 5, 2.2, {
          shapeType: "ellipse",
          semanticRole: "ornament",
          backgroundColor: color,
          rotation: direction * (35 + index * 12),
          opacity: 0.72,
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
  const bodyFont = clamp(w * 0.085, 9, 12);
  const titleLength = document.design.coupleNames.length;
  const titleFont = clamp(
    w * 0.28 * Math.min(1, 18 / Math.max(18, titleLength)),
    18,
    38,
  );
  const detailsHeight = clamp(h * 0.18, 20, 36);
  const detailsY = panel.y + h - detailsHeight;
  const photo = document.assets.find((asset) => asset.kind === "photo");
  let cursor = panel.y;

  if (photo) {
    const photoHeight = clamp(h * 0.28, 20, 58);
    const photoWidth = Math.min(w * 0.62, photoHeight * 0.80);
    const photoX = direction.layout === "asymmetric"
      ? panel.x + w * 0.06
      : centerX - photoWidth / 2;
    nodes.push(node("agent-photo-frame", "shape", photoX - 1.4, cursor,
      photoWidth + 2.8, photoHeight + 2.8, {
        shapeType: "ellipse",
        semanticRole: "frame",
        backgroundColor: direction.palette.paper,
        borderColor: direction.palette.accent,
        borderWidth: 0.5,
        zIndex: 1,
      }));
    nodes.push(node("agent-photo", "image", photoX, cursor + 1.4, photoWidth, photoHeight, {
      assetId: photo.id,
      clipShape: "ellipse",
      semanticRole: "photo",
      zIndex: 2,
    }));
    if (direction.ornament === "botanical" && h > 100) {
      addBotanical(nodes, "agent-cover-botanical", centerX, cursor + photoHeight * 0.72,
        direction.palette.accent);
    }
    cursor += photoHeight + 2.8 + h * 0.055;
  } else if (h > 100) {
    const monogramSize = clamp(Math.min(w, h) * 0.15, 17, 26);
    addMonogram(nodes, "agent-cover-monogram", panel, cursor, monogramSize, document, direction);
    cursor += monogramSize + h * 0.05;
  } else {
    cursor += h * 0.04;
  }

  const eyebrowHeight = clamp(h * 0.045, 6, 10);
  nodes.push(text("agent-eyebrow", direction.content.eyebrow, panel, cursor, eyebrowHeight,
    clamp(bodyFont - 1, 8, 10), direction, {
      semanticRole: "eyebrow",
      fontWeight: 600,
      letterSpacing: 1.4,
      textAlign: align,
      color: direction.palette.accent,
    }));

  const titleY = cursor + eyebrowHeight + h * 0.025;
  const titleHeight = Math.max(12, Math.min(clamp(h * 0.16, 17, 34), detailsY - titleY - 10));
  nodes.push(text("agent-title", document.design.coupleNames, panel, titleY, titleHeight,
    titleFont, direction, {
      semanticRole: "title",
      fontFamily: direction.typography.heading,
      fontWeight: direction.layout === "asymmetric" ? 600 : 400,
      textAlign: align,
      color: direction.palette.primary,
    }));

  const dividerY = Math.min(titleY + titleHeight + 4, detailsY - 6);
  addDivider(nodes, "agent-divider", centerX, dividerY, Math.min(52, w * 0.46), direction.palette.accent);

  if (!hasSecondaryPanel && detailsY - dividerY > 22) {
    nodes.push(text("agent-subtitle", direction.content.subtitle, panel, dividerY + 5,
      Math.min(20, detailsY - dividerY - 7), bodyFont - 0.5, direction, {
        semanticRole: "subtitle",
        fontStyle: direction.ornament === "lines" ? "italic" : "normal",
        textAlign: align,
      }));
  }

  const cardInset = w * 0.04;
  nodes.push(node("agent-date-pill", "shape", panel.x + cardInset, detailsY,
    w - cardInset * 2, detailsHeight, {
      shapeType: "rounded-rectangle",
      cornerRadius: direction.layout === "asymmetric" ? 2.5 : detailsHeight / 2,
      semanticRole: "card",
      backgroundColor: direction.palette.paper,
      borderColor: direction.palette.accent,
      borderWidth: direction.ornament === "lines" ? 0.35 : 0,
      opacity: 0.94,
      zIndex: 1,
    }));
  nodes.push(text("agent-details", `${document.design.eventDate}\n${document.design.venue}`,
    { ...panel, x: panel.x + cardInset + 4, width: w - (cardInset + 4) * 2 },
    detailsY + 2, detailsHeight - 4, bodyFont, direction, {
      semanticRole: "details",
      fontWeight: 600,
      textAlign: align,
      color: direction.palette.primary,
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
  const monogramSize = clamp(Math.min(w, h) * 0.18, 17, 32);
  addMonogram(nodes, "agent-quote-monogram", panel, panel.y + h * 0.12,
    monogramSize, document, direction);
  addDivider(nodes, "agent-quote-divider", centerX, panel.y + h * 0.40,
    Math.min(48, w * 0.42), direction.palette.accent);
  nodes.push(text("agent-subtitle", direction.content.subtitle,
    { ...panel, x: panel.x + w * 0.08, width: w * 0.84 },
    panel.y + h * 0.45, h * 0.28, clamp(w * 0.10, 9.5, 14), direction, {
      semanticRole: "quote",
      fontFamily: direction.typography.heading,
      fontStyle: "italic",
      letterSpacing: 0.15,
      color: direction.palette.primary,
    }));
  if (direction.ornament === "botanical" && h > 85) {
    addBotanical(nodes, "agent-quote-botanical", centerX, panel.y + h * 0.83,
      direction.palette.accent);
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
  const panels = getDesignPanelMap(document, sideId);
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
  const direction = deterministicDirection(document, style, prompt);
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
  const fallback = deterministicDirection(document, style);
  const productionNotes = /preflight|size_|\bmm\b|koordinat|lipatan|panel|warna|font|layout|produksi|bleed/i;
  const visualClaims = /melihat gambar|menginspeksi (gambar|visual)|sudah print.?ready|siap cetak final/i;
  const safeDirection: DesignDirection = {
    ...direction,
    summary: visualClaims.test(direction.summary) ? fallback.summary : direction.summary,
    typography: {
      heading: ["Georgia", "Arial"].includes(direction.typography.heading)
        ? direction.typography.heading
        : fallback.typography.heading,
      body: ["Georgia", "Arial"].includes(direction.typography.body)
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
