import type { DragEvent } from "react";
import {
  assetLibraryClipboard,
  assetLibraryFolderDescendantIds,
  type AssetLibraryLocation,
} from "../../../core/editor/assetLibrary";
import type { ProjectAssetLibraryState } from "../../../types";
import type { AssetLibraryCommands } from "./assetLibraryCommands";
import {
  activeAssetLibraryDrag,
  assetLibraryDragType,
  assetLibrarySelectionFromKeys,
  beginAssetLibraryDrag,
  endAssetLibraryDrag,
  type AssetLibraryNode,
} from "./assetLibraryNodes";

export interface AssetLibraryDragDropContext {
  library: ProjectAssetLibraryState;
  location: AssetLibraryLocation;
  selectedKeys: ReadonlySet<string>;
  selectedNodes: readonly AssetLibraryNode[];
  selectOnly: (key: string) => void;
  setDropTargetKey: (key: string | null) => void;
  commands: AssetLibraryCommands;
  messagePublished: (message: string) => void;
}

/** Dragging items onto folders, crumbs and the item pane: move by default, Ctrl copies. */
export function assetLibraryDragDrop(context: AssetLibraryDragDropContext) {
  const { library, location, selectedKeys, selectedNodes, commands, messagePublished } = context;

  function dropAllowed(target: AssetLibraryLocation) {
    const drag = activeAssetLibraryDrag();
    if (!drag || drag.root !== target.root) return false;
    if (!target.folderId) return true;
    const dragged = assetLibrarySelectionFromKeys(drag.keys);
    return !assetLibraryFolderDescendantIds(library.folders, dragged.folderIds).has(
      target.folderId,
    );
  }

  function handleDragEnd() {
    endAssetLibraryDrag();
    context.setDropTargetKey(null);
  }

  return {
    handleDragEnd,

    handleDragStart(event: DragEvent<HTMLElement>, node: AssetLibraryNode) {
      const keys = selectedKeys.has(node.key)
        ? selectedNodes.map((selected) => selected.key)
        : [node.key];
      if (!selectedKeys.has(node.key)) context.selectOnly(node.key);
      beginAssetLibraryDrag(keys, location.root);
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData(assetLibraryDragType, keys.join("\n"));
    },

    handleDragOver(event: DragEvent<HTMLElement>, target: AssetLibraryLocation, key: string) {
      if (!dropAllowed(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "copy" : "move";
      context.setDropTargetKey(key);
    },

    handleDrop(event: DragEvent<HTMLElement>, target: AssetLibraryLocation) {
      const drag = activeAssetLibraryDrag();
      if (!drag || !dropAllowed(target)) return;
      event.preventDefault();
      event.stopPropagation();
      handleDragEnd();
      const dragged = assetLibrarySelectionFromKeys(drag.keys);
      if (event.ctrlKey || event.metaKey) {
        const dragClipboard = assetLibraryClipboard(library, dragged);
        if (!dragClipboard) return;
        const pasted = commands.paste(dragClipboard, target, "复制素材");
        messagePublished(`已复制 ${pasted.folderIds.length + pasted.entryIds.length} 项。`);
        return;
      }
      const movedCount = commands.move(dragged, target);
      if (movedCount > 0) messagePublished(`已移动 ${movedCount} 项。`);
    },
  };
}
