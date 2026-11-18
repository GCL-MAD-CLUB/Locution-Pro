import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { useRef, useState } from "react";
import { SubtitleGlyph, VideoGlyph, OfflineFileIcon } from "../../../common/MediaKindIcons";
import {
  timelineThumbnailResolutionForDisplay,
  timelineThumbnails,
} from "../../../../application/thumbnails/timeline";
import type { AssetLibraryEntry } from "../../../../types";
import type { ResolvedAssetMedia } from "../model/nodes";
import { convertFileSrc } from "../../../../platform/tauri/media";
import { assetLibraryEntryHoverTimeUs } from "../../../../core/editor/assetLibrary/assetLibrary";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import { DragStackPreview } from "../../../common/DragStackPreview";
import type { AssetLibraryDragPreview as DragPreview } from "../actions/dragDrop";
import { assetLibraryFolderIcons, assetLibraryRootIcons } from "./AssetLibraryIcons";

interface AssetLibraryThumbnailProps {
  entry: AssetLibraryEntry;
  media: ResolvedAssetMedia | null;
  displayWidth: number;
  enabled: boolean;
  priority?: number;
}

function useNearViewport(lifetime: RenderLifetime, element: HTMLElement | null) {
  const [visible, setVisible] = useState(false);
  lifetime.useAfterCommit(() => {
    if (!element) return;
    const observer = new IntersectionObserver(
      ([record]) => setVisible(Boolean(record?.isIntersecting)),
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return visible;
}

export function AssetLibraryThumbnail({
  entry,
  media,
  displayWidth,
  enabled,
  priority = 0,
}: AssetLibraryThumbnailProps) {
  const lifetime = new RenderLifetime();

  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const visible = useNearViewport(lifetime, element);
  const resolution = timelineThumbnailResolutionForDisplay(displayWidth, (displayWidth * 9) / 16);
  const kind = entry.root === "subtitles" ? "subtitle" : "storyboard";
  const identity = media ? `${kind}:${media.fingerprint}:${media.videoPath}:${entry.start_us}` : "";
  const [thumbnail, setThumbnail] = useState<{
    identity: string;
    src: string;
    width: number;
  } | null>(null);
  const requestRef = useRef<ReturnType<typeof timelineThumbnails.request> | null>(null);

  lifetime.useAfterCommit(() => {
    if (!media) return;
    const options = {
      kind,
      assetId: media.assetId,
      fingerprint: media.fingerprint,
      videoPath: media.videoPath,
      timeUs: entry.start_us,
      frameRate: entry.media.frame_rate || undefined,
      priority,
      resolution,
    } as const;
    const placeholder = timelineThumbnails.peek(options);
    if (placeholder) {
      setThumbnail((current) =>
        current?.identity === identity && current.width >= placeholder.width
          ? current
          : { identity, src: placeholder.url, width: placeholder.width },
      );
    }
    if (!enabled || !visible) return;
    let active = true;
    const request = timelineThumbnails.request(options);
    requestRef.current = request;
    void request.promise.then(
      (result) => {
        if (!active) return;
        setThumbnail((current) =>
          current?.identity === identity && current.width > result.resolution.width
            ? current
            : { identity, src: result.url, width: result.resolution.width },
        );
      },
      () => undefined,
    );
    return () => {
      active = false;
      if (requestRef.current === request) requestRef.current = null;
      request.cancel();
    };
  }, [
    enabled,
    entry.media.frame_rate,
    entry.start_us,
    identity,
    kind,
    media?.assetId,
    resolution.width,
    visible,
  ]);

  lifetime.useAfterCommit(() => {
    requestRef.current?.reprioritize(priority);
  }, [priority]);

  const PlaceholderIcon = !media
    ? OfflineFileIcon
    : entry.root === "subtitles"
      ? SubtitleGlyph
      : VideoGlyph;
  const shown = thumbnail?.identity === identity ? thumbnail : null;
  return lifetime.render(
    <div ref={setElement} className="asset-library-thumbnail" data-offline={!media || undefined}>
      {shown ? (
        <img src={shown.src} alt="" decoding="async" draggable={false} />
      ) : (
        <PlaceholderIcon
          className={`asset-library-thumbnail-placeholder${media ? "" : " is-offline"}`}
          aria-hidden="true"
        />
      )}
    </div>,
  );
}

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
  const lifetime = new RenderLifetime();

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

  lifetime.useAfterCommit(() => {
    const video = videoRef.current;
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) seek(video);
    // seek reads the latest target; rerun only when it moves.
  }, [targetSeconds]);

  return lifetime.render(
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
    />,
  );
}

function PlaceholderIcon({ preview }: { preview: DragPreview }) {
  const { node } = preview;
  if (node.kind === "library") {
    const Icon = assetLibraryRootIcons[node.root];
    return <Icon />;
  }
  if (node.kind === "folder") {
    const Icon = assetLibraryFolderIcons[node.folder.root];
    return <Icon />;
  }
  return node.entry.root === "subtitles" ? (
    <SubtitleGlyph aria-hidden="true" />
  ) : (
    <VideoGlyph aria-hidden="true" />
  );
}

export function AssetLibraryDragPreview({ preview }: { preview: DragPreview | null }) {
  if (!preview) return null;
  return (
    <DragStackPreview
      x={preview.x}
      y={preview.y}
      thumbnailSrc={preview.thumbnailSrc}
      aspectRatio={preview.aspectRatio}
      layerCount={preview.layerCount}
      placeholder={<PlaceholderIcon preview={preview} />}
    />
  );
}
