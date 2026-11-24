import { z } from "zod";

export const sideIdSchema = z.enum(["outside", "inside"]);
export const designStyleSchema = z.enum(["modern", "rustic", "classic"]);

export const boxSchema = z.object({
  x: z.number().min(-1000),
  y: z.number().min(-1000),
  width: z.number().positive().max(2000),
  height: z.number().positive().max(2000),
});

export const designNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["text", "image", "shape"]),
  role: z.literal("CONTENT").default("CONTENT"),
  box: boxSchema,
  rotation: z.number().min(-360).max(360).default(0),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  zIndex: z.number().int().min(0).max(1000).default(1),
  text: z.string().max(5000).optional(),
  fontSize: z.number().min(4).max(240).optional(),
  fontFamily: z.string().max(120).optional(),
  fontWeight: z.number().int().min(300).max(900).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  letterSpacing: z.number().min(-5).max(20).optional(),
  color: z.string().max(32).optional(),
  backgroundColor: z.string().max(32).optional(),
  borderColor: z.string().max(32).optional(),
  borderWidth: z.number().min(0).max(30).optional(),
  shapeType: z.enum(["rectangle", "ellipse", "rounded-rectangle"]).optional(),
  clipShape: z.enum(["rectangle", "ellipse", "rounded-rectangle"]).optional(),
  cornerRadius: z.number().min(0).max(500).optional(),
  semanticRole: z.enum([
    "photo", "frame", "eyebrow", "title", "subtitle", "body", "details",
    "date", "venue", "quote", "monogram", "divider", "ornament", "card", "label",
  ]).optional(),
  assetId: z.string().optional(),
});

export const blangkoAnalysisSchema = z.object({
  widthMm: z.number().min(20).max(2000),
  heightMm: z.number().min(20).max(2000),
  sizeSource: z.enum(["metadata-dpi", "standard-aspect", "aspect-preserved"]),
  dpi: z.number().positive().max(2400).optional(),
  confidence: z.number().min(0).max(1),
  folds: z.array(z.object({
    axis: z.enum(["vertical", "horizontal"]),
    positionRatio: z.number().min(0.05).max(0.95),
    confidence: z.number().min(0).max(1),
    source: z.enum(["edge-projection", "layout-heuristic"]),
  })).max(4),
  warnings: z.array(z.string().max(240)).max(8),
});

export type BlangkoAnalysis = z.infer<typeof blangkoAnalysisSchema>;

export const projectAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  kind: z.enum(["blangko", "photo", "ornament", "map"]),
  source: z.enum(["builtin", "storage"]),
  builtinId: z.string().optional(),
  storageKey: z.string().optional(),
  contentType: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  analysis: blangkoAnalysisSchema.optional(),
});

export const foldLineSchema = z.object({
  id: z.string().min(1),
  axis: z.enum(["vertical", "horizontal"]),
  positionMm: z.number().nonnegative(),
  kind: z.enum(["fold", "score", "cut"]).default("fold"),
});

export const invitationSideSchema = z.object({
  id: sideIdSchema,
  label: z.string().min(1),
  blangkoAssetId: z.string().optional(),
  foldLines: z.array(foldLineSchema).max(12),
  nodes: z.array(designNodeSchema).max(500),
});

export const invitationDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1).max(160),
  stock: z.object({
    width: z.number().min(20).max(2000),
    height: z.number().min(20).max(2000),
    bleed: z.number().min(0).max(30),
    safeMargin: z.number().min(0).max(50),
    targetPpi: z.union([z.literal(300), z.literal(600)]),
    physicalSizeConfirmed: z.boolean(),
  }),
  design: z.object({
    style: designStyleSchema,
    coupleNames: z.string().max(180),
    eventDate: z.string().max(180),
    venue: z.string().max(240),
  }),
  assets: z.array(projectAssetSchema).max(200),
  sides: z.array(invitationSideSchema).length(2),
});

export type SideId = z.infer<typeof sideIdSchema>;
export type DesignStyle = z.infer<typeof designStyleSchema>;
export type DesignNode = z.infer<typeof designNodeSchema>;
export type InvitationSide = z.infer<typeof invitationSideSchema>;
export type ProjectAsset = z.infer<typeof projectAssetSchema>;
export type InvitationDocument = z.infer<typeof invitationDocumentSchema>;

