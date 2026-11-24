import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { invitationDocumentSchema, sideIdSchema } from "@contracts/invitation";
import { probePhotoCraft, runPhotoCraftHandoff } from "../photocraft/runtime";

export const photoCraftRoutes = new Hono();

photoCraftRoutes.get("/status", async (c) => c.json(await probePhotoCraft()));

const handoffSchema = z.object({
  document: invitationDocumentSchema,
  sideId: sideIdSchema,
  projection: z.enum(["composite", "content-only"]),
  pngBase64: z.string().min(8).max(45_000_000),
});

photoCraftRoutes.post(
  "/handoff",
  bodyLimit({ maxSize: 50 * 1024 * 1024, onError: (c) => c.body(null, 413) }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = handoffSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Payload handoff PhotoCraft tidak valid." }, 400);
    try {
      const result = await runPhotoCraftHandoff(parsed.data);
      return c.json(result);
    } catch (error) {
      const status = await probePhotoCraft();
      const message = error instanceof Error ? error.message : "PhotoCraft gagal dijalankan.";
      return c.json({ error: message, runtime: status }, status.available ? 500 : 503);
    }
  },
);
