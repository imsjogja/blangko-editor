import { useRef, useState } from "react";
import { Bot, FileImage, FolderCog, ImagePlus, LoaderCircle, ScanLine, Trash2, Upload } from "lucide-react";
import type { Message } from "@ag-ui/core";
import {
  getSide,
  type DesignProposal,
  type InvitationDocument,
  type ProjectAsset,
  type SideId,
} from "@contracts/invitation";
import type { AssetUrlMap } from "@/lib/builtin-assets";
import { resizeSmartCanvas } from "@contracts/smart-canvas";
import type { OrnamentProposal } from "@contracts/agent";
import { AgentChat, type AgentSendInput } from "./AgentChat";

export interface AgentProgress {
  stage: string;
  message: string;
  progress: number;
}

interface LeftPanelProps {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  uploading: boolean;
  analyzing: boolean;
  agentRunning: boolean;
  agentProgress: AgentProgress[];
  agentMessages: Message[];
  agentError: string | null;
  proposal: DesignProposal | null;
  onChange: (document: InvitationDocument) => void;
  onUpload: (file: File, kind: ProjectAsset["kind"]) => void;
  onInsertAsset: (asset: ProjectAsset) => void;
  onUseBlangko: (asset: ProjectAsset) => void;
  onAnalyzeBlangko: (asset: ProjectAsset) => void;
  onRemoveAsset: (asset: ProjectAsset) => void;
  onGenerate: (input: AgentSendInput) => void;
  onAgentWelcome: () => void;
  onCancelAgent: () => void;
  onApplyProposal: (proposal: DesignProposal) => void;
  onApplyOrnament: (proposal: OrnamentProposal) => void;
  onDismissProposal: () => void;
}

