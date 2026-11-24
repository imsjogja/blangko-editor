import { createRouter, publicQuery } from "./middleware";
import { projectRouter } from "./project-router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  project: projectRouter,
});

export type AppRouter = typeof appRouter;
