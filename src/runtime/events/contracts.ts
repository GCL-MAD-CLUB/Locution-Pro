import type { ExportSettings, ExportSource } from "../../core/editor/export/exportTypes";

export interface ApplicationEventMap {
  "media.import.requested": { paths?: string[]; folderId?: string };
  "media.video.opened": { videoId: string };
  "media.replace-selection.requested": Record<string, never>;
  "media.link-selection.requested": Record<string, never>;
  "media.make-selection-offline.requested": Record<string, never>;
  "export.requested": { source: ExportSource };
  "export.configure-selection.requested": Record<string, never>;
  "export.quick-selection.requested": Record<string, never>;
  /** Adds media files to the transcode queue and shows the transcode workspace. */
  "transcode.enqueue.requested": { paths: string[] };
  /** Sends export-page clips to the transcode queue with matching settings, one output per clip. */
  "transcode.export.requested": { source: ExportSource; settings: ExportSettings };
  /** Finished outputs to import into a media bin folder (null is the top level). */
  "transcode.output.completed": { paths: string[]; folderId: string | null };
  /** Selects the media bin items of these files and scrolls them into view. */
  "media.reveal.requested": { paths: string[] };
  "edit.copy.requested": Record<string, never>;
  "edit.paste.requested": Record<string, never>;
  "edit.clear.requested": Record<string, never>;
  "edit.duplicate.requested": Record<string, never>;
  "edit.select-all.requested": Record<string, never>;
  "edit.clear-selection.requested": Record<string, never>;
  "playback.seek.requested": {
    /** Defers the seek until this media is the loaded source in the active monitor. */
    videoId?: string;
    timeUs: number;
    focusEndUs?: number;
    play?: boolean;
    focusTarget?:
      | { kind: "subtitle"; videoId: string; trackId: string; cueId: string }
      | { kind: "storyboard"; videoContext: string; shotId: string };
  };
  "storyboard.reveal-shot.requested": { videoContext: string; shotId: string };
  "playback.frame-preview.requested": {
    sessionId: string;
    assetId: string;
    frame: number | null;
  };
  "storyboard.detection.completed": { videoContext: string; firstShotId?: string };
}

export type ApplicationEventType = keyof ApplicationEventMap;
