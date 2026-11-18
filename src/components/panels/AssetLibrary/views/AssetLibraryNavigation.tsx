import { scheduleAfter, cancelTask } from "../../../../runtime/scheduling";
import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { ChevronRight, Pin } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import {
  assetLibraryHomePlace,
  assetLibraryProjectLabel,
  assetLibraryProjectPlace,
  assetLibraryRootLabels,
  assetLibraryRoots,
  sortedAssetLibraryNodes,
  type AssetLibraryLocation,
  type AssetLibraryPlace,
  type AssetLibrarySort,
} from "../../../../core/editor/assetLibrary/assetLibrary";
import {
  assetLibraryHomeLabel,
  type AssetLibraryPinnedPlace,
} from "../../../../core/editor/assetLibrary/assetLibraryHome";
import type {
  AssetLibraryFolder,
  AssetLibraryRoot,
  ProjectAssetLibraryState,
} from "../../../../types";
import {
  assetLibraryDropTargetProps,
  assetLibraryTreeDropPrefix as treeDropPrefix,
} from "../../../common/AssetLibraryDrag";
import { assetLocationKey } from "../model/nodes";
import {
  assetLibraryFolderIcons,
  AssetLibraryHomeIcon,
  AssetLibraryProjectIcon,
  assetLibraryRootIcons,
} from "./AssetLibraryIcons";

interface AssetLibraryNavigationProps {
  library: ProjectAssetLibraryState;
  location: AssetLibraryPlace;
  sort: AssetLibrarySort;
  collapsedKeys: ReadonlySet<string>;
  showHidden: boolean;
  /** Folders and libraries pinned to quick access, listed under the home without children. */
  pinnedPlaces: readonly AssetLibraryPinnedPlace[];
  dropTargetKey: string | null;
  onNavigate: (location: AssetLibraryPlace) => void;
  onToggleCollapsed: (key: string) => void;
  onCreateFolder: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, location: AssetLibraryLocation) => void;
}

/** The "此项目" row above both libraries; it opens like a folder and lists them. */
const projectKey = assetLocationKey(assetLibraryProjectPlace);
const projectLabel = assetLibraryProjectLabel;
const homeKey = assetLocationKey(assetLibraryHomePlace);
/** Pinned rows repeat folders from the tree, so their keys are kept apart. */
const pinnedKey = (pinId: string) => `pin:${pinId}`;
const pinnedTarget = ({ root, folder }: AssetLibraryPinnedPlace): AssetLibraryLocation => ({
  root,
  folderId: folder?.id ?? null,
});

/** How long a drag must hover over a collapsed folder before it opens, as in a file manager. */
const dragExpandDelayMs = 700;

interface VisibleTreeRow {
  key: string;
  target: AssetLibraryPlace;
  parent: AssetLibraryPlace | null;
  expandable: boolean;
  expanded: boolean;
}

function parentKey(root: AssetLibraryRoot, folderId: string | null) {
  return assetLocationKey({ root, folderId });
}

