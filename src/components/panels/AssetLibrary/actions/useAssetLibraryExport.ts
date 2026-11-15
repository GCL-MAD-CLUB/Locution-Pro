import type { AssetLibraryLocation } from "../../../../core/editor/assetLibrary";
import {
  assetLibraryExportEntries,
  type AssetLibraryExportSelection,
} from "../../../../core/editor/assetLibraryExport";
import { useExportCapability } from "../../../../runtime/capabilities/ExportCapability";
import type { SystemIdentity } from "../../../../runtime/systems/identity";
import {
  buildAssetLibraryExportSource,
  enqueueQuickExport,
  requestExport,
  type ExportSource,
} from "../../../../systems/ExportSystem";
import { useProjectPort } from "../../../../systems/ProjectSystem";
import type { ProjectAssetLibraryState } from "../../../../types";
import type { AssetLibraryNode, ResolvedAssetMedia } from "../model/nodes";

interface AssetLibraryExportOptions {
  identity: SystemIdentity;
  /** Whether this panel answers the global export commands. */
  active: boolean;
  library: ProjectAssetLibraryState;
  showHidden: boolean;
  mediaByEntryId: ReadonlyMap<string, ResolvedAssetMedia | null>;
  /** The listed items the global export commands act on. */
  selectedNodes: readonly AssetLibraryNode[];
}

/**
 * What selected listed items, or a navigation-pane row, export: libraries and folders bring
 * everything inside them.
 */
export function assetLibraryExportSelection(
  nodes: readonly AssetLibraryNode[],
  treeLocation?: AssetLibraryLocation,
): AssetLibraryExportSelection {
  if (treeLocation) {
    const { root, folderId } = treeLocation;
    return { roots: folderId ? [] : [root], folderIds: folderId ? [folderId] : [], entryIds: [] };
  }
  return {
    roots: nodes.flatMap((node) => (node.kind === "library" ? [node.root] : [])),
    folderIds: nodes.flatMap((node) => (node.kind === "folder" ? [node.folder.id] : [])),
    entryIds: nodes.flatMap((node) => (node.kind === "entry" ? [node.entry.id] : [])),
  };
}

/**
 * Exports asset-library materials the way the subtitle and storyboard panels export their
 * selections: 导出 opens the export workspace, 使用上次设置导出 starts right away. Materials
 * whose media is offline are left out and reported.
 */
export function useAssetLibraryExport({
  identity,
  active,
  library,
  showHidden,
  mediaByEntryId,
  selectedNodes,
}: AssetLibraryExportOptions) {
  const { mediaItems, projects, detachedVideoIds, exportState, messagePublished } = useProjectPort(
    ["mediaItems", "projects", "detachedVideoIds", "exportState"],
    ["messagePublished"],
  );

  /** Materials of a selection whose media still plays; the count needs no export source. */
  function exportableCount(selection: AssetLibraryExportSelection) {
    return assetLibraryExportEntries(library, selection, showHidden).filter((entry) =>
      mediaByEntryId.get(entry.id),
    ).length;
  }

  function sourceFor(selection: AssetLibraryExportSelection) {
    const entries = assetLibraryExportEntries(library, selection, showHidden);
    const items = entries.flatMap((entry) => {
      const media = mediaByEntryId.get(entry.id);
      return media ? [{ entry, videoId: media.videoId }] : [];
    });
    const source = buildAssetLibraryExportSource({
      items,
      mediaItems,
      projects,
      detachedVideoIds,
    });
    return { source, skipped: entries.length - (source?.clips.length ?? 0) };
  }

  /** Builds the source and says why nothing or not everything can export. */
  function preparedSource(selection: AssetLibraryExportSelection): ExportSource | null {
    const { source, skipped } = sourceFor(selection);
    if (!source) {
      messagePublished(
        skipped > 0 ? "所选素材的源媒体均已离线或从项目移除，无法导出。" : "所选内容中没有素材。",
      );
      return null;
    }
    if (skipped > 0) messagePublished(`已跳过 ${skipped} 个源媒体离线的素材。`);
    return source;
  }

  function configure(selection: AssetLibraryExportSelection) {
    const source = preparedSource(selection);
    if (source) requestExport(source);
  }

  async function quick(selection: AssetLibraryExportSelection) {
    const source = exportState ? preparedSource(selection) : null;
    if (!source || !exportState) return;
    const submission = enqueueQuickExport(source, exportState);
    if (await submission.started) messagePublished("已开始导出。");
    const outcome = await submission.completion;
    if (outcome.status === "success") {
      const outputs = outcome.result.outputs;
      const completed = outputs.filter((output) => output.status === "completed").length;
      const failed = outputs.length - completed;
      messagePublished(`已导出 ${completed} 个片段${failed > 0 ? `，${failed} 个失败` : ""}。`);
    } else if (outcome.status === "cancelled") {
      messagePublished("已取消导出。");
    }
  }

  const selection = assetLibraryExportSelection(selectedNodes);
  const selectedCount = active ? exportableCount(selection) : 0;
  useExportCapability({
    identity,
    active,
    selectedCount,
    hasLastSettings: Boolean(exportState),
    handlers: {
      configure: () => configure(selection),
      quick: () => quick(selection),
    },
  });

  return {
    hasLastSettings: Boolean(exportState),
    /** Whether a selection holds any material that can export. */
    canExport: (target: AssetLibraryExportSelection) => exportableCount(target) > 0,
    configure,
    quick,
  };
}
