import type { PointerEvent as ReactPointerEvent } from "react";
import {
  assetLibraryCanDropInto,
  assetLibraryClipboard,
  sameAssetLibraryLocation,
  type AssetLibraryLocation,
} from "../../../core/editor/assetLibrary";
import type { ProjectAssetLibraryState } from "../../../types";
import { maximumDragStackLayers } from "../../common/DragStackPreview";
import {
  assetLibraryDropTargetAt,
  assetLibraryTreeDropPrefix,
} from "../../common/utils/assetLibraryDropTarget";
import type { AssetLibraryCommands } from "./assetLibraryCommands";
import { assetLibrarySelectionFromKeys, type AssetLibraryNode } from "./assetLibraryNodes";

/** Pointer travel before a press on an item becomes a drag, matching the storyboard. */
const dragThresholdPx = 4;

export interface AssetLibraryDragPreview {
  node: AssetLibraryNode;
  /** The item's shown frame, or null to draw its kind icon. */
  thumbnailSrc: string | null;
  aspectRatio: number;
  layerCount: number;
  x: number;
  y: number;
}

// The storyboard panel's shot drag classes: a no-drop cursor by default, grabbing over a target.
const draggingClass = "is-dragging-storyboard-shot";
const allowedClass = "is-storyboard-shot-drag-allowed";

/** Ends a drag without the release also counting as a click on whatever is under it. */
function suppressNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

export interface AssetLibraryDragDropContext {
  library: ProjectAssetLibraryState;
  location: AssetLibraryLocation;
  selectedKeys: ReadonlySet<string>;
  selectedNodes: readonly AssetLibraryNode[];
  selectOnly: (key: string) => void;
  setDropTargetKey: (key: string | null) => void;
  setPreview: (preview: AssetLibraryDragPreview | null) => void;
  /** Ends the drag in progress; the panel calls it on unmount, as the storyboard does. */
  cleanupRef: { current: (() => void) | null };
  commands: AssetLibraryCommands;
  messagePublished: (message: string) => void;
}

/**
 * Pointer-driven drag for items onto folders, tree rows, crumbs and the item pane: move by
 * default, Ctrl copies, Esc cancels. Like the media bin, this avoids HTML drag and drop, which
 * the desktop window reserves for dropping files from the system.
 */
export function assetLibraryDragDrop(context: AssetLibraryDragDropContext) {
  const { library, location, selectedKeys, selectedNodes, commands, messagePublished } = context;

  function startNodeDrag(event: ReactPointerEvent<HTMLElement>, node: AssetLibraryNode) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("input, textarea, button")) return;
    context.cleanupRef.current?.();
    const selected = selectedKeys.has(node.key);
    const keys = selected ? selectedNodes.map((item) => item.key) : [node.key];
    const dragged = assetLibrarySelectionFromKeys(keys);
    const thumbnail = event.currentTarget.querySelector<HTMLImageElement>(
      ".asset-library-thumbnail img",
    );
    const bounds = thumbnail?.getBoundingClientRect();
    const sourceWidth = thumbnail?.naturalWidth || bounds?.width || 16;
    const sourceHeight = thumbnail?.naturalHeight || bounds?.height || 9;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    let dragging = false;

    const targetAt = (clientX: number, clientY: number) => {
      const target = assetLibraryDropTargetAt(clientX, clientY);
      return target &&
        assetLibraryCanDropInto(library, location.root, dragged.folderIds, target.location)
        ? target
        : null;
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (
        !dragging &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < dragThresholdPx
      ) {
        return;
      }
      if (!dragging) {
        dragging = true;
        if (!selected) context.selectOnly(node.key);
        document.body.classList.add(draggingClass);
      }
      moveEvent.preventDefault();
      const target = targetAt(moveEvent.clientX, moveEvent.clientY);
      document.body.classList.toggle(allowedClass, Boolean(target));
      // The folder on show is a valid spot to let go, but only other folders light up. Its
      // tree row still reports the hover so a collapsed row can open.
      const highlighted =
        target &&
        (target.key.startsWith(assetLibraryTreeDropPrefix) ||
          !sameAssetLibraryLocation(target.location, location))
          ? target.key
          : null;
      context.setDropTargetKey(highlighted);
      context.setPreview({
        node,
        thumbnailSrc: thumbnail?.currentSrc || thumbnail?.src || null,
        aspectRatio: sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9,
        layerCount: Math.min(maximumDragStackLayers, keys.length),
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("blur", onBlur);
      document.body.classList.remove(draggingClass, allowedClass);
      context.setDropTargetKey(null);
      context.setPreview(null);
      if (context.cleanupRef.current === cleanup) context.cleanupRef.current = null;
    };

    const drop = (target: AssetLibraryLocation, copy: boolean) => {
      if (copy) {
        const dragClipboard = assetLibraryClipboard(library, dragged);
        if (!dragClipboard) return;
        const pasted = commands.paste(dragClipboard, target, "复制素材");
        messagePublished(`已复制 ${pasted.folderIds.length + pasted.entryIds.length} 项。`);
        return;
      }
      const movedCount = commands.move(dragged, target);
      if (movedCount > 0) messagePublished(`已移动 ${movedCount} 项。`);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      if (!dragging) return;
      upEvent.preventDefault();
      suppressNextClick();
      const target = targetAt(upEvent.clientX, upEvent.clientY);
      if (target) drop(target.location, upEvent.ctrlKey || upEvent.metaKey);
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };

    const onBlur = () => cleanup();

    // Esc ends the drag while the button is still down; the click that follows the release
    // must not then select or toggle the item under the pointer.
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (!dragging || keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      cleanup();
      const onRelease = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        releaseCleanup();
        suppressNextClick();
      };
      const releaseCleanup = () => {
        window.removeEventListener("pointerup", onRelease);
        window.removeEventListener("pointercancel", releaseCleanup);
        if (context.cleanupRef.current === releaseCleanup) context.cleanupRef.current = null;
      };
      window.addEventListener("pointerup", onRelease);
      window.addEventListener("pointercancel", releaseCleanup);
      context.cleanupRef.current = releaseCleanup;
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("blur", onBlur);
    context.cleanupRef.current = cleanup;
  }

  return { startNodeDrag };
}
