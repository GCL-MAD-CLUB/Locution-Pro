import {
  isMediaItemEnabled,
  isMediaItemOffline,
  mediaItemProject,
} from "../../../systems/ProjectSystem";
import type { AssetLibraryEntry, MediaBinItem, MediaDocument } from "../../../types";

export interface ResolvedAssetMedia {
  videoId: string;
  assetId: string;
  fingerprint: string;
  videoPath: string;
  /** The proxy when one exists, for smooth hover scrubbing like the media bin. */
  previewPath: string;
}

/**
 * Finds the project video an entry can play from. The captured video id is tried first;
 * if that item was removed or replaced, any enabled video with the same fingerprint works.
 */
export function resolveAssetMedia(
  entry: AssetLibraryEntry,
  mediaItems: readonly MediaBinItem[],
  projects: Record<string, MediaDocument>,
): ResolvedAssetMedia | null {
  const items = mediaItems as MediaBinItem[];
  const candidates = items.filter(
    (item) => item.kind === "video" && isMediaItemEnabled(item) && !isMediaItemOffline(item),
  );
  const resolve = (item: MediaBinItem | undefined) => {
    const project = item ? mediaItemProject(item, projects, items) : undefined;
    return item && project
      ? {
          videoId: item.id,
          assetId: project.asset.id,
          fingerprint: project.asset.fingerprint,
          videoPath: project.asset.path,
          previewPath: project.proxy_path || project.asset.path,
        }
      : null;
  };
  const direct = resolve(candidates.find((item) => item.id === entry.media.video_id));
  if (direct && (!entry.media.fingerprint || direct.fingerprint === entry.media.fingerprint)) {
    return direct;
  }
  if (!entry.media.fingerprint) return direct;
  for (const item of candidates) {
    const resolved = resolve(item);
    if (resolved?.fingerprint === entry.media.fingerprint) return resolved;
  }
  return null;
}
