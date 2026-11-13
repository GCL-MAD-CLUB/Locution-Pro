import type {
  AssetLibraryAnnotation,
  AssetLibraryColorLabel,
  AssetLibraryEntry,
  AssetLibraryFolder,
  AssetLibraryMedia,
  AssetLibraryRoot,
  MediaAsset,
  ProjectAssetLibraryState,
} from "../../types";
import { frameToTimeUs, timeUsToFrame } from "./timeline";

// Asset-library entries are snapshots. Nothing here reads subtitle or storyboard state:
// once captured, an entry owns its range, text and annotations independently.

export const assetLibraryRoots = ["subtitles", "storyboards"] as const;

export const assetLibraryRootLabels: Record<AssetLibraryRoot, string> = {
  subtitles: "字幕",
  storyboards: "分镜",
};

export const assetLibraryColorLabels = ["red", "yellow", "green", "blue", "purple"] as const;

export type AssetLibraryFlag = "retained" | "none" | "excluded";

export interface AssetLibraryLocation {
  root: AssetLibraryRoot;
  folderId: string | null;
}

export interface AssetLibrarySelection {
  folderIds: readonly string[];
  entryIds: readonly string[];
}

export interface AssetLibraryClipboard {
  root: AssetLibraryRoot;
  folders: AssetLibraryFolder[];
  entries: AssetLibraryEntry[];
  topFolderIds: string[];
  topEntryIds: string[];
}

export type AssetLibrarySortKey = "name" | "created" | "start" | "duration" | "rating";

export interface AssetLibrarySort {
  key: AssetLibrarySortKey;
  direction: "ascending" | "descending";
}

export interface AssetLibraryCapture {
  media: AssetLibraryMedia;
  startUs: number;
  endUs: number;
  name: string;
  text: string;
  annotation?: Partial<AssetLibraryAnnotation>;
}

export type AssetLibraryIdFactory = (kind: "asset" | "asset-folder") => string;

const maximumRating = 5;
const maximumNameLength = 120;
const copySuffix = " - 副本";

