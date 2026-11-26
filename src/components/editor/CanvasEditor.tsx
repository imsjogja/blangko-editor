import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Download, Eye, EyeOff, FileCode2, LoaderCircle, RefreshCw } from "lucide-react";
import type { InvitationDocument, SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "@/lib/builtin-assets";
import { PhotoCraftCanvasBridge, downloadNativeBytes, photoCraftBytes } from "@/lib/photocraft-canvas";
import { sideContentKey } from "@/lib/photocraft-runtime";
import { captureBoundsBaseline, mapInspectToWriteBack, type NativeBoundsBaseline } from "@/lib/photocraft-writeback";
import { usePhotoCraftRuntime } from "./usePhotoCraftRuntime";

interface CanvasEditorProps {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  selectedNodeId: string | null;
  showBlangko: boolean;
  onSideChange: (side: SideId) => void;
  onSelectNode: (id: string | null) => void;
  onToggleBlangko: () => void;
  /** Native edits mapped back onto the canonical document (one undoable revision per batch). */
  onWriteBack?: (next: InvitationDocument) => void;
}

const WRITEBACK_DEBOUNCE_MS = 800;
const MAX_ECHO_KEYS = 8;

/**
 * A native PhotoCraft document (tab) held open inside the WASM session
 * (bridge protocol ≥ 3). Everything that used to be a single global — clean
 * baseline, bounds baseline, write-back guard — is per document so both sides
 * of the invitation stay alive at once.
 */
interface NativeDocRecord {
  docId: number;
  sideId: SideId;
  /** Content key of the canonical snapshot this tab was opened with. */
  key: string | null;
  /** Content revision considered "in sync with canonical"; null until the first revision event. */
  baselineRevision: number | null;
  /** Latest content revision observed for this tab. */
  latestContent: number | null;
  /** Open-time layer bounds for delta-based geometry write-back. */
  baselineBounds: NativeBoundsBaseline;
  /** Last content revision already handed to the write-back debounce. */
  lastWriteBack: number | null;
  dirty: boolean;
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
  const [hasNativeDocument, setHasNativeDocument] = useState(false);
  const [openingDocument, setOpeningDocument] = useState(false);
  const [nativeDirty, setNativeDirty] = useState(false);
  const nativeDirtyRef = useRef(false);
  const [canonicalPending, setCanonicalPending] = useState(false);
  /** Blangko projection currently shown by the open native tab. */
  const nativeBlangkoRef = useRef<boolean | null>(null);
  const [nativeRevision, setNativeRevision] = useState<number | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const runtime = usePhotoCraftRuntime({ document, sideId, assets, includeBlangko: showBlangko, enabled: true });

  // Mirrors for async write-back callbacks (they run after later renders).
  const documentRef = useRef(document);
  const assetsRef = useRef(assets);
  const showBlangkoRef = useRef(showBlangko);
  const onWriteBackRef = useRef(props.onWriteBack);
  const onSideChangeRef = useRef(onSideChange);
  // Legacy single-document state (bridge protocol < 3) plus the per-document
  // table used once the multi-document bridge is live.
  const baselineBoundsRef = useRef<NativeBoundsBaseline>(new Map());
  const pendingEchoKeys = useRef<Set<string>>(new Set());
  const writeBackTimer = useRef<number | null>(null);
  const lastWriteBackRevision = useRef<number | null>(null);
  const docsRef = useRef<Map<number, NativeDocRecord>>(new Map());
  const activeDocRef = useRef<number | null>(null);

  useEffect(() => { selectedRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => { showBlangkoRef.current = showBlangko; }, [showBlangko]);

  // A blangko toggle while a native tab is open must never silently reopen
  // and drop the user's place or unexported edit. The fresh canonical
  // snapshot for the new projection is still rendering in the background at
  // this point, so watch the toggle itself and surface the pending choice.
  useEffect(() => {
    if (nativeBlangkoRef.current !== null && showBlangko !== nativeBlangkoRef.current && hasNativeDocument) {
      setCanonicalPending(true);
    }
  }, [showBlangko, hasNativeDocument]);
  useEffect(() => { onWriteBackRef.current = props.onWriteBack; });
  useEffect(() => { onSideChangeRef.current = onSideChange; });

  const recordForSide = (side: SideId): NativeDocRecord | undefined =>
    [...docsRef.current.values()].find((record) => record.sideId === side);

  const rememberEchoKey = (key: string) => {
    const keys = pendingEchoKeys.current;
    if (keys.size >= MAX_ECHO_KEYS) keys.delete(keys.values().next().value as string);
    keys.add(key);
  };

  // Map native edits back onto the canonical document. Best-effort: when the
  // running WASM build predates the inspect request (protocol < 2), write-back
  // stays off and the manual .pcraft export remains the fallback path. With
  // protocol ≥ 3 the inspection targets the edited tab directly, so a pending
  // write-back survives the user switching sides in between.
  const runWriteBack = useCallback(async (docId?: number) => {
    const bridge = bridgeRef.current;
    const onWriteBack = onWriteBackRef.current;
    if (!bridge?.supportsInspect || !onWriteBack || !openedSnapshot.current) return;
    const record = docId !== undefined ? docsRef.current.get(docId) : undefined;
    try {
      const inspect = await bridge.inspect(record?.docId);
      const side = record ? record.sideId : nativeSideRef.current;
      const baseline = record ? record.baselineBounds : baselineBoundsRef.current;
      const mapped = mapInspectToWriteBack(documentRef.current, side, inspect, baseline);
      if (!mapped || !mapped.patches.length) return;
      // The server render this change triggers is an echo of content the native
      // canvas already shows: it is adopted by content key without reopening,
      // so native undo history and unmapped properties survive.
      rememberEchoKey(sideContentKey(mapped.document, side, assetsRef.current, showBlangkoRef.current));
      if (record) {
        record.baselineBounds = captureBoundsBaseline(inspect);
        // Everything observed so far is now persisted canonically.
        record.baselineRevision = record.latestContent;
        record.dirty = false;
        if (record.docId === activeDocRef.current) {
          nativeDirtyRef.current = false;
          setNativeDirty(false);
        }
      } else {
        baselineBoundsRef.current = captureBoundsBaseline(inspect);
      }
      onWriteBack(mapped.document);
    } catch {
      // A failed write-back only delays canonical persistence of the edit.
    }
  }, []);

  const scheduleWriteBack = useCallback((docId: number | null, contentRevision: number | null) => {
    if (contentRevision === null) return;
    if (docId !== null) {
      const record = docsRef.current.get(docId);
      if (!record || record.baselineRevision === null) return;
      if (contentRevision === record.lastWriteBack) return;
      record.lastWriteBack = contentRevision;
    } else {
      if (baselineRevision.current === null || !openedSnapshot.current) return;
      if (contentRevision === lastWriteBackRevision.current) return;
      lastWriteBackRevision.current = contentRevision;
    }
    if (writeBackTimer.current !== null) window.clearTimeout(writeBackTimer.current);
    writeBackTimer.current = window.setTimeout(() => {
      writeBackTimer.current = null;
      void runWriteBack(docId ?? undefined);
    }, WRITEBACK_DEBOUNCE_MS);
  }, [runWriteBack]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const echoKeys = pendingEchoKeys.current;
    const docs = docsRef.current;
    const bridge = new PhotoCraftCanvasBridge();
    bridgeRef.current = bridge;
    bridge.attach(iframe);
    bridge.onRevision((revision) => {
      const current = typeof revision.revision === "number" ? revision.revision : null;
      const content = typeof revision.pixelRevision === "number" ? revision.pixelRevision : current;
      const docId = typeof revision.document === "number" ? revision.document : null;
      const record = docId !== null && bridge.supportsMultiDocument ? docs.get(docId) : undefined;

      if (record) {
        record.latestContent = content;
        activeDocRef.current = record.docId;
        // A revision from a tab that is not the side the parent shows means the
        // user clicked the tab inside the native canvas: follow it.
        if (record.sideId !== nativeSideRef.current) {
          nativeSideRef.current = record.sideId;
          onSideChangeRef.current(record.sideId);
        }
        const hadBaseline = record.baselineRevision !== null;
        if (record.baselineRevision === null && content !== null) {
          record.baselineRevision = content;
          record.dirty = false;
        } else if (content !== record.baselineRevision) {
          record.dirty = true;
          if (hadBaseline && content !== null) scheduleWriteBack(record.docId, content);
        }
        setNativeRevision(current);
        nativeDirtyRef.current = record.dirty;
        setNativeDirty(record.dirty);
      } else {
        const hadBaseline = baselineRevision.current !== null;
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
        // A content revision past the established baseline is a native edit:
        // debounce it into a canonical write-back.
        if (hadBaseline && content !== null && content !== baselineRevision.current) {
          scheduleWriteBack(null, content);
        }
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
      nativeBlangkoRef.current = null;
      baselineRevision.current = null;
      latestContentRevision.current = null;
      nativeDirtyRef.current = false;
      opening.current = false;
      lastWriteBackRevision.current = null;
      docs.clear();
      activeDocRef.current = null;
      if (writeBackTimer.current !== null) {
        window.clearTimeout(writeBackTimer.current);
        writeBackTimer.current = null;
      }
      echoKeys.clear();
      setReady(false);
      setHasNativeDocument(false);
    };
  }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const snapshot = runtime.snapshot;
    const bridge = bridgeRef.current;
    if (!ready || !snapshot?.fileBase64 || !bridge || bridgeError || openedSnapshot.current === snapshot) return;

    // Pending-canonical guard: a blangko toggle while a native tab is open
    // must never silently reopen and drop the user's place/edit. Surface the
    // choice to load the new projection instead. This runs before the
    // `opening` early-return so a toggle arriving mid-reopen is not swallowed.
    // The toggle is detected either from the snapshot's own projection flag or
    // from a stale cache entry whose flag is missing but no longer matches the
    // requested state.
    const snapshotBlangko = snapshot.includeBlangko !== undefined
      ? snapshot.includeBlangko
      : showBlangkoRef.current;
    if (
      openedSnapshot.current &&
      nativeBlangkoRef.current !== null &&
      snapshotBlangko !== nativeBlangkoRef.current
    ) {
      setCanonicalPending(true);
      return;
    }

    if (opening.current) return;
    const multi = bridge.supportsMultiDocument;
    const record = multi ? recordForSide(sideId) : undefined;

    if (snapshot.key && pendingEchoKeys.current.delete(snapshot.key)) {
      // Echo of a native write-back: the canvas already shows this content.
      // Adopt the snapshot as the new baseline without reopening, so native
      // undo history and unmapped native-only properties survive.
      //
      // Race guard: the write-back debounce may capture a content key that
      // already includes a blangko toggle made *after* the native edit. Such
      // a snapshot is NOT a pure echo — the open native tab still shows the
      // old blangko state. Keep the native document authoritative and surface
      // the pending-canonical choice instead of silently clearing the dirty
      // flag (which would drop the user's unexported native edit).
      const blangkoMismatch = snapshot.includeBlangko !== undefined && snapshot.includeBlangko !== showBlangkoRef.current;
      openedSnapshot.current = snapshot;
      nativeSideRef.current = sideId;
      if (snapshot.includeBlangko !== undefined) nativeBlangkoRef.current = snapshot.includeBlangko;
      if (record) {
        record.key = snapshot.key;
        if (!blangkoMismatch) {
          record.baselineRevision = record.latestContent;
          record.dirty = false;
          if (activeDocRef.current !== record.docId) {
            void bridge.activate(record.docId).catch(() => undefined);
          }
        }
      } else if (!blangkoMismatch) {
        baselineRevision.current = latestContentRevision.current;
      }
      if (blangkoMismatch) {
        nativeDirtyRef.current = true;
        setNativeDirty(true);
        setCanonicalPending(true);
        return;
      }
      nativeDirtyRef.current = false;
      setNativeDirty(false);
      setCanonicalPending(false);
      return;
    }

    // Multi-document fast path: this side's tab is already open with exactly
    // this content — switching is a native tab activation, no reopen.
    if (record && record.key !== null && record.key === snapshot.key) {
      openedSnapshot.current = snapshot;
      nativeSideRef.current = sideId;
      if (snapshot.includeBlangko !== undefined) nativeBlangkoRef.current = snapshot.includeBlangko;
      nativeDirtyRef.current = record.dirty;
      setNativeDirty(record.dirty);
      setCanonicalPending(false);
      setHasNativeDocument(true);
      if (activeDocRef.current !== record.docId) {
        void bridge.activate(record.docId).catch((error: unknown) => setBridgeError(error instanceof Error ? error.message : "Dokumen native gagal diaktifkan."));
      }
      return;
    }

    if (nativeDirtyRef.current && openedSnapshot.current) {
      // The canonical document changed elsewhere while this tab holds native
      // edits: keep the native document alive until the user chooses to load.
      setCanonicalPending(true);
      return;
    }
    setCanonicalPending(false);
    opening.current = true;
    setOpeningDocument(true);
    setBridgeError(null);
    baselineRevision.current = null;
    latestContentRevision.current = null;
    lastWriteBackRevision.current = null;
    void bridge.open(snapshot.fileName || `blangko-${sideId}.pcraft`, photoCraftBytes(snapshot.fileBase64))
      .then(({ document: docId }) => {
        openedSnapshot.current = snapshot;
        nativeSideRef.current = sideId;
        if (snapshot.includeBlangko !== undefined) nativeBlangkoRef.current = snapshot.includeBlangko;
        nativeDirtyRef.current = false;
        setNativeDirty(false);
        setHasNativeDocument(true);
        if (multi && docId !== null) {
          // Replace this side's stale tab, if any, so tabs never accumulate.
          const previous = recordForSide(sideId);
          if (previous && previous.docId !== docId) {
            docsRef.current.delete(previous.docId);
            void bridge.close(previous.docId).catch(() => undefined);
          }
          const next: NativeDocRecord = {
            docId,
            sideId,
            key: snapshot.key ?? null,
            baselineRevision: null,
            latestContent: null,
            baselineBounds: new Map(),
            lastWriteBack: null,
            dirty: false,
          };
          docsRef.current.set(docId, next);
          activeDocRef.current = docId;
          // Open-time bounds baseline for delta-based geometry write-back.
          if (bridge.supportsInspect) {
            void bridge.inspect(docId)
              .then((inspect) => { next.baselineBounds = captureBoundsBaseline(inspect); })
              .catch(() => undefined);
          }
        } else if (bridge.supportsInspect) {
          void bridge.inspect()
            .then((inspect) => { baselineBoundsRef.current = captureBoundsBaseline(inspect); })
            .catch(() => undefined);
        }
      })
      .catch((error: unknown) => setBridgeError(error instanceof Error ? error.message : "Dokumen native gagal dibuka."))
      .finally(() => {
        opening.current = false;
        setOpeningDocument(false);
      });
  }, [ready, runtime.snapshot, sideId, openingDocument, bridgeError]);

  useEffect(() => {
    if (!ready || !selectedNodeId || nativeDirty) return;
    // Selection originating in the parent panel is projected to the native layer.
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
        const record = activeDocRef.current !== null ? docsRef.current.get(activeDocRef.current) : undefined;
        if (record) {
          record.baselineRevision = record.latestContent;
          record.dirty = false;
        }
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
    const bridge = bridgeRef.current;
    if (bridge?.supportsMultiDocument) {
      // Keep the WASM session (and the other side's tab) alive: drop only this
      // side's native tab so the open effect re-imports it from the project.
      const record = recordForSide(nativeSideRef.current);
      if (record) {
        docsRef.current.delete(record.docId);
        void bridge.close(record.docId).catch(() => undefined);
      }
      nativeDirtyRef.current = false;
      setNativeDirty(false);
      setCanonicalPending(false);
      setBridgeError(null);
      openedSnapshot.current = null;
      nativeBlangkoRef.current = null;
      lastWriteBackRevision.current = null;
      runtime.retry();
      return;
    }
    nativeDirtyRef.current = false;
    setNativeDirty(false);
    setCanonicalPending(false);
    setBridgeError(null);
    pendingEchoKeys.current.clear();
    baselineBoundsRef.current = new Map();
    lastWriteBackRevision.current = null;
    setReloadToken((value) => value + 1);
    runtime.retry();
  };

  const runtimeUnavailable = runtime.status && !runtime.status.available ? runtime.status.message : null;
  const error = bridgeError || runtime.error || runtimeUnavailable;
  const blockingLoading = !ready || (!hasNativeDocument && !error);
  const backgroundBusy = hasNativeDocument && (runtime.syncing || openingDocument);
  const exportDisabled = !ready || !hasNativeDocument || exporting || openingDocument;

  const retryBackground = () => {
    setBridgeError(null);
    runtime.retry();
  };

  // With the multi-document bridge (protocol ≥ 3) a side switch keeps the
  // native tab alive, so no edits are lost and no confirmation is needed.
  // The single-document fallback still closes the document on open, hence the
  // confirmation there.
  const requestSideChange = (nextSide: SideId) => {
    if (nextSide === sideId) return;
    const multi = bridgeRef.current?.supportsMultiDocument ?? false;
    if (!multi && nativeDirtyRef.current) {
      const label = document.sides.find((item) => item.id === sideId)?.label ?? sideId;
      const message = `Perubahan native sisi ${label} belum diekspor dan akan hilang saat berpindah sisi. Lanjutkan?`;
      if (!window.confirm(message)) return;
      nativeDirtyRef.current = false;
      setNativeDirty(false);
      setCanonicalPending(false);
      // Echo keys and bounds baselines are per-side state.
      pendingEchoKeys.current.clear();
      baselineBoundsRef.current = new Map();
      lastWriteBackRevision.current = null;
    }
    onSideChange(nextSide);
    onSelectNode(null);
  };

  return (
    <section className="canvas-workspace" aria-label="Workspace PhotoCraft native">
      <div className="canvas-toolbar">
        <div className="side-tabs" aria-label="Sisi undangan">
          {document.sides.map((item) => (
            <button key={item.id} type="button" className={item.id === sideId ? "side-tab active" : "side-tab"} onClick={() => requestSideChange(item.id)}>
              {item.label}<span>{item.id === "outside" ? "A" : "B"}</span>
            </button>
          ))}
        </div>
        <div className="canvas-view-actions">
          <span className="icon-text-button active" title="Fork PhotoCraft WASM dengan bridge dokumen dua arah"><Cpu size={15} /> PhotoCraft Native</span>
          <button type="button" className={showBlangko ? "icon-text-button active" : "icon-text-button"} onClick={onToggleBlangko} aria-pressed={showBlangko}>
            {showBlangko ? <Eye size={15} /> : <EyeOff size={15} />} Blangko
          </button>
          <button type="button" className="icon-text-button" disabled={exportDisabled} onClick={() => void exportNative("png")} title="Render dan unduh PNG dari dokumen native yang sedang aktif">
            {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} PNG
          </button>
          <button type="button" className="icon-text-button" disabled={exportDisabled} onClick={() => void exportNative("pcraft")} title="Unduh .pcraft dari dokumen native, termasuk perubahan di canvas">
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
        {blockingLoading && !error && (
          <div className="photocraft-native-loading">
            <LoaderCircle className="spin" size={24} />
            <strong>{!ready ? "Memuat PhotoCraft WASM…" : "Menyiapkan dokumen native…"}</strong>
            <small>Menyiapkan Type, Shape, Smart Object, seleksi, dan transformasi native.</small>
          </div>
        )}
        {error && !hasNativeDocument && (
          <div className="photocraft-native-loading error" role="alert">
            <strong>Canvas native belum dapat disinkronkan</strong>
            <small>{error}</small>
            <button type="button" className="secondary-button" onClick={() => reloadNative(true)}><RefreshCw size={14} />Muat ulang canvas</button>
          </div>
        )}
        {backgroundBusy && !error && (
          <div className="photocraft-native-background-status" role="status">
            <LoaderCircle size={13} className="spin" /> Sinkronisasi latar belakang · canvas tetap aktif
          </div>
        )}
        {hasNativeDocument && error && (
          <div className="photocraft-native-background-status error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={retryBackground}><RefreshCw size={12} />Coba lagi</button>
          </div>
        )}
      </div>

      <div className="canvas-statusbar">
        <span>{document.stock.width} × {document.stock.height} mm</span>
        <span className="status-separator" />
        <span>{document.stock.targetPpi} ppi</span>
        <span className="status-separator" />
        <span className={`native-canvas-badge ${nativeDirty ? "dirty" : ""}`}>
          {(blockingLoading || backgroundBusy) && <LoaderCircle size={12} className="spin" />}
          {nativeDirty
            ? `Revisi native ${nativeRevision ?? "—"} · belum diekspor`
            : backgroundBusy
              ? "Native aktif · menyinkronkan"
              : ready && hasNativeDocument ? "Native canvas · tersinkron" : "WASM starting"}
        </span>
        {canonicalPending && <button type="button" className="native-sync-pending" onClick={() => reloadNative(true)} title="Versi proyek berubah. Dokumen native dipertahankan sampai Anda memilih memuatnya.">Versi proyek tertunda · Muat</button>}
        <span className="panel-hint">{backgroundBusy ? "Edit dan ekspor dokumen aktif tetap tersedia." : "Gunakan .pcraft / PNG di toolbar untuk hasil edit native terbaru."}</span>
      </div>
    </section>
  );
}
