import { useEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import { Cpu, Eye, EyeOff, LoaderCircle, Maximize2, Minus, Plus, RefreshCw } from "lucide-react";
import { getSide, type DesignNode, type InvitationDocument, type SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "@/lib/builtin-assets";
import { usePhotoCraftRuntime } from "./usePhotoCraftRuntime";

function nodeBorderRadius(node: DesignNode, scale: number): string | undefined {
  const geometry = node.kind === "shape" ? node.shapeType : node.kind === "image" ? node.clipShape : undefined;
  if (geometry === "ellipse") return "50%";
  if (geometry === "rounded-rectangle") return `${(node.cornerRadius ?? 3) * scale}px`;
  return undefined;
}

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
  const {
    document, sideId, assets, selectedNodeId, showBlangko, showGuides, zoom,
    onSideChange, onSelectNode, onUpdateNode, onToggleBlangko, onToggleGuides, onZoomChange,
  } = props;
  const side = getSide(document, sideId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 650 });
  const selectedNode = side.nodes.find((node) => node.id === selectedNodeId) || null;
  const [runtimeRequested, setRuntimeRequested] = useState(true);
  const runtime = usePhotoCraftRuntime({
    document, sideId, assets, includeBlangko: showBlangko, enabled: runtimeRequested,
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = Math.min(
    Math.max(1.2, (viewportSize.width - 96) / document.stock.width),
    Math.max(1.2, (viewportSize.height - 118) / document.stock.height),
  );
  const scale = fitScale * zoom;
  const paperWidth = document.stock.width * scale;
  const paperHeight = document.stock.height * scale;
  const fontSize = (node: DesignNode) => (node.fontSize || 12) * 25.4 / 72 * scale;

  return (
    <section className="canvas-workspace" aria-label="Workspace canvas">
      <div className="canvas-toolbar">
        <div className="side-tabs" aria-label="Sisi undangan">
          {document.sides.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === sideId ? "side-tab active" : "side-tab"}
              onClick={() => { onSideChange(item.id); onSelectNode(null); }}
            >
              {item.label}
              <span>{item.id === "outside" ? "A" : "B"}</span>
            </button>
          ))}
        </div>
        <div className="canvas-view-actions">
          <button
            type="button"
            className={runtimeRequested && runtime.status?.available ? "icon-text-button active" : "icon-text-button"}
            onClick={() => setRuntimeRequested((value) => !value)}
            aria-pressed={runtimeRequested && Boolean(runtime.status?.available)}
            disabled={!runtime.status?.available}
            title={runtime.status?.message || "Memeriksa runtime PhotoCraft…"}
          >
            <Cpu size={15} /> PhotoCraft
          </button>
          <button type="button" className={showBlangko ? "icon-text-button active" : "icon-text-button"} onClick={onToggleBlangko} aria-pressed={showBlangko}>
            {showBlangko ? <Eye size={15} /> : <EyeOff size={15} />} Blangko
          </button>
          <button type="button" className={showGuides ? "icon-text-button active" : "icon-text-button"} onClick={onToggleGuides} aria-pressed={showGuides}>
            <Eye size={15} /> Garis bantu
          </button>
        </div>
      </div>

      <div className="canvas-viewport" ref={viewportRef} onClick={() => onSelectNode(null)}>
        <div className="paper-stage" style={{ width: paperWidth, height: paperHeight }}>
          <div
            className={`paper-document ${runtime.usingEngine ? "runtime-authoritative" : ""}`}
            style={{ width: paperWidth, height: paperHeight }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="content-only-paper" />
            {!runtime.usingEngine && showBlangko && side.blangkoAssetId && assets[side.blangkoAssetId] && (
              <img className="blangko-layer" src={assets[side.blangkoAssetId]} alt={`Blangko ${side.label}`} draggable={false} />
            )}
            {runtime.usingEngine && runtime.snapshot && (
              <img
                className="photocraft-engine-render"
                src={`data:${runtime.snapshot.mime};base64,${runtime.snapshot.imageBase64}`}
                alt={`Render PhotoCraft ${side.label}`}
                draggable={false}
                data-testid="photocraft-engine-render"
              />
            )}

            {showGuides && (
              <div className="safe-area-guide" style={{ inset: document.stock.safeMargin * scale }} aria-hidden="true" />
            )}
            {showGuides && side.foldLines.map((fold) => (
              <div
                key={fold.id}
                className={`fold-guide ${fold.axis}`}
                style={fold.axis === "vertical"
                  ? { left: fold.positionMm * scale }
                  : { top: fold.positionMm * scale }}
                aria-hidden="true"
              >
                <span>{fold.kind === "fold" ? "LIPAT" : fold.kind.toUpperCase()}</span>
              </div>
            ))}

            {[...side.nodes].sort((a, b) => a.zIndex - b.zIndex).map((node) => (
              <div
                id={`node-${node.id}`}
                key={node.id}
                className={`design-node ${node.kind} ${selectedNodeId === node.id ? "selected" : ""} ${node.locked ? "locked" : ""} ${runtime.usingEngine ? "runtime-proxy" : ""}`}
                style={{
                  left: node.box.x * scale,
                  top: node.box.y * scale,
                  width: node.box.width * scale,
                  height: Math.max(node.box.height * scale, node.kind === "shape" ? 2 : 12),
                  transform: `rotate(${node.rotation}deg)`,
                  opacity: node.visible ? node.opacity : 0.18,
                  zIndex: node.zIndex + 5,
                  color: node.color,
                  backgroundColor: node.kind === "shape" ? node.backgroundColor : undefined,
                  border: node.borderWidth ? `${node.borderWidth * scale}px solid ${node.borderColor}` : undefined,
                  borderRadius: nodeBorderRadius(node, scale),
                  fontFamily: node.fontFamily,
                  fontWeight: node.fontWeight,
                  fontStyle: node.fontStyle,
                  fontSize: fontSize(node),
                  letterSpacing: node.letterSpacing ? node.letterSpacing * 25.4 / 72 * scale : undefined,
                  textAlign: node.textAlign,
                }}
                onClick={(event) => { event.stopPropagation(); onSelectNode(node.id); }}
              >
                {!runtime.usingEngine && node.kind === "text" && node.text}
                {!runtime.usingEngine && node.kind === "image" && node.assetId && assets[node.assetId] && (
                  <img src={assets[node.assetId]} alt="Aset desain" draggable={false} />
                )}
                {!runtime.usingEngine && node.kind === "image" && (!node.assetId || !assets[node.assetId]) && <span>Aset tidak tersedia</span>}
              </div>
            ))}

            {selectedNode && !selectedNode.locked && selectedNode.visible && (
              <Moveable
                target={`#node-${selectedNode.id}`}
                draggable
                resizable
                rotatable
                throttleDrag={0}
                throttleResize={0}
                throttleRotate={0}
                origin={false}
                onDrag={({ target, left, top }) => {
                  target.style.left = `${left}px`;
                  target.style.top = `${top}px`;
                }}
                onDragEnd={({ lastEvent }) => {
                  if (!lastEvent) return;
                  onUpdateNode(selectedNode.id, {
                    box: { ...selectedNode.box, x: lastEvent.left / scale, y: lastEvent.top / scale },
                  });
                }}
                onResize={({ target, width, height, drag }) => {
                  target.style.width = `${width}px`;
                  target.style.height = `${height}px`;
                  target.style.left = `${drag.left}px`;
                  target.style.top = `${drag.top}px`;
                }}
                onResizeEnd={({ lastEvent }) => {
                  if (!lastEvent) return;
                  onUpdateNode(selectedNode.id, {
                    box: {
                      x: lastEvent.drag.left / scale,
                      y: lastEvent.drag.top / scale,
                      width: lastEvent.width / scale,
                      height: lastEvent.height / scale,
                    },
                  });
                }}
                onRotate={({ target, transform }) => { target.style.transform = transform; }}
                onRotateEnd={({ lastEvent }) => {
                  if (lastEvent) onUpdateNode(selectedNode.id, { rotation: lastEvent.rotation });
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="canvas-statusbar">
        <span>{document.stock.width} × {document.stock.height} mm</span>
        <span className="status-separator" />
        <span>{document.stock.targetPpi} ppi</span>
        <span className="status-separator" />
        {runtime.error ? (
          <button type="button" className="runtime-canvas-status error" onClick={runtime.retry} title={runtime.error}>
            <RefreshCw size={12} /> Canvas lokal — coba runtime lagi
          </button>
        ) : (
          <span className={`runtime-canvas-status ${runtime.usingEngine ? "active" : ""}`}>
            {runtime.syncing && <LoaderCircle size={12} className="spin" />}
            {runtime.usingEngine ? `${runtime.snapshot?.runtime || "PhotoCraft"} · editable` : runtimeRequested ? "Canvas lokal" : "Canvas lokal · runtime dimatikan"}
          </span>
        )}
        <div className="zoom-controls">
          <button type="button" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))} aria-label="Perkecil canvas"><Minus size={14} /></button>
          <button type="button" className="zoom-value" onClick={() => onZoomChange(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => onZoomChange(Math.min(2, zoom + 0.1))} aria-label="Perbesar canvas"><Plus size={14} /></button>
          <button type="button" onClick={() => onZoomChange(1)} aria-label="Sesuaikan canvas"><Maximize2 size={14} /></button>
        </div>
      </div>
    </section>
  );
}
