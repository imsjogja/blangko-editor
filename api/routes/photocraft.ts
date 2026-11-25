import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { invitationDocumentSchema, sideIdSchema } from "@contracts/invitation";
import { photoCraftRuntimeAssetsSchema } from "@contracts/photocraft";
import { probePhotoCraft, syncPhotoCraftRuntime } from "../photocraft/runtime";

export const photoCraftRoutes = new Hono();

photoCraftRoutes.get("/status", async (c) => c.json(await probePhotoCraft()));

const runtimeSchema = z.object({
  document: invitationDocumentSchema,
  sideId: sideIdSchema,
  projection: z.enum(["composite", "content-only"]),
  assets: photoCraftRuntimeAssetsSchema,
  maxSide: z.number().int().min(64).max(2400).optional(),
});

async function runtimeResponse(c: Context, includeDocument: boolean) {
  const body = await c.req.json().catch(() => null);
  const parsed = runtimeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Payload runtime PhotoCraft tidak valid." }, 400);
  try {
    const result = await syncPhotoCraftRuntime({ ...parsed.data, includeDocument });
    return c.json(result);
  } catch (error) {
    const status = await probePhotoCraft();
    const message = error instanceof Error ? error.message : "PhotoCraft gagal menjalankan dokumen.";
    return c.json({ error: message, runtime: status }, status.available ? 500 : 503);
  }
}

const runtimeBodyLimit = bodyLimit({ maxSize: 100 * 1024 * 1024, onError: (c) => c.body(null, 413) });
photoCraftRoutes.post("/sync", runtimeBodyLimit, async (c) => runtimeResponse(c, true));
photoCraftRoutes.post("/handoff", runtimeBodyLimit, async (c) => runtimeResponse(c, true));
