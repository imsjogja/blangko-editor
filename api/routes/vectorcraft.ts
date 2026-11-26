import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { probeVectorCraft, refineOrnament } from "../vectorcraft/ornament";

export const vectorCraftRoutes = new Hono();

vectorCraftRoutes.get("/status", async (c) => c.json(await probeVectorCraft()));

const ornamentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  svgBase64: z.string().min(1),
  commands: z.array(z.object({
    id: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })).max(256),
  maxSide: z.number().int().min(64).max(4096).optional(),
});

const ornamentBodyLimit = bodyLimit({ maxSize: 16 * 1024 * 1024, onError: (c) => c.body(null, 413) });

vectorCraftRoutes.post("/ornament", ornamentBodyLimit, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ornamentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload refine ornamen tidak valid." }, 400);
  try {
    const result = await refineOrnament(parsed.data);
    return c.json(result);
  } catch (error) {
    const status = await probeVectorCraft();
    const message = error instanceof Error ? error.message : "VectorCraft gagal memproses ornamen.";
    return c.json({ error: message, runtime: status }, status.available ? 500 : 503);
  }
});
