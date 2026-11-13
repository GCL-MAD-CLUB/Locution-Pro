import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { assetLibraryEntryHoverTimeUs } from "../../../../core/editor/assetLibrary";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import type { AssetLibraryEntry } from "../../../../types";
import type { ResolvedAssetMedia } from "../assetLibraryMedia";

interface AssetLibraryHoverFrameProps {
  entry: AssetLibraryEntry;
  media: ResolvedAssetMedia;
  progress: number;
}

/**
 * The media bin's hover scrub frame for one entry: a video seeked to the hovered point of the
 * entry's range, shown over the cover once the seek lands.
 */
export function AssetLibraryHoverFrame({ entry, media, progress }: AssetLibraryHoverFrameProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const targetSeconds = assetLibraryEntryHoverTimeUs(entry, progress) / 1_000_000;
  const src = isTauriRuntime() ? convertFileSrc(media.previewPath) : media.previewPath;

  function seek(video: HTMLVideoElement) {
    const latestTime = Number.isFinite(video.duration)
      ? Math.max(0, video.duration - 0.001)
      : targetSeconds;
    const time = Math.min(targetSeconds, latestTime);
    if (Math.abs(video.currentTime - time) > 0.001) {
      video.currentTime = time;
    } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setReady(true);
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) seek(video);
    // seek reads the latest target; rerun only when it moves.
  }, [targetSeconds]);

  return (
    <video
      ref={videoRef}
      className={`media-bin-card-thumbnail media-bin-card-hover-thumbnail${ready ? " is-ready" : ""}`}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      draggable={false}
      onLoadedMetadata={(event) => seek(event.currentTarget)}
      onLoadedData={(event) => seek(event.currentTarget)}
      onSeeked={() => setReady(true)}
    />
  );
}
