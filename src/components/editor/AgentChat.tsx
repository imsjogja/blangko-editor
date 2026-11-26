import { useEffect, useRef, useState } from "react";
import type { ContentPart, Message } from "@ag-ui/core";
import { Bot, Brush, Check, FileImage, LoaderCircle, Paperclip, Send, Sparkles, Square, WandSparkles, X } from "lucide-react";
import type { DesignProposal, DesignStyle, ProjectAsset } from "@contracts/invitation";
import {
  designProposalActivitySchema,
  ornamentProposalActivitySchema,
  presetActivitySchema,
  type DesignPreset,
  type OrnamentProposal,
} from "@contracts/agent";

export interface AgentSendInput {
  prompt: string;
  files: File[];
  attachmentKind: ProjectAsset["kind"];
  intent: "design" | "ornament" | "ornament-refine";
  style?: DesignStyle;
  presetId?: string;
  assetId?: string;
}

interface AgentChatProps {
  messages: Message[];
  running: boolean;
  error: string | null;
  ornaments: Array<{ id: string; name: string }>;
  onWelcome: () => void;
  onSend: (input: AgentSendInput) => void;
  onCancel: () => void;
  onApplyDesign: (proposal: DesignProposal) => void;
  onApplyOrnament: (proposal: OrnamentProposal) => void;
}

function messageText(message: Message): string {
  if (!("content" in message) || !message.content) return "";
  if (typeof message.content === "string") return message.content;
  return (message.content as ContentPart[]).filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n");
}

function PresetGallery({ content, disabled, onSelect }: {
  content: unknown;
  disabled: boolean;
  onSelect: (preset: DesignPreset) => void;
}) {
  const parsed = presetActivitySchema.safeParse(content);
  if (!parsed.success) return null;
  return (
    <div className="agent-generative-card preset-gallery">
      <div className="generative-card-heading"><span>TREN DESAIN 2026</span><Sparkles size={14} /></div>
      <div className="agent-preset-grid">
        {parsed.data.presets.map((preset) => (
          <button key={preset.id} type="button" disabled={disabled} onClick={() => onSelect(preset)}>
            <span className="preset-palette">{preset.palette.map((color) => <i key={color} style={{ background: color }} />)}</span>
            <strong>{preset.label}</strong>
            <small>{preset.detail}</small>
            <em>{preset.trend}</em>
          </button>
        ))}
      </div>
      <p>{parsed.data.note}</p>
    </div>
  );
}

function DesignProposalCard({ content, onApply }: { content: unknown; onApply: (proposal: DesignProposal) => void }) {
  const parsed = designProposalActivitySchema.safeParse(content);
  if (!parsed.success) return null;
  const { proposal } = parsed.data;
  return (
    <div className="agent-generative-card agent-design-proposal">
      <div className="generative-card-heading"><span>PROPOSAL {proposal.sideId === "outside" ? "LUAR" : "DALAM"}</span><span className="mode-badge ai">{proposal.mode === "ai" ? "AI" : "SKILL"}</span></div>
      <p>{proposal.summary}</p>
      <div className="proposal-metrics">
        <span><strong>{proposal.nodes.length}</strong> objek editable</span>
        {proposal.quality && <span><strong>{proposal.quality.score}</strong>/100 struktur</span>}
      </div>
      {proposal.warnings.map((warning) => <small className="warning-copy" key={warning}>{warning}</small>)}
      <small>Skor struktur bukan bukti estetika atau print readiness.</small>
      <button type="button" className="primary-button full-width" onClick={() => onApply(proposal)}><Check size={15} />Terapkan proposal</button>
    </div>
  );
}

