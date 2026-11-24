import { describe, expect, it } from "vitest";
import {
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
    expect(title?.fontFamily).toBe("Georgia");
    expect(runPreflight(candidate, "outside").filter((issue) => issue.severity === "error")).toEqual([]);
    expect(proposal.nodes.every((node) => node.box.y + node.box.height <= document.stock.height)).toBe(true);
  });

  it("builds deterministic proposals without requiring an AI credential", () => {
    const document = confirmedDocument();
    const proposal = createDeterministicProposal(document, "inside", "modern");
    expect(proposal.mode).toBe("deterministic");
    expect(proposal.nodes.length).toBeGreaterThanOrEqual(4);
    expect(proposal.nodes.find((node) => node.id === "agent-title")?.text).toBe(document.design.coupleNames);
  });
});
