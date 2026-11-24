import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invitationDocumentSchema, type ProjectAsset } from "@contracts/invitation";
import { createRouter, publicQuery } from "./middleware";
import { storage } from "./lib/storage";
import {
  createProject,
  findProject,
  insertProjectAsset,
  listProjectAssets,
  saveProject,
} from "./queries/projects";

const uploadTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function mapAsset(asset: {
  id: string;
  name: string;
  kind: string;
  storageKey: string;
  contentType: string;
  width: number | null;
  height: number | null;
}): ProjectAsset {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind as ProjectAsset["kind"],
    source: "storage",
    storageKey: asset.storageKey,
    contentType: asset.contentType,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
  };
}

export const projectRouter = createRouter({
  create: publicQuery
    .input(z.object({ document: invitationDocumentSchema }))
    .mutation(async ({ input }) => ({
      project: await createProject(input.document),
      assets: [],
    })),

  get: publicQuery
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [project, records] = await Promise.all([
        findProject(input.projectId),
        listProjectAssets(input.projectId),
      ]);
      const assets = records.map((record) => ({
        ...mapAsset(record),
        url: `/api/projects/${input.projectId}/assets/${record.id}`,
      }));
      return { project, assets };
    }),

  save: publicQuery
    .input(z.object({
      projectId: z.string().uuid(),
      baseRevision: z.number().int().positive(),
      document: invitationDocumentSchema,
    }))
    .mutation(async ({ input }) => {
      const project = await saveProject(input.projectId, input.baseRevision, input.document);
      return { revision: project.revision, updatedAt: project.updatedAt };
    }),

  uploadAsset: publicQuery
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(200),
      kind: z.enum(["blangko", "photo", "ornament", "map"]),
      contentBase64: z.string().min(8).max(17_000_000),
      contentType: z.string().max(100),
      width: z.number().int().positive().max(30000),
      height: z.number().int().positive().max(30000),
    }))
    .mutation(async ({ input }) => {
      if (!uploadTypes.has(input.contentType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Gunakan aset PNG, JPG, atau WebP." });
      }
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      if (bytes.byteLength > 12 * 1024 * 1024) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Ukuran aset maksimal 12 MB." });
      }
      await findProject(input.projectId);
      // Control characters are intentionally stripped from user-provided file names.
      // eslint-disable-next-line no-control-regex
      const safeName = input.name.replace(/[\\/\u0000-\u001f]/g, "-").replace(/\.\./g, "-");
      const saved = await storage.uploadFile({
        fileContent: bytes,
        fileName: `projects/${input.projectId}/${safeName}`,
        contentType: input.contentType,
      });
      const record = await insertProjectAsset({
        projectId: input.projectId,
        storageKey: saved.key,
        name: input.name,
        kind: input.kind,
        contentType: input.contentType,
        size: saved.size,
        width: input.width,
        height: input.height,
      });
      return {
        asset: mapAsset(record),
        url: `/api/projects/${input.projectId}/assets/${record.id}`,
      };
    }),
});
