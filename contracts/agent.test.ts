import { describe, expect, it } from "vitest";
import { designPresets, ornamentDirectionSchema, ornamentSvg } from "./agent";
import { createInitialDocument, invitationDocumentSchema } from "./invitation";
import { agentRoutes } from "../api/routes/agent";

 describe("agent design presets", () => {
  it("offers researched directions only through supported style compilers", () => {
    expect(designPresets).toHaveLength(6);
    expect(new Set(designPresets.map((preset) => preset.id)).size).toBe(6);
    expect(designPresets.every((preset) => ["modern", "rustic", "classic"].includes(preset.style))).toBe(true);
  });

  it("streams preset and ornament generative UI without an AI call", async () => {
    const document = createInitialDocument();
    const response = await agentRoutes.request("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        forwardedProps: {
          document,
          request: { sideId: "outside", style: "modern", prompt: "", intent: "welcome" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("ACTIVITY_SNAPSHOT");
    expect(stream).toContain("blangko.design.presets");
    expect(stream).toContain("blangko.ornament.studio");
    expect(stream).toContain("RUN_FINISHED");
  });
});

describe("agent vector ornaments", () => {
  it("compiles only validated path data into a passive SVG image", () => {
    const direction = ornamentDirectionSchema.parse({
      summary: "Garis botanical yang ringan.",
      name: "Sage sprig",
      paths: [{ d: "M 10 790 C 120 500 240 220 400 10 Z", stroke: "#6E7254" }],
    });
    const svg = ornamentSvg(direction);
    expect(svg).toContain("<svg");
    expect(svg).toContain("stroke=\"#6E7254\"");
    expect(svg).not.toContain("script");
    expect(svg).not.toContain("foreignObject");
  });

  it("rejects executable or unsupported path syntax", () => {
    expect(ornamentDirectionSchema.safeParse({
      summary: "Input berbahaya.",
      name: "Invalid",
      paths: [{ d: "M 0 0\"><script>alert(1)</script>", stroke: "#000000" }],
    }).success).toBe(false);
  });

  it("persists generated vectors as document assets, not user file blobs", () => {
    const document = createInitialDocument();
    const next = {
      ...document,
      assets: [...document.assets, {
        id: "vector-1",
        name: "Generated sprig",
        kind: "ornament",
        source: "generated",
        generatedSvg: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
      }],
    };
    expect(invitationDocumentSchema.safeParse(next).success).toBe(true);
  });
});
