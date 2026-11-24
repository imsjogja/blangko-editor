import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, FileCheck2, Lock, Plus, Printer, Square, Trash2, Type, Unlock } from "lucide-react";
import { getSide, type DesignNode, type InvitationDocument, type PreflightIssue, type SideId } from "@contracts/invitation";

interface InspectorProps {
  document: InvitationDocument;
  sideId: SideId;
  selectedNode: DesignNode | null;
  issues: PreflightIssue[];
  onUpdateNode: (id: string, patch: Partial<DesignNode>) => void;
  onSelectNode: (id: string | null) => void;
  onDeleteNode: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  onReorderNode: (id: string, direction: "up" | "down") => void;
  onAddNode: (kind: "text" | "shape") => void;
  onExport: () => void;
}

export function Inspector(props: InspectorProps) {
  const [tab, setTab] = useState<"object" | "layers" | "print">("object");
  const { document, sideId, selectedNode, issues } = props;
  const side = getSide(document, sideId);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  const updateBox = (key: keyof DesignNode["box"], value: number) => {
    if (selectedNode) props.onUpdateNode(selectedNode.id, { box: { ...selectedNode.box, [key]: value } });
  };

  return (
    <aside className="right-panel editor-panel">
      <div className="panel-tabs" role="tablist" aria-label="Inspector">
        <button type="button" role="tab" aria-selected={tab === "object"} className={tab === "object" ? "active" : ""} onClick={() => setTab("object")}>Objek</button>
        <button type="button" role="tab" aria-selected={tab === "layers"} className={tab === "layers" ? "active" : ""} onClick={() => setTab("layers")}>Layer <span className="tab-count">{side.nodes.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "print"} className={tab === "print" ? "active" : ""} onClick={() => setTab("print")}>Cetak</button>
      </div>
      <div className="panel-scroll">
        {tab === "object" && !selectedNode && (
          <div className="empty-inspector">
            <div className="section-heading"><span>TAMBAH OBJEK</span></div>
            <p>Pilih objek pada canvas untuk mengatur posisi, ukuran, dan tipografi.</p>
            <button type="button" className="secondary-button full-width" onClick={() => onAddNodeSafe(props, "text")}><Type size={15} />Tambah teks</button>
            <button type="button" className="secondary-button full-width" onClick={() => onAddNodeSafe(props, "shape")}><Square size={15} />Tambah bidang</button>
            <div className="shortcut-hint"><span>Hapus objek</span><kbd>Delete</kbd></div>
            <div className="shortcut-hint"><span>Batalkan pilihan</span><kbd>Esc</kbd></div>
          </div>
        )}

        {tab === "object" && selectedNode && (
          <div className="panel-section-stack">
            <section className="panel-section">
              <div className="selected-object-heading">
                <span>{selectedNode.kind.toUpperCase()}</span>
                <div>
                  <button type="button" className="icon-button" onClick={() => props.onUpdateNode(selectedNode.id, { locked: !selectedNode.locked })} aria-label={selectedNode.locked ? "Buka kunci" : "Kunci objek"}>{selectedNode.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
                  <button type="button" className="icon-button danger" onClick={() => props.onDeleteNode(selectedNode.id)} aria-label="Hapus objek"><Trash2 size={15} /></button>
                </div>
              </div>
              {selectedNode.kind === "text" && <label className="field-label">Teks<textarea rows={5} value={selectedNode.text || ""} onChange={(event) => props.onUpdateNode(selectedNode.id, { text: event.target.value })} /></label>}
              <div className="field-grid two-cols">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label className="field-label" key={key}>{key === "width" ? "Lebar" : key === "height" ? "Tinggi" : key.toUpperCase()}<input type="number" step="0.5" value={Number(selectedNode.box[key].toFixed(2))} onChange={(event) => updateBox(key, Number(event.target.value))} /><span>mm</span></label>
                ))}
              </div>
              <label className="field-label">Rotasi<input type="number" min="-360" max="360" value={Number(selectedNode.rotation.toFixed(1))} onChange={(event) => props.onUpdateNode(selectedNode.id, { rotation: Number(event.target.value) })} /><span>°</span></label>
            </section>

            {selectedNode.kind === "text" && (
              <section className="panel-section">
                <div className="section-heading"><span>TIPOGRAFI</span></div>
                <div className="field-grid two-cols">
                  <label className="field-label">Font<select value={selectedNode.fontFamily || "Arial"} onChange={(event) => props.onUpdateNode(selectedNode.id, { fontFamily: event.target.value })}><option>Arial</option><option>Georgia</option><option>Courier New</option></select></label>
                  <label className="field-label">Ukuran<input type="number" min="4" max="240" value={selectedNode.fontSize || 12} onChange={(event) => props.onUpdateNode(selectedNode.id, { fontSize: Number(event.target.value) })} /><span>pt</span></label>
                </div>
                <div className="field-grid two-cols">
                  <label className="field-label">Ketebalan<select value={selectedNode.fontWeight || 400} onChange={(event) => props.onUpdateNode(selectedNode.id, { fontWeight: Number(event.target.value) })}><option value="400">Regular</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>
                  <label className="field-label">Perataan<select value={selectedNode.textAlign || "left"} onChange={(event) => props.onUpdateNode(selectedNode.id, { textAlign: event.target.value as DesignNode["textAlign"] })}><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>
                </div>
                <label className="color-field">Warna teks<input type="color" value={selectedNode.color || "#2D2A26"} onChange={(event) => props.onUpdateNode(selectedNode.id, { color: event.target.value })} /><code>{selectedNode.color || "#2D2A26"}</code></label>
              </section>
            )}

            {selectedNode.kind === "shape" && <section className="panel-section"><label className="color-field">Warna bidang<input type="color" value={selectedNode.backgroundColor || "#6E7254"} onChange={(event) => props.onUpdateNode(selectedNode.id, { backgroundColor: event.target.value })} /><code>{selectedNode.backgroundColor}</code></label></section>}

            <section className="panel-section">
              <label className="range-label">Opasitas <span>{Math.round(selectedNode.opacity * 100)}%</span><input type="range" min="0.05" max="1" step="0.05" value={selectedNode.opacity} onChange={(event) => props.onUpdateNode(selectedNode.id, { opacity: Number(event.target.value) })} /></label>
              <label className="check-row"><input type="checkbox" checked={selectedNode.visible} onChange={(event) => props.onUpdateNode(selectedNode.id, { visible: event.target.checked })} /><span>Tampilkan objek</span></label>
              <button type="button" className="secondary-button full-width" onClick={() => props.onDuplicateNode(selectedNode.id)}><Copy size={15} />Duplikat objek</button>
            </section>
          </div>
        )}

        {tab === "layers" && (
          <div className="layer-list">
            <div className="layer-list-actions"><button type="button" className="small-button" onClick={() => props.onAddNode("text")}><Plus size={13} />Teks</button><button type="button" className="small-button" onClick={() => props.onAddNode("shape")}><Plus size={13} />Bidang</button></div>
            <div className="fixed-layer"><Lock size={13} /><span>Blangko · referensi</span><span>NON-CETAK</span></div>
            {[...side.nodes].sort((a, b) => b.zIndex - a.zIndex).map((node) => (
              <div key={node.id} className={selectedNode?.id === node.id ? "layer-row selected" : "layer-row"}>
                <button type="button" className="layer-select" onClick={() => { props.onSelectNode(node.id); setTab("object"); }}><span className="layer-type">{node.kind === "text" ? "T" : node.kind === "image" ? "I" : "□"}</span><span>{node.text || node.id}</span></button>
                <button type="button" className="icon-button" onClick={() => props.onUpdateNode(node.id, { visible: !node.visible })} aria-label="Ubah visibilitas">{node.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <div className="layer-order"><button type="button" onClick={() => props.onReorderNode(node.id, "up")} aria-label="Naikkan layer"><ArrowUp size={12} /></button><button type="button" onClick={() => props.onReorderNode(node.id, "down")} aria-label="Turunkan layer"><ArrowDown size={12} /></button></div>
              </div>
            ))}
          </div>
        )}

        {tab === "print" && (
          <div className="panel-section-stack">
            <section className="print-summary">
              <div className="section-heading"><span>PROYEKSI CETAK</span></div>
              <dl><div><dt>Ukuran halaman</dt><dd>{document.stock.width} × {document.stock.height} mm</dd></div><div><dt>Resolusi</dt><dd>{document.stock.targetPpi} ppi</dd></div><div><dt>Blangko</dt><dd>Dikecualikan</dd></div><div><dt>Garis bantu</dt><dd>Dikecualikan</dd></div></dl>
            </section>
            <section className="panel-section">
              <div className={errors ? "preflight-count error" : "preflight-count"}><FileCheck2 size={20} /><div><strong>{errors} galat · {warnings} peringatan</strong><span>Preflight sisi {side.label}</span></div></div>
              <div className="issue-list">{issues.slice(0, 5).map((issue, index) => <button type="button" key={`${issue.code}-${index}`} onClick={() => { if (issue.nodeId) { props.onSelectNode(issue.nodeId); setTab("object"); } }} className={issue.severity === "error" ? "issue error" : "issue"}>{issue.message}</button>)}</div>
            </section>
            <section className="panel-section">
              <button type="button" className="primary-button full-width" onClick={props.onExport}><Printer size={16} />Ekspor dokumen</button>
              <p className="panel-hint">PDF dibuat pada skala 100%. Pilih “Actual size” pada dialog printer.</p>
            </section>
            <section className="engine-note"><span>CANVAS RUNTIME</span><strong>Domain Canvas · aktif</strong><p>Semantic adapter PhotoCraft v1 tersedia untuk runtime WASM/CLI yang dipin.</p></section>
          </div>
        )}
      </div>
    </aside>
  );
}

function onAddNodeSafe(props: InspectorProps, kind: "text" | "shape") {
  props.onAddNode(kind);
}
