import { Link2Off } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  assetLibraryEntryDurationUs,
  type AssetLibraryViewLayout,
} from "../../../../core/editor/assetLibrary";
import { formatDuration } from "../../../../core/editor/time";
import { type AssetLibraryNode } from "../assetLibraryNodes";
import { AssetLibraryBadges, AssetLibraryFolderIcon } from "./AssetLibraryBadges";
import { AssetLibraryThumbnail } from "./AssetLibraryThumbnail";

const cardGap = 10;
const gridPadding = 10;

interface MarqueeState {
  originX: number;
  originY: number;
  x: number;
  y: number;
  additive: boolean;
  baseKeys: ReadonlySet<string>;
}

export interface AssetLibraryItemsProps {
  nodes: readonly AssetLibraryNode[];
  layout: AssetLibraryViewLayout;
  selectedKeys: ReadonlySet<string>;
  focusKey: string | null;
  renamingKey: string | null;
  cutKeys: ReadonlySet<string>;
  dropTargetKey: string | null;
  thumbnailsEnabled: boolean;
  emptyText: string;
  locationLabel?: (node: AssetLibraryNode) => string | null;
  onNodePointerDown: (event: ReactPointerEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onNodeClick: (event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onOpenNode: (node: AssetLibraryNode) => void;
  onMarqueeSelect: (keys: string[]) => void;
  onClearSelection: () => void;
  onRename: (node: AssetLibraryNode, name: string) => void;
  onCancelRename: () => void;
  onDragStartNode: (event: DragEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onDragEnd: () => void;
  onDragOverTarget: (event: DragEvent<HTMLElement>, folderId: string | null) => void;
  onDragLeaveTarget: () => void;
  onDropOnTarget: (event: DragEvent<HTMLElement>, folderId: string | null) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode | null) => void;
  onColumnsChange: (columns: number) => void;
  /** Ctrl+wheel steps the shared size control, switching between list and icons. */
  onZoom: (steps: number) => void;
}

function nodeName(node: AssetLibraryNode) {
  return node.kind === "folder" ? node.folder.name : node.entry.name;
}

function RenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const finishedRef = useRef(false);
  const finish = (commit: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <input
      className="asset-library-rename"
      value={value}
      aria-label="重命名"
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}

export function AssetLibraryItems(props: AssetLibraryItemsProps) {
  const {
    nodes,
    layout,
    selectedKeys,
    focusKey,
    renamingKey,
    cutKeys,
    dropTargetKey,
    thumbnailsEnabled,
    emptyText,
    locationLabel,
    onColumnsChange,
    onZoom,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const cardWidth = layout.mode === "icons" ? layout.cardWidth : 0;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth - gridPadding * 2;
      onColumnsChange(
        layout.mode === "icons"
          ? Math.max(1, Math.floor((width + cardGap) / (cardWidth + cardGap)))
          : 1,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardWidth, layout.mode, onColumnsChange]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY !== 0) onZoom(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [onZoom]);

  useEffect(() => {
    if (!focusKey) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-asset-key="${CSS.escape(focusKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusKey]);

  function contentPoint(event: { clientX: number; clientY: number }) {
    const element = scrollRef.current!;
    const bounds = element.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left + element.scrollLeft,
      y: event.clientY - bounds.top + element.scrollTop,
    };
  }

  function keysInMarquee(state: MarqueeState) {
    const element = scrollRef.current;
    if (!element) return [];
    const bounds = element.getBoundingClientRect();
    const left = Math.min(state.originX, state.x) - element.scrollLeft + bounds.left;
    const right = Math.max(state.originX, state.x) - element.scrollLeft + bounds.left;
    const top = Math.min(state.originY, state.y) - element.scrollTop + bounds.top;
    const bottom = Math.max(state.originY, state.y) - element.scrollTop + bounds.top;
    return Array.from(element.querySelectorAll<HTMLElement>("[data-asset-key]")).flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const hit =
        rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
      return hit ? [node.dataset.assetKey!] : [];
    });
  }

  function startMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-asset-key]")) return;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const point = contentPoint(event);
    const initial: MarqueeState = {
      originX: point.x,
      originY: point.y,
      x: point.x,
      y: point.y,
      additive,
      baseKeys: additive ? new Set(selectedKeys) : new Set(),
    };
    let moved = false;
    let current = initial;
    const handleMove = (moveEvent: PointerEvent) => {
      const next = contentPoint(moveEvent);
      if (!moved && Math.hypot(next.x - initial.originX, next.y - initial.originY) < 4) return;
      moved = true;
      current = { ...current, x: next.x, y: next.y };
      setMarquee(current);
      props.onMarqueeSelect([...new Set([...current.baseKeys, ...keysInMarquee(current)])]);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      setMarquee(null);
      if (!moved && !additive) props.onClearSelection();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  function nodeHandlers(node: AssetLibraryNode) {
    const folderId = node.kind === "folder" ? node.folder.id : null;
    return {
      "data-asset-key": node.key,
      draggable: renamingKey !== node.key,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) =>
        props.onNodePointerDown(event, node),
      onClick: (event: ReactMouseEvent<HTMLElement>) => props.onNodeClick(event, node),
      onDoubleClick: () => props.onOpenNode(node),
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => props.onContextMenu(event, node),
      onDragStart: (event: DragEvent<HTMLElement>) => props.onDragStartNode(event, node),
      onDragEnd: props.onDragEnd,
      ...(folderId
        ? {
            onDragOver: (event: DragEvent<HTMLElement>) => props.onDragOverTarget(event, folderId),
            onDragLeave: props.onDragLeaveTarget,
            onDrop: (event: DragEvent<HTMLElement>) => props.onDropOnTarget(event, folderId),
          }
        : {}),
    };
  }

