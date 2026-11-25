import { useEffect, useRef, useState } from "react";
import { Cpu, Download, Eye, EyeOff, FileCode2, LoaderCircle, RefreshCw } from "lucide-react";
import type { DesignNode, InvitationDocument, SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "@/lib/builtin-assets";
import { PhotoCraftCanvasBridge, downloadNativeBytes, photoCraftBytes } from "@/lib/photocraft-canvas";
import { usePhotoCraftRuntime } from "./usePhotoCraftRuntime";

interface CanvasEditorProps {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  selectedNodeId: string | null;
  showBlangko: boolean;
  showGuides: boolean;
  zoom: number;
  onSideChange: (side: SideId) => void;
  onSelectNode: (id: string | null) => void;
  onUpdateNode: (id: string, patch: Partial<DesignNode>) => void;
  onToggleBlangko: () => void;
  onToggleGuides: () => void;
  onZoomChange: (zoom: number) => void;
}

export function CanvasEditor(props: CanvasEditorProps) {
  const { document, sideId, assets, selectedNodeId, showBlangko, onSideChange, onSelectNode, onToggleBlangko } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<PhotoCraftCanvasBridge | null>(null);
  const openedSnapshot = useRef<object | null>(null);
  const baselineRevision = useRef<number | null>(null);
  const latestContentRevision = useRef<number | null>(null);
  const opening = useRef(false);
  const selectedRef = useRef(selectedNodeId);
  const nativeSideRef = useRef<SideId>(sideId);
  const [ready, setReady] = useState(false);
  const [openingDocument, setOpeningDocument] = useState(false);
  const [nativeDirty, setNativeDirty] = useState(false);
  const nativeDirtyRef = useRef(false);
  const [canonicalPending, setCanonicalPending] = useState(false);
  const [nativeRevision, setNativeRevision] = useState<number | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const runtime = usePhotoCraftRuntime({ document, sideId, assets, includeBlangko: showBlangko, enabled: true });

  useEffect(() => { selectedRef.current = selectedNodeId; }, [selectedNodeId]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = new PhotoCraftCanvasBridge();
    bridgeRef.current = bridge;
    bridge.attach(iframe);
    bridge.onRevision((revision) => {
      const current = typeof revision.revision === "number" ? revision.revision : null;
      const content = typeof revision.pixelRevision === "number" ? revision.pixelRevision : current;
      setNativeRevision(current);
      latestContentRevision.current = content;
      if (baselineRevision.current === null && content !== null) {
        baselineRevision.current = content;
        nativeDirtyRef.current = false;
        setNativeDirty(false);
      } else if (content !== baselineRevision.current) {
        nativeDirtyRef.current = true;
        setNativeDirty(true);
      }
      const selected = revision.selected?.find((layer) => layer.name.startsWith("blangko-node:"));
      if (selected) {
        const id = selected.name.slice("blangko-node:".length);
        if (selectedRef.current !== id) onSelectNode(id);
      } else if (selectedRef.current) {
        onSelectNode(null);
      }
    });
    void bridge.whenReady()
      .then(() => setReady(true))
      .catch((error: unknown) => setBridgeError(error instanceof Error ? error.message : "PhotoCraft WASM gagal dimuat."));
    return () => {
      bridge.detach();
      bridgeRef.current = null;
      openedSnapshot.current = null;
      baselineRevision.current = null;
      latestContentRevision.current = null;
      nativeDirtyRef.current = false;
      opening.current = false;
      setReady(false);
    };
  }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const snapshot = runtime.snapshot;
    const bridge = bridgeRef.current;
    if (!ready || !snapshot?.fileBase64 || !bridge || openedSnapshot.current === snapshot || opening.current) return;
    if (nativeDirtyRef.current && openedSnapshot.current) {
      setCanonicalPending(true);
      return;
    }
    setCanonicalPending(false);
    opening.current = true;
    setOpeningDocument(true);
    setBridgeError(null);
    baselineRevision.current = null;
    latestContentRevision.current = null;
    void bridge.open(snapshot.fileName || `blangko-${sideId}.pcraft`, photoCraftBytes(snapshot.fileBase64))
      .then(() => {
        openedSnapshot.current = snapshot;
        nativeSideRef.current = sideId;
        nativeDirtyRef.current = false;
        setNativeDirty(false);
      })
      .catch((error: unknown) => setBridgeError(error instanceof Error ? error.message : "Dokumen native gagal dibuka."))
      .finally(() => {
        opening.current = false;
        setOpeningDocument(false);
      });
  }, [ready, runtime.snapshot, sideId, openingDocument]);

  useEffect(() => {
    if (!ready || !selectedNodeId || nativeDirty) return;
    // Selection originating in the parent inspector is projected to the native layer.
    // A native dirty document remains authoritative until the next canonical open.
    void bridgeRef.current?.command("engine.execute", {
      command: "layer.select",
      params: { layer: `blangko-node:${selectedNodeId}` },
    }).catch(() => undefined);
  }, [selectedNodeId, ready, nativeDirty]);

  const exportNative = async (format: "pcraft" | "png") => {
    const bridge = bridgeRef.current;
    if (!bridge || exporting) return;
    setExporting(true);
    setBridgeError(null);
    try {
      const result = await bridge.export(format);
      downloadNativeBytes(
        result.bytes,
        `${document.title.replace(/[^a-z0-9-_]+/gi, "-")}-${nativeSideRef.current}-native.${format}`,
        format === "png" ? "image/png" : "application/octet-stream",
      );
      if (format === "pcraft") {
        baselineRevision.current = latestContentRevision.current;
        nativeDirtyRef.current = false;
        setNativeDirty(false);
      }
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : "Ekspor native gagal.");
    } finally {
      setExporting(false);
    }
  };

  const reloadNative = (discardNative = false) => {
    if (discardNative && nativeDirtyRef.current && !window.confirm("Muat versi proyek dan mengganti dokumen native yang belum diekspor?")) return;
    nativeDirtyRef.current = false;
    setNativeDirty(false);
    setCanonicalPending(false);
    setBridgeError(null);
    setReloadToken((value) => value + 1);
    runtime.retry();
  };

  const error = bridgeError || runtime.error;
  const loading = !ready || runtime.syncing || openingDocument;

  return (
    <section className="canvas-workspace" aria-label="Workspace PhotoCraft native">
      <div className="canvas-toolbar">
        <div className="side-tabs" aria-label="Sisi undangan">
          {document.sides.map((item) => (
            <button key={item.id} type="button" className={item.id === sideId ? "side-tab active" : "side-tab"} onClick={() => { onSideChange(item.id); onSelectNode(null); }}>
              {item.label}<span>{item.id === "outside" ? "A" : "B"}</span>
            </button>
          ))}
        </div>
        <div className="canvas-view-actions">
          <span className="icon-text-button active" title="Fork PhotoCraft WASM dengan bridge dokumen dua arah"><Cpu size={15} /> PhotoCraft Native</span>
          <button type="button" className={showBlangko ? "icon-text-button active" : "icon-text-button"} onClick={onToggleBlangko} aria-pressed={showBlangko}>
            {showBlangko ? <Eye size={15} /> : <EyeOff size={15} />} Blangko
          </button>
          <button type="button" className="icon-text-button" disabled={!ready || exporting || loading} onClick={() => void exportNative("png")} title="Render dan unduh PNG dari dokumen native yang sedang aktif">
            {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} PNG
          </button>
          <button type="button" className="icon-text-button" disabled={!ready || exporting || loading} onClick={() => void exportNative("pcraft")} title="Unduh .pcraft dari dokumen native, termasuk perubahan di canvas">
            <FileCode2 size={15} /> .pcraft
          </button>
        </div>
      </div>

      <div className="photocraft-native-stage">
        <iframe
          key={reloadToken}
          ref={iframeRef}
          className="photocraft-native-frame"
          src="/photocraft/index.html"
          title="PhotoCraft native canvas"
          allow="clipboard-read; clipboard-write"
          data-testid="photocraft-native-canvas"
        />
        {loading && !error && (
          <div className="photocraft-native-loading">
            <LoaderCircle className="spin" size={24} />
            <strong>{!ready ? "Memuat PhotoCraft WASM…" : "Membuka dokumen native…"}</strong>
            <small>Menyiapkan Type, Shape, Smart Object, seleksi, dan transformasi native.</small>
          </div>
        )}
        {error && (
          <div className="photocraft-native-loading error" role="alert">
            <strong>Canvas native belum dapat disinkronkan</strong>
            <small>{error}</small>
            <button type="button" className="secondary-button" onClick={() => reloadNative(true)}><RefreshCw size={14} />Muat ulang canvas</button>
          </div>
        )}
      </div>

      <div className="canvas-statusbar">
        <span>{document.stock.width} × {document.stock.height} mm</span>
        <span className="status-separator" />
        <span>{document.stock.targetPpi} ppi</span>
        <span className="status-separator" />
        <span className={`native-canvas-badge ${nativeDirty ? "dirty" : ""}`}>
          {loading && <LoaderCircle size={12} className="spin" />}
          {nativeDirty ? `Revisi native ${nativeRevision ?? "—"} · belum diekspor` : ready ? "Native canvas · tersinkron" : "WASM starting"}
        </span>
        {canonicalPending && <button type="button" className="native-sync-pending" onClick={() => reloadNative(true)} title="Versi proyek berubah. Dokumen native dipertahankan sampai Anda memilih memuatnya.">Versi proyek tertunda · Muat</button>}
        <span className="panel-hint">Gunakan .pcraft / PNG di toolbar untuk hasil edit native terbaru.</span>
      </div>
    </section>
  );
}
