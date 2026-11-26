import { z } from "zod";
import { designNodeSchema, designProposalSchema, designStyleSchema, projectAssetSchema, sideIdSchema } from "./invitation";

export const designPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string(),
  trend: z.string(),
  style: designStyleSchema,
  prompt: z.string(),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(3),
});

export type DesignPreset = z.infer<typeof designPresetSchema>;

// Trend directions are translated into the three compilers that the platform
// actually supports. They do not pretend that unsupported paper, foil, or
// die-cut production has already been applied to the physical blangko.
export const designPresets: DesignPreset[] = [
  {
    id: "editorial-minimal",
    label: "Editorial Minimal",
    detail: "Tipografi besar, hirarki tegas, dan whitespace lapang.",
    trend: "Editorial minimalism",
    style: "modern",
    prompt: "Susun editorial minimalis dengan nama pasangan sebagai focal point dominan, skala tipografi kontras, satu aksen, dan whitespace luas. Pertahankan blangko serta zona tenang.",
    palette: ["#F4EBDD", "#292824", "#8B7658"],
  },
  {
    id: "retro-modern",
    label: "Retro Modern",
    detail: "Script ekspresif, sans-serif bersih, dan tanggal statement.",
    trend: "Mixed-script typography",
    style: "modern",
    prompt: "Gunakan bahasa retro-modern: script pada nama, sans-serif untuk detail, tanggal sebagai elemen statement, dan komposisi asimetris yang tetap terbaca.",
    palette: ["#F2E8D8", "#413C35", "#A65F46"],
  },
  {
    id: "botanical-fine-art",
    label: "Botanical Fine Art",
    detail: "Ilustrasi botani tipis dengan palet muted yang romantis.",
    trend: "Hand-illustrated florals",
    style: "rustic",
    prompt: "Buat komposisi botanical fine art dengan ornamen garis organik yang ringan, palet muted, ruang napas, dan tanpa menutupi motif asli blangko.",
    palette: ["#F5EFE4", "#5F6B52", "#B68A74"],
  },
  {
    id: "organic-arch",
    label: "Organic Arch",
    detail: "Struktur lengkung arsitektural sebagai bingkai komposisi.",
    trend: "Arch & organic silhouettes",
    style: "classic",
    prompt: "Bangun hirarki dalam bingkai arch organik yang halus. Gunakan bentuk lengkung sebagai struktur layout, bukan simulasi die-cut, dan jaga area lipat tetap kosong.",
    palette: ["#F3E9DA", "#51483C", "#9A765B"],
  },
  {
    id: "heritage-crest",
    label: "Heritage Crest",
    detail: "Monogram/crest formal dengan detail editorial yang tenang.",
    trend: "Monograms & custom crests",
    style: "classic",
    prompt: "Rancang monogram atau crest sebagai focal point tunggal, tipografi formal, detail kecil terukur, dan komposisi heritage yang tidak penuh ornamen.",
    palette: ["#F4ECDE", "#343C35", "#A78B54"],
  },
  {
    id: "neutral-greenery",
    label: "Neutral Greenery",
    detail: "Eucalyptus dan garis daun monokrom yang understated.",
    trend: "Neutral greenery",
    style: "rustic",
    prompt: "Gunakan greenery netral yang understated, garis daun monokrom, aksen sage, dan tipografi bersih. Ornamen hanya membingkai, tidak memenuhi zona teks.",
    palette: ["#F4F1E8", "#596452", "#9AA18A"],
  },
];

export const agentIntentSchema = z.enum(["welcome", "design", "ornament", "ornament-refine"]);

export const vectorCraftCommandSchema = z.object({
  id: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ornamentRefinePlanSchema = z.object({
  summary: z.string().min(8).max(240),
  commands: z.array(vectorCraftCommandSchema).min(1).max(8),
});

export type OrnamentRefinePlan = z.infer<typeof ornamentRefinePlanSchema>;

export const ornamentPathSchema = z.object({
  d: z.string().min(2).max(1200).regex(/^[MmLlCcQqZz0-9\s,+\-.eE]+$/, "Path hanya boleh berisi perintah M, L, C, Q, dan Z."),
  fill: z.string().regex(/^none$|^#[0-9a-fA-F]{6}$/).default("none"),
  stroke: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  strokeWidth: z.number().min(0.5).max(24).default(3),
  opacity: z.number().min(0.05).max(1).default(1),
});

export const ornamentDirectionSchema = z.object({
  summary: z.string().min(8).max(240),
  name: z.string().min(2).max(80),
  paths: z.array(ornamentPathSchema).min(1).max(32),
});

export type OrnamentDirection = z.infer<typeof ornamentDirectionSchema>;

export const ornamentProposalSchema = z.object({
  summary: z.string(),
  asset: projectAssetSchema,
  node: designNodeSchema,
  sideId: sideIdSchema,
});

export type OrnamentProposal = z.infer<typeof ornamentProposalSchema>;

export const designProposalActivitySchema = z.object({
  proposal: designProposalSchema,
});

export const presetActivitySchema = z.object({
  presets: z.array(designPresetSchema),
  note: z.string(),
});

export const ornamentProposalActivitySchema = z.object({
  proposal: ornamentProposalSchema,
});

export function ornamentSvg(direction: OrnamentDirection): string {
  const paths = direction.paths.map((path) =>
    `<path d="${path.d}" fill="${path.fill}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${path.opacity}"/>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><g>${paths}</g></svg>`;
}