  function nodeClassName(node: AssetLibraryNode, base: string) {
    return [
      base,
      node.kind === "folder" ? "is-folder" : "is-entry",
      selectedKeys.has(node.key) ? "selected" : "",
      focusKey === node.key ? "focused" : "",
      cutKeys.has(node.key) ? "is-cut" : "",
      dropTargetKey === node.key ? "drop-target" : "",
      node.kind === "entry" && !node.media ? "is-offline" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function nameContent(node: AssetLibraryNode) {
    return renamingKey === node.key ? (
      <RenameInput
        initialValue={nodeName(node)}
        onCommit={(value) => props.onRename(node, value)}
        onCancel={props.onCancelRename}
      />
    ) : (
      <span className="asset-library-name" title={nodeName(node)}>
        {nodeName(node)}
      </span>
    );
  }

  function renderRow(node: AssetLibraryNode) {
    const location = locationLabel?.(node);
    return (
      <div
        key={node.key}
        className={nodeClassName(node, "asset-library-row")}
        role="option"
        aria-selected={selectedKeys.has(node.key)}
        {...nodeHandlers(node)}
      >
        <span className="asset-library-row-icon">
          {node.kind === "folder" ? (
            <AssetLibraryFolderIcon />
          ) : layout.mode === "list" && layout.showThumbnail ? (
            <AssetLibraryThumbnail
              entry={node.entry}
              media={node.media}
              displayWidth={(layout.rowHeight - 6) * (16 / 9)}
              enabled={thumbnailsEnabled}
            />
          ) : node.media ? (
            <span className={`asset-library-kind-dot is-${node.entry.root}`} aria-hidden="true" />
          ) : (
            <Link2Off className="asset-library-offline-icon" aria-label="媒体离线" />
          )}
        </span>
        <span className="asset-library-row-name">
          {nameContent(node)}
          {location && <span className="asset-library-location">{location}</span>}
        </span>
        {node.kind === "entry" ? (
          <>
            <AssetLibraryBadges entry={node.entry} />
            <span className="asset-library-row-meta">
              {formatDuration(assetLibraryEntryDurationUs(node.entry))}
            </span>
            <span className="asset-library-row-source" title={node.entry.media.file_name}>
              {node.entry.media.file_name}
            </span>
          </>
        ) : (
          <>
            <span />
            <span className="asset-library-row-meta">{node.childCount} 项</span>
            <span className="asset-library-row-source">文件夹</span>
          </>
        )}
      </div>
    );
  }

  function renderCard(node: AssetLibraryNode) {
    const location = locationLabel?.(node);
    return (
      <div
        key={node.key}
        className={nodeClassName(node, "asset-library-card")}
        role="option"
        aria-selected={selectedKeys.has(node.key)}
        {...nodeHandlers(node)}
      >
        <div className="asset-library-card-visual">
          {node.kind === "folder" ? (
            <AssetLibraryFolderIcon className="asset-library-card-folder" />
          ) : (
            <>
              <AssetLibraryThumbnail
                entry={node.entry}
                media={node.media}
                displayWidth={cardWidth}
                enabled={thumbnailsEnabled}
              />
              <span className="asset-library-card-overlay">
                <AssetLibraryBadges entry={node.entry} />
                <span className="asset-library-card-duration">
                  {formatDuration(assetLibraryEntryDurationUs(node.entry))}
                </span>
              </span>
            </>
          )}
        </div>
        <div className="asset-library-card-caption">
          {nameContent(node)}
          <span className="asset-library-location">
            {location ??
              (node.kind === "folder" ? `${node.childCount} 项` : node.entry.media.file_name)}
          </span>
        </div>
      </div>
    );
  }

  const style = {
    "--asset-row-height": layout.mode === "list" ? `${layout.rowHeight}px` : undefined,
    "--asset-card-width": layout.mode === "icons" ? `${layout.cardWidth}px` : undefined,
  } as CSSProperties;
  const marqueeStyle = marquee
    ? {
        left: Math.min(marquee.originX, marquee.x),
        top: Math.min(marquee.originY, marquee.y),
        width: Math.abs(marquee.x - marquee.originX),
        height: Math.abs(marquee.y - marquee.originY),
      }
    : undefined;

  return (
    <div
      ref={scrollRef}
      className={`asset-library-items is-${layout.mode}${dropTargetKey === "content" ? " drop-target" : ""}`}
      style={style}
      role="listbox"
      aria-multiselectable="true"
      aria-label="素材"
      onPointerDown={startMarquee}
      onContextMenu={(event) => {
        if (!(event.target as HTMLElement).closest("[data-asset-key]")) {
          props.onContextMenu(event, null);
        }
      }}
      onDragOver={(event) => props.onDragOverTarget(event, null)}
      onDragLeave={props.onDragLeaveTarget}
      onDrop={(event) => props.onDropOnTarget(event, null)}
    >
      {nodes.length === 0 ? (
        <div className="asset-library-empty">{emptyText}</div>
      ) : layout.mode === "list" ? (
        nodes.map(renderRow)
      ) : (
        <div className="asset-library-grid">{nodes.map(renderCard)}</div>
      )}
      {marqueeStyle && <div className="asset-library-marquee" style={marqueeStyle} />}
    </div>
  );
}
