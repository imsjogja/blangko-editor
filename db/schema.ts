import {
  bigint,
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 64 }).primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  revision: int("revision").notNull().default(1),
  document: json("document").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const projectAssets = mysqlTable(
  "project_assets",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    projectId: varchar("project_id", { length: 64 }).notNull(),
    storageKey: varchar("storage_key", { length: 768 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    width: int("width"),
    height: int("height"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("project_assets_project_idx").on(table.projectId)],
);

export type Project = typeof projects.$inferSelect;
export type ProjectAssetRecord = typeof projectAssets.$inferSelect;