export const designDirectionSchema = z.object({
  summary: z.string().min(8).max(300),
  layout: z.enum(["center", "asymmetric", "editorial"]),
  palette: z.object({
    paper: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  typography: z.object({
    heading: z.string().min(2).max(80),
    body: z.string().min(2).max(80),
  }),
  content: z.object({
    eyebrow: z.string().max(100),
    title: z.string().max(180),
    subtitle: z.string().max(240),
    body: z.string().max(1000),
  }),
  ornament: z.enum(["lines", "botanical", "none"]),
});

export type DesignDirection = z.infer<typeof designDirectionSchema>;

export const proposalQualitySchema = z.object({
  score: z.number().min(0).max(100),
  status: z.enum(["needs-revision", "needs-visual-review", "approved-for-preview"]),
  productionStatus: z.enum(["not-print-ready", "print-ready"]),
  visualReviewRequired: z.boolean(),
  categories: z.array(z.object({
    id: z.string(),
    label: z.string(),
    score: z.number().min(0),
    maxScore: z.number().positive(),
  })).length(5),
  hardGates: z.array(z.object({
    id: z.string(),
    label: z.string(),
    passed: z.boolean(),
  })).min(1),
  notes: z.array(z.string()).max(8),
});

export const designProposalSchema = z.object({
  id: z.string(),
  mode: z.enum(["ai", "deterministic"]),
  summary: z.string(),
  sideId: sideIdSchema,
  style: designStyleSchema,
  nodes: z.array(designNodeSchema),
  baseNodeIds: z.array(z.string()).optional(),
  quality: proposalQualitySchema.optional(),
  warnings: z.array(z.string()),
});

export type ProposalQuality = z.infer<typeof proposalQualitySchema>;
export type DesignProposal = z.infer<typeof designProposalSchema>;

export interface PreflightIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
}

export function getSide(document: InvitationDocument, sideId: SideId): InvitationSide {
  const side = document.sides.find((item) => item.id === sideId);
  if (!side) throw new Error(`Sisi ${sideId} tidak ditemukan`);
  return side;
}

export function applyDesignProposal(
  document: InvitationDocument,
  proposal: DesignProposal,
): InvitationDocument {
  return {
    ...document,
    design: { ...document.design, style: proposal.style },
    sides: document.sides.map((side) => {
      if (side.id !== proposal.sideId) return side;
      const proposalNodeIds = new Set(proposal.nodes.map((node) => node.id));
      const replacedNodeIds = new Set(proposal.baseNodeIds ?? side.nodes.map((node) => node.id));
      const retainedNodes = side.nodes.filter((node) =>
        !replacedNodeIds.has(node.id) && !proposalNodeIds.has(node.id)
      );
      return { ...side, nodes: [...retainedNodes, ...proposal.nodes] };
    }),
  };
}

export function runPreflight(document: InvitationDocument, sideId: SideId): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const side = getSide(document, sideId);
  const { width, height, safeMargin, physicalSizeConfirmed } = document.stock;

  if (!physicalSizeConfirmed) {
    issues.push({
      code: "SIZE_UNCONFIRMED",
      severity: "error",
      message: "Konfirmasikan ukuran fisik blangko sebelum mencetak.",
    });
  }

  for (const fold of side.foldLines) {
    const limit = fold.axis === "vertical" ? width : height;
    if (fold.positionMm <= 0 || fold.positionMm >= limit) {
      issues.push({
        code: "FOLD_OUTSIDE",
        severity: "error",
        message: `Garis ${fold.kind} berada di luar bidang kertas.`,
      });
    }
  }

  for (const node of side.nodes) {
    if (!node.visible) continue;
    const { x, y, width: nodeWidth, height: nodeHeight } = node.box;
    if (x < 0 || y < 0 || x + nodeWidth > width || y + nodeHeight > height) {
      issues.push({
        code: "NODE_OUTSIDE",
        severity: "error",
        message: `Objek ${node.text || node.id} melewati batas kertas.`,
        nodeId: node.id,
      });
    }
    if (
      x < safeMargin ||
      y < safeMargin ||
      x + nodeWidth > width - safeMargin ||
      y + nodeHeight > height - safeMargin
    ) {
      issues.push({
        code: "SAFE_MARGIN",
        severity: "warning",
        message: `Objek ${node.text || node.id} berada di dalam margin aman ${safeMargin} mm.`,
        nodeId: node.id,
      });
    }
    for (const fold of side.foldLines) {
      const distance = fold.axis === "vertical"
        ? Math.min(Math.abs(x - fold.positionMm), Math.abs(x + nodeWidth - fold.positionMm))
        : Math.min(Math.abs(y - fold.positionMm), Math.abs(y + nodeHeight - fold.positionMm));
      const crosses = fold.axis === "vertical"
        ? x < fold.positionMm && x + nodeWidth > fold.positionMm
        : y < fold.positionMm && y + nodeHeight > fold.positionMm;
      if (crosses || distance < 3) {
        issues.push({
          code: "FOLD_CLEARANCE",
          severity: "warning",
          message: `Objek ${node.text || node.id} terlalu dekat atau melintasi garis lipat.`,
          nodeId: node.id,
        });
      }
    }
    if (node.kind === "image" && (!node.assetId || !document.assets.some((asset) => asset.id === node.assetId))) {
      issues.push({
        code: "IMAGE_MISSING",
        severity: "error",
        message: `Aset gambar untuk objek ${node.id} tidak ditemukan.`,
        nodeId: node.id,
      });
    }
    if (node.kind === "text" && (node.fontSize || 12) < 8) {
      issues.push({
        code: "TEXT_TOO_SMALL",
        severity: "warning",
        message: `Teks ${node.text || node.id} berukuran kurang dari 8 pt.`,
        nodeId: node.id,
      });
    }
  }

  return issues;
}

