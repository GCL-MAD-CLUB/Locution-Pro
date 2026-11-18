import type {
  MediaDocument,
  ProjectWorkspace,
  SubtitleCue,
  SubtitleTrack,
} from "../../../src/types";

export function videoFixture(
  id: string,
  {
    fingerprint = "fp",
    trackCount = 0,
    cueText = (sequence) => `${id}-${sequence}`,
    cueId = (track, sequence) => `${track}-cue-${sequence}`,
  }: {
    fingerprint?: string;
    trackCount?: number;
    cueText?: (sequence: number) => string;
    cueId?: (track: string, sequence: number) => string;
  } = {},
): MediaDocument {
  const tracks: SubtitleTrack[] = Array.from({ length: trackCount }, (_, index) => ({
    id: `${id}-${index + 1}`,
    asset_id: id,
    source_type: "embedded",
    stream_index: index + 1,
    source_path: null,
    kind: "text",
    codec: "srt",
    language: null,
    title: null,
    offset_us: 0,
    cue_count: 2,
    warning: null,
  }));
  const cues = Object.fromEntries(
    tracks.map((track) => [
      track.id,
      [1, 2].map((sequence): SubtitleCue => ({
        id: cueId(track.id, sequence),
        track_id: track.id,
        sequence,
        start_us: sequence * 1_000_000,
        end_us: (sequence + 1) * 1_000_000,
        raw_text: cueText(sequence),
        plain_text: cueText(sequence),
        speaker: null,
        style: null,
        layer: null,
      })),
    ]),
  );
  return {
    asset: {
      id,
      path: `/${id}.mp4`,
      file_name: `${id}.mp4`,
      file_size: 1,
      modified_at: 0,
      start_time_us: 0,
      tape_name: null,
      duration_us: 10_000_000,
      video_stream_index: 0,
      audio_stream_index: null,
      fingerprint,
    },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        avg_frame_rate: "24/1",
        language: null,
        title: null,
        width: null,
        height: null,
        channels: null,
        disposition: {},
      },
    ],
    tracks,
    cues,
    cache_dir: "",
    proxy_path: null,
  };
}

export function workspaceFixture(projects: MediaDocument[]): ProjectWorkspace {
  return {
    projects,
    media_bin: {
      folders: [],
      items: projects.map(({ asset }) => ({
        id: asset.id,
        bin_id: null,
        kind: "video",
        enabled: true,
        hidden: false,
        offline: false,
        path: asset.path,
        file_name: asset.file_name,
        duration_us: asset.duration_us,
        start_time_us: asset.start_time_us,
        bound_to_video_id: null,
        source_video_id: null,
        stream_index: asset.video_stream_index,
        subtitle_track_id: null,
        codec: null,
        language: null,
        extracted: false,
        origin: "imported",
        color: "",
      })),
    },
    editor: {
      active_video_id: projects[0]?.asset.id ?? "",
      active_track_id: projects[0]?.tracks[0]?.id ?? "",
      detached_video_ids: [],
      preview: { use_proxy: false },
    },
    subtitles: {},
    storyboards: {},
  };
}
