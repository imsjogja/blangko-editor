import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { projects, projectAssets } from "@db/schema";
import type { InvitationDocument } from "@contracts/invitation";
import { getDb } from "./connection";

export async function createProject(document: InvitationDocument) {
  const id = randomUUID();
  await getDb().insert(projects).values({ id, title: document.title, document, revision: 1 });
  return findProject(id);
}

export async function findProject(id: string) {
  const project = await getDb().query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Proyek tidak ditemukan." });
  return project;
}

export async function saveProject(id: string, baseRevision: number, document: InvitationDocument) {
  const result = await getDb()
    .update(projects)
    .set({ title: document.title, document, revision: baseRevision + 1 })
    .where(and(eq(projects.id, id), eq(projects.revision, baseRevision)));

  if (result[0].affectedRows === 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Dokumen telah berubah di tempat lain. Muat ulang revisi terbaru sebelum menyimpan.",
    });
  }
  return findProject(id);
}

export async function listProjectAssets(projectId: string) {
  return getDb().select().from(projectAssets).where(eq(projectAssets.projectId, projectId));
}

export async function findProjectAsset(projectId: string, assetId: string) {
  return getDb().query.projectAssets.findFirst({
    where: and(eq(projectAssets.projectId, projectId), eq(projectAssets.id, assetId)),
  });
}

export async function insertProjectAsset(values: {
  projectId: string;
  storageKey: string;
  name: string;
  kind: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}) {
  const id = randomUUID();
  await getDb().insert(projectAssets).values({ id, ...values });
  const [asset] = await getDb().select().from(projectAssets).where(eq(projectAssets.id, id));
  return asset;
}
