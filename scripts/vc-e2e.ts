/* Round-trip E2E terhadap binary asli lewat jalur POC refineOrnament. */
import { refineOrnament, probeVectorCraft } from "../api/vectorcraft/ornament";
import { disposeVectorCraftMcpSessions } from "../api/vectorcraft/session";

const BIN = "vendor/vectorcraft/vectorcraft-cli-0.24.1-macos-universal/vectorcraft-cli";

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#c0392b"/><circle cx="50" cy="50" r="30" fill="#f1c40f"/></svg>',
  "utf8",
).toString("base64");

const status = await probeVectorCraft(BIN);
console.log("STATUS:", JSON.stringify(status));

const result = await refineOrnament({
  binaryPath: BIN,
  name: "ornamen.svg",
  svgBase64: SVG,
  commands: [
    { id: "select.all" },
    { id: "paint.setFill", params: { color: "#2c3e50" } },
  ],
  maxSide: 512,
});

const svgOut = Buffer.from(result.svgBase64, "base64").toString("utf8");
console.log("COMPLETED:", result.completed);
console.log("WARNINGS:", JSON.stringify(result.warnings));
console.log("SVG_OUT_HEAD:", svgOut.slice(0, 200));
console.log("SVG_OUT_HAS_SHAPES:", svgOut.includes("rect") || svgOut.includes("path") || svgOut.includes("circle"));
console.log("RECOLOR_APPLIED:", svgOut.toLowerCase().includes("#2c3e50"));
console.log("OLD_COLOR_GONE:", !svgOut.toLowerCase().includes("#c0392b"));
console.log("PREVIEW_BYTES:", result.previewPngBase64 ? Buffer.from(result.previewPngBase64, "base64").length : 0);

await disposeVectorCraftMcpSessions();
process.exit(0);
