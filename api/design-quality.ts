import {
  applyDesignProposal,
  getSide,
  runPreflight,
  type DesignProposal,
  type InvitationDocument,
  type ProposalQuality,
} from "@contracts/invitation";

/**
 * Structural preview QA adapted from the design-director skill.
 * It deliberately does not claim aesthetic inspection or print readiness.
 */
export function evaluateProposalQuality(
  sourceDocument: InvitationDocument,
  proposal: DesignProposal,
): ProposalQuality {
  const candidate = applyDesignProposal(sourceDocument, proposal);
  const sourceSide = getSide(sourceDocument, proposal.sideId);
  const candidateSide = getSide(candidate, proposal.sideId);
  const issues = runPreflight(candidate, proposal.sideId);
  const errorIssues = issues.filter((issue) => issue.severity === "error" && issue.code !== "SIZE_UNCONFIRMED");
  const textNodes = proposal.nodes.filter((node) => node.kind === "text");
  const title = proposal.nodes.find((node) => node.id === "agent-title");
  const details = proposal.nodes.find((node) => node.id === "agent-details");
  const hasSecondaryFocal = proposal.nodes.some((node) =>
    node.semanticRole === "photo" || node.semanticRole === "monogram"
  );
  const sourceImmutable = sourceSide.blangkoAssetId === candidateSide.blangkoAssetId
    && sourceDocument.assets === candidate.assets;
  const editable = proposal.nodes.every((node) =>
    node.role === "CONTENT"
    && (node.kind !== "text" || Boolean(node.text?.trim()))
    && (node.kind !== "image" || Boolean(node.assetId))
  );
  const assetsResolved = proposal.nodes.every((node) =>
    node.kind !== "image" || candidate.assets.some((asset) => asset.id === node.assetId)
  );
  const factsPreserved = title?.text === sourceDocument.design.coupleNames
    && details?.text === `${sourceDocument.design.eventDate}\n${sourceDocument.design.venue}`;
  const geometryClear = !issues.some((issue) =>
    ["NODE_OUTSIDE", "FOLD_CLEARANCE", "SAFE_MARGIN"].includes(issue.code)
  );

  const hardGates = [
    { id: "NO-BLANKO-REPLACE", label: "Blangko sumber tetap utuh", passed: sourceImmutable },
    { id: "EDITABLE-SCENE", label: "Elemen tetap editable", passed: editable },
    { id: "SAFE-PANELS", label: "Objek berada dalam panel aman", passed: geometryClear },
    { id: "ASSETS-RESOLVED", label: "Aset desain tersedia", passed: assetsResolved },
    { id: "FACTUAL-CONTENT", label: "Fakta acara berasal dari dokumen", passed: factsPreserved },
  ];

  const composition = Math.min(30,
    15
    + (title?.text ? 5 : 0)
    + (details?.text ? 5 : 0)
    + (hasSecondaryFocal ? 5 : 0)
  );
  const typography = Math.min(25,
    (textNodes.length >= 4 ? 8 : textNodes.length * 2)
    + (textNodes.every((node) => (node.fontSize ?? 12) >= 8) ? 7 : 0)
    + ((title?.fontSize ?? 0) >= 20 ? 5 : 0)
    + (textNodes.some((node) => (node.letterSpacing ?? 0) > 0) ? 5 : 0)
  );
  const editabilityScore = editable ? 20 : 0;
  const factualScore = factsPreserved ? 15 : 0;
  const preflightScore = Math.max(0, 10 - errorIssues.length * 5
    - issues.filter((issue) => issue.severity === "warning").length);
  const categories = [
    { id: "composition", label: "Komposisi & hierarki", score: composition, maxScore: 30 },
    { id: "typography", label: "Tipografi", score: typography, maxScore: 25 },
    { id: "editability", label: "Editability", score: editabilityScore, maxScore: 20 },
    { id: "facts", label: "Integritas fakta", score: factualScore, maxScore: 15 },
    { id: "preflight", label: "Preflight struktural", score: preflightScore, maxScore: 10 },
  ];
  const score = categories.reduce((total, category) => total + category.score, 0);
  const gatesPassed = hardGates.every((gate) => gate.passed);

  return {
    score,
    status: score >= 85 && gatesPassed ? "needs-visual-review" : "needs-revision",
    productionStatus: "not-print-ready",
    visualReviewRequired: true,
    categories,
    hardGates,
    notes: [
      "Skor mengukur struktur proposal, bukan penilaian estetika oleh peninjau manusia.",
      "Periksa komposit pada zoom 100% sebelum menyetujui preview visual.",
      "Print-ready tetap memerlukan kalibrasi ukuran, duplex, bleed, dan proses cetak yang terverifikasi.",
    ],
  };
}
