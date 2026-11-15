import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  Pin,
  Star,
  type LucideIcon,
} from "lucide-react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  assetLibraryProjectLabel,
  assetLibraryRootLabels,
  formatAssetLibraryDate,
} from "../../../../core/editor/assetLibrary";
import type {
  AssetLibraryHome,
  AssetLibraryHomeTab,
} from "../../../../core/editor/assetLibraryHome";
import type { ProjectAssetLibraryState } from "../../../../types";
import { assetNodeParentText, type AssetLibraryNode } from "../model/nodes";
import "./AssetLibraryHome.css";
import { AssetLibraryThumbnail } from "./AssetLibraryPreview";
import { assetLibraryFolderIcons, assetLibraryRootIcons } from "./AssetLibraryIcons";

/** Section ids, kept with the properties pane's in the panel's collapsed sections. */
export const assetLibraryHomeSections = { quickAccess: "home:quick-access", files: "home:files" };

/** Each material row shows its first frame at this width, in a 16:9 slot. */
const homeThumbnailWidth = 50;

interface HomeEmptyState {
  icon: LucideIcon;
  title: string;
  hint: string;
}

const homeTabs: readonly {
  tab: AssetLibraryHomeTab;
  label: string;
  icon: LucideIcon;
  empty: HomeEmptyState;
}[] = [
  {
    tab: "recent",
    label: "最近使用的素材",
    icon: Clock,
    empty: {
      icon: Clock,
      title: "你最近使用的素材将显示在此处",
      hint: "你将在此处快速访问最近使用的素材。",
    },
  },
  {
    tab: "favorites",
    label: "收藏夹",
    icon: Star,
    empty: {
      icon: Star,
      title: "你的收藏夹将显示在此处",
      hint: "选择一个素材，然后选择“添加到收藏夹”以在此处访问它。",
    },
  },
];

const quickAccessEmpty: HomeEmptyState = {
  icon: Pin,
  title: "常用的文件夹可以固定在此处",
  hint: "右键单击文件夹，然后选择“固定到快速访问”。",
};

/** A small stack of cards around the section's symbol, then what fills the section and how. */
function HomeEmpty({ state, compact = false }: { state: HomeEmptyState; compact?: boolean }) {
  const Icon = state.icon;
  return (
    <div className={`asset-library-home-placeholder${compact ? " is-compact" : ""}`}>
      <span className="asset-library-home-placeholder-art" aria-hidden="true">
        <span className="asset-library-home-placeholder-card is-back-left" />
        <span className="asset-library-home-placeholder-card is-back-right" />
        <span className="asset-library-home-placeholder-card is-front">
          <span className="asset-library-home-placeholder-badge">
            <Icon />
          </span>
        </span>
      </span>
      <strong>{state.title}</strong>
      <span>{state.hint}</span>
    </div>
  );
}

interface AssetLibraryHomeProps {
  library: ProjectAssetLibraryState;
  home: AssetLibraryHome;
  tab: AssetLibraryHomeTab;
  /** Pinned folders, then the materials of the open tab, as the panel lists them. */
  nodes: readonly AssetLibraryNode[];
  selectedKeys: ReadonlySet<string>;
  focusKey: string | null;
  cutKeys: ReadonlySet<string>;
  thumbnailsEnabled: boolean;
  collapsedSections: ReadonlySet<string>;
  onToggleSection: (section: string) => void;
  onTabChange: (tab: AssetLibraryHomeTab) => void;
  onNodePointerDown: (event: ReactPointerEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onNodeClick: (event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode) => void;
  onOpenNode: (node: AssetLibraryNode) => void;
  onOpenLocation: (node: AssetLibraryNode) => void;
  onClearSelection: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode | null) => void;
}

/**
 * The home, as in a file manager: folders pinned to quick access as tiles, then recently used
 * or favorite materials in a list that names where each one is.
 */
