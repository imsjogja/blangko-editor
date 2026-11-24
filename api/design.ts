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

const palettes: Record<DesignStyle, DesignDirection["palette"]> = {
  modern: { paper: "#F2F2F0", primary: "#202522", accent: "#C45C26" },
  rustic: { paper: "#F4EBDD", primary: "#51483C", accent: "#6E7254" },
  classic: { paper: "#F3EFE7", primary: "#342E2A", accent: "#8A6A3D" },
};

export function deterministicDirection(document: InvitationDocument, style: DesignStyle): DesignDirection {
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

  return {
    summary: `Layout ${copy.layout} dengan hierarki nama yang kuat, ruang napas cukup, dan ornamen ${copy.ornament}.`,
    layout: copy.layout,
    palette: palettes[style],
    typography: { heading: copy.heading, body: "Arial" },
    content: {
      eyebrow: copy.eyebrow,
      title: document.design.coupleNames,
      subtitle: copy.subtitle,
      body: `${document.design.eventDate}\n${document.design.venue}`,
    },
    ornament: copy.ornament,
  };
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
    box: { x, y, width, height },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 2,
    ...values,
  };
}

export function buildNodesFromDirection(
  document: InvitationDocument,
  sideId: SideId,
  direction: DesignDirection,
): DesignNode[] {
  const side = getSide(document, sideId);
  const verticalFold = side.foldLines.find((fold) => fold.axis === "vertical");
  const useRightPanel = sideId === "outside" && verticalFold;
  const panelX = useRightPanel ? verticalFold.positionMm + 10 : 14;
  const panelWidth = useRightPanel
    ? document.stock.width - verticalFold.positionMm - 24
    : verticalFold
      ? verticalFold.positionMm - 28
      : document.stock.width - 28;
  const centerX = panelX + panelWidth / 2;
  const align = direction.layout === "asymmetric" ? "left" : "center";
  const titleWidth = direction.layout === "editorial" ? panelWidth * 0.86 : panelWidth;
  const titleX = direction.layout === "editorial" ? panelX : centerX - titleWidth / 2;
  const titleSize = direction.layout === "editorial" ? 31 : direction.layout === "asymmetric" ? 30 : 35;
  const nodes: DesignNode[] = [];
  const photo = document.assets.find((asset) => asset.kind === "photo" && asset.source === "storage");

  if (photo) {
    nodes.push(node("agent-photo", "image", panelX, 18, panelWidth, 52, {
      assetId: photo.id,
      zIndex: 1,
    }));
  }

  const startY = photo ? 78 : 34;
  nodes.push(node("agent-eyebrow", "text", panelX, startY, panelWidth, 9, {
    text: direction.content.eyebrow,
    fontSize: 9,
    fontFamily: direction.typography.body,
    fontWeight: 600,
    textAlign: align,
    color: direction.palette.accent,
  }));
  nodes.push(node("agent-title", "text", titleX, startY + 15, titleWidth, 34, {
    text: direction.content.title,
    fontSize: titleSize,
    fontFamily: direction.typography.heading,
    fontWeight: 400,
    textAlign: align,
    color: direction.palette.primary,
  }));
  nodes.push(node("agent-subtitle", "text", panelX + 4, startY + (photo ? 52 : 55), panelWidth - 8, photo ? 20 : 24, {
    text: direction.content.subtitle,
    fontSize: 11,
    fontFamily: direction.typography.body,
    fontWeight: 400,
    textAlign: align,
    color: direction.palette.primary,
  }));
  nodes.push(node("agent-details", "text", panelX + 4, startY + (photo ? 78 : 91), panelWidth - 8, photo ? 30 : 34, {
    text: direction.content.body,
    fontSize: 12,
    fontFamily: direction.typography.body,
    fontWeight: 600,
    textAlign: align,
    color: direction.palette.primary,
  }));

  if (direction.ornament !== "none") {
    nodes.push(node("agent-ornament", "shape", centerX - 22, startY + (photo ? 118 : 136), 44, 0.6, {
      backgroundColor: direction.palette.accent,
      zIndex: 1,
    }));
  }

  return nodes;
}

export function createDeterministicProposal(
  document: InvitationDocument,
  sideId: SideId,
  style: DesignStyle,
  warning?: string,
): DesignProposal {
  const direction = deterministicDirection(document, style);
  return {
    id: randomUUID(),
    mode: "deterministic",
    summary: direction.summary,
    sideId,
    style,
    nodes: buildNodesFromDirection(document, sideId, direction),
    warnings: warning ? [warning] : [],
  };
}

export function createAiProposal(
  document: InvitationDocument,
  sideId: SideId,
  style: DesignStyle,
  direction: DesignDirection,
): DesignProposal {
  const fallback = deterministicDirection(document, style);
  const productionNotes = /preflight|size_|\bmm\b|koordinat|lipatan|panel|warna|font|layout|produksi|bleed/i;
  const safeDirection: DesignDirection = {
    ...direction,
    typography: {
      heading: ["Georgia", "Arial"].includes(direction.typography.heading)
        ? direction.typography.heading
        : fallback.typography.heading,
      body: ["Georgia", "Arial"].includes(direction.typography.body)
        ? direction.typography.body
        : fallback.typography.body,
    },
    content: {
      eyebrow: direction.content.eyebrow || fallback.content.eyebrow,
      title: document.design.coupleNames,
      subtitle: direction.content.subtitle.length <= 180 && !productionNotes.test(direction.content.subtitle)
        ? direction.content.subtitle
        : fallback.content.subtitle,
      body: `${document.design.eventDate}\n${document.design.venue}`,
    },
  };
  return {
    id: randomUUID(),
    mode: "ai",
    summary: direction.summary,
    sideId,
    style,
    nodes: buildNodesFromDirection(document, sideId, safeDirection),
    warnings: [],
  };
}
