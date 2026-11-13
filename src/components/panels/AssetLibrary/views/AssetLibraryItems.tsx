import type { AssetLibraryRoot } from "../../../../types";
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
  formatAssetLibraryDate,
  type AssetLibrarySort,
  type AssetLibraryViewLayout,
} from "../../../../core/editor/assetLibrary";
import { formatMonitorTime } from "../../../../core/editor/time";
import "../../MediaBin/MediaBin.css";
import { MediaBinFolderIcon, OfflineFileIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import {
  assetLibraryColumnsForRoot,
  type AssetLibraryColumn,
  type AssetLibraryColumnId,
  type AssetLibraryColumnWidths,
} from "../assetLibraryColumns";
import { type AssetLibraryNode } from "../assetLibraryNodes";
import { AssetLibraryMarks, AssetLibraryThumbnailMarks } from "./AssetLibraryBadges";
import { AssetLibraryListHeader } from "./AssetLibraryListHeader";
import { AssetLibraryThumbnail } from "./AssetLibraryThumbnail";

/** Matches `.media-bin-grid`: 14px padding and a 12px gap. */
const gridPadding = 14;
const gridGap = 12;
/** Rows from the two-line height up have room to show a readable frame in the 16:9 slot. */
const twoLineRowHeight = 36;
/** List icons are 16px at the smallest size and scale with the shared size control. */
const listIconSize = 16;

interface MarqueeState {
  originX: number;
  originY: number;
  x: number;
  y: number;
  baseKeys: ReadonlySet<string>;
}

export interface AssetLibraryItemsProps {
  root: AssetLibraryRoot;
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
  visibleColumns: ReadonlySet<AssetLibraryColumnId>;
  columnWidths: AssetLibraryColumnWidths;
  itemCheckboxes: boolean;
  onSort: (sort: AssetLibrarySort) => void;
  onToggleColumn: (column: AssetLibraryColumnId) => void;
  onColumnWidthChange: (column: AssetLibraryColumnId, width: number) => void;
  onResetColumnWidths: () => void;
  /** Checkbox clicks add or remove one item without touching the rest of the selection. */
  onToggleNodeSelected: (node: AssetLibraryNode) => void;
  onToggleAllSelected: () => void;
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
  return node.kind === "folder"
    ? ""
    : formatMonitorTime(assetLibraryEntryDurationUs(node.entry), node.entry.media.frame_rate);
}

function cellText(node: AssetLibraryNode, column: AssetLibraryColumnId) {
  if (column === "created") {
    return formatAssetLibraryDate(
      node.kind === "folder" ? node.folder.created_at : node.entry.created_at,
    );
  }
  if (node.kind === "folder") return "";
  const { entry } = node;
  switch (column) {
    case "subtitle":
      return entry.text.trim();
    case "keywords":
      return entry.annotation.keywords.join("、");
    case "source":
      return entry.media.file_name;
    case "duration":
      return nodeDuration(node);
    default:
      return "";
  }
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

export function AssetLibraryItems(props: AssetLibraryItemsProps) {
  const {
    root,
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
    visibleColumns,
    columnWidths,
    itemCheckboxes,
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
  const columns = assetLibraryColumnsForRoot(root)
    .filter((column) => column.id !== "name")
    .filter((column) =>
      column.id === "location" ? Boolean(locationLabel) : visibleColumns.has(column.id),
    );
  const selectedCount = nodes.filter((node) => selectedKeys.has(node.key)).length;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setContentWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [nodes.length, layout.mode, layout.mode === "list" ? layout.rowHeight : layout.cardWidth]);

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
      <span
        className={`${className}${/\r?\n/.test(nodeName(node)) ? " has-explicit-lines" : ""}`}
        title={nodeName(node)}
      >
        {nodeName(node)}
      </span>
    );
  }

  function renderCheckbox(node: AssetLibraryNode, className = "") {
    if (!itemCheckboxes) return null;
    const selected = selectedKeys.has(node.key);
    return (
      <input
        type="checkbox"
        className={`asset-library-check${className}`}
        checked={selected}
        tabIndex={-1}
        aria-label={`选择“${nodeName(node)}”`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onChange={() => props.onToggleNodeSelected(node)}
      />
    );
  }

  function renderCell(node: AssetLibraryNode, column: AssetLibraryColumn) {
    if (column.id === "location") {
      const location = locationLabel?.(node);
      return (
        <span key={column.id} className="asset-library-location-cell" title={location ?? undefined}>
          {location}
        </span>
      );
    }
    if (column.id === "marks") {
      return (
        <span key={column.id}>
          {node.kind === "entry" && <AssetLibraryMarks entry={node.entry} />}
        </span>
      );
    }
    const text = cellText(node, column.id);
    const long = column.id === "subtitle" || column.id === "keywords";
    return (
      <span
        key={column.id}
        className={
          column.id === "subtitle" || column.id === "keywords" || column.id === "source"
            ? `asset-library-text-cell${/\r?\n/.test(text) ? " has-explicit-lines" : ""}`
            : undefined
        }
        title={
          column.id === "source" && node.kind === "entry"
            ? node.entry.media.path
            : long && text
              ? text
              : undefined
        }
      >
        {text}
      </span>
    );
  }

  const twoLineRows = layout.mode === "list" && layout.rowHeight >= twoLineRowHeight;
  const listPreviewWidth =
    layout.mode === "list" ? Math.round((listIconSize * layout.iconScale * 16) / 9) : 0;

  /** A 16:9 slot in every row; tall rows show the entry's frame, others its kind icon. */
  function renderListPreview(node: AssetLibraryNode) {
    return (
      <span className="asset-library-list-preview">
        {twoLineRows && node.kind === "entry" && node.media ? (
          <AssetLibraryThumbnail
            entry={node.entry}
            media={node.media}
            displayWidth={listPreviewWidth}
            enabled={thumbnailsEnabled}
          />
        ) : (
          <KindIcon node={node} />
        )}
      </span>
    );
  }

  function renderRow(node: AssetLibraryNode) {
    return (
      <div
        key={node.key}
        className={`media-bin-row asset-library-row ${stateClassName(node)}${twoLineRows ? " has-two-lines" : ""}`}
        role="option"
        aria-selected={selectedKeys.has(node.key)}
        {...nodeHandlers(node)}
      >
        <span
          className={`media-bin-title-cell${
            node.kind === "folder" ? " media-bin-folder-title-cell" : ""
          }`}
        >
          {renderCheckbox(node)}
          {renderListPreview(node)}
          {nameContent(node, "media-bin-name-copy")}
        </span>
        {columns.map((column) => renderCell(node, column))}
        <span aria-hidden="true" />
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
        <AssetLibraryThumbnailMarks entry={node.entry} />
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
        <span className="media-bin-card-preview-shell">
          {renderCardPreview(node)}
          {renderCheckbox(node, " asset-library-card-check")}
        </span>
        <span className="media-bin-card-meta">{nameContent(node, "media-bin-card-name")}</span>
      </div>
    );
  }

  const listScale = layout.mode === "list" ? layout.iconScale : 1;
  const detailWidths = columns.map((column) => columnWidths[column.id]);
  const style = {
    "--asset-library-columns": [
      `${columnWidths.name}px`,
      ...detailWidths.map((width) => `${width}px`),
      "minmax(0, 1fr)",
    ].join(" "),
    "--asset-library-min-width": `${
      columnWidths.name + detailWidths.reduce((total, width) => total + width, 0)
    }px`,
    "--media-list-row-height": layout.mode === "list" ? `${layout.rowHeight}px` : undefined,
    "--media-list-icon-size": `${listIconSize * listScale}px`,
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
        itemCheckboxes ? " has-checkboxes" : ""
      }${dropTargetKey === "content" ? " is-drop-target" : ""}`}
      style={style}
    >
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
        {layout.mode === "list" && (
          <AssetLibraryListHeader
            root={root}
            columns={columns}
            columnWidths={columnWidths}
            visibleColumns={visibleColumns}
            sort={sort}
            itemCount={nodes.length}
            selectedCount={selectedCount}
            itemCheckboxes={itemCheckboxes}
            onSort={props.onSort}
            onToggleColumn={props.onToggleColumn}
            onColumnWidthChange={props.onColumnWidthChange}
            onResetColumnWidths={props.onResetColumnWidths}
            onToggleAllSelected={props.onToggleAllSelected}
          />
        )}
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