export function LeftPanel(props: LeftPanelProps) {
  const [tab, setTab] = useState<"project" | "assets" | "agent">("project");
  const [assetKind, setAssetKind] = useState<ProjectAsset["kind"]>("photo");
  const [removeCandidate, setRemoveCandidate] = useState<string | null>(null);
  const blangkoInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const { document, sideId, assets, uploading, analyzing } = props;
  const side = getSide(document, sideId);
  const activeBlangko = document.assets.find((asset) => asset.id === side.blangkoAssetId);
  const analysis = activeBlangko?.analysis;

  const updateStock = (key: keyof InvitationDocument["stock"], value: number | boolean) => {
    if ((key === "width" || key === "height") && typeof value === "number") {
      props.onChange(resizeSmartCanvas(document, { [key]: value }));
      return;
    }
    props.onChange({ ...document, stock: { ...document.stock, [key]: value } });
  };
  const updateDesign = (key: keyof InvitationDocument["design"], value: string) => {
    props.onChange({ ...document, design: { ...document.design, [key]: value } });
  };
  const updateFold = (value: number) => {
    props.onChange({
      ...document,
      sides: document.sides.map((item) => item.id === sideId
        ? { ...item, foldLines: item.foldLines.map((fold, index) => index === 0 ? { ...fold, positionMm: value } : fold) }
        : item),
    });
  };

  return (
    <aside className="left-panel editor-panel">
      <div className="panel-tabs" role="tablist" aria-label="Panel proyek">
        <button type="button" role="tab" aria-selected={tab === "project"} className={tab === "project" ? "active" : ""} onClick={() => setTab("project")}><FolderCog size={16} /><span>Proyek</span></button>
        <button type="button" role="tab" aria-selected={tab === "assets"} className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}><FileImage size={16} /><span>Aset</span></button>
        <button type="button" role="tab" aria-selected={tab === "agent"} className={tab === "agent" ? "active" : ""} onClick={() => setTab("agent")}><Bot size={16} /><span>Agen</span></button>
      </div>

      <div className="panel-scroll">
        {tab === "project" && (
          <div className="panel-section-stack">
            <section className="panel-section">
              <div className="section-heading"><span>DOKUMEN</span><span className="mono">MM</span></div>
              <label className="field-label">Nama proyek<input value={document.title} onChange={(event) => props.onChange({ ...document, title: event.target.value })} /></label>
              <div className="field-grid two-cols">
                <label className="field-label">Lebar<input type="number" min="20" max="2000" value={document.stock.width} onChange={(event) => updateStock("width", Number(event.target.value))} /><span>mm</span></label>
                <label className="field-label">Tinggi<input type="number" min="20" max="2000" value={document.stock.height} onChange={(event) => updateStock("height", Number(event.target.value))} /><span>mm</span></label>
                <label className="field-label">Bleed<input type="number" min="0" max="30" value={document.stock.bleed} onChange={(event) => updateStock("bleed", Number(event.target.value))} /><span>mm</span></label>
                <label className="field-label">Aman<input type="number" min="0" max="50" value={document.stock.safeMargin} onChange={(event) => updateStock("safeMargin", Number(event.target.value))} /><span>mm</span></label>
              </div>
              <label className="field-label">Posisi lipat sisi {side.label.toLowerCase()}<input type="number" min="1" max={document.stock.width - 1} step="0.5" value={side.foldLines[0]?.positionMm || document.stock.width / 2} onChange={(event) => updateFold(Number(event.target.value))} /><span>mm</span></label>
              <label className="check-row"><input type="checkbox" checked={document.stock.physicalSizeConfirmed} onChange={(event) => updateStock("physicalSizeConfirmed", event.target.checked)} /><span>Ukuran fisik sudah dikalibrasi</span></label>
            </section>

            <section className="panel-section">
              <div className="section-heading"><span>ISI UNDANGAN</span></div>
              <label className="field-label">Nama pasangan<input value={document.design.coupleNames} onChange={(event) => updateDesign("coupleNames", event.target.value)} /></label>
              <label className="field-label">Tanggal acara<input value={document.design.eventDate} onChange={(event) => updateDesign("eventDate", event.target.value)} /></label>
              <label className="field-label">Lokasi<textarea rows={2} value={document.design.venue} onChange={(event) => updateDesign("venue", event.target.value)} /></label>
            </section>

            <section className="panel-section">
              <div className="section-heading"><span>KUALITAS CETAK</span></div>
              <div className="segmented-control">
                {[300, 600].map((dpi) => <button key={dpi} type="button" className={document.stock.targetPpi === dpi ? "active" : ""} onClick={() => updateStock("targetPpi", dpi)}>{dpi} ppi</button>)}
              </div>
              <p className="panel-hint">300 ppi untuk foto; 600 ppi untuk detail garis dan teks halus.</p>
            </section>
          </div>
        )}

        {tab === "assets" && (
          <div className="panel-section-stack">
            <section className="panel-section">
              <div className="section-heading"><span>BLANGKO SISI {side.label.toUpperCase()}</span><span className="protocol-badge">CV</span></div>
              <p className="panel-hint">Smart canvas membaca rasio, metadata DPI, dan kandidat lipatan. Blangko tetap dikecualikan dari cetak isi.</p>
              <button type="button" className="secondary-button full-width" disabled={uploading || analyzing} onClick={() => blangkoInput.current?.click()}><Upload size={15} />Unggah & analisis blangko</button>
              <input ref={blangkoInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onUpload(file, "blangko"); event.target.value = ""; }} />
              {analyzing && <div className="inline-status"><LoaderCircle className="spin" size={15} />Menganalisis ukuran, lipatan, dan zona tenang…</div>}
              {activeBlangko && (
                <button type="button" className="secondary-button full-width analysis-button" disabled={analyzing} onClick={() => props.onAnalyzeBlangko(activeBlangko)}><ScanLine size={15} />{analysis ? "Analisis ulang smart canvas" : "Analisis smart canvas"}</button>
              )}
              {analysis && (
                <div className="analysis-result" aria-live="polite">
                  <div><strong>{analysis.widthMm} × {analysis.heightMm} mm</strong><span>{analysis.sizeSource === "metadata-dpi" ? `Metadata ${analysis.dpi} DPI` : analysis.sizeSource === "standard-aspect" ? "Estimasi ukuran standar" : "Estimasi dari rasio"}</span></div>
                  {analysis.folds.map((fold, index) => <p key={`${fold.axis}-${index}`}>{fold.axis === "vertical" ? "Vertikal" : "Horizontal"} · {Math.round(fold.positionRatio * 100)}% · confidence {Math.round(fold.confidence * 100)}% <span>{fold.source === "layout-heuristic" ? "heuristic" : "CV"}</span></p>)}
                  {analysis.visual && <small>Palet {analysis.visual.palette.accent} dan peta whitespace {analysis.visual.columns} × {analysis.visual.rows} siap dipakai agen.</small>}
                  {analysis.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                </div>
              )}
            </section>
            <section className="panel-section">
              <div className="section-heading"><span>ASET DESAIN</span></div>
              <div className="upload-row">
                <select value={assetKind} onChange={(event) => setAssetKind(event.target.value as ProjectAsset["kind"])} aria-label="Jenis aset">
                  <option value="photo">Foto</option><option value="ornament">Ornamen</option><option value="map">Denah</option>
                </select>
                <button type="button" className="secondary-button" disabled={uploading} onClick={() => assetInput.current?.click()}><ImagePlus size={15} />Tambah</button>
              </div>
              <input ref={assetInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onUpload(file, assetKind); event.target.value = ""; }} />
              {uploading && <div className="inline-status"><LoaderCircle className="spin" size={15} />Mengunggah ke object storage…</div>}
            </section>
            <section className="asset-list">
              {document.assets.map((asset) => (
                <article className="asset-item" key={asset.id}>
                  <div className="asset-thumbnail">{assets[asset.id] ? <img src={assets[asset.id]} alt="" /> : <FileImage size={20} />}</div>
                  <div className="asset-copy"><strong>{asset.name}</strong><span>{asset.kind} · {asset.source === "builtin" ? "bawaan" : asset.source === "generated" ? "vektor agen" : "tersimpan"}</span></div>
                  <div className="asset-actions">
                    {asset.kind === "blangko" ? (
                      <button type="button" className="small-button" onClick={() => props.onUseBlangko(asset)}>Gunakan</button>
                    ) : (
                      <button type="button" className="small-button" onClick={() => props.onInsertAsset(asset)}>Sisipkan</button>
                    )}
                    <button type="button" className="icon-button danger" onClick={() => setRemoveCandidate(asset.id)} aria-label={`Hapus ${asset.name}`}><Trash2 size={14} /></button>
                  </div>
                  {removeCandidate === asset.id && (
                    <div className="asset-remove-confirm" role="alert">
                      <p>Hapus dari proyek? Objek yang memakai aset ini juga dihapus. File storage tidak dihapus permanen.</p>
                      <div><button type="button" className="small-button" onClick={() => setRemoveCandidate(null)}>Batal</button><button type="button" className="small-button danger-fill" onClick={() => { props.onRemoveAsset(asset); setRemoveCandidate(null); }}>Hapus dari proyek</button></div>
                    </div>
                  )}
                </article>
              ))}
            </section>
          </div>
        )}

        {tab === "agent" && (
          <AgentChat
            messages={props.agentMessages}
            running={props.agentRunning}
            error={props.agentError}
            onWelcome={props.onAgentWelcome}
            onSend={props.onGenerate}
            onCancel={props.onCancelAgent}
            onApplyDesign={props.onApplyProposal}
            onApplyOrnament={props.onApplyOrnament}
          />
        )}
      </div>
    </aside>
  );
}
