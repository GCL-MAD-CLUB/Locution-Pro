import { Captions, Film, Link2Off } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  timelineThumbnailResolutionForDisplay,
  timelineThumbnails,
} from "../../../../timelineThumbnail";
import type { AssetLibraryEntry } from "../../../../types";
import type { ResolvedAssetMedia } from "../assetLibraryMedia";

interface AssetLibraryThumbnailProps {
  entry: AssetLibraryEntry;
  media: ResolvedAssetMedia | null;
  displayWidth: number;
  enabled: boolean;
  priority?: number;
}

function useNearViewport(element: HTMLElement | null) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
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
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const visible = useNearViewport(element);
  const resolution = timelineThumbnailResolutionForDisplay(displayWidth, (displayWidth * 9) / 16);
  const kind = entry.root === "subtitles" ? "subtitle" : "storyboard";
  const identity = media ? `${kind}:${media.fingerprint}:${media.videoPath}:${entry.start_us}` : "";
  const [thumbnail, setThumbnail] = useState<{
    identity: string;
    src: string;
    width: number;
  } | null>(null);
  const requestRef = useRef<ReturnType<typeof timelineThumbnails.request> | null>(null);

  useEffect(() => {
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

  useEffect(() => {
    requestRef.current?.reprioritize(priority);
  }, [priority]);

  const PlaceholderIcon = !media ? Link2Off : entry.root === "subtitles" ? Captions : Film;
  const shown = thumbnail?.identity === identity ? thumbnail : null;
  return (
    <div ref={setElement} className="asset-library-thumbnail" data-offline={!media || undefined}>
      {shown ? (
        <img src={shown.src} alt="" decoding="async" draggable={false} />
      ) : (
        <PlaceholderIcon className="asset-library-thumbnail-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}
