import { Hono } from "hono";
import { storage } from "../lib/storage";
import { findProjectAsset } from "../queries/projects";

export const projectAssetRoutes = new Hono();

// Same-origin asset delivery keeps canvas exports readable without exposing an
// arbitrary storage-key proxy. Only assets recorded for the requested project
// can be read, and no delete operation is exposed.
projectAssetRoutes.get("/:projectId/assets/:assetId", async (c) => {
  const { projectId, assetId } = c.req.param();
  const asset = await findProjectAsset(projectId, assetId);
  if (!asset) return c.json({ error: "Aset proyek tidak ditemukan." }, 404);

  const bytes = await storage.readFile({ fileKey: asset.storageKey });
  return c.body(Buffer.from(bytes), 200, {
    "Content-Type": asset.contentType,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
  });
});
