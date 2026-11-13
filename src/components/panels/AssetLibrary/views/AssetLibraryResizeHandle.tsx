import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { assetLibraryPaneWidths, type AssetLibraryPane } from "../assetLibraryState";

/** Divider between framed panes; only the handle being dragged keeps its line visible. */
export function AssetLibraryResizeHandle({
  pane,
  label,
  width,
  onWidthChange,
}: {
  pane: AssetLibraryPane;
  label: string;
  width: number;
  onWidthChange: (pane: AssetLibraryPane, width: number) => void;
}) {
  const [active, setActive] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    const startX = event.clientX;
    // The folder pane grows to the right, the properties pane to the left.
    const direction = pane === "navigation" ? 1 : -1;
    document.body.classList.add("is-resizing-asset-library-pane");
    setActive(true);
    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      onWidthChange(pane, width + direction * (moveEvent.clientX - startX));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      document.body.classList.remove("is-resizing-asset-library-pane");
      setActive(false);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  return (
    <div
      className={`asset-library-resize-handle${active ? " is-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={startResize}
      onDoubleClick={() => onWidthChange(pane, assetLibraryPaneWidths[pane].initial)}
    />
  );
}