export function AssetLibraryHome(props: AssetLibraryHomeProps) {
  const { library, home, tab, nodes, selectedKeys, focusKey, cutKeys, collapsedSections } = props;
  const pinned = nodes.filter((node) => node.kind !== "entry");
  const materials = nodes.filter((node) => node.kind === "entry");
  const usedAt = new Map(home.recent.map((use) => [use.entryId, use.usedAt]));
  const quickAccessOpen = !collapsedSections.has(assetLibraryHomeSections.quickAccess);
  const filesOpen = !collapsedSections.has(assetLibraryHomeSections.files);

  function itemProps(node: AssetLibraryNode, className: string) {
    const selected = selectedKeys.has(node.key);
    const hidden =
      node.kind !== "library" && (node.kind === "folder" ? node.folder : node.entry).hidden;
    return {
      "data-asset-key": node.key,
      role: "option",
      "aria-selected": selected,
      className: [
        className,
        selected ? "selected" : "",
        focusKey === node.key ? "is-focused" : "",
        cutKeys.has(node.key) ? "is-cut" : "",
        hidden ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" "),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        event.stopPropagation();
        props.onNodePointerDown(event, node);
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.stopPropagation();
        props.onNodeClick(event, node);
      },
      onDoubleClick: () => props.onOpenNode(node),
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => props.onContextMenu(event, node),
    };
  }

  function heading(section: string, open: boolean, label: string, content: ReactNode) {
    return (
      <div className="asset-library-home-heading">
        <button
          type="button"
          className="asset-library-home-toggle"
          aria-expanded={open}
          aria-label={open ? `折叠${label}` : `展开${label}`}
          onClick={() => props.onToggleSection(section)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
        {content}
      </div>
    );
  }

  const openTab = homeTabs.find((candidate) => candidate.tab === tab) ?? homeTabs[0]!;

  return (
    // Framed like the item views beside the navigation pane.
    <div className="asset-library-items-frame">
      <div
        className="media-bin-table-scroll asset-library-items asset-library-home"
        onPointerDown={(event) => {
          if (event.button === 0) props.onClearSelection();
        }}
        onContextMenu={(event) => props.onContextMenu(event, null)}
      >
        <section className="asset-library-home-section" aria-label="快速访问">
          {heading(
            assetLibraryHomeSections.quickAccess,
            quickAccessOpen,
            "快速访问",
            <span className="asset-library-home-title">快速访问</span>,
          )}
          {quickAccessOpen &&
            (pinned.length > 0 ? (
              <div className="asset-library-home-tiles" role="listbox" aria-label="快速访问">
                {pinned.map((node) => {
                  // A pinned library sits in the project; a pinned folder names its path.
                  const isLibrary = node.kind === "library";
                  const Icon = isLibrary
                    ? assetLibraryRootIcons[node.root]
                    : assetLibraryFolderIcons[node.folder.root];
                  const name = isLibrary ? assetLibraryRootLabels[node.root] : node.folder.name;
                  return (
                    <div key={node.key} {...itemProps(node, "asset-library-home-tile")}>
                      <span className="asset-library-home-tile-icon">
                        <Icon />
                      </span>
                      <span className="asset-library-home-tile-copy">
                        <span className="asset-library-home-name" title={name}>
                          {name}
                        </span>
                        <span className="asset-library-home-detail">
                          {isLibrary
                            ? assetLibraryProjectLabel
                            : assetNodeParentText(library, node)}
                        </span>
                        <Pin className="asset-library-home-pin" aria-label="已固定" />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <HomeEmpty state={quickAccessEmpty} compact />
            ))}
        </section>

        <section className="asset-library-home-section" aria-label={openTab.label}>
          {heading(
            assetLibraryHomeSections.files,
            filesOpen,
            openTab.label,
            <div className="asset-library-home-tabs" role="tablist">
              {homeTabs.map(({ tab: candidate, label, icon: TabIcon }) => {
                return (
                  <button
                    key={candidate}
                    type="button"
                    role="tab"
                    aria-selected={candidate === tab}
                    className={candidate === tab ? "is-active" : undefined}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onTabChange(candidate)}
                  >
                    <TabIcon aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>,
          )}
          {filesOpen &&
            (materials.length > 0 ? (
              <div className="asset-library-home-list" role="listbox" aria-label={openTab.label}>
                <div className="asset-library-home-list-header" aria-hidden="true">
                  <span>名称</span>
                  <span>使用日期</span>
                </div>
                {materials.map((node) => {
                  if (node.kind !== "entry") return null;
                  const used = usedAt.get(node.entry.id);
                  return (
                    <div key={node.key} {...itemProps(node, "asset-library-home-row")}>
                      <span className="asset-library-home-row-name">
                        <span className="asset-library-home-thumbnail">
                          <AssetLibraryThumbnail
                            entry={node.entry}
                            media={node.media}
                            displayWidth={homeThumbnailWidth}
                            enabled={props.thumbnailsEnabled}
                          />
                        </span>
                        <span className="asset-library-home-row-copy">
                          <span className="asset-library-home-name" title={node.entry.name}>
                            {node.entry.name}
                          </span>
                          <span className="asset-library-home-detail">
                            {assetNodeParentText(library, node)}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="asset-library-home-row-action"
                          title="打开所在位置"
                          aria-label="打开所在位置"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onOpenLocation(node);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <FolderOpen aria-hidden="true" />
                        </button>
                      </span>
                      <span className="asset-library-home-row-date">
                        {used === undefined ? "" : formatAssetLibraryDate(used)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <HomeEmpty state={openTab.empty} />
            ))}
        </section>
      </div>
    </div>
  );
}