function OrnamentProposalCard({ content, onApply }: { content: unknown; onApply: (proposal: OrnamentProposal) => void }) {
  const parsed = ornamentProposalActivitySchema.safeParse(content);
  if (!parsed.success) return null;
  const { proposal } = parsed.data;
  const preview = proposal.asset.generatedSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(proposal.asset.generatedSvg)}`
    : "";
  return (
    <div className="agent-generative-card ornament-proposal-card">
      <div className="generative-card-heading"><span>ORNAMEN VEKTOR</span><WandSparkles size={14} /></div>
      {preview && <div className="ornament-preview"><img src={preview} alt={proposal.asset.name} /></div>}
      <strong>{proposal.asset.name}</strong>
      <p>{proposal.summary}</p>
      <small>Path M/L/C/Q/Z, tanpa script atau raster. Posisi dan ukuran tetap dapat diedit.</small>
      <button type="button" className="primary-button full-width" onClick={() => onApply(proposal)}><Check size={15} />Sisipkan ke sisi {proposal.sideId === "outside" ? "luar" : "dalam"}</button>
    </div>
  );
}

function ActivityView({ message, running, onPreset, onApplyDesign, onApplyOrnament }: {
  message: Extract<Message, { role: "activity" }>;
  running: boolean;
  onPreset: (preset: DesignPreset) => void;
  onApplyDesign: (proposal: DesignProposal) => void;
  onApplyOrnament: (proposal: OrnamentProposal) => void;
}) {
  const content = message.content;
  if (message.activityType === "blangko.design.presets") return <PresetGallery content={content} disabled={running} onSelect={onPreset} />;
  if (message.activityType === "blangko.design.proposal") return <DesignProposalCard content={content} onApply={onApplyDesign} />;
  if (message.activityType === "blangko.ornament.proposal") return <OrnamentProposalCard content={content} onApply={onApplyOrnament} />;
  if (message.activityType === "blangko.ornament.studio") {
    return <div className="agent-generative-card ornament-studio-card"><WandSparkles size={18} /><div><strong>Ornament Studio</strong><p>Motif → path vektor → preview → persetujuan.</p></div></div>;
  }
  if (message.activityType === "blangko.design.progress" || message.activityType === "blangko.ornament.progress") {
    const progress = typeof content.progress === "number" ? content.progress : 0;
    return <div className="agent-activity-progress"><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><p>{typeof content.message === "string" ? content.message : "Agen sedang bekerja…"}</p></div>;
  }
  return null;
}

export function AgentChat(props: AgentChatProps) {
  const [prompt, setPrompt] = useState("");
  const [intent, setIntent] = useState<"design" | "ornament" | "ornament-refine">("design");
  const [refineAssetId, setRefineAssetId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentKind, setAttachmentKind] = useState<ProjectAsset["kind"]>("photo");
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { props.onWelcome(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [props.messages, props.running]);

  const activeRefineAssetId = props.ornaments.some((item) => item.id === refineAssetId)
    ? refineAssetId
    : (props.ornaments[0]?.id ?? "");

  const send = () => {
    const value = prompt.trim();
    if (intent === "ornament-refine") {
      if (!value || !activeRefineAssetId || props.running) return;
      props.onSend({ prompt: value, files: [], attachmentKind, intent, assetId: activeRefineAssetId });
    } else {
      if ((!value && !files.length) || props.running) return;
      props.onSend({ prompt: value, files, attachmentKind, intent });
    }
    setPrompt("");
    setFiles([]);
  };

  return (
    <section className="agent-chat" aria-label="Agentic chat AG-UI">
      <div className="agent-chat-heading">
        <div><Bot size={16} /><strong>Design Agent</strong></div>
        <span className="protocol-badge">AG-UI 1.0</span>
      </div>
      <div className="agent-message-stream" ref={scrollRef} aria-live="polite">
        {!props.messages.length && <div className="chat-empty"><LoaderCircle className="spin" size={18} /><span>Menyiapkan Design Director…</span></div>}
        {props.messages.map((message) => {
          if (message.role === "activity") {
            return <ActivityView key={message.id} message={message} running={props.running} onPreset={(preset) => props.onSend({ prompt: preset.prompt, files: [], attachmentKind: "photo", intent: "design", style: preset.style, presetId: preset.id })} onApplyDesign={props.onApplyDesign} onApplyOrnament={props.onApplyOrnament} />;
          }
          if (message.role !== "assistant" && message.role !== "user") return null;
          const text = messageText(message);
          if (!text) return null;
          return <article key={message.id} className={`chat-message ${message.role}`}><span>{message.role === "assistant" ? "DESIGN DIRECTOR" : "ANDA"}</span><p>{text}</p></article>;
        })}
        {props.error && !props.running && <div className="chat-error" role="alert"><strong>Run agen terhenti</strong><p>{props.error}</p><small>Tidak ada proposal dari run ini yang diterapkan otomatis. Perbaiki instruksi atau coba lagi.</small></div>}
        {props.running && <div className="chat-thinking"><LoaderCircle className="spin" size={14} />Agen menerima event dan menyusun UI…</div>}
      </div>

      <div className="agent-composer">
        <div className="composer-mode" role="group" aria-label="Mode agen">
          <button type="button" className={intent === "design" ? "active" : ""} onClick={() => setIntent("design")}><Sparkles size={13} />Desain</button>
          <button type="button" className={intent === "ornament" ? "active" : ""} onClick={() => setIntent("ornament")}><WandSparkles size={13} />Ornamen AI</button>
          <button type="button" className={intent === "ornament-refine" ? "active" : ""} onClick={() => setIntent("ornament-refine")}><Brush size={13} />Refine VC</button>
        </div>
        {intent === "ornament-refine" && (
          props.ornaments.length
            ? <select className="refine-asset-select" value={activeRefineAssetId} onChange={(event) => setRefineAssetId(event.target.value)} aria-label="Ornamen yang di-refine">
                {props.ornaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            : <small className="refine-asset-empty">Belum ada ornamen SVG hasil generate. Buat dulu lewat mode Ornamen AI.</small>
        )}
        {files.length > 0 && <div className="composer-attachments">{files.map((file, index) => <span key={`${file.name}-${index}`}><FileImage size={12} />{file.name}<button type="button" onClick={() => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Lepas ${file.name}`}><X size={11} /></button></span>)}</div>}
        <textarea
          rows={3}
          value={prompt}
          maxLength={2000}
          placeholder={intent === "ornament-refine" ? "Contoh: ubah seluruh warna jadi #2c3e50, lalu rapikan stroke…" : intent === "ornament" ? "Contoh: eucalyptus tipis, sage, bingkai asimetris…" : "Instruksikan layout atau lampirkan aset untuk dianalisis…"}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); }
          }}
        />
        <div className="composer-actions">
          <input ref={fileInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            setFiles((items) => [...items, ...selected].slice(0, 4));
            event.currentTarget.value = "";
          }} />
          <select value={attachmentKind} onChange={(event) => setAttachmentKind(event.target.value as ProjectAsset["kind"])} aria-label="Jenis lampiran">
            <option value="photo">Foto</option><option value="ornament">Ornamen</option><option value="map">Denah</option><option value="blangko">Blangko</option>
          </select>
          <button type="button" className="icon-button" disabled={props.running || files.length >= 4} onClick={() => fileInput.current?.click()} aria-label="Lampirkan file" title="Lampirkan maksimal 4 file"><Paperclip size={16} /></button>
          <span className="composer-shortcut">⌘↵</span>
          {props.running
            ? <button type="button" className="icon-button stop" onClick={props.onCancel} aria-label="Hentikan agen"><Square size={14} /></button>
            : <button type="button" className="send-button" disabled={!prompt.trim() && !files.length} onClick={send} aria-label="Kirim prompt"><Send size={15} /></button>}
        </div>
      </div>
    </section>
  );
}
