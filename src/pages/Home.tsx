import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { BookOpen, Check, Cloud, CloudOff, Download, LoaderCircle, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Redo2, Save, Undo2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import type { BaseEvent } from "@ag-ui/core";
import {
  applyDesignProposal,
  createInitialDocument,
  getSide,
  invitationDocumentSchema,
  runPreflight,
  type DesignNode,
  type DesignProposal,
  type DesignStyle,
  type InvitationDocument,
  type ProjectAsset,
  type SideId,
} from "@contracts/invitation";
import { trpc } from "@/providers/trpc";
import { CanvasEditor } from "@/components/editor/CanvasEditor";
import { LeftPanel, type AgentProgress } from "@/components/editor/LeftPanel";
import { Inspector } from "@/components/editor/Inspector";
import { ExportDialog, type ExportOptions } from "@/components/editor/ExportDialog";
import { exportMaster, exportPng, exportPrintPdf } from "@/lib/export";
import { resolveAssetUrls, type AssetUrlMap } from "@/lib/builtin-assets";
import { prepareImage } from "@/lib/uploads";
import { analyzeBlangkoFile } from "@/lib/blangko-analysis";
import { exportPhotoCraftHandoff } from "@/lib/photocraft-runtime";
import { applyBlangkoAnalysis, removeAssetFromDocument } from "@contracts/smart-canvas";

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type DomainEvent = BaseEvent & { name?: string; value?: unknown; message?: string };

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const initialDocument = useRef(createInitialDocument());
  const [document, setDocument] = useState<InvitationDocument>(initialDocument.current);
  const documentRef = useRef(document);
  const revisionRef = useRef(1);
  const [projectReady, setProjectReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<AssetUrlMap>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [sideId, setSideId] = useState<SideId>("outside");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showBlangko, setShowBlangko] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [past, setPast] = useState<InvitationDocument[]>([]);
  const [future, setFuture] = useState<InvitationDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentProgress, setAgentProgress] = useState<AgentProgress[]>([]);
  const [proposal, setProposal] = useState<DesignProposal | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mobileLeft, setMobileLeft] = useState(false);
  const [mobileRight, setMobileRight] = useState(false);
  const [desktopLeft, setDesktopLeft] = useState(true);
  const [desktopRight, setDesktopRight] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 940px)").matches);
  const createStarted = useRef(false);

  const createProject = trpc.project.create.useMutation();
  const saveProject = trpc.project.save.useMutation();
  const uploadAsset = trpc.project.uploadAsset.useMutation();
  const projectQuery = trpc.project.get.useQuery(
    { projectId: projectId || "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(projectId), retry: false },
  );

  useEffect(() => { documentRef.current = document; }, [document]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 940px)");
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) {
        setMobileLeft(false);
        setMobileRight(false);
      }
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!projectId && !createStarted.current) {
      createStarted.current = true;
      setInitError(null);
      createProject.mutateAsync({ document: initialDocument.current })
        .then(({ project }) => {
          revisionRef.current = project.revision;
          setDocument(initialDocument.current);
          setProjectReady(true);
          setSearchParams({ project: project.id }, { replace: true });
        })
        .catch((error) => setInitError(error instanceof Error ? error.message : "Proyek gagal dibuat."));
    }
  }, [projectId, createProject, setSearchParams]);

  useEffect(() => {
    if (!projectQuery.data) return;
    const parsed = invitationDocumentSchema.safeParse(projectQuery.data.project.document);
    if (!parsed.success) {
      setInitError("Skema dokumen pada revisi tersimpan tidak valid.");
      return;
    }
    setDocument(parsed.data);
    documentRef.current = parsed.data;
    revisionRef.current = projectQuery.data.project.revision;
    const uploaded = Object.fromEntries(projectQuery.data.assets.map((asset) => [asset.id, asset.url]));
    setAssetUrls(uploaded);
    setProjectReady(true);
    setSaveStatus("saved");
    setInitError(null);
  }, [projectQuery.data]);

  useEffect(() => {
    if (projectQuery.error) setInitError(projectQuery.error.message);
  }, [projectQuery.error]);

  const changeDocument = useCallback((next: InvitationDocument) => {
    const current = documentRef.current;
    setPast((items) => [...items.slice(-39), current]);
    setFuture([]);
    documentRef.current = next;
    setDocument(next);
    setSaveStatus("dirty");
  }, []);

  const saveNow = useCallback(async () => {
    if (!projectId || !projectReady || saveStatus === "saving") return;
    const snapshot = documentRef.current;
    const baseRevision = revisionRef.current;
    setSaveStatus("saving");
    try {
      const result = await saveProject.mutateAsync({ projectId, baseRevision, document: snapshot });
      revisionRef.current = result.revision;
      setSaveStatus(documentRef.current === snapshot ? "saved" : "dirty");
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Dokumen gagal disimpan.");
    }
  }, [projectId, projectReady, saveStatus, saveProject]);

  useEffect(() => {
    if (saveStatus !== "dirty" || !projectReady) return;
    const timer = window.setTimeout(() => { void saveNow(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [document, saveStatus, projectReady, saveNow]);

  const undo = useCallback(() => {
    const previous = past.at(-1);
    if (!previous) return;
    const current = documentRef.current;
    setFuture((items) => [current, ...items]);
    setPast((items) => items.slice(0, -1));
    documentRef.current = previous;
    setDocument(previous);
    setSaveStatus("dirty");
    setSelectedNodeId(null);
  }, [past]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    const current = documentRef.current;
    setPast((items) => [...items, current]);
    setFuture((items) => items.slice(1));
    documentRef.current = next;
    setDocument(next);
    setSaveStatus("dirty");
    setSelectedNodeId(null);
  }, [future]);

  const updateNode = useCallback((id: string, patch: Partial<DesignNode>) => {
    const current = documentRef.current;
    changeDocument({
      ...current,
      sides: current.sides.map((side) => side.id === sideId
        ? { ...side, nodes: side.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }
        : side),
    });
  }, [changeDocument, sideId]);

  const deleteNode = useCallback((id: string) => {
    const current = documentRef.current;
    changeDocument({ ...current, sides: current.sides.map((side) => side.id === sideId ? { ...side, nodes: side.nodes.filter((node) => node.id !== id) } : side) });
    setSelectedNodeId(null);
  }, [changeDocument, sideId]);

  const duplicateNode = (id: string) => {
    const current = documentRef.current;
    const side = getSide(current, sideId);
    const original = side.nodes.find((node) => node.id === id);
    if (!original) return;
    const duplicate: DesignNode = { ...original, id: crypto.randomUUID(), box: { ...original.box, x: original.box.x + 4, y: original.box.y + 4 }, zIndex: Math.max(...side.nodes.map((node) => node.zIndex)) + 1 };
    changeDocument({ ...current, sides: current.sides.map((item) => item.id === sideId ? { ...item, nodes: [...item.nodes, duplicate] } : item) });
    setSelectedNodeId(duplicate.id);
  };

  const reorderNode = (id: string, direction: "up" | "down") => {
    const current = documentRef.current;
    const side = getSide(current, sideId);
    const ordered = [...side.nodes].sort((a, b) => a.zIndex - b.zIndex);
    const index = ordered.findIndex((node) => node.id === id);
    const other = ordered[index + (direction === "up" ? 1 : -1)];
    const node = ordered[index];
    if (!other || !node) return;
    const nodes = side.nodes.map((item) => item.id === id ? { ...item, zIndex: other.zIndex } : item.id === other.id ? { ...item, zIndex: node.zIndex } : item);
    changeDocument({ ...current, sides: current.sides.map((item) => item.id === sideId ? { ...item, nodes } : item) });
  };

  const addNode = (kind: "text" | "shape") => {
    const current = documentRef.current;
    const side = getSide(current, sideId);
    const fold = side.foldLines.find((item) => item.axis === "vertical");
    const x = sideId === "outside" && fold ? fold.positionMm + 18 : 18;
    const id = crypto.randomUUID();
    const nextZ = Math.max(0, ...side.nodes.map((node) => node.zIndex)) + 1;
    const node: DesignNode = kind === "text"
      ? { id, kind, role: "CONTENT", box: { x, y: 82, width: 92, height: 18 }, rotation: 0, visible: true, locked: false, opacity: 1, zIndex: nextZ, text: "Teks baru", fontSize: 18, fontFamily: "Arial", fontWeight: 400, textAlign: "left", color: "#51483C" }
      : { id, kind, role: "CONTENT", box: { x, y: 82, width: 42, height: 12 }, rotation: 0, visible: true, locked: false, opacity: 1, zIndex: nextZ, backgroundColor: "#6E7254" };
    changeDocument({ ...current, sides: current.sides.map((item) => item.id === sideId ? { ...item, nodes: [...item.nodes, node] } : item) });
    setSelectedNodeId(id);
  };

  const handleUpload = async (file: File, kind: ProjectAsset["kind"]) => {
    if (!projectId) return;
    setUploading(true);
    if (kind === "blangko") setAnalyzing(true);
    try {
      const [prepared, analysis] = await Promise.all([
        prepareImage(file),
        kind === "blangko" ? analyzeBlangkoFile(file) : Promise.resolve(undefined),
      ]);
      const result = await uploadAsset.mutateAsync({ projectId, name: file.name, kind, ...prepared, contentType: file.type });
      const asset: ProjectAsset = { ...result.asset, analysis };
      setAssetUrls((urls) => ({ ...urls, [result.asset.id]: result.url }));
      const current = documentRef.current;
      let next: InvitationDocument = {
        ...current,
        assets: [...current.assets.filter((item) => item.id !== asset.id), asset],
        sides: current.sides.map((side) => side.id === sideId && kind === "blangko" ? { ...side, blangkoAssetId: asset.id } : side),
      };
      if (kind === "blangko" && analysis) {
        next = applyBlangkoAnalysis(next, sideId, asset.id, analysis);
        setZoom(1);
      }
      changeDocument(next);
      toast.success(kind === "blangko" && analysis
        ? `${file.name} dianalisis: ${analysis.widthMm} × ${analysis.heightMm} mm, ${analysis.folds.length} panduan lipat.`
        : `${file.name} berhasil disimpan.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aset gagal diunggah.");
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  };

  const insertAsset = (asset: ProjectAsset) => {
    const current = documentRef.current;
    const side = getSide(current, sideId);
    const maxWidth = 72;
    const ratio = asset.width && asset.height ? asset.width / asset.height : 1.4;
    const width = Math.min(maxWidth, ratio * 58);
    const height = width / ratio;
    const id = crypto.randomUUID();
    const node: DesignNode = { id, kind: "image", role: "CONTENT", box: { x: 28, y: 40, width, height }, rotation: 0, visible: true, locked: false, opacity: 1, zIndex: Math.max(0, ...side.nodes.map((item) => item.zIndex)) + 1, assetId: asset.id };
    changeDocument({ ...current, sides: current.sides.map((item) => item.id === sideId ? { ...item, nodes: [...item.nodes, node] } : item) });
    setSelectedNodeId(id);
  };

  const useBlangko = (asset: ProjectAsset) => {
    const current = documentRef.current;
    if (asset.analysis) {
      changeDocument(applyBlangkoAnalysis(current, sideId, asset.id));
      setZoom(1);
    } else {
      changeDocument({ ...current, stock: { ...current.stock, physicalSizeConfirmed: false }, sides: current.sides.map((side) => side.id === sideId ? { ...side, blangkoAssetId: asset.id } : side) });
    }
    toast.success(`Blangko sisi ${sideId === "outside" ? "luar" : "dalam"} diganti.`);
  };

  const analyzeExistingBlangko = async (asset: ProjectAsset) => {
    const url = resolveAssetUrls(documentRef.current.assets, assetUrls)[asset.id];
    if (!url) {
      toast.error("URL aset tidak tersedia untuk analisis.");
      return;
    }
    setAnalyzing(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("File blangko tidak dapat dibaca.");
      const blob = await response.blob();
      const file = new File([blob], asset.name, { type: blob.type || asset.contentType || "image/png" });
      const analysis = await analyzeBlangkoFile(file);
      const current = documentRef.current;
      const withAnalysis = {
        ...current,
        assets: current.assets.map((item) => item.id === asset.id ? { ...item, analysis } : item),
      };
      changeDocument(applyBlangkoAnalysis(withAnalysis, sideId, asset.id, analysis));
      setZoom(1);
      toast.success("Smart canvas diperbarui dari analisis blangko.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Blangko gagal dianalisis.");
    } finally {
      setAnalyzing(false);
    }
  };

  const removeAsset = (asset: ProjectAsset) => {
    changeDocument(removeAssetFromDocument(documentRef.current, asset.id));
    setSelectedNodeId(null);
    toast.success(`${asset.name} dihapus dari proyek. Undo tersedia.`);
  };

  const generateDesign = async (style: DesignStyle, prompt: string) => {
    setAgentRunning(true);
    setAgentProgress([]);
    setProposal(null);
    const threadId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          threadId,
          runId,
          messages: [{ id: crypto.randomUUID(), role: "user", content: prompt }],
          tools: [],
          context: [],
          state: {},
          forwardedProps: { document: documentRef.current, request: { sideId, style, prompt } },
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Endpoint agen mengembalikan HTTP ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let runError = "";
      const consume = (block: string) => {
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) return;
        const event = JSON.parse(data) as DomainEvent;
        if (event.type === "CUSTOM" && event.name === "blangko.agent.progress") {
          const progress = event.value as AgentProgress;
          setAgentProgress((items) => [...items, progress]);
        }
        if (event.type === "CUSTOM" && event.name === "blangko.design.proposal") setProposal(event.value as DesignProposal);
        if (event.type === "RUN_ERROR") runError = event.message || "Agen gagal dijalankan.";
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        blocks.forEach(consume);
        if (done) { if (buffer.trim()) consume(buffer); break; }
      }
      if (runError) throw new Error(runError);
      toast.success("Proposal diterima melalui AG-UI.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agen gagal dijalankan.");
    } finally {
      setAgentRunning(false);
    }
  };

  const applyProposal = () => {
    if (!proposal) return;
    const current = documentRef.current;
    changeDocument(applyDesignProposal(current, proposal));
    setSideId(proposal.sideId);
    setSelectedNodeId(null);
    setProposal(null);
    toast.success("Proposal diterapkan sebagai satu revisi. Undo tersedia.");
  };

  const handleExport = async (options: ExportOptions) => {
    setExporting(true);
    try {
      const assets = resolveAssetUrls(document.assets, assetUrls);
      if (options.format === "pdf") {
        await exportPrintPdf({ document, sideIds: options.sideIds, assets, includeBlangko: options.includeBlangko });
      } else {
        for (const id of options.sideIds) await exportPng({ document, sideId: id, assets, includeBlangko: options.includeBlangko });
      }
      setExportOpen(false);
      toast.success("Ekspor selesai diunduh.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ekspor gagal dibuat.");
    } finally {
      setExporting(false);
    }
  };

  const handlePhotoCraft = async (includeBlangko: boolean) => {
    setExporting(true);
    try {
      const runtime = await exportPhotoCraftHandoff({
        document: documentRef.current,
        sideId,
        assets: resolveAssetUrls(documentRef.current.assets, assetUrls),
        includeBlangko,
      });
      setExportOpen(false);
      toast.success(`${runtime} berhasil membuat .pcraft dan semantic manifest.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Handoff PhotoCraft gagal.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveNow(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) { event.preventDefault(); redo(); }
      if (event.key === "Delete" && selectedNodeId) deleteNode(selectedNodeId);
      if (event.key === "Escape") { setSelectedNodeId(null); setMobileLeft(false); setMobileRight(false); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [deleteNode, redo, saveNow, selectedNodeId, undo]);

  const side = getSide(document, sideId);
  const selectedNode = side.nodes.find((node) => node.id === selectedNodeId) || null;
  const issues = useMemo(() => runPreflight(document, sideId), [document, sideId]);
  const resolvedAssets = useMemo(() => resolveAssetUrls(document.assets, assetUrls), [document.assets, assetUrls]);

  if ((!projectReady && !initError) || (projectId && projectQuery.isLoading)) {
    return <div className="app-loading"><BookOpen size={28} /><LoaderCircle className="spin" size={20} /><p>Menyiapkan workspace dan dokumen…</p></div>;
  }

  if (initError && !projectReady) {
    return <div className="app-loading error-state"><CloudOff size={30} /><h1>Workspace belum dapat dibuka</h1><p>{initError}</p><button type="button" className="primary-button" onClick={() => window.location.reload()}>Coba lagi</button><button type="button" className="secondary-button" onClick={() => { createStarted.current = false; setInitError(null); setSearchParams({}); }}>Buat proyek baru</button></div>;
  }

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div className="brand-block"><div className="brand-mark"><BookOpen size={19} /></div><div><strong>BLANGKO</strong><span>EDITOR / 01</span></div></div>
        <button
          type="button"
          className="panel-toggle left"
          onClick={() => isMobile ? setMobileLeft((value) => !value) : setDesktopLeft((value) => !value)}
          aria-label={isMobile ? (mobileLeft ? "Tutup panel proyek" : "Buka panel proyek") : (desktopLeft ? "Sembunyikan panel proyek" : "Tampilkan panel proyek")}
          aria-expanded={isMobile ? mobileLeft : desktopLeft}
          aria-controls="left-panel"
        >
          {(isMobile ? mobileLeft : desktopLeft) ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <div className="document-identity"><strong>{document.title}</strong><span>{side.label} · revisi {revisionRef.current}</span></div>
        <div className="topbar-actions">
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === "saving" ? <LoaderCircle className="spin" size={13} /> : saveStatus === "error" ? <CloudOff size={13} /> : saveStatus === "saved" ? <Cloud size={13} /> : <Check size={13} />}
            {saveStatus === "saved" ? "Tersimpan" : saveStatus === "saving" ? "Menyimpan" : saveStatus === "dirty" ? "Perubahan lokal" : "Gagal simpan"}
          </span>
          <div className="history-actions"><button type="button" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={17} /></button><button type="button" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={17} /></button></div>
          <button type="button" className="secondary-button save-button" onClick={() => void saveNow()} disabled={saveStatus === "saving"}><Save size={15} />Simpan</button>
          <button type="button" className="primary-button export-button" onClick={() => setExportOpen(true)}><Download size={15} />Ekspor</button>
          <button
            type="button"
            className="panel-toggle"
            onClick={() => isMobile ? setMobileRight((value) => !value) : setDesktopRight((value) => !value)}
            aria-label={isMobile ? (mobileRight ? "Tutup inspector" : "Buka inspector") : (desktopRight ? "Sembunyikan inspector" : "Tampilkan inspector")}
            aria-expanded={isMobile ? mobileRight : desktopRight}
            aria-controls="right-panel"
          >
            {(isMobile ? mobileRight : desktopRight) ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </header>

      {isMobile && (mobileLeft || mobileRight) && (
        <button type="button" className="panel-backdrop" aria-label="Tutup semua panel" onClick={() => { setMobileLeft(false); setMobileRight(false); }} />
      )}
      <div className={`editor-grid ${desktopLeft ? "" : "hide-left"} ${desktopRight ? "" : "hide-right"}`}>
        <div id="left-panel" className={`mobile-panel-wrap ${desktopLeft ? "" : "desktop-hidden"} ${mobileLeft ? "open" : ""}`}>
          <button type="button" className="mobile-close" onClick={() => setMobileLeft(false)}>Tutup panel</button>
          <LeftPanel document={document} sideId={sideId} assets={resolvedAssets} uploading={uploading} analyzing={analyzing} agentRunning={agentRunning} agentProgress={agentProgress} proposal={proposal} onChange={changeDocument} onUpload={(file, kind) => void handleUpload(file, kind)} onInsertAsset={insertAsset} onUseBlangko={useBlangko} onAnalyzeBlangko={(asset) => void analyzeExistingBlangko(asset)} onRemoveAsset={removeAsset} onGenerate={(style, prompt) => void generateDesign(style, prompt)} onApplyProposal={applyProposal} onDismissProposal={() => setProposal(null)} />
        </div>
        <CanvasEditor document={document} sideId={sideId} assets={resolvedAssets} selectedNodeId={selectedNodeId} showBlangko={showBlangko} showGuides={showGuides} zoom={zoom} onSideChange={setSideId} onSelectNode={setSelectedNodeId} onUpdateNode={updateNode} onToggleBlangko={() => setShowBlangko((value) => !value)} onToggleGuides={() => setShowGuides((value) => !value)} onZoomChange={setZoom} />
        <div id="right-panel" className={`mobile-panel-wrap right ${desktopRight ? "" : "desktop-hidden"} ${mobileRight ? "open" : ""}`}>
          <button type="button" className="mobile-close" onClick={() => setMobileRight(false)}>Tutup inspector</button>
          <Inspector document={document} sideId={sideId} selectedNode={selectedNode} issues={issues} onUpdateNode={updateNode} onSelectNode={setSelectedNodeId} onDeleteNode={deleteNode} onDuplicateNode={duplicateNode} onReorderNode={reorderNode} onAddNode={addNode} onExport={() => setExportOpen(true)} />
        </div>
      </div>

      {exportOpen && <ExportDialog document={document} sideId={sideId} issues={issues} exporting={exporting} onClose={() => setExportOpen(false)} onExport={(options) => void handleExport(options)} onPhotoCraft={(includeBlangko) => void handlePhotoCraft(includeBlangko)} onMaster={() => exportMaster(document)} />}
      <Toaster position="bottom-right" theme="dark" richColors />
    </main>
  );
}
