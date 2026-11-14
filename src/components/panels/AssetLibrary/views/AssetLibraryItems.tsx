import { Captions, Film } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  assetLibraryEntryDurationUs,
  assetLibraryGridLayout,
  assetLibraryRootLabels,
  formatAssetLibraryDate,
  type AssetLibraryLocation,
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
import { assetLibraryDropTargetProps } from "../../../common/utils/assetLibraryDropTarget";
import { assetNodeTarget, type AssetLibraryNode } from "../assetLibraryNodes";
import type { AssetLibraryColumnScope } from "../assetLibraryColumns";
import { assetLibraryRootIcons } from "./AssetLibraryTreeIcons";
import { AssetLibraryMarks, AssetLibraryThumbnailMarks } from "./AssetLibraryBadges";
import { AssetLibraryHoverFrame } from "./AssetLibraryHoverFrame";
import { AssetLibraryListHeader } from "./AssetLibraryListHeader";
import { AssetLibraryThumbnail } from "./AssetLibraryThumbnail";

/** Matches `.media-bin-grid`: 14px padding and a 12px gap. */
const gridPadding = 14;
const gridGap = 12;
/** Rows from the two-line height up have room to show a readable frame in the 16:9 slot. */
const twoLineRowHeight = 36;
/** Card names clamp to this many lines, as .asset-library-card .media-bin-card-name does. */
const cardNameLines = 4;
/** List icons are 16px at the smallest size and scale with the shared size control. */
const listIconSize = 16;

/** The media bin's icon-view hover scrub: which card and where along its thumbnail. */
interface HoverScrub {
  key: string;
  progress: number;
}

interface MarqueeState {
  originX: number;
  originY: number;
  x: number;
  y: number;
  baseKeys: ReadonlySet<string>;
}

export interface AssetLibraryItemsProps {
  /** The column set: one library, or the project, which shows every column. */
  root: AssetLibraryColumnScope;
  /** The folder on show, which the empty part of the pane drops into; the project takes none. */
  location: AssetLibraryLocation | null;
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
  /** The "隐藏" column checkbox, for the one item in its row. */
  onSetHidden: (node: AssetLibraryNode, hidden: boolean) => void;
  onNodePointerDown: (event: ReactPointerEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onNodeClick: (event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onOpenNode: (node: AssetLibraryNode) => void;
  onMarqueeSelect: (keys: string[]) => void;
  onClearSelection: () => void;
  onRename: (node: AssetLibraryNode, name: string) => void;
  onCancelRename: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode | null) => void;
  onColumnsChange: (columns: number) => void;
  /** Ctrl+wheel steps the shared size control, switching between list and icons. */
  onZoom: (steps: number) => void;
}

function nodeHidden(node: AssetLibraryNode) {
  if (node.kind === "library") return false;
  return node.kind === "folder" ? node.folder.hidden : node.entry.hidden;
}

function nodeName(node: AssetLibraryNode) {
  if (node.kind === "library") return assetLibraryRootLabels[node.root];
  return node.kind === "folder" ? node.folder.name : node.entry.name;
}

function nodeDuration(node: AssetLibraryNode) {
  return node.kind === "entry"
    ? formatMonitorTime(assetLibraryEntryDurationUs(node.entry), node.entry.media.frame_rate)
    : "";
}

function cellText(node: AssetLibraryNode, column: AssetLibraryColumnId) {
  if (node.kind === "library") return "";
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
    case "inPoint":
      return formatMonitorTime(entry.start_us, entry.media.frame_rate);
    case "duration":
      return nodeDuration(node);
    default:
      return "";
  }
}

/** Line height of item names, which the rename field matches line for line. */
const nameLineHeightPx = 16;

/**
 * Edits a name in place of its label. The field wraps like the label and opens at the
 * number of lines the label showed, up to `maxLines`; longer text scrolls inside it.
 */
function RenameInput({
  initialValue,
  maxLines,
  wrap,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  maxLines: number;
  wrap: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const finishedRef = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const lines = Math.round(field.scrollHeight / nameLineHeightPx);
    field.style.height = `${Math.min(maxLines, Math.max(1, lines)) * nameLineHeightPx}px`;
  }, [maxLines]);
  const finish = (commit: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <textarea
      ref={fieldRef}
      className={`media-bin-title-editor asset-library-rename${wrap ? " is-wrapping" : ""}`}
      value={value}
      rows={1}
      wrap={wrap ? "soft" : "off"}
      spellCheck={false}
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
        // Enter that confirms an input method candidate is not a commit.
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}

