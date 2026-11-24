import { useEffect, useState } from "react";
import { AlertTriangle, Download, FileJson, LoaderCircle, X } from "lucide-react";
import type { InvitationDocument, PreflightIssue, SideId } from "@contracts/invitation";
import { getPhotoCraftStatus, type PhotoCraftRuntimeStatus } from "@/lib/photocraft-runtime";

export interface ExportOptions {
  format: "pdf" | "png";
  sideIds: SideId[];
  includeBlangko: boolean;
}

interface ExportDialogProps {
  document: InvitationDocument;
  sideId: SideId;
  issues: PreflightIssue[];
  exporting: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  onPhotoCraft: (includeBlangko: boolean) => void;
  onMaster: () => void;
}

export function ExportDialog({ document, sideId, issues, exporting, onClose, onExport, onPhotoCraft, onMaster }: ExportDialogProps) {
  const [format, setFormat] = useState<"pdf" | "png">("pdf");
  const [allSides, setAllSides] = useState(true);
  const [includeBlangko, setIncludeBlangko] = useState(false);
  const [runtime, setRuntime] = useState<PhotoCraftRuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const errors = issues.filter((issue) => issue.severity === "error");

  useEffect(() => {
    let active = true;
    getPhotoCraftStatus()
      .then((status) => { if (active) setRuntime(status); })
      .catch((error) => { if (active) setRuntimeError(error instanceof Error ? error.message : "Status runtime gagal dibaca."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !exporting) onClose(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [exporting, onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) onClose(); }}>
      <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header><div><span className="eyebrow">OUTPUT STUDIO</span><h2 id="export-title">Ekspor undangan</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={exporting} aria-label="Tutup ekspor"><X size={19} /></button></header>
        <div className="export-body">
          <div className="export-main">
            <fieldset><legend>Proyeksi</legend><div className="export-option-grid">
              <button type="button" className={!includeBlangko ? "export-option active" : "export-option"} onClick={() => setIncludeBlangko(false)}><strong>Cetak isi</strong><span>Hanya desain isi. Blangko dan garis bantu dikecualikan.</span></button>
              <button type="button" className={includeBlangko ? "export-option active" : "export-option"} onClick={() => setIncludeBlangko(true)}><strong>Preview komposit</strong><span>Blangko dan desain digabung untuk tinjauan visual.</span></button>
            </div></fieldset>
            <div className="field-grid two-cols">
              <label className="field-label">Format<select value={format} onChange={(event) => setFormat(event.target.value as "pdf" | "png")}><option value="pdf">PDF siap cetak</option><option value="png">PNG {document.stock.targetPpi} ppi</option></select></label>
              <label className="field-label">Sisi<select value={allSides ? "all" : "current"} onChange={(event) => setAllSides(event.target.value === "all")}><option value="all">Luar & dalam</option><option value="current">Sisi {sideId === "outside" ? "luar" : "dalam"} saja</option></select></label>
            </div>
            <div className="export-spec"><span>{document.stock.width} × {document.stock.height} mm</span><span>{document.stock.targetPpi} ppi</span><span>Skala 100%</span></div>
            <section className="photocraft-handoff" aria-label="PhotoCraft runtime">
              <div className="section-heading"><span>PHOTOCRAFT RUNTIME</span><span className={runtime?.available ? "runtime-state available" : "runtime-state"}>{runtime?.available ? "CLI AKTIF" : "CLI"}</span></div>
              <p>{runtimeError || runtime?.message || "Memeriksa runtime PhotoCraft…"}</p>
              {runtime?.version && <code>{runtime.version}</code>}
              <small>Handoff raster sisi aktif ke .pcraft + semantic manifest JSON. Layer editable penuh belum diterapkan.</small>
              <button type="button" className="secondary-button full-width" disabled={exporting || !runtime?.available} onClick={() => onPhotoCraft(includeBlangko)}>{exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}Ekspor .pcraft sisi aktif</button>
            </section>
          </div>
          <aside className="export-preflight">
            <span className="eyebrow">PREFLIGHT · SISI AKTIF</span>
            <h3>{errors.length} galat, {issues.length - errors.length} peringatan</h3>
            <div className="export-issue-list">
              {issues.length === 0 && <p className="success-copy">Tidak ada masalah pada sisi aktif.</p>}
              {issues.map((issue, index) => <div className={issue.severity === "error" ? "export-issue error" : "export-issue"} key={`${issue.code}-${index}`}><AlertTriangle size={14} /><span>{issue.message}</span></div>)}
            </div>
            {errors.length > 0 && !includeBlangko && <p className="error-copy">Selesaikan galat atau pilih preview komposit untuk melanjutkan.</p>}
          </aside>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onMaster}><FileJson size={16} />Unduh master JSON</button>
          <div><button type="button" className="secondary-button" onClick={onClose} disabled={exporting}>Batal</button><button type="button" className="primary-button" disabled={exporting || (errors.length > 0 && !includeBlangko)} onClick={() => onExport({ format, sideIds: allSides ? ["outside", "inside"] : [sideId], includeBlangko })}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{exporting ? "Membuat output…" : "Ekspor sekarang"}</button></div>
        </footer>
      </section>
    </div>
  );
}