export function createAssetLibraryId(kind: "asset" | "asset-folder") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${kind}:${random}`;
}

export function emptyAssetLibrary(): ProjectAssetLibraryState {
  return { folders: [], entries: [] };
}

export function emptyAssetLibraryAnnotation(): AssetLibraryAnnotation {
  return {
    rating: 0,
    retained: false,
    excluded: false,
    color_label: null,
    custom_label: null,
    title: null,
    keywords: [],
  };
}

function isAssetLibraryRoot(value: unknown): value is AssetLibraryRoot {
  return value === "subtitles" || value === "storyboards";
}

function isColorLabel(value: unknown): value is AssetLibraryColorLabel {
  return assetLibraryColorLabels.includes(value as AssetLibraryColorLabel);
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizedAssetLibraryName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, maximumNameLength);
}

/** Entry names retain authored line breaks for list and icon labels. */
function normalizedAssetLibraryEntryName(name: string) {
  return name
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim()
    .slice(0, maximumNameLength);
}

export function normalizedAssetLibraryKeywords(keywords: readonly unknown[]) {
  const seen = new Set<string>();
  return keywords.flatMap((keyword) => {
    const name = typeof keyword === "string" ? normalizedAssetLibraryName(keyword) : "";
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}

function normalizedAnnotation(
  annotation: Partial<AssetLibraryAnnotation> | undefined,
): AssetLibraryAnnotation {
  const retained = annotation?.retained === true;
  return {
    rating: Math.min(maximumRating, Math.max(0, Math.round(finiteNumber(annotation?.rating)))),
    retained,
    excluded: !retained && annotation?.excluded === true,
    color_label: isColorLabel(annotation?.color_label) ? annotation.color_label : null,
    custom_label: optionalText(annotation?.custom_label),
    title: optionalText(annotation?.title),
    keywords: normalizedAssetLibraryKeywords(
      Array.isArray(annotation?.keywords) ? annotation.keywords : [],
    ),
  };
}

/** Repairs a library read from a project file; invalid references fall back to the root. */
export function normalizedAssetLibrary(
  library: Partial<ProjectAssetLibraryState> | null | undefined,
): ProjectAssetLibraryState {
  const folderIds = new Set<string>();
  const folders = (Array.isArray(library?.folders) ? library.folders : []).flatMap((folder) => {
    const id = typeof folder?.id === "string" ? folder.id.trim() : "";
    const name = typeof folder?.name === "string" ? normalizedAssetLibraryName(folder.name) : "";
    if (!id || !name || folderIds.has(id) || !isAssetLibraryRoot(folder.root)) return [];
    folderIds.add(id);
    return [
      {
        id,
        root: folder.root,
        parent_id: typeof folder.parent_id === "string" ? folder.parent_id : null,
        name,
        created_at: finiteNumber(folder.created_at),
      },
    ];
  });
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const validParent = (folder: AssetLibraryFolder) => {
    const parent = folder.parent_id ? byId.get(folder.parent_id) : undefined;
    return parent && parent.root === folder.root && parent.id !== folder.id ? parent.id : null;
  };
  const parentById = new Map(folders.map((folder) => [folder.id, validParent(folder)]));
  for (const folder of folders) {
    const visited = new Set([folder.id]);
    let parentId = parentById.get(folder.id) ?? null;
    while (parentId) {
      if (visited.has(parentId)) {
        parentById.set(folder.id, null);
        break;
      }
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
  const normalizedFolders = folders.map((folder) => ({
    ...folder,
    parent_id: parentById.get(folder.id) ?? null,
  }));

  const entryIds = new Set<string>();
  const entries = (Array.isArray(library?.entries) ? library.entries : []).flatMap((entry) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || entryIds.has(id) || !isAssetLibraryRoot(entry.root) || !entry.media) return [];
    entryIds.add(id);
    const folder = entry.folder_id ? byId.get(entry.folder_id) : undefined;
    const startUs = Math.max(0, Math.round(finiteNumber(entry.start_us)));
    const media: AssetLibraryMedia = {
      video_id: String(entry.media.video_id ?? ""),
      path: String(entry.media.path ?? ""),
      file_name: String(entry.media.file_name ?? ""),
      fingerprint: String(entry.media.fingerprint ?? ""),
      frame_rate: Math.max(0, finiteNumber(entry.media.frame_rate)),
      duration_us: Math.max(0, Math.round(finiteNumber(entry.media.duration_us))),
    };
    return [
      {
        id,
        root: entry.root,
        folder_id: folder && folder.root === entry.root ? folder.id : null,
        name:
          normalizedAssetLibraryEntryName(typeof entry.name === "string" ? entry.name : "") ||
          media.file_name ||
          "未命名素材",
        created_at: finiteNumber(entry.created_at),
        media,
        start_us: startUs,
        end_us: Math.max(startUs, Math.round(finiteNumber(entry.end_us, startUs))),
        text: typeof entry.text === "string" ? entry.text : "",
        annotation: normalizedAnnotation(entry.annotation),
      },
    ];
  });
  return { folders: normalizedFolders, entries };
}

export function assetLibraryFolderDescendantIds(
  folders: readonly AssetLibraryFolder[],
  folderIds: Iterable<string>,
) {
  const result = new Set(folderIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_id && result.has(folder.parent_id) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

/** Folders from the root down to and including `folderId`. */
export function assetLibraryFolderPath(
  library: ProjectAssetLibraryState,
  folderId: string | null,
): AssetLibraryFolder[] {
  const byId = new Map(library.folders.map((folder) => [folder.id, folder]));
  const path: AssetLibraryFolder[] = [];
  const visited = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

export function sameAssetLibraryLocation(left: AssetLibraryLocation, right: AssetLibraryLocation) {
  return left.root === right.root && left.folderId === right.folderId;
}

export function assetLibraryLocationExists(
  library: ProjectAssetLibraryState,
  location: AssetLibraryLocation,
) {
  return (
    location.folderId === null ||
    library.folders.some(
      (folder) => folder.id === location.folderId && folder.root === location.root,
    )
  );
}

export function assetLibraryChildren(
  library: ProjectAssetLibraryState,
  location: AssetLibraryLocation,
) {
  return {
    folders: library.folders.filter(
      (folder) => folder.root === location.root && folder.parent_id === location.folderId,
    ),
    entries: library.entries.filter(
      (entry) => entry.root === location.root && entry.folder_id === location.folderId,
    ),
  };
}

/** All folders and entries nested anywhere below a location, used by recursive search. */
export function assetLibraryDescendants(
  library: ProjectAssetLibraryState,
  location: AssetLibraryLocation,
) {
  const scopeIds =
    location.folderId === null
      ? null
      : assetLibraryFolderDescendantIds(library.folders, [location.folderId]);
  const inScope = (root: AssetLibraryRoot, parentId: string | null) =>
    root === location.root && (scopeIds === null || (parentId !== null && scopeIds.has(parentId)));
  return {
    folders: library.folders.filter((folder) => inScope(folder.root, folder.parent_id)),
    entries: library.entries.filter((entry) => inScope(entry.root, entry.folder_id)),
  };
}

/** Windows-style "名称", "名称 (2)", "名称 (3)" … unique within `names`. */
export function uniqueAssetLibraryName(names: Iterable<string>, base: string) {
  const taken = new Set([...names].map((name) => name.toLocaleLowerCase()));
  const name = normalizedAssetLibraryName(base) || "新建文件夹";
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let index = 2; ; index += 1) {
    const candidate = `${name} (${index})`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function siblingFolderNames(
  folders: readonly AssetLibraryFolder[],
  location: AssetLibraryLocation,
  excludedId?: string,
) {
  return folders
    .filter(
      (folder) =>
        folder.root === location.root &&
        folder.parent_id === location.folderId &&
        folder.id !== excludedId,
    )
    .map((folder) => folder.name);
}

export function withAssetLibraryFolder(
  library: ProjectAssetLibraryState,
  location: AssetLibraryLocation,
  id: string,
  now: number,
  name = "新建文件夹",
) {
  if (!assetLibraryLocationExists(library, location)) return { library, folder: null };
  const folder: AssetLibraryFolder = {
    id,
    root: location.root,
    parent_id: location.folderId,
    name: uniqueAssetLibraryName(siblingFolderNames(library.folders, location), name),
    created_at: now,
  };
  return { library: { ...library, folders: [...library.folders, folder] }, folder };
}

export function renamedAssetLibraryFolder(
  library: ProjectAssetLibraryState,
  folderId: string,
  name: string,
) {
  const folder = library.folders.find((candidate) => candidate.id === folderId);
  const normalized = normalizedAssetLibraryName(name);
  if (!folder || !normalized || normalized === folder.name) return library;
  const nextName = uniqueAssetLibraryName(
    siblingFolderNames(
      library.folders,
      { root: folder.root, folderId: folder.parent_id },
      folder.id,
    ),
    normalized,
  );
  return {
    ...library,
    folders: library.folders.map((candidate) =>
      candidate.id === folderId ? { ...candidate, name: nextName } : candidate,
    ),
  };
}

export function updatedAssetLibraryEntries(
  library: ProjectAssetLibraryState,
  entryIds: Iterable<string>,
  recipe: (entry: AssetLibraryEntry) => AssetLibraryEntry,
) {
  const ids = new Set(entryIds);
  let changed = false;
  const entries = library.entries.map((entry) => {
    if (!ids.has(entry.id)) return entry;
    const next = recipe(entry);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? { ...library, entries } : library;
}

export function renamedAssetLibraryEntry(entry: AssetLibraryEntry, name: string) {
  const normalized = normalizedAssetLibraryEntryName(name);
  return normalized && normalized !== entry.name ? { ...entry, name: normalized } : entry;
}

/** Keep only selected nodes that are not already covered by a selected ancestor folder. */
function topLevelSelection(library: ProjectAssetLibraryState, selection: AssetLibrarySelection) {
  const selectedFolders = new Set(selection.folderIds);
  const covered = assetLibraryFolderDescendantIds(library.folders, selectedFolders);
  const folders = library.folders.filter(
    (folder) =>
      selectedFolders.has(folder.id) && !(folder.parent_id && covered.has(folder.parent_id)),
  );
  const entryIds = new Set(selection.entryIds);
  const entries = library.entries.filter(
    (entry) => entryIds.has(entry.id) && !(entry.folder_id && covered.has(entry.folder_id)),
  );
  return { folders, entries, covered };
}

export function removedAssetLibraryNodes(
  library: ProjectAssetLibraryState,
  selection: AssetLibrarySelection,
) {
  const removedFolders = assetLibraryFolderDescendantIds(library.folders, selection.folderIds);
  const removedEntries = new Set(selection.entryIds);
  const folders = library.folders.filter((folder) => !removedFolders.has(folder.id));
  const entries = library.entries.filter(
    (entry) =>
      !removedEntries.has(entry.id) && !(entry.folder_id && removedFolders.has(entry.folder_id)),
  );
  return folders.length === library.folders.length && entries.length === library.entries.length
    ? library
    : { folders, entries };
}

/**
 * Moves folders and entries into `target`. Nodes from the other root, a folder into
 * itself or its descendants, and nodes already in place are skipped.
 */
export function movedAssetLibraryNodes(
  library: ProjectAssetLibraryState,
  selection: AssetLibrarySelection,
  target: AssetLibraryLocation,
) {
  if (!assetLibraryLocationExists(library, target)) return { library, movedCount: 0 };
  const { folders, entries } = topLevelSelection(library, selection);
  const targetAncestors = new Set(
    assetLibraryFolderPath(library, target.folderId).map((folder) => folder.id),
  );
  const movableFolders = folders.filter(
    (folder) =>
      folder.root === target.root &&
      folder.parent_id !== target.folderId &&
      !targetAncestors.has(folder.id),
  );
  const movableEntries = entries.filter(
    (entry) => entry.root === target.root && entry.folder_id !== target.folderId,
  );
  if (movableFolders.length === 0 && movableEntries.length === 0) {
    return { library, movedCount: 0 };
  }
  const names = siblingFolderNames(library.folders, target);
  const renamed = new Map<string, string>();
  for (const folder of movableFolders) {
    const name = uniqueAssetLibraryName(names, folder.name);
    names.push(name);
    renamed.set(folder.id, name);
  }
  const entryIds = new Set(movableEntries.map((entry) => entry.id));
  return {
    library: {
      folders: library.folders.map((folder) =>
        renamed.has(folder.id)
          ? { ...folder, parent_id: target.folderId, name: renamed.get(folder.id)! }
          : folder,
      ),
      entries: library.entries.map((entry) =>
        entryIds.has(entry.id) ? { ...entry, folder_id: target.folderId } : entry,
      ),
    },
    movedCount: movableFolders.length + movableEntries.length,
  };
}

/** Captures the selected subtrees so a later paste is independent of further edits. */
export function assetLibraryClipboard(
  library: ProjectAssetLibraryState,
  selection: AssetLibrarySelection,
): AssetLibraryClipboard | null {
  const { folders, entries } = topLevelSelection(library, selection);
  const root = folders[0]?.root ?? entries[0]?.root;
  if (!root) return null;
  const topFolders = folders.filter((folder) => folder.root === root);
  const topEntries = entries.filter((entry) => entry.root === root);
  const subtree = assetLibraryFolderDescendantIds(
    library.folders,
    topFolders.map((folder) => folder.id),
  );
  const topEntryIds = new Set(topEntries.map((entry) => entry.id));
  return {
    root,
    folders: library.folders.filter((folder) => subtree.has(folder.id)),
    entries: library.entries.filter(
      (entry) => topEntryIds.has(entry.id) || (entry.folder_id && subtree.has(entry.folder_id)),
    ),
    topFolderIds: topFolders.map((folder) => folder.id),
    topEntryIds: [...topEntryIds],
  };
}

function copiedEntryName(names: readonly string[], name: string) {
  const taken = new Set(names.map((candidate) => candidate.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  return uniqueAssetLibraryName(names, `${name}${copySuffix}`);
}

/** Pastes clipboard contents as new, independent nodes below `target`. */
export function pastedAssetLibraryNodes(
  library: ProjectAssetLibraryState,
  clipboard: AssetLibraryClipboard,
  target: AssetLibraryLocation,
  createId: AssetLibraryIdFactory,
  now: number,
) {
  if (clipboard.root !== target.root || !assetLibraryLocationExists(library, target)) {
    return { library, folderIds: [] as string[], entryIds: [] as string[] };
  }
  const folderIdMap = new Map(
    clipboard.folders.map((folder) => [folder.id, createId("asset-folder")]),
  );
  const topFolderIds = new Set(clipboard.topFolderIds);
  const topEntryIds = new Set(clipboard.topEntryIds);
  const folderNames = siblingFolderNames(library.folders, target);
  const entryNames = assetLibraryChildren(library, target).entries.map((entry) => entry.name);
  const folders = clipboard.folders.map((folder) => {
    const isTop = topFolderIds.has(folder.id);
    const name = isTop ? uniqueAssetLibraryName(folderNames, folder.name) : folder.name;
    if (isTop) folderNames.push(name);
    return {
      ...folder,
      id: folderIdMap.get(folder.id)!,
      parent_id: isTop ? target.folderId : (folderIdMap.get(folder.parent_id ?? "") ?? null),
      name,
      created_at: now,
    };
  });
  const entries = clipboard.entries.map((entry) => {
    const isTop = topEntryIds.has(entry.id);
    const name = isTop ? copiedEntryName(entryNames, entry.name) : entry.name;
    if (isTop) entryNames.push(name);
    return {
      ...entry,
      id: createId("asset"),
      folder_id: isTop ? target.folderId : (folderIdMap.get(entry.folder_id ?? "") ?? null),
      name,
      created_at: now,
      annotation: { ...entry.annotation, keywords: [...entry.annotation.keywords] },
    };
  });
  const newTopFolderIds = clipboard.topFolderIds.map((id) => folderIdMap.get(id)!);
  const newTopEntryIds = entries
    .filter((_, index) => topEntryIds.has(clipboard.entries[index].id))
    .map((entry) => entry.id);
  return {
    library: {
      folders: [...library.folders, ...folders],
      entries: [...library.entries, ...entries],
    },
    folderIds: newTopFolderIds,
    entryIds: newTopEntryIds,
  };
}

/** Snapshots the source video identity so the entry no longer depends on the panel source. */
export function assetLibraryMediaFromSource(
  videoId: string,
  asset: Pick<MediaAsset, "path" | "file_name" | "fingerprint" | "duration_us">,
  frameRate: number,
): AssetLibraryMedia {
  return {
    video_id: videoId,
    path: asset.path,
    file_name: asset.file_name,
    fingerprint: asset.fingerprint ?? "",
    frame_rate: frameRate,
    duration_us: Math.max(0, Math.round(asset.duration_us || 0)),
  };
}

export function assetLibraryEntryFromCapture(
  root: AssetLibraryRoot,
  capture: AssetLibraryCapture,
  id: string,
  now: number,
  folderId: string | null = null,
): AssetLibraryEntry {
  const startUs = Math.max(0, Math.round(capture.startUs));
  return {
    id,
    root,
    folder_id: folderId,
    name: normalizedAssetLibraryEntryName(capture.name) || capture.media.file_name || "未命名素材",
    created_at: now,
    media: { ...capture.media },
    start_us: startUs,
    end_us: Math.max(startUs, Math.round(capture.endUs)),
    text: capture.text,
    annotation: normalizedAnnotation(capture.annotation),
  };
}

export function withAssetLibraryCaptures(
  library: ProjectAssetLibraryState,
  root: AssetLibraryRoot,
  captures: readonly AssetLibraryCapture[],
  createId: AssetLibraryIdFactory,
  now: number,
) {
  if (captures.length === 0) return library;
  return {
    ...library,
    entries: [
      ...library.entries,
      ...captures.map((capture) =>
        assetLibraryEntryFromCapture(root, capture, createId("asset"), now),
      ),
    ],
  };
}

function fileStem(fileName: string) {
  return fileName.replace(/\.[^.\\/]+$/, "") || fileName;
}

export function subtitleAssetName(text: string, fileName: string, sequence: number) {
  const name = normalizedAssetLibraryEntryName(text);
  return name || `${fileStem(fileName)} 字幕 ${sequence}`;
}

export function storyboardAssetName(
  title: string | null | undefined,
  fileName: string,
  sequence: number,
) {
  return title?.trim() || `${fileStem(fileName)} 镜头 ${sequence}`;
}

export function assetLibraryEntryFlag(entry: AssetLibraryEntry): AssetLibraryFlag {
  return entry.annotation.retained ? "retained" : entry.annotation.excluded ? "excluded" : "none";
}

function withAnnotation(entry: AssetLibraryEntry, patch: Partial<AssetLibraryAnnotation>) {
  const annotation = normalizedAnnotation({ ...entry.annotation, ...patch });
  const current = entry.annotation;
  const unchanged =
    annotation.rating === current.rating &&
    annotation.retained === current.retained &&
    annotation.excluded === current.excluded &&
    annotation.color_label === current.color_label &&
    annotation.custom_label === current.custom_label &&
    annotation.title === current.title &&
    annotation.keywords.length === current.keywords.length &&
    annotation.keywords.every((keyword, index) => keyword === current.keywords[index]);
  return unchanged ? entry : { ...entry, annotation };
}

export function withAssetLibraryFlag(entry: AssetLibraryEntry, flag: AssetLibraryFlag) {
  return withAnnotation(entry, { retained: flag === "retained", excluded: flag === "excluded" });
}

export function withAssetLibraryRating(entry: AssetLibraryEntry, rating: number) {
  return withAnnotation(entry, { rating });
}

export function withAssetLibraryRatingDelta(entry: AssetLibraryEntry, delta: number) {
  return withAnnotation(entry, { rating: entry.annotation.rating + delta });
}

export function withAssetLibraryColorLabel(
  entry: AssetLibraryEntry,
  colorLabel: AssetLibraryColorLabel | null,
) {
  return withAnnotation(entry, { color_label: colorLabel });
}

export function withAssetLibraryCustomLabel(entry: AssetLibraryEntry, customLabel: string) {
  return withAnnotation(entry, { custom_label: customLabel });
}

export function withAssetLibraryTitle(entry: AssetLibraryEntry, title: string) {
  return withAnnotation(entry, { title });
}

export function withAssetLibraryKeywords(entry: AssetLibraryEntry, keywords: readonly string[]) {
  return withAnnotation(entry, { keywords: [...keywords] });
}

export function withAssetLibraryText(entry: AssetLibraryEntry, text: string) {
  return text === entry.text ? entry : { ...entry, text };
}

/** Snaps a new range to frame boundaries, keeps at least one frame and stays within the media. */
export function trimmedAssetLibraryEntry(entry: AssetLibraryEntry, startUs: number, endUs: number) {
  const frameRate = entry.media.frame_rate;
  const lastFrame =
    entry.media.duration_us > 0
      ? Math.max(1, timeUsToFrame(entry.media.duration_us, frameRate))
      : Number.POSITIVE_INFINITY;
  const startFrame = Math.min(
    Math.max(0, timeUsToFrame(Math.min(startUs, endUs), frameRate)),
    lastFrame - 1,
  );
  const endFrame = Math.min(
    lastFrame,
    Math.max(startFrame + 1, timeUsToFrame(Math.max(startUs, endUs), frameRate)),
  );
  const start_us = frameToTimeUs(startFrame, frameRate);
  const end_us = frameToTimeUs(endFrame, frameRate);
  return start_us === entry.start_us && end_us === entry.end_us
    ? entry
    : { ...entry, start_us, end_us };
}

export function assetLibraryEntryDurationUs(entry: AssetLibraryEntry) {
  if (entry.root === "storyboards") {
    const frameRate = entry.media.frame_rate;
    return frameToTimeUs(
      Math.max(
        0,
        timeUsToFrame(entry.end_us, frameRate) - timeUsToFrame(entry.start_us, frameRate) + 1,
      ),
      frameRate,
    );
  }
  return Math.max(0, entry.end_us - entry.start_us);
}

export function assetLibraryEntryMatches(entry: AssetLibraryEntry, query: string) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    entry.name,
    entry.text,
    entry.media.file_name,
    entry.annotation.title ?? "",
    entry.annotation.custom_label ?? "",
    ...entry.annotation.keywords,
  ]
    .join("\n")
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const nameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function entrySortValue(entry: AssetLibraryEntry, key: AssetLibrarySortKey) {
  switch (key) {
    case "created":
      return entry.created_at;
    case "start":
      return entry.start_us;
    case "duration":
      return assetLibraryEntryDurationUs(entry);
    case "rating":
      return entry.annotation.rating;
    default:
      return 0;
  }
}

/** Folders always precede entries, as in a file manager; both follow the chosen order. */
export function sortedAssetLibraryNodes(
  folders: readonly AssetLibraryFolder[],
  entries: readonly AssetLibraryEntry[],
  sort: AssetLibrarySort,
) {
  const direction = sort.direction === "ascending" ? 1 : -1;
  const sortedFolders = [...folders].sort((left, right) =>
    sort.key === "created"
      ? (left.created_at - right.created_at) * direction ||
        nameCollator.compare(left.name, right.name)
      : nameCollator.compare(left.name, right.name) * direction,
  );
  const sortedEntries = [...entries].sort(
    (left, right) =>
      (sort.key === "name"
        ? nameCollator.compare(left.name, right.name)
        : entrySortValue(left, sort.key) - entrySortValue(right, sort.key)) * direction ||
      nameCollator.compare(left.name, right.name) ||
      left.start_us - right.start_us,
  );
  return { folders: sortedFolders, entries: sortedEntries };
}

export const assetLibraryIconThreshold = 30;

export type AssetLibraryViewLayout =
  { mode: "list"; rowHeight: number; iconScale: number } | { mode: "icons"; cardWidth: number };

/**
 * One size control drives both presentations, like a file manager's zoom: small sizes
 * render a list, larger sizes switch to icons that keep growing.
 */
export function assetLibraryViewLayout(size: number): AssetLibraryViewLayout {
  const clamped = Math.min(100, Math.max(0, finiteNumber(size)));
  if (clamped < assetLibraryIconThreshold) {
    // The list range maps onto the media bin row-height slider (0-100).
    const listSize = (clamped / assetLibraryIconThreshold) * 100;
    return { mode: "list", rowHeight: 24 + listSize * 0.36, iconScale: 1 + listSize * 0.015 };
  }
  const progress = (clamped - assetLibraryIconThreshold) / (100 - assetLibraryIconThreshold);
  return { mode: "icons", cardWidth: Math.round(120 + progress * 200) };
}

export type AssetLibraryViewPresetId = "extraLarge" | "large" | "medium" | "small" | "details";

/** File-manager view presets. Each one only sets the shared size control. */
export const assetLibraryViewPresets: readonly {
  id: AssetLibraryViewPresetId;
  label: string;
  size: number;
  shortcut: string;
}[] = [
  { id: "extraLarge", label: "超大图标", size: 100, shortcut: "Ctrl+Shift+1" },
  { id: "large", label: "大图标", size: 72, shortcut: "Ctrl+Shift+2" },
  { id: "medium", label: "中等图标", size: 48, shortcut: "Ctrl+Shift+3" },
  { id: "small", label: "小图标", size: assetLibraryIconThreshold, shortcut: "Ctrl+Shift+4" },
  { id: "details", label: "详细信息", size: 12, shortcut: "Ctrl+Shift+6" },
];

export function assetLibraryViewPresetForSize(size: number) {
  return assetLibraryViewPresets.find((preset) => preset.size === size) ?? null;
}

const pathSeparator = "\\";

/** Address-bar text such as `字幕\访谈\第一段`. */
export function assetLibraryPathText(
  library: ProjectAssetLibraryState,
  location: AssetLibraryLocation,
) {
  return [
    assetLibraryRootLabels[location.root],
    ...assetLibraryFolderPath(library, location.folderId).map((folder) => folder.name),
  ].join(pathSeparator);
}

/**
 * Resolves typed address-bar text. A leading root name makes the path absolute; otherwise it
 * is resolved from `current`. Names match case-insensitively, and `..` goes up one level.
 */
export function assetLibraryLocationFromPath(
  library: ProjectAssetLibraryState,
  text: string,
  current: AssetLibraryLocation,
): AssetLibraryLocation | null {
  const segments = text
    .split(/[\\/]+/)
    .map((segment) => normalizedAssetLibraryName(segment))
    .filter(Boolean);
  if (segments.length === 0) return null;
  const root = assetLibraryRoots.find(
    (candidate) =>
      assetLibraryRootLabels[candidate].toLocaleLowerCase() === segments[0]!.toLocaleLowerCase(),
  );
  let location: AssetLibraryLocation = root ? { root, folderId: null } : current;
  const byId = new Map(library.folders.map((folder) => [folder.id, folder]));
  for (const segment of root ? segments.slice(1) : segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      const parentId = location.folderId ? (byId.get(location.folderId)?.parent_id ?? null) : null;
      location = { root: location.root, folderId: parentId };
      continue;
    }
    const lowered = segment.toLocaleLowerCase();
    const match = library.folders.find(
      (folder) =>
        folder.root === location.root &&
        folder.parent_id === location.folderId &&
        folder.name.toLocaleLowerCase() === lowered,
    );
    if (!match) return null;
    location = { root: location.root, folderId: match.id };
  }
  return location;
}

/** Local date and time in the file-manager form `2026/9/23 18:51`. */
export function formatAssetLibraryDate(timestamp: number) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${minutes}`;
}

export interface AssetLibraryHistory {
  location: AssetLibraryLocation;
  backStack: AssetLibraryLocation[];
  forwardStack: AssetLibraryLocation[];
}

/**
 * Moves `steps` entries back (negative) or forward (positive). Skipped locations stay in
 * history in visiting order, as in a browser's history menu.
 */
export function steppedAssetLibraryHistory(
  history: AssetLibraryHistory,
  steps: number,
  limit = 50,
): AssetLibraryHistory | null {
  const { location, backStack, forwardStack } = history;
  if (steps < 0) {
    const count = Math.min(Math.floor(-steps), backStack.length);
    if (count < 1) return null;
    return {
      location: backStack[backStack.length - count]!,
      backStack: backStack.slice(0, -count),
      forwardStack: [
        ...backStack.slice(backStack.length - count + 1),
        location,
        ...forwardStack,
      ].slice(0, limit),
    };
  }
  const count = Math.min(Math.floor(steps), forwardStack.length);
  if (count < 1) return null;
  return {
    location: forwardStack[count - 1]!,
    backStack: [...backStack, location, ...forwardStack.slice(0, count - 1)].slice(-limit),
    forwardStack: forwardStack.slice(count),
  };
}
