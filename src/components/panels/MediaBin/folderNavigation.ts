/** Drop a folder the bin can no longer show, and forget expansions outside the scope. */
export function mediaBinFolderNavigation(
  currentFolderId: string | null,
  rootFolderId: string | null,
  scopedFolderIds: ReadonlySet<string>,
  expandedFolderIds: ReadonlySet<string>,
): { currentFolderId: string | null; expandedFolderIds: ReadonlySet<string> } {
  const validTargets = new Set(scopedFolderIds);
  validTargets.add(rootFolderId ?? "");
  const nextFolderId =
    currentFolderId !== rootFolderId && (!currentFolderId || !validTargets.has(currentFolderId))
      ? rootFolderId
      : currentFolderId;
  let nextExpanded = expandedFolderIds;
  for (const folderId of expandedFolderIds) {
    if (!scopedFolderIds.has(folderId)) {
      nextExpanded = new Set([...expandedFolderIds].filter((id) => scopedFolderIds.has(id)));
      break;
    }
  }
  return { currentFolderId: nextFolderId, expandedFolderIds: nextExpanded };
}
