import { Captions, ChevronRight, Film } from "lucide-react";
import {
  useEffect,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import {
  assetLibraryRootLabels,
  assetLibraryRoots,
  sortedAssetLibraryNodes,
  type AssetLibraryLocation,
  type AssetLibrarySort,
} from "../../../../core/editor/assetLibrary";
import type {
  AssetLibraryFolder,
  AssetLibraryRoot,
  ProjectAssetLibraryState,
} from "../../../../types";
import { MediaBinFolderIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import {
  assetLibraryDropTargetProps,
  assetLibraryTreeDropPrefix as treeDropPrefix,
} from "../../../common/utils/assetLibraryDropTarget";
import { assetLocationKey } from "../assetLibraryNodes";

interface AssetLibraryNavigationProps {
  library: ProjectAssetLibraryState;
  location: AssetLibraryLocation;
  sort: AssetLibrarySort;
  collapsedKeys: ReadonlySet<string>;
  dropTargetKey: string | null;
  onNavigate: (location: AssetLibraryLocation) => void;
  onToggleCollapsed: (key: string) => void;
  onCreateFolder: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, location: AssetLibraryLocation) => void;
}

const rootIcons: Record<AssetLibraryRoot, { className: string; Icon: typeof Captions }> = {
  subtitles: { className: "subtitle", Icon: Captions },
  storyboards: { className: "video", Icon: Film },
};

/** How long a drag must hover over a collapsed folder before it opens, as in a file manager. */
const dragExpandDelayMs = 700;

interface VisibleTreeRow {
  key: string;
  target: AssetLibraryLocation;
  parent: AssetLibraryLocation | null;
  expandable: boolean;
  expanded: boolean;
}

function parentKey(root: AssetLibraryRoot, folderId: string | null) {
  return assetLocationKey({ root, folderId });
}

export function AssetLibraryNavigation(props: AssetLibraryNavigationProps) {
  const { library, location, collapsedKeys, dropTargetKey } = props;
  // Both maps use location keys so lookups match at every depth, not just under the roots.
  const childrenByParent = new Map<string, AssetLibraryFolder[]>();
  const countByParent = new Map<string, number>();
  for (const folder of library.folders) {
    const key = parentKey(folder.root, folder.parent_id);
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), folder]);
    countByParent.set(key, (countByParent.get(key) ?? 0) + 1);
  }
  for (const entry of library.entries) {
    const key = parentKey(entry.root, entry.folder_id);
    countByParent.set(key, (countByParent.get(key) ?? 0) + 1);
  }
  const sortedChildren = (key: string) =>
    sortedAssetLibraryNodes(childrenByParent.get(key) ?? [], [], props.sort).folders;
  const activeKey = assetLocationKey(location);
  // A drag resting on a collapsed tree folder opens it, as in a file manager. The timer is
  // dropped as soon as the row is left or opened some other way.
  const hoveredTreeKey = dropTargetKey?.startsWith(treeDropPrefix)
    ? dropTargetKey.slice(treeDropPrefix.length)
    : null;
  const dragExpandKey = hoveredTreeKey && collapsedKeys.has(hoveredTreeKey) ? hoveredTreeKey : null;
  const { onToggleCollapsed } = props;
  useEffect(() => {
    if (!dragExpandKey) return;
    const timer = window.setTimeout(() => onToggleCollapsed(dragExpandKey), dragExpandDelayMs);
    return () => window.clearTimeout(timer);
  }, [dragExpandKey, onToggleCollapsed]);

  // Rows in display order, for arrow-key movement through the expanded tree.
  function visibleRows() {
    const rows: VisibleTreeRow[] = [];
    const walk = (target: AssetLibraryLocation, parent: AssetLibraryLocation | null) => {
      const key = assetLocationKey(target);
      const children = sortedChildren(key);
      const expanded = children.length > 0 && !collapsedKeys.has(key);
      rows.push({ key, target, parent, expandable: children.length > 0, expanded });
      if (expanded) {
        children.forEach((folder) => walk({ root: folder.root, folderId: folder.id }, target));
      }
    };
    assetLibraryRoots.forEach((root) => walk({ root, folderId: null }, null));
    return rows;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rows = visibleRows();
    const index = rows.findIndex((row) => row.key === activeKey);
    const current = rows[index];
    let next: VisibleTreeRow | undefined;
    switch (event.key) {
      case "ArrowUp":
        next = rows[Math.max(0, index - 1)];
        break;
      case "ArrowDown":
        next = rows[Math.min(rows.length - 1, index + 1)];
        break;
      case "Home":
        next = rows[0];
        break;
      case "End":
        next = rows.at(-1);
        break;
      case "ArrowRight":
        if (current?.expandable && !current.expanded) props.onToggleCollapsed(current.key);
        else if (current?.expanded) next = rows[index + 1];
        break;
      case "ArrowLeft":
        if (current?.expanded) props.onToggleCollapsed(current.key);
        else if (current?.parent) next = { ...current, target: current.parent };
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next) props.onNavigate(next.target);
  }

  function renderItem(
    target: AssetLibraryLocation,
    label: string,
    icon: ReactElement,
    depth: number,
  ): ReactElement {
    const key = assetLocationKey(target);
    const children = sortedChildren(key);
    const expandable = children.length > 0;
    const expanded = expandable && !collapsedKeys.has(key);
    const active = activeKey === key;
    return (
      <li
        key={key}
        role="treeitem"
        aria-selected={active}
        aria-expanded={expandable ? expanded : undefined}
      >
        <div
          className={`media-bin-row media-bin-folder-row asset-library-tree-row${
            active ? " selected" : ""
          }${dropTargetKey === treeDropPrefix + key ? " folder-drop-target" : ""}`}
          style={{ "--asset-tree-depth": depth } as CSSProperties}
          onClick={() => props.onNavigate(target)}
          onDoubleClick={() => expandable && props.onToggleCollapsed(key)}
          onContextMenu={(event) => props.onContextMenu(event, target)}
          {...assetLibraryDropTargetProps(target, treeDropPrefix + key)}
        >
          <span className="media-bin-title-cell media-bin-folder-title-cell">
            {expandable ? (
              <button
                type="button"
                className={`media-bin-folder-toggle asset-library-tree-toggle${
                  expanded ? " expanded" : ""
                }`}
                tabIndex={-1}
                aria-label={expanded ? `折叠${label}` : `展开${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleCollapsed(key);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            ) : (
              <span className="asset-library-tree-toggle" aria-hidden="true" />
            )}
            {icon}
            <span className="media-bin-name-copy" title={label}>
              {label}
            </span>
          </span>
          <span className="asset-library-tree-count">{countByParent.get(key) ?? 0}</span>
        </div>
        {expanded && (
          <ul role="group">
            {children.map((folder) =>
              renderItem(
                { root: folder.root, folderId: folder.id },
                folder.name,
                <span className="media-bin-kind-icon folder">
                  <MediaBinFolderIcon />
                </span>,
                depth + 1,
              ),
            )}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav className="asset-library-navigation" aria-label="素材库文件夹">
      <div className="media-bin-table-scroll">
        <ul
          className="asset-library-tree"
          role="tree"
          tabIndex={0}
          aria-label="文件夹"
          onKeyDown={handleKeyDown}
        >
          {assetLibraryRoots.map((root) => {
            const { className, Icon } = rootIcons[root];
            return renderItem(
              { root, folderId: null },
              assetLibraryRootLabels[root],
              <span className={`media-bin-kind-icon ${className}`}>
                <Icon aria-hidden="true" />
              </span>,
              0,
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
