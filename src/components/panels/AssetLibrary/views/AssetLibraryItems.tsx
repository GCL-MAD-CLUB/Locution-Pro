import { Captions, Film } from "lucide-react";
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
import { mediaGridLayout } from "../../../../application/media/mediaGridLayout";
import {
  assetLibraryEntryDurationUs,
  type AssetLibrarySort,
  type AssetLibrarySortKey,
  type AssetLibraryViewLayout,
} from "../../../../core/editor/assetLibrary";
import { formatDuration } from "../../../../core/editor/time";
import { annotationColors } from "../../../../runtime/theme";
import "../../MediaBin/MediaBin.css";
import { MediaBinFolderIcon, OfflineFileIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import { type AssetLibraryNode } from "../assetLibraryNodes";
import { AssetLibraryFlagMark, AssetLibraryMarks } from "./AssetLibraryBadges";
import { AssetLibraryThumbnail } from "./AssetLibraryThumbnail";

/** Matches `.media-bin-grid`: 14px padding and a 12px gap. */
const gridPadding = 14;
const gridGap = 12;

interface MarqueeState {
  originX: number;
  originY: number;
  x: number;
  y: number;
  baseKeys: ReadonlySet<string>;
}

interface ListColumn {
  id: "label" | "title" | "location" | "marks" | "duration";
  label: string;
  sortKey: AssetLibrarySortKey | null;
}

const listColumns: readonly ListColumn[] = [
  { id: "label", label: "", sortKey: null },
  { id: "title", label: "名称", sortKey: "name" },
  { id: "location", label: "位置", sortKey: null },
  { id: "marks", label: "标注", sortKey: "rating" },
  { id: "duration", label: "持续时间", sortKey: "duration" },
];

export interface AssetLibraryItemsProps {
  nodes: readonly AssetLibraryNode[];
  layout: AssetLibraryViewLayout;
  sort: AssetLibrarySort;
  selectedKeys: ReadonlySet<string>;
  focusKey: string | null;
  renamingKey: string | null;
  cutKeys: ReadonlySet<string>;
  dropTargetKey: string | null;
  thumbnailsEnabled: boolean;
  emptyText: string;
  locationLabel?: (node: AssetLibraryNode) => string | null;
  onSort: (sort: AssetLibrarySort) => void;
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

function nodeDuration(node: AssetLibraryNode) {
  return node.kind === "folder" ? "" : formatDuration(assetLibraryEntryDurationUs(node.entry));
}

function SortArrow({ direction }: { direction: AssetLibrarySort["direction"] }) {
  return (
    <svg className="media-bin-sort-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={
          direction === "ascending"
            ? "M8 14 L8 2.5 M5 5.5 L8 2.5 L11 5.5"
            : "M8 2 L8 13.5 M5 10.5 L8 13.5 L11 10.5"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.75"
      />
    </svg>
  );
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
      className="media-bin-title-editor"
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

/** The media bin's kind glyphs, drawn in one fixed-size box so every row lines up. */
function KindIcon({ node }: { node: AssetLibraryNode }) {
  if (node.kind === "folder") {
    return (
      <span className="media-bin-kind-icon folder">
        <MediaBinFolderIcon />
      </span>
    );
  }
  if (!node.media) {
    return (
      <span className="media-bin-kind-icon">
        <OfflineFileIcon
          className="media-bin-offline-icon"
          role="img"
          aria-hidden={false}
          aria-label="媒体离线"
        />
      </span>
    );
  }
  const subtitle = node.entry.root === "subtitles";
  const Icon = subtitle ? Captions : Film;
  return (
    <span className={`media-bin-kind-icon ${subtitle ? "subtitle" : "video"}`}>
      <Icon aria-hidden="true" />
    </span>
  );
}

/** Folders use the media bin folder color; entries show their color label when set. */
function LabelColor({ node }: { node: AssetLibraryNode }) {
  if (node.kind === "folder") {
    return (
      <span className="media-bin-label-color" style={{ background: "var(--color-media-folder)" }} />
    );
  }
  const colorLabel = node.entry.annotation.color_label;
  return colorLabel ? (
    <span className="media-bin-label-color" style={{ background: annotationColors[colorLabel] }} />
  ) : (
    <span className="media-bin-label-color asset-library-label-empty" aria-hidden="true" />
  );
}

export function AssetLibraryItems(props: AssetLibraryItemsProps) {
  const {
    nodes,
    layout,
    sort,
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
  const [contentWidth, setContentWidth] = useState(0);
  const grid =
    layout.mode === "icons"
      ? mediaGridLayout(
          Math.max(0, contentWidth - gridPadding * 2),
          nodes.length,
          layout.cardWidth,
          gridGap,
        )
      : { columns: 1, cardWidth: 0 };
  const columns = listColumns.filter((column) => column.id !== "location" || locationLabel);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setContentWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => onColumnsChange(grid.columns), [grid.columns, onColumnsChange]);

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
      baseKeys: additive ? new Set(selectedKeys) : new Set(),
    };
    let moved = false;
    let current = initial;
    const handleMove = (moveEvent: PointerEvent) => {
      const next = contentPoint(moveEvent);
      if (!moved && Math.hypot(next.x - initial.originX, next.y - initial.originY) < 4) return;
      if (!moved) document.body.classList.add("is-marquee-selecting");
      moved = true;
      current = { ...current, x: next.x, y: next.y };
      setMarquee(current);
      props.onMarqueeSelect([...new Set([...current.baseKeys, ...keysInMarquee(current)])]);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      document.body.classList.remove("is-marquee-selecting");
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

  function stateClassName(node: AssetLibraryNode) {
    return [
      node.kind === "folder" ? "media-bin-folder-row" : "",
      selectedKeys.has(node.key) ? "selected" : "",
      focusKey === node.key ? "is-focused" : "",
      cutKeys.has(node.key) ? "is-cut" : "",
      dropTargetKey === node.key ? "folder-drop-target" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function nameContent(node: AssetLibraryNode, className: string) {
    return renamingKey === node.key ? (
      <RenameInput
        initialValue={nodeName(node)}
        onCommit={(value) => props.onRename(node, value)}
        onCancel={props.onCancelRename}
      />
    ) : (
      <span className={className} title={nodeName(node)}>
        {nodeName(node)}
      </span>
    );
  }

  function toggleSort(key: AssetLibrarySortKey) {
    props.onSort({
      key,
      direction: sort.key === key && sort.direction === "ascending" ? "descending" : "ascending",
    });
  }

  function renderHeader() {
    const hasItems = nodes.length > 0;
    return (
      <div className="media-bin-table-header-viewport">
        <div className="media-bin-table-header" role="row">
          {columns.map((column) => {
            const active = column.sortKey !== null && sort.key === column.sortKey;
            const nextDirection = active && sort.direction === "ascending" ? "降序" : "升序";
            const name = column.id === "label" ? "标签" : column.label;
            return (
              <span
                key={column.id}
                className="media-bin-column-header"
                role="columnheader"
                aria-label={column.id === "label" ? "标签" : undefined}
                aria-sort={active ? sort.direction : undefined}
              >
                {column.sortKey ? (
                  <button
                    type="button"
                    className={`media-bin-column-sort-button${active ? " active" : ""}`}
                    title={`按${name}${nextDirection}排列`}
                    aria-label={`按${name}${nextDirection}排列`}
                    disabled={!hasItems}
                    onClick={() => toggleSort(column.sortKey!)}
                  >
                    <span className="media-bin-column-label-text">{column.label}</span>
                    {active && <SortArrow direction={sort.direction} />}
                  </button>
                ) : (
                  <span className="media-bin-column-label-text">{column.label}</span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  function renderRow(node: AssetLibraryNode) {
    const location = locationLabel?.(node);
    return (
      <div
        key={node.key}
        className={`media-bin-row asset-library-row ${stateClassName(node)}`}
        role="option"
        aria-selected={selectedKeys.has(node.key)}
        {...nodeHandlers(node)}
      >
        <span className="media-bin-label-cell">
          <LabelColor node={node} />
        </span>
        <span
          className={`media-bin-title-cell${
            node.kind === "folder" ? " media-bin-folder-title-cell" : ""
          }`}
        >
          <KindIcon node={node} />
          {nameContent(node, "media-bin-name-copy")}
        </span>
        {locationLabel && (
          <span className="asset-library-location-cell" title={location ?? undefined}>
            {location}
          </span>
        )}
        <span>{node.kind === "entry" && <AssetLibraryMarks entry={node.entry} />}</span>
        <span>{nodeDuration(node)}</span>
      </div>
    );
  }

  function renderCardPreview(node: AssetLibraryNode) {
    if (node.kind === "folder") {
      return (
        <span className="media-bin-card-preview folder">
          <MediaBinFolderIcon />
        </span>
      );
    }
    const subtitle = node.entry.root === "subtitles";
    const BadgeIcon = subtitle ? Captions : Film;
    return (
      <span className={`media-bin-card-preview ${subtitle ? "subtitle" : "video"}`}>
        {node.media ? (
          <>
            <AssetLibraryThumbnail
              entry={node.entry}
              media={node.media}
              displayWidth={grid.cardWidth}
              enabled={thumbnailsEnabled}
            />
            <span className="media-bin-card-type-badges" aria-hidden="true">
              <span className={`media-bin-card-type-badge ${subtitle ? "subtitle" : "video"}`}>
                <BadgeIcon />
              </span>
            </span>
          </>
        ) : (
          <OfflineFileIcon
            className="media-bin-offline-icon"
            role="img"
            aria-hidden={false}
            aria-label="媒体离线"
          />
        )}
        <span className="asset-library-card-flag">
          <AssetLibraryFlagMark entry={node.entry} />
        </span>
        <span className="asset-library-card-marks">
          <AssetLibraryMarks entry={node.entry} showFlag={false} />
        </span>
      </span>
    );
  }

  function renderCard(node: AssetLibraryNode) {
    const location = locationLabel?.(node);
    return (
      <div
        key={node.key}
        className={`media-bin-card asset-library-card ${
          node.kind === "folder" ? "media-bin-folder-card" : ""
        } ${stateClassName(node)}`}
        role="option"
        aria-selected={selectedKeys.has(node.key)}
        title={location || undefined}
        {...nodeHandlers(node)}
      >
        <span className="media-bin-card-preview-shell">{renderCardPreview(node)}</span>
        <span className="media-bin-card-meta">
          {node.kind === "entry" && node.entry.annotation.color_label && <LabelColor node={node} />}
          {nameContent(node, "media-bin-card-name")}
          <span className="media-bin-card-duration">
            {node.kind === "folder" ? `${node.childCount} 项` : nodeDuration(node)}
          </span>
        </span>
      </div>
    );
  }

  const listScale = layout.mode === "list" ? layout.iconScale : 1;
  const style = {
    "--media-list-row-height": layout.mode === "list" ? `${layout.rowHeight}px` : undefined,
    "--media-list-icon-size": `${16 * listScale}px`,
    "--media-list-title-icon-gap": `${6 * (1 + (listScale - 1) / 1.5)}px`,
    "--media-grid-column-count": grid.columns,
    "--media-grid-card-render-width": `${grid.cardWidth}px`,
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
      className={`asset-library-items-frame is-${layout.mode}${
        locationLabel ? " has-location" : ""
      }${dropTargetKey === "content" ? " is-drop-target" : ""}`}
      style={style}
    >
      {layout.mode === "list" && renderHeader()}
      <div
        ref={scrollRef}
        className="media-bin-table-scroll asset-library-items"
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
          <div className="media-bin-grid">{nodes.map(renderCard)}</div>
        )}
        {marqueeStyle && <div className="asset-library-marquee" style={marqueeStyle} />}
      </div>
    </div>
  );
}
