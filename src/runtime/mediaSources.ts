import type { MediaDocument } from "../types";

// Runtime media comes from the document at dispatch time. There is no backend mirror.
const mediaCommands = new Set([
  "read_storyboard_graph_vectors",
  "demux_media_streams",
  "generate_proxy",
  "add_external_subtitles",
  "find_media_needing_analysis",
  "analyze_imported_media",
  "export_still_frame",
  "get_cached_video_cover_thumbnail",
  "get_cached_subtitle_thumbnails",
  "generate_subtitle_thumbnails",
  "cache_subtitle_thumbnail",
  "get_cached_storyboard_thumbnails",
  "generate_storyboard_thumbnails",
  "cache_storyboard_thumbnail",
  "storyboard_frame_trace",
  "detect_storyboard_shots",
  "select_storyboard_frames",
  "search_storyboards_semantic",
  "search_storyboards_semantic_batch",
]);
let readSources: () => Record<string, MediaDocument> = () => ({});

export function registerMediaSources(reader: typeof readSources) {
  readSources = reader;
}

export function commandMediaSources(command: string, args?: Record<string, unknown>) {
  if (!mediaCommands.has(command)) return args;
  const ids = new Set<string>();
  if (typeof args?.assetId === "string") ids.add(args.assetId);
  if (Array.isArray(args?.assetIds)) for (const id of args.assetIds) ids.add(id);
  if (Array.isArray(args?.shots)) for (const shot of args.shots) ids.add(shot.asset_id);
  const sources = readSources();
  const mediaSources: Record<string, MediaDocument> = {};
  // Thumbnail and detection requests need metadata only. Avoid serializing every
  // subtitle cue for each frame; analysis needs raw cues to preserve existing edits.
  const needsCues =
    command === "analyze_imported_media" || command === "find_media_needing_analysis";
  const needsTracks = needsCues || command === "demux_media_streams";
  for (const id of ids) {
    const media = sources[id];
    if (media)
      mediaSources[id] = {
        ...media,
        tracks: needsTracks ? media.tracks : [],
        cues: needsCues ? media.cues : {},
      };
  }
  return { ...args, mediaSources };
}
