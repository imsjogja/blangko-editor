import { getSide, type InvitationDocument, type SideId } from "./invitation";

export type PrintProjection = "composite" | "content-only";

export interface PhotoCraftSemanticCommand {
  command: string;
  params: Record<string, unknown>;
}

/**
 * Stable semantic batch consumed by a PhotoCraft runtime adapter.
 * The runtime must resolve these operations against `engine.commands` from the
 * pinned PhotoCraft build; the model never receives raw engine command IDs.
 */
export function compilePhotoCraftBatch(
  document: InvitationDocument,
  sideId: SideId,
  projection: PrintProjection,
): PhotoCraftSemanticCommand[] {
  const side = getSide(document, sideId);
  const commands: PhotoCraftSemanticCommand[] = [
    {
      command: "document.create",
      params: {
        widthMm: document.stock.width,
        heightMm: document.stock.height,
        targetPpi: document.stock.targetPpi,
        metadata: { title: `${document.title} — ${side.label}`, schemaVersion: 1 },
      },
    },
  ];

  if (projection === "composite" && side.blangkoAssetId) {
    commands.push({ command: "group.create", params: { id: "__BLANGKO__", locked: true, printable: false } });
    commands.push({
      command: "image.place",
      params: {
        groupId: "__BLANGKO__",
        assetId: side.blangkoAssetId,
        boxMm: { x: 0, y: 0, width: document.stock.width, height: document.stock.height },
        locked: true,
        printable: false,
      },
    });
  }

  commands.push({ command: "group.create", params: { id: "__CONTENT__", locked: false, printable: true } });
  for (const node of [...side.nodes].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!node.visible) continue;
    commands.push({
      command: node.kind === "text" ? "text.create" : node.kind === "image" ? "image.place" : "shape.create",
      params: { ...node, groupId: "__CONTENT__", boxMm: node.box, printable: true },
    });
  }

  if (projection === "composite") {
    commands.push({ command: "group.create", params: { id: "__GUIDES__", locked: true, printable: false } });
    for (const fold of side.foldLines) {
      commands.push({ command: "guide.fold", params: { ...fold, groupId: "__GUIDES__", printable: false } });
    }
  }

  commands.push({ command: "document.commit", params: { transaction: `agent-${sideId}-${projection}` } });
  return commands;
}
