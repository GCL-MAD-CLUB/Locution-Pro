import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { Play } from "lucide-react";
import { VideoGlyph } from "../../../common/MediaKindIcons/MediaKindIcons";
import { useState } from "react";
import {
  timelineThumbnails,
  timelineThumbnailResolutionForDisplay,
} from "../../../../timelineThumbnail";
import type { ExportClip } from "../../../../systems/ExportSystem";

interface ExportClipThumbnailProps {
  clip: ExportClip;
  /** Shown over the frame's corner, like a media card. */
  durationText: string;
  onPlay: () => void;
}

export function ExportClipThumbnail({ clip, durationText, onPlay }: ExportClipThumbnailProps) {
  const lifetime = new RenderLifetime();

  const [src, setSrc] = useState<string | null>(null);

  lifetime.afterCommit(() => {
    const thumbnail = clip.thumbnail;
    if (!thumbnail || !clip.sourcePath) {
      return;
    }
    let alive = true;
    const resolution = timelineThumbnailResolutionForDisplay(96, 54, window.devicePixelRatio || 1);
    const request = timelineThumbnails.request({
      kind: "storyboard",
      assetId: thumbnail.assetId,
      videoPath: clip.sourcePath,
      fingerprint: thumbnail.fingerprint ?? "",
      timeUs: thumbnail.timeUs,
      priority: 1,
      resolution,
    });
    void request.promise.then(
      (result) => {
        if (alive) {
          setSrc(result.url);
        }
      },
      () => undefined,
    );
    return () => {
      alive = false;
      request.cancel();
    };
  }, [clip.sourcePath, clip.thumbnail]);

  return lifetime.render(
    <button
      type="button"
      className="export-clip-thumbnail"
      aria-label={`播放 ${clip.label}`}
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
      }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <VideoGlyph className="export-clip-thumbnail-placeholder" size={18} />
      )}
      <span className="export-clip-thumbnail-play" aria-hidden="true">
        <Play size={11} />
      </span>
      <span className="export-clip-thumbnail-duration">{durationText}</span>
    </button>,
  );
}
