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
  type DesignNode,
  type InvitationDocument,
  type ProjectAsset,
  type SideId,
} from "@contracts/invitation";
import {
  agentIntentSchema,
  designPresets,
  ornamentDirectionSchema,
  ornamentSvg,
  type OrnamentProposal,
} from "@contracts/agent";
import { createKimiGateway, listModels, classifyAiError, AiMisconfigured, AiUnavailable, ContentRejected } from "../ai/ai-client";
import { createAiProposal, createDeterministicProposal, getDesignCompositionPanelMap } from "../design";
import { log } from "../lib/logger";

function diagnostic(error: unknown) {
  const candidate = error as { status?: number; statusCode?: number; cause?: { name?: string } };
  return {
    errorType: error instanceof Error ? error.name : "unknown",
    classifiedType: classifyAiError(error).name,
    status: candidate?.status ?? candidate?.statusCode,
    causeType: candidate?.cause?.name,
  };
}

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
      intent: agentIntentSchema.default("design"),
      presetId: z.string().optional(),
    }),
  }),
}).passthrough();

function event(type: string, values: Record<string, unknown> = {}) {
  return { type, timestamp: Date.now(), ...values };
}

function aiFailure(error: unknown): Error {
  const classified = classifyAiError(error);
  if (classified instanceof AiUnavailable) return new Error("Kuota AI tidak tersedia. Coba lagi setelah kuota situs diisi.");
  if (classified instanceof ContentRejected) return new Error("Permintaan tidak dapat diproses oleh model. Sederhanakan instruksi desain.");
  return new Error("Layanan AI sedang tidak tersedia. Tidak ada perubahan yang diterapkan; silakan coba lagi dengan sengaja.");
}

function fallbackOrnament(prompt: string, palette?: { accent: string; primary: string }) {
  const accent = palette?.accent ?? "#8B7658";
  const primary = palette?.primary ?? "#6E7254";
  return {
    summary: `Ornamen vektor disusun dengan skill lokal berdasarkan instruksi: ${prompt || "botanical minimal"}.`,
    name: "Botanical Line — Skill Lokal",
    paths: [
      { d: "M 400 710 C 390 560 405 360 400 90", fill: "none", stroke: primary, strokeWidth: 4, opacity: 0.9 },
      { d: "M 399 560 C 315 535 260 475 260 390 C 340 410 390 470 399 560 Z", fill: "none", stroke: primary, strokeWidth: 4, opacity: 0.85 },
      { d: "M 401 465 C 485 440 540 380 540 295 C 460 315 410 375 401 465 Z", fill: "none", stroke: accent, strokeWidth: 4, opacity: 0.85 },
      { d: "M 400 350 C 335 325 300 275 302 210 C 360 232 395 275 400 350 Z", fill: "none", stroke: accent, strokeWidth: 3, opacity: 0.8 },
      { d: "M 400 660 C 470 635 510 590 520 530 C 455 548 415 590 400 660 Z", fill: "none", stroke: primary, strokeWidth: 3, opacity: 0.8 },
      { d: "M 400 92 C 365 70 365 35 400 24 C 435 35 435 70 400 92 Z", fill: "none", stroke: accent, strokeWidth: 3, opacity: 0.9 },
    ],
  };
}