/** The media bin's kind glyphs, drawn in one fixed-size box so every row lines up. */
function KindIcon({ node }: { node: AssetLibraryNode }) {
  if (node.kind === "library") {
    const Icon = assetLibraryRootIcons[node.root];
    return (
      <span className="media-bin-kind-icon folder">
        <Icon />
      </span>
    );
  }
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
    location,
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
  const [hoverScrub, setHoverScrub] = useState<HoverScrub | null>(null);
  /** Selected cards keep their last scrub position after the pointer leaves, as in the media bin. */
  const [keptScrubProgress, setKeptScrubProgress] = useState<Readonly<Record<string, number>>>({});

  // Unmounted cards never get pointerleave; drop scrubs for cards that left the view, and the
  // live scrub while the panel is in the background.
  useEffect(() => {
    const shown = new Set(nodes.map((node) => node.key));
    setHoverScrub((current) =>
      current && thumbnailsEnabled && shown.has(current.key) ? current : null,
    );
    setKeptScrubProgress((current) =>
      Object.keys(current).every((key) => shown.has(key))
        ? current
        : Object.fromEntries(Object.entries(current).filter(([key]) => shown.has(key))),
    );
  }, [nodes, thumbnailsEnabled]);
  const grid =
    layout.mode === "icons"
      ? assetLibraryGridLayout(contentWidth - gridPadding * 2, layout.cardWidth, gridGap)
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
    // Folders and libraries take drops into themselves.
    const target = assetNodeTarget(node);
    return {
      "data-asset-key": node.key,
      ...(target ? assetLibraryDropTargetProps(target, node.key) : {}),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) =>
        props.onNodePointerDown(event, node),
      onClick: (event: ReactMouseEvent<HTMLElement>) => props.onNodeClick(event, node),
      onDoubleClick: () => props.onOpenNode(node),
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => props.onContextMenu(event, node),
    };
  }

  function stateClassName(node: AssetLibraryNode) {
    return [
      node.kind === "entry" ? "" : "media-bin-folder-row",
      selectedKeys.has(node.key) ? "selected" : "",
      focusKey === node.key ? "is-focused" : "",
      cutKeys.has(node.key) ? "is-cut" : "",
      dropTargetKey === node.key ? "folder-drop-target" : "",
      nodeHidden(node) ? "is-hidden" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function nameContent(node: AssetLibraryNode, className: string, maxLines: number) {
    const explicitLines = /\r?\n/.test(nodeName(node));
    return renamingKey === node.key ? (
      <RenameInput
        initialValue={nodeName(node)}
        maxLines={maxLines}
        // Labels with their own line breaks keep them rather than wrapping, except on cards.
        wrap={maxLines > 1 && !(explicitLines && layout.mode === "list")}
        onCommit={(value) => props.onRename(node, value)}
        onCancel={props.onCancelRename}
      />
    ) : (
      <span
        className={`${className}${explicitLines ? " has-explicit-lines" : ""}`}
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
    if (column.id === "hidden") {
      if (node.kind === "library") return <span key={column.id} />;
      return (
        <span key={column.id} className="media-bin-boolean-cell">
          <input
            type="checkbox"
            checked={nodeHidden(node)}
            tabIndex={-1}
            aria-label={`隐藏“${nodeName(node)}”`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => props.onSetHidden(node, event.currentTarget.checked)}
          />
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
          {nameContent(node, "media-bin-name-copy", twoLineRows ? 2 : 1)}
        </span>
        {columns.map((column) => renderCell(node, column))}
        <span aria-hidden="true" />
      </div>
    );
  }

  function updateHoverScrub(event: ReactPointerEvent<HTMLElement>, key: string) {
    if (event.buttons !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setHoverScrub((current) =>
      current?.key === key && current.progress === progress ? current : { key, progress },
    );
  }

  function finishHoverScrub(key: string) {
    if (hoverScrub?.key !== key) return;
    const { progress } = hoverScrub;
    setKeptScrubProgress(({ [key]: _removed, ...remaining }) =>
      selectedKeys.has(key) ? { ...remaining, [key]: progress } : remaining,
    );
    setHoverScrub(null);
  }

  function scrubProgress(node: AssetLibraryNode) {
    if (hoverScrub?.key === node.key) return hoverScrub.progress;
    return selectedKeys.has(node.key) ? (keptScrubProgress[node.key] ?? null) : null;
  }

  function renderCardPreview(node: AssetLibraryNode, progress: number | null) {
    if (node.kind !== "entry") {
      const Icon = node.kind === "library" ? assetLibraryRootIcons[node.root] : MediaBinFolderIcon;
      return (
        <span className="media-bin-card-preview folder">
          <Icon />
        </span>
      );
    }
    const subtitle = node.entry.root === "subtitles";
    const BadgeIcon = subtitle ? Captions : Film;
    const scrubbable = Boolean(node.media);
    return (
      <span
        className={`media-bin-card-preview ${subtitle ? "subtitle" : "video"}`}
        onPointerMove={
          scrubbable && thumbnailsEnabled ? (event) => updateHoverScrub(event, node.key) : undefined
        }
        onPointerLeave={scrubbable ? () => finishHoverScrub(node.key) : undefined}
      >
        {node.media ? (
          <>
            <AssetLibraryThumbnail
              entry={node.entry}
              media={node.media}
              displayWidth={grid.cardWidth}
              enabled={thumbnailsEnabled}
            />
            {progress !== null && (
              <AssetLibraryHoverFrame
                key={node.media.previewPath}
                entry={node.entry}
                media={node.media}
                progress={progress}
              />
            )}
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
    const progress =
      node.kind === "entry" && node.media && thumbnailsEnabled ? scrubProgress(node) : null;
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
          {renderCardPreview(node, progress)}
          {renderCheckbox(node, " asset-library-card-check")}
          {progress !== null && (
            <span
              className={`media-bin-card-hover-progress${selectedKeys.has(node.key) ? " is-selected" : ""}`}
              aria-hidden="true"
            >
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </span>
        <span className="media-bin-card-meta">
          {nameContent(node, "media-bin-card-name", cardNameLines)}
        </span>
      </div>
    );
  }

  const listScale = layout.mode === "list" ? layout.iconScale : 1;
  const showHeader = layout.mode === "list" || nodes.length === 0;
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
      className={`asset-library-items-frame is-${layout.mode}${showHeader ? " has-table-header" : ""}${
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
        {...(location ? assetLibraryDropTargetProps(location, "content") : {})}
      >
        {showHeader && (
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