export function AssetLibraryNavigation(props: AssetLibraryNavigationProps) {
  const lifetime = new RenderLifetime();

  const { library, location, collapsedKeys, dropTargetKey } = props;
  // Location keys make lookups match at every depth, not just under the roots.
  const childrenByParent = new Map<string, AssetLibraryFolder[]>();
  for (const folder of library.folders) {
    if (folder.hidden && !props.showHidden) continue;
    const key = parentKey(folder.root, folder.parent_id);
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), folder]);
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
  lifetime.useAfterCommit(() => {
    if (!dragExpandKey) return;
    const timer = scheduleAfter(() => onToggleCollapsed(dragExpandKey), dragExpandDelayMs);
    return () => cancelTask(timer);
  }, [dragExpandKey, onToggleCollapsed]);

  // Rows in display order, for arrow-key movement through the expanded tree.
  function visibleRows() {
    const rows: VisibleTreeRow[] = [];
    const walk = (target: AssetLibraryLocation, parent: AssetLibraryPlace) => {
      const key = assetLocationKey(target);
      const children = sortedChildren(key);
      const expanded = children.length > 0 && !collapsedKeys.has(key);
      rows.push({ key, target, parent, expandable: children.length > 0, expanded });
      if (expanded) {
        children.forEach((folder) => walk({ root: folder.root, folderId: folder.id }, target));
      }
    };
    rows.push({
      key: homeKey,
      target: assetLibraryHomePlace,
      parent: null,
      expandable: false,
      expanded: false,
    });
    for (const pinned of props.pinnedPlaces) {
      rows.push({
        key: pinnedKey(pinned.id),
        target: pinnedTarget(pinned),
        parent: null,
        expandable: false,
        expanded: false,
      });
    }
    const projectOpen = !collapsedKeys.has(projectKey);
    rows.push({
      key: projectKey,
      target: assetLibraryProjectPlace,
      parent: null,
      expandable: true,
      expanded: projectOpen,
    });
    if (projectOpen) {
      assetLibraryRoots.forEach((root) => walk({ root, folderId: null }, assetLibraryProjectPlace));
    }
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
    hidden = false,
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
          }${dropTargetKey === treeDropPrefix + key ? " folder-drop-target" : ""}${
            hidden ? " is-hidden" : ""
          }`}
          style={{ "--asset-tree-depth": depth } as CSSProperties}
          onClick={() => props.onNavigate(target)}
          onContextMenu={(event) => props.onContextMenu(event, target)}
          {...assetLibraryDropTargetProps(target, treeDropPrefix + key)}
        >
          <span className="media-bin-title-cell media-bin-folder-title-cell">
            {expandable ? (
              renderToggle(key, label, expanded)
            ) : (
              <span className="asset-library-tree-toggle" aria-hidden="true" />
            )}
            {icon}
            <span className="media-bin-name-copy" title={label}>
              {label}
            </span>
          </span>
        </div>
        {expanded && (
          <ul role="group">
            {children.map((folder) => {
              const FolderIcon = assetLibraryFolderIcons[folder.root];
              return renderItem(
                { root: folder.root, folderId: folder.id },
                folder.name,
                <span className="media-bin-kind-icon folder">
                  <FolderIcon />
                </span>,
                depth + 1,
                folder.hidden,
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  function renderToggle(key: string, label: string, expanded: boolean) {
    return (
      <button
        type="button"
        className={`media-bin-folder-toggle asset-library-tree-toggle${expanded ? " expanded" : ""}`}
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
    );
  }

  // The project groups the two libraries, as "此电脑" groups drives; it only opens and closes.
  const projectExpanded = !collapsedKeys.has(projectKey);

  /** The home and pinned folders are single rows: they never expand, as in a file manager. */
  function renderShortcut(
    key: string,
    target: AssetLibraryPlace,
    label: string,
    icon: ReactElement,
    options: { pinned?: AssetLibraryLocation; hidden?: boolean } = {},
  ) {
    const active = activeKey === assetLocationKey(target);
    const { pinned } = options;
    return (
      <li key={key} role="treeitem" aria-selected={active}>
        <div
          className={`media-bin-row media-bin-folder-row asset-library-tree-row${
            active ? " selected" : ""
          }${dropTargetKey === treeDropPrefix + key ? " folder-drop-target" : ""}${
            options.hidden ? " is-hidden" : ""
          }`}
          style={{ "--asset-tree-depth": 0 } as CSSProperties}
          onClick={() => props.onNavigate(target)}
          onContextMenu={(event) =>
            pinned ? props.onContextMenu(event, pinned) : event.preventDefault()
          }
          {...(pinned ? assetLibraryDropTargetProps(pinned, treeDropPrefix + key) : {})}
        >
          <span className="media-bin-title-cell media-bin-folder-title-cell">
            <span className="asset-library-tree-toggle" aria-hidden="true" />
            {icon}
            <span className="media-bin-name-copy" title={label}>
              {label}
            </span>
            {pinned && <Pin className="asset-library-tree-pin" aria-label="已固定" />}
          </span>
        </div>
      </li>
    );
  }

  return lifetime.render(
    <nav className="asset-library-navigation" aria-label="素材库文件夹">
      <div className="media-bin-table-scroll">
        <ul
          className="asset-library-tree"
          role="tree"
          tabIndex={0}
          aria-label="文件夹"
          onKeyDown={handleKeyDown}
        >
          {renderShortcut(
            homeKey,
            assetLibraryHomePlace,
            assetLibraryHomeLabel,
            <span className="media-bin-kind-icon folder">
              <AssetLibraryHomeIcon />
            </span>,
          )}
          <li role="separator" className="asset-library-tree-separator" />
          {props.pinnedPlaces.map((pinned) => {
            const { folder, root } = pinned;
            const Icon = folder ? assetLibraryFolderIcons[root] : assetLibraryRootIcons[root];
            const target = pinnedTarget(pinned);
            return renderShortcut(
              pinnedKey(pinned.id),
              target,
              folder?.name ?? assetLibraryRootLabels[root],
              <span className="media-bin-kind-icon folder">
                <Icon />
              </span>,
              { pinned: target, hidden: folder?.hidden },
            );
          })}
          {props.pinnedPlaces.length > 0 && (
            <li role="separator" className="asset-library-tree-separator" />
          )}
          {/* The project opens like a folder; the arrow or a double-click expands it. */}
          <li
            role="treeitem"
            aria-selected={activeKey === projectKey}
            aria-expanded={projectExpanded}
          >
            <div
              className={`media-bin-row media-bin-folder-row asset-library-tree-row${
                activeKey === projectKey ? " selected" : ""
              }`}
              style={{ "--asset-tree-depth": 0 } as CSSProperties}
              onClick={() => props.onNavigate(assetLibraryProjectPlace)}
              onDoubleClick={() => props.onToggleCollapsed(projectKey)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <span className="media-bin-title-cell media-bin-folder-title-cell">
                {renderToggle(projectKey, projectLabel, projectExpanded)}
                <span className="media-bin-kind-icon folder">
                  <AssetLibraryProjectIcon />
                </span>
                <span className="media-bin-name-copy" title={projectLabel}>
                  {projectLabel}
                </span>
              </span>
            </div>
            {projectExpanded && (
              <ul role="group">
                {assetLibraryRoots.map((root) => {
                  const Icon = assetLibraryRootIcons[root];
                  return renderItem(
                    { root, folderId: null },
                    assetLibraryRootLabels[root],
                    <span className="media-bin-kind-icon folder">
                      <Icon />
                    </span>,
                    1,
                  );
                })}
              </ul>
            )}
          </li>
        </ul>
      </div>
    </nav>,
  );
}
