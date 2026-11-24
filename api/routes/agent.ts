import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { generateObject } from "ai";
import { z } from "zod";
import {
  designDirectionSchema,
  designStyleSchema,
  invitationDocumentSchema,
  runPreflight,
  sideIdSchema,
} from "@contracts/invitation";
import { createKimiGateway, listModels, classifyAiError, AiMisconfigured, AiUnavailable, ContentRejected } from "../ai/ai-client";
import { createAiProposal, createDeterministicProposal } from "../design";

export const agentRoutes = new Hono();

const runInputSchema = z.object({
  threadId: z.string().optional(),
  runId: z.string().optional(),
  forwardedProps: z.object({
    document: invitationDocumentSchema,
    request: z.object({
      sideId: sideIdSchema,
      style: designStyleSchema,
      prompt: z.string().max(2000).default(""),
    }),
  }),
}).passthrough();

function event(type: string, values: Record<string, unknown> = {}) {
  return { type, timestamp: Date.now(), ...values };
}

agentRoutes.post("/run", async (c) => {
  const parsed = runInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "RunAgentInput atau dokumen undangan tidak valid.", details: parsed.error.flatten() }, 400);
  }

  const { threadId = crypto.randomUUID(), runId = crypto.randomUUID(), forwardedProps } = parsed.data;
  const { document, request } = forwardedProps;

  return streamSSE(c, async (stream) => {
    const send = async (value: Record<string, unknown>) => {
      await stream.writeSSE({ data: JSON.stringify(value) });
    };
    const progress = async (stage: string, message: string, progressValue: number) => {
      await send(event("CUSTOM", {
        name: "blangko.agent.progress",
        value: { stage, message, progress: progressValue },
      }));
    };

    try {
      await send(event("RUN_STARTED", { threadId, runId, protocolVersion: "1.0" }));
      await send(event("STATE_SNAPSHOT", {
        snapshot: { phase: "ANALYZING", projectRevision: null, proposalCount: 0 },
      }));
      await send(event("STEP_STARTED", { stepName: "analyze-document" }));
      await progress("analysis", "Memeriksa ukuran, panel lipatan, dan zona aman…", 18);

      const issues = runPreflight(document, request.sideId);
      await send(event("STEP_FINISHED", { stepName: "analyze-document" }));
      await send(event("STEP_STARTED", { stepName: "compose-layout" }));
      await progress("composition", `Menyusun alternatif gaya ${request.style}…`, 46);

      let proposal;
      const warnings: string[] = [];
      try {
        const { defaultModelId } = await listModels();
        const gateway = createKimiGateway();
        const result = await generateObject({
          model: gateway(defaultModelId),
          schema: designDirectionSchema,
          system: "Anda adalah art director undangan cetak. Berikan arahan visual yang ringkas, bukan analisis produksi. Field summary hanya untuk ringkasan desain. Field content.eyebrow berisi label undangan singkat; content.subtitle berisi satu kalimat ajakan hangat untuk tamu, maksimal 180 karakter; content.body tidak akan dicetak dari jawaban Anda. Jangan menaruh ukuran, koordinat, preflight, warna, font, catatan lipatan, atau instruksi produksi di field content. Nama pasangan, tanggal, dan venue akan diambil langsung dari data proyek. Warna harus hex enam digit. Gunakan font Georgia atau Arial. Hindari teks pada garis lipat.",
          prompt: `Gaya: ${request.style}. Sisi: ${request.sideId}. Nama: ${document.design.coupleNames}. Acara: ${document.design.eventDate}. Lokasi: ${document.design.venue}. Permintaan pengguna: ${request.prompt || "Tidak ada tambahan"}. Hasil preflight: ${JSON.stringify(issues)}`,
        });
        proposal = createAiProposal(document, request.sideId, request.style, result.object);
      } catch (error) {
        const classified = classifyAiError(error);
        if (classified instanceof AiMisconfigured) {
          proposal = createDeterministicProposal(
            document,
            request.sideId,
            request.style,
            "Model AI belum diprovisikan; proposal ini dibuat dengan skill deterministik lokal.",
          );
        } else if (classified instanceof AiUnavailable) {
          throw new Error("Kuota AI tidak tersedia. Coba lagi setelah kuota situs diisi.");
        } else if (classified instanceof ContentRejected) {
          throw new Error("Permintaan tidak dapat diproses oleh model. Sederhanakan instruksi desain.");
        } else {
          throw new Error("Layanan AI sedang tidak tersedia. Tidak ada perubahan yang diterapkan; silakan coba lagi dengan sengaja.");
        }
      }

      if (issues.some((issue) => issue.code === "SIZE_UNCONFIRMED")) {
        warnings.push("Ukuran fisik blangko belum dikonfirmasi; lakukan kalibrasi sebelum ekspor cetak.");
      }
      proposal.warnings.push(...warnings);

      await send(event("CUSTOM", { name: "blangko.design.proposal", value: proposal }));
      await send(event("STATE_SNAPSHOT", {
        snapshot: { phase: "AWAITING_PROPOSAL_APPROVAL", projectRevision: null, proposalCount: 1 },
      }));
      await progress("review", "Proposal siap ditinjau sebelum diterapkan ke canvas.", 100);
      await send(event("STEP_FINISHED", { stepName: "compose-layout" }));

      const messageId = crypto.randomUUID();
      await send(event("TEXT_MESSAGE_START", { messageId, role: "assistant" }));
      await send(event("TEXT_MESSAGE_CONTENT", {
        messageId,
        delta: `${proposal.summary}\n\nMode: ${proposal.mode === "ai" ? "AI" : "skill deterministik"}. Tinjau proposal lalu klik Terapkan.`,
      }));
      await send(event("TEXT_MESSAGE_END", { messageId }));
      await send(event("RUN_FINISHED", { threadId, runId }));
    } catch (error) {
      await send(event("RUN_ERROR", {
        message: error instanceof Error ? error.message : "Agen gagal dijalankan.",
        code: "BLANGKO_AGENT_ERROR",
      }));
    }
  });
});