function makeOrnamentProposal(
  document: InvitationDocument,
  sideId: SideId,
  direction: z.infer<typeof ornamentDirectionSchema>,
  mode: "ai" | "deterministic",
): OrnamentProposal {
  const id = crypto.randomUUID();
  const svg = ornamentSvg(direction);
  const asset: ProjectAsset = {
    id,
    name: `${direction.name}${mode === "deterministic" ? "" : " · AI"}`,
    kind: "ornament",
    source: "generated",
    contentType: "image/svg+xml",
    generatedSvg: svg,
    width: 800,
    height: 800,
  };
  const size = Math.min(54, document.stock.width * 0.28, document.stock.height * 0.32);
  const margin = document.stock.safeMargin + 4;
  const node: DesignNode = {
    id: crypto.randomUUID(),
    kind: "image",
    role: "CONTENT",
    semanticRole: "ornament",
    box: {
      x: Math.max(margin, document.stock.width - margin - size),
      y: margin,
      width: size,
      height: size,
    },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 0.88,
    zIndex: Math.max(0, ...document.sides.find((side) => side.id === sideId)?.nodes.map((node) => node.zIndex) ?? [0]) + 1,
    assetId: id,
    clipShape: "rectangle",
  };
  return { summary: direction.summary, asset, node, sideId };
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
    const activity = async (messageId: string, activityType: string, content: Record<string, unknown>) => {
      await send(event("ACTIVITY_SNAPSHOT", { messageId, activityType, content }));
    };
    const textMessage = async (content: string) => {
      const messageId = crypto.randomUUID();
      await send(event("TEXT_MESSAGE_START", { messageId, role: "assistant" }));
      await send(event("TEXT_MESSAGE_CONTENT", { messageId, delta: content }));
      await send(event("TEXT_MESSAGE_END", { messageId }));
    };
    const progress = async (stage: string, message: string, progressValue: number) => {
      await activity("design-run-progress", "blangko.design.progress", { stage, message, progress: progressValue });
      await send(event("CUSTOM", {
        name: "blangko.agent.progress",
        value: { stage, message, progress: progressValue },
      }));
    };

    try {
      await send(event("RUN_STARTED", { threadId, runId, protocolVersion: "1.0" }));

      if (request.intent === "welcome") {
        await activity("design-preset-gallery", "blangko.design.presets", {
          presets: designPresets,
          note: "Riset tren 2026 diterjemahkan ke compiler blangko. Arch adalah struktur visual, bukan simulasi die-cut atau print-ready.",
        });
        await activity("ornament-studio", "blangko.ornament.studio", {
          title: "Ornament Studio",
          detail: "Tulis motif, warna, atau gaya. Agen menghasilkan path vektor; Anda meninjau sebelum objek masuk canvas.",
          suggestions: ["Eucalyptus tipis warna sage", "Crest monogram klasik", "Arch botanical asimetris"],
        });
        await textMessage("Pilih preset tren atau jelaskan desain Anda. Lampirkan foto, denah, ornamen, atau blangko langsung melalui prompt; aset disimpan ke proyek sebelum agen membaca konteksnya.");
        await send(event("RUN_FINISHED", { threadId, runId }));
        return;
      }

      await send(event("STATE_SNAPSHOT", {
        snapshot: { phase: "ANALYZING", projectRevision: null, proposalCount: 0 },
      }));

      if (request.intent === "ornament") {
        await send(event("STEP_STARTED", { stepName: "compose-ornament" }));
        await activity("ornament-run-progress", "blangko.ornament.progress", {
          stage: "vector-composition",
          message: "Menyusun path vektor dan menjaga ornamen tetap ringan…",
          progress: 48,
        });
        const activeBlangko = document.assets.find((asset) =>
          asset.id === document.sides.find((side) => side.id === request.sideId)?.blangkoAssetId
        );
        let direction;
        let mode: "ai" | "deterministic" = "ai";
        try {
          const { defaultModelId } = await listModels();
          const gateway = createKimiGateway();
          const result = await generateObject({
            model: gateway(defaultModelId),
            schema: ornamentDirectionSchema,
            system: "Anda adalah ilustrator vektor untuk ornamen undangan cetak. Hasilkan artwork orisinal dalam viewBox 800 × 800. Gunakan hanya path M, L, C, Q, Z dengan koordinat 0–800, tanpa angka notasi eksponensial. Buat garis bersih, tidak terlalu rapat, maksimal 16 path bila memungkinkan. Isi biasanya none; jangan membuat latar penuh. Hindari teks, logo, merek, dan klaim print-ready. Palette harus selaras dengan blangko dan permintaan pengguna.",
            prompt: `Instruksi ornamen: ${request.prompt || "Botanical line art yang elegan"}. Palette blangko: ${JSON.stringify(activeBlangko?.analysis?.visual?.palette ?? null)}. Ukuran bidang: ${document.stock.width} × ${document.stock.height} mm.`,
          });
          direction = result.object;
        } catch (error) {
          log.error("agent ornament generation failed", diagnostic(error));
          if (classifyAiError(error) instanceof AiMisconfigured) {
            direction = fallbackOrnament(request.prompt, activeBlangko?.analysis?.visual?.palette);
            mode = "deterministic";
          } else {
            throw aiFailure(error);
          }
        }
        const proposal = makeOrnamentProposal(document, request.sideId, direction, mode);
        await activity(crypto.randomUUID(), "blangko.ornament.proposal", { proposal });
        await activity("ornament-run-progress", "blangko.ornament.progress", {
          stage: "review",
          message: "Ornamen vektor siap ditinjau.",
          progress: 100,
        });
        await send(event("STEP_FINISHED", { stepName: "compose-ornament" }));
        await textMessage(`${proposal.summary}\n\nPreview vektor tersedia di kartu. Pilih Sisipkan untuk menambahkannya sebagai satu revisi; Undo tetap tersedia.`);
        await send(event("RUN_FINISHED", { threadId, runId }));
        return;
      }

      await activity("design-preset-gallery", "blangko.design.presets", {
        presets: designPresets,
        note: "Pilih arah lain kapan saja. Proposal tidak menimpa layer sebelum Anda menyetujuinya.",
      });
      await send(event("STEP_STARTED", { stepName: "analyze-document" }));
      await progress("analysis", "Memeriksa ukuran, lipatan, whitespace, warna, dan lampiran proyek…", 18);

      const issues = runPreflight(document, request.sideId);
      await send(event("STEP_FINISHED", { stepName: "analyze-document" }));
      await send(event("STEP_STARTED", { stepName: "compose-layout" }));
      await progress("composition", `Menyusun alternatif gaya ${request.style}…`, 46);

      let proposal;
      const warnings: string[] = [];
      const activeBlangko = document.assets.find((asset) =>
        asset.id === document.sides.find((side) => side.id === request.sideId)?.blangkoAssetId
      );
      const preset = designPresets.find((item) => item.id === request.presetId);
      const designContext = {
        side: request.sideId,
        style: request.style,
        trendPreset: preset ?? null,
        physicalCanvasMm: { width: document.stock.width, height: document.stock.height },
        safeMarginMm: document.stock.safeMargin,
        physicalSizeConfirmed: document.stock.physicalSizeConfirmed,
        panels: getDesignCompositionPanelMap(document, request.sideId),
        blangkoAnalysis: activeBlangko?.analysis ?? null,
        assetInventory: {
          photos: document.assets.filter((asset) => asset.kind === "photo").map((asset) => asset.name),
          ornaments: document.assets.filter((asset) => asset.kind === "ornament").map((asset) => asset.name),
          maps: document.assets.filter((asset) => asset.kind === "map").map((asset) => asset.name),
        },
        visualInput: activeBlangko?.analysis?.visual
          ? "Grid density dan palette dihitung dari piksel blangko di browser. Panel sudah digeser ke zona tenang; gunakan metadata ini tanpa mengklaim melihat piksel secara langsung."
          : "Belum ada metadata visual. Jangan mengklaim inspeksi gambar; minta analisis blangko dijalankan.",
      };
      try {
        const { defaultModelId } = await listModels();
        const gateway = createKimiGateway();
        const result = await generateObject({
          model: gateway(defaultModelId),
          schema: designDirectionSchema,
          system: "Anda adalah art director sekaligus layout engineer untuk undangan blangko. Berikan arahan visual yang dapat dikompilasi menjadi scene editable, bukan analisis produksi. Audit peta panel dan pertahankan maksimal dua focal point per panel: foto/monogram dan nama. Sisi luar memprioritaskan cover serta panel kutipan; sisi dalam memprioritaskan pembuka serta rincian acara. Blangko tidak boleh diganti dan latarnya harus tetap terlihat. Field summary hanya berisi ringkasan desain tanpa klaim telah melihat gambar atau kesiapan cetak. Field content.eyebrow berisi label singkat; content.subtitle berisi satu kalimat ajakan hangat maksimal 180 karakter; content.body tidak dicetak dari jawaban Anda. Jangan menaruh ukuran, koordinat, preflight, warna, font, catatan lipatan, atau instruksi produksi di field content. Nama pasangan, tanggal, dan venue selalu diambil dari data proyek. Jangan mengarang waktu, orang tua, akad, resepsi, atau alamat tambahan. Warna harus hex enam digit dan merupakan hipotesis sampai tinjauan komposit. Gunakan hanya font Great Vibes, Noto Serif, atau Inter yang dipaketkan. Pertahankan visual DNA dan palette hasil analisis blangko; jangan menambahkan kartu atau ornamen besar yang menutupi zona tenang.",
          prompt: `Konteks terstruktur: ${JSON.stringify(designContext)}\nNama: ${document.design.coupleNames}. Acara: ${document.design.eventDate}. Lokasi: ${document.design.venue}.\nPermintaan pengguna: ${preset?.prompt ?? ""}\n${request.prompt || "Tidak ada tambahan"}.\nHasil preflight awal: ${JSON.stringify(issues)}`,
        });
        proposal = createAiProposal(document, request.sideId, request.style, result.object);
      } catch (error) {
        log.error("agent design generation failed", diagnostic(error));
        const classified = classifyAiError(error);
        if (classified instanceof AiMisconfigured) {
          proposal = createDeterministicProposal(
            document,
            request.sideId,
            request.style,
            "Model AI belum diprovisikan; proposal ini dibuat dengan skill deterministik lokal.",
            `${preset?.prompt ?? ""} ${request.prompt}`,
          );
        } else {
          throw aiFailure(error);
        }
      }

      if (issues.some((issue) => issue.code === "SIZE_UNCONFIRMED")) {
        warnings.push("Ukuran fisik blangko belum dikonfirmasi; lakukan kalibrasi sebelum ekspor cetak.");
      }
      if (activeBlangko?.analysis?.folds.some((fold) => fold.source === "layout-heuristic")) {
        warnings.push("Sebagian garis lipat berasal dari heuristic, bukan deteksi edge; verifikasi terhadap blangko fisik.");
      } else if (activeBlangko?.analysis?.folds.some((fold) => fold.confidence < 0.6)) {
        warnings.push("Confidence kandidat lipatan rendah; periksa guides sebelum mengunci layout produksi.");
      }
      proposal.warnings.push(...warnings);

      await activity(crypto.randomUUID(), "blangko.design.proposal", { proposal });
      await send(event("CUSTOM", { name: "blangko.design.proposal", value: proposal }));
      await send(event("STATE_SNAPSHOT", {
        snapshot: { phase: "AWAITING_PROPOSAL_APPROVAL", projectRevision: null, proposalCount: 1 },
      }));
      await progress("review", "Proposal siap ditinjau sebelum diterapkan ke canvas.", 100);
      await send(event("STEP_FINISHED", { stepName: "compose-layout" }));
      await textMessage(`${proposal.summary}\n\nMode: ${proposal.mode === "ai" ? "AI" : "skill deterministik"}. Skor struktur: ${proposal.quality?.score ?? "—"}/100. Tinjau komposit secara visual lalu klik Terapkan; status produksi belum print-ready.`);
      await send(event("RUN_FINISHED", { threadId, runId }));
    } catch (error) {
      await send(event("RUN_ERROR", {
        message: error instanceof Error ? error.message : "Agen gagal dijalankan.",
        code: "BLANGKO_AGENT_ERROR",
      }));
    }
  });
});