function textNode(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  options: Partial<DesignNode> = {},
): DesignNode {
  return {
    id,
    kind: "text",
    role: "CONTENT",
    box: { x, y, width, height },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    zIndex: 2,
    text,
    fontSize,
    fontFamily: "Georgia",
    fontWeight: 400,
    textAlign: "center",
    color,
    ...options,
  };
}

export function createInitialDocument(): InvitationDocument {
  const assets: ProjectAsset[] = [
    { id: "builtin-outside", name: "Blangko botanical luar", kind: "blangko", source: "builtin", builtinId: "botanical-outside", width: 1403, height: 992 },
    { id: "builtin-inside", name: "Blangko botanical dalam", kind: "blangko", source: "builtin", builtinId: "botanical-inside", width: 1403, height: 992 },
  ];
  return {
    schemaVersion: 1,
    title: "Undangan Alya & Rama",
    stock: { width: 297, height: 210, bleed: 3, safeMargin: 8, targetPpi: 300, physicalSizeConfirmed: false },
    design: { style: "rustic", coupleNames: "Alya & Rama", eventDate: "Sabtu, 18 April 2027", venue: "Pendopo Agung • Yogyakarta" },
    assets,
    sides: [
      {
        id: "outside",
        label: "Luar",
        blangkoAssetId: "builtin-outside",
        foldLines: [{ id: "fold-outside", axis: "vertical", positionMm: 148.5, kind: "fold" }],
        nodes: [
          textNode("outside-eyebrow", "THE WEDDING OF", 161, 49, 120, 9, 10, "#6E7254", { fontFamily: "Arial" }),
          textNode("outside-names", "Alya & Rama", 157, 72, 128, 27, 34, "#51483C", { fontWeight: 400 }),
          textNode("outside-date", "18 . 04 . 2027", 168, 108, 106, 10, 12, "#6E7254", { fontFamily: "Arial" }),
          { id: "outside-rule", kind: "shape", role: "CONTENT", box: { x: 199, y: 126, width: 44, height: 0.5 }, rotation: 0, visible: true, locked: false, opacity: 1, zIndex: 1, backgroundColor: "#9A6B4F" },
        ],
      },
      {
        id: "inside",
        label: "Dalam",
        blangkoAssetId: "builtin-inside",
        foldLines: [{ id: "fold-inside", axis: "vertical", positionMm: 148.5, kind: "fold" }],
        nodes: [
          textNode("inside-title", "Dengan hormat", 19, 30, 110, 14, 22, "#51483C"),
          textNode("inside-body", "Dengan memohon rahmat dan ridha Tuhan Yang Maha Esa, kami bermaksud menyelenggarakan pernikahan putra-putri kami.", 19, 52, 110, 38, 12, "#5E584F", { fontFamily: "Arial", textAlign: "left" }),
          textNode("inside-names", "Alya & Rama", 19, 99, 110, 20, 28, "#6E7254"),
          textNode("inside-details", "Sabtu, 18 April 2027\nPukul 09.00 WIB\nPendopo Agung • Yogyakarta", 19, 128, 110, 36, 12, "#51483C", { fontFamily: "Arial", textAlign: "left" }),
        ],
      },
    ],
  };
}
