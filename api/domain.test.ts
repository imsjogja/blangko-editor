import { describe, expect, it } from "vitest";
import {
  applyDesignProposal,
  createInitialDocument,
  invitationDocumentSchema,
  runPreflight,
  type InvitationDocument,
} from "@contracts/invitation";
import { compilePhotoCraftBatch } from "@contracts/photocraft";
import {
  createAiProposal,
  createDeterministicProposal,
  deterministicDirection,
  getDesignCompositionPanelMap,
  getDesignPanelMap,
} from "./design";

function confirmedDocument(): InvitationDocument {
  const document = createInitialDocument();
  document.stock.physicalSizeConfirmed = true;
  return document;
}

describe("invitation domain", () => {
  it("creates a valid two-sided physical document", () => {
    const document = createInitialDocument();
    expect(invitationDocumentSchema.parse(document)).toMatchObject({
      schemaVersion: 1,
      stock: { width: 297, height: 210, targetPpi: 300 },
    });
    expect(document.sides.map((side) => side.id)).toEqual(["outside", "inside"]);
    expect(runPreflight(document, "outside").some((issue) => issue.code === "SIZE_UNCONFIRMED")).toBe(true);
  });

  it("blocks objects outside the paper and accepts the calibrated initial layout", () => {
    const document = confirmedDocument();
    expect(runPreflight(document, "outside").filter((issue) => issue.severity === "error")).toEqual([]);
    document.sides[0].nodes[0].box.x = -2;
    expect(runPreflight(document, "outside").some((issue) => issue.code === "NODE_OUTSIDE")).toBe(true);
  });

  it("keeps blangko and guides out of the content-only PhotoCraft projection", () => {
    const document = confirmedDocument();
    const content = compilePhotoCraftBatch(document, "outside", "content-only");
    const composite = compilePhotoCraftBatch(document, "outside", "composite");
    expect(content.some((command) => command.params.groupId === "__BLANGKO__")).toBe(false);
    expect(content.some((command) => command.command === "guide.fold")).toBe(false);
    expect(content.every((command) => command.params.printable !== false)).toBe(true);
    expect(composite.some((command) => command.params.groupId === "__BLANGKO__")).toBe(true);
    expect(composite.some((command) => command.command === "guide.fold")).toBe(true);
    expect(content.at(-1)?.command).toBe("document.commit");
  });
});

describe("design proposals", () => {
  it("preserves factual content and removes production notes from AI copy", () => {
    const document = confirmedDocument();
    document.assets.push({
      id: "photo-test",
      name: "photo.png",
      kind: "photo",
      source: "storage",
      storageKey: "projects/test/photo.png",
      contentType: "image/png",
      width: 640,
      height: 420,
    });
    const direction = deterministicDirection(document, "rustic");
    direction.content.title = "Nama karangan model";
    direction.content.subtitle = "Preflight panel 297 mm, warna dan catatan produksi";
    direction.content.body = "Tanggal dan venue karangan model";
    direction.typography.heading = "Font Tidak Tersedia";

    const proposal = createAiProposal(document, "outside", "rustic", direction);
    const candidate = {
      ...document,
      sides: document.sides.map((side) => side.id === "outside" ? { ...side, nodes: proposal.nodes } : side),
    };
    const details = proposal.nodes.find((node) => node.id === "agent-details");
    const subtitle = proposal.nodes.find((node) => node.id === "agent-subtitle");
    const title = proposal.nodes.find((node) => node.id === "agent-title");

    expect(details?.text).toBe(`${document.design.eventDate}\n${document.design.venue}`);
    expect(title?.text).toBe(document.design.coupleNames);
    expect(subtitle?.text).not.toMatch(/preflight|produksi|\bmm\b/i);
    expect(title?.fontFamily).toBe("Great Vibes");
    expect(runPreflight(candidate, "outside").filter((issue) => issue.severity === "error")).toEqual([]);
    expect(proposal.nodes.every((node) => node.box.y + node.box.height <= document.stock.height)).toBe(true);
  });

  it("builds deterministic proposals without requiring an AI credential", () => {
    const document = confirmedDocument();
    const proposal = createDeterministicProposal(document, "inside", "modern");
    expect(proposal.mode).toBe("deterministic");
    expect(proposal.nodes.length).toBeGreaterThanOrEqual(4);
    expect(proposal.nodes.find((node) => node.id === "agent-title")?.text).toBe(document.design.coupleNames);
    expect(proposal.quality?.hardGates.every((gate) => gate.passed)).toBe(true);
  });

  it("compiles distinct safe panels for horizontal folds on both sides", () => {
    const document = confirmedDocument();
    document.stock.width = 120;
    document.stock.height = 200;
    document.stock.safeMargin = 6;
    document.sides = document.sides.map((side) => ({
      ...side,
      foldLines: [{ id: `horizontal-${side.id}`, axis: "horizontal", positionMm: side.id === "outside" ? 118 : 72, kind: "fold" }],
      nodes: [],
    }));

    for (const sideId of ["outside", "inside"] as const) {
      const panels = getDesignPanelMap(document, sideId);
      const proposal = createDeterministicProposal(document, sideId, "rustic");
      const candidate = applyDesignProposal(document, proposal);
      const geometryIssues = runPreflight(candidate, sideId).filter((issue) =>
        ["NODE_OUTSIDE", "FOLD_CLEARANCE", "SAFE_MARGIN"].includes(issue.code)
      );
      expect(panels.map((panel) => panel.role)).toEqual(["primary", "secondary"]);
      expect(panels[0].y).toBeGreaterThan(0);
      expect(panels[1].y).toBeGreaterThan(panels[0].y + panels[0].height);
      expect(geometryIssues).toEqual([]);
      expect(proposal.quality?.hardGates.find((gate) => gate.id === "SAFE-PANELS")?.passed).toBe(true);
    }
  });

  it("keeps fractional-millimetre BL01 panels inward and gives event details enough room", () => {
    const document = confirmedDocument();
    document.stock.width = 90.375;
    document.stock.height = 200;
    document.stock.safeMargin = 5;
    document.design.venue = "Pendopo Agung • Yogyakarta";
    document.assets.push({
      id: "photo-bl01",
      name: "cover.png",
      kind: "photo",
      source: "storage",
      storageKey: "projects/test/bl01-cover.png",
      contentType: "image/png",
      width: 600,
      height: 800,
    });
    document.sides = document.sides.map((side) => ({
      ...side,
      foldLines: [{ id: `fold-${side.id}`, axis: "horizontal", positionMm: 116.25, kind: "fold" }],
      nodes: [],
    }));

    const panels = getDesignPanelMap(document, "outside");
    for (const panel of panels) {
      expect(panel.x).toBeGreaterThanOrEqual(document.stock.safeMargin);
      expect(panel.x + panel.width).toBeLessThanOrEqual(document.stock.width - document.stock.safeMargin);
    }
    const proposal = createDeterministicProposal(document, "outside", "rustic");
    const candidate = applyDesignProposal(document, proposal);
    const details = proposal.nodes.find((node) => node.id === "agent-details");
    const pill = proposal.nodes.find((node) => node.id === "agent-date-pill");

    expect(runPreflight(candidate, "outside").filter((issue) =>
      ["NODE_OUTSIDE", "FOLD_CLEARANCE", "SAFE_MARGIN"].includes(issue.code)
    )).toEqual([]);
    expect(proposal.quality?.hardGates.every((gate) => gate.passed)).toBe(true);
    expect(pill?.box.height).toBeGreaterThanOrEqual(12);
    expect(details?.box.width).toBeGreaterThanOrEqual(38);
    expect(details?.fontSize).toBeGreaterThanOrEqual(8);
  });

  it("moves composition toward measured quiet space and reuses the blangko palette", () => {
    const document = confirmedDocument();
    document.sides[0].foldLines = [];
    const columns = 18;
    const rows = 32;
    const density = Array.from({ length: columns * rows }, (_, index) =>
      index % columns < columns / 2 ? 0.85 : 0.015
    );
    const palette = { paper: "#F4EFDF", primary: "#34382C", accent: "#687044" };
    document.assets[0].analysis = {
      widthMm: document.stock.width,
      heightMm: document.stock.height,
      sizeSource: "aspect-preserved",
      confidence: 0.8,
      folds: [],
      warnings: [],
      visual: { columns, rows, density, palette },
    };

    const raw = getDesignPanelMap(document, "outside")[0];
    const quiet = getDesignCompositionPanelMap(document, "outside")[0];
    const direction = deterministicDirection(document, "rustic");
    expect(quiet.x).toBeGreaterThan(raw.x + raw.width * 0.1);
    expect(quiet.width).toBeLessThan(raw.width);
    expect(direction.palette).toEqual(palette);
  });

  it("builds a rich editable cover with an oval photo and honest structural QA", () => {
    const document = confirmedDocument();
    document.assets.push({
      id: "photo-cover",
      name: "cover.png",
      kind: "photo",
      source: "storage",
      storageKey: "projects/test/cover.png",
      contentType: "image/png",
      width: 800,
      height: 1000,
    });
    const proposal = createDeterministicProposal(document, "outside", "rustic");

    expect(proposal.nodes.length).toBeGreaterThanOrEqual(18);
    expect(proposal.nodes.find((node) => node.id === "agent-photo")?.clipShape).toBe("ellipse");
    expect(proposal.nodes.find((node) => node.id === "agent-photo-frame")?.shapeType).toBe("ellipse");
    expect(proposal.nodes.find((node) => node.id === "agent-date-pill")?.shapeType).toBe("rounded-rectangle");
    expect(proposal.nodes.filter((node) => node.kind === "text").every((node) => Boolean(node.text?.trim()))).toBe(true);
    expect(proposal.quality?.score).toBeGreaterThanOrEqual(85);
    expect(proposal.quality?.status).toBe("needs-visual-review");
    expect(proposal.quality?.productionStatus).toBe("not-print-ready");
    expect(proposal.quality?.visualReviewRequired).toBe(true);
    expect(proposal.quality?.hardGates.every((gate) => gate.passed)).toBe(true);
  });

  it("does not invent event schedules, family names, or additional ceremonies", () => {
    const document = confirmedDocument();
    const proposal = createDeterministicProposal(document, "inside", "classic");
    const copy = proposal.nodes.map((node) => node.text || "").join("\n");

    expect(copy).not.toMatch(/\bAKAD\b|\bRESEPSI\b|09[.:]00|orang tua|putra-putri kami/i);
    expect(proposal.nodes.find((node) => node.id === "agent-details")?.text)
      .toBe(`${document.design.eventDate}\n${document.design.venue}`);
    expect(proposal.nodes.find((node) => node.id === "agent-title")?.text)
      .toBe(document.design.coupleNames);
  });

  it("preserves nodes created after a proposal and never replaces the blangko binding", () => {
    const document = confirmedDocument();
    const proposal = createDeterministicProposal(document, "outside", "modern");
    const current = structuredClone(document);
    const originalBlangko = current.sides[0].blangkoAssetId;
    current.sides[0].nodes.push({
      id: "user-added-after-proposal",
      kind: "shape",
      role: "CONTENT",
      box: { x: 20, y: 20, width: 12, height: 12 },
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 8,
      backgroundColor: "#202522",
    });

    const applied = applyDesignProposal(current, proposal);
    const outside = applied.sides[0];
    expect(outside.nodes.some((node) => node.id === "user-added-after-proposal")).toBe(true);
    expect(outside.nodes.some((node) => node.id === "outside-eyebrow")).toBe(false);
    expect(outside.nodes.some((node) => node.id === "agent-title")).toBe(true);
    expect(outside.blangkoAssetId).toBe(originalBlangko);
  });
});
