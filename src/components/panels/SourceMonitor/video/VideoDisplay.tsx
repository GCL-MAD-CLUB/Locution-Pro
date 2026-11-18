import { useScopedState } from "../../../../runtime/state/useScopedState";
import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import {
  useCallback,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useSourceMonitorState, type MonitorZoomLevel, type ZoomPan } from "../sourceMonitorState";
import { TransientVideoPreview, type TransientVideoFrame } from "./TransientVideoPreview";
import type { FrameHistogram } from "../../../../core/editor/frameHistogram";
import { useVideoHistogram } from "../histogram/useVideoHistogram";
import { useVideoFrameTrace } from "../histogram/useVideoFrameTrace";
import { frameTraceCacheKey } from "../../../../application/media/frameTraceCache";

interface VideoDisplayProps {
  stageRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc: string | null;
  transientPreview?: TransientVideoFrame | null;
  frameRate: number;
  muted: boolean;
  zoomLevel: MonitorZoomLevel;
  zoomPan: ZoomPan;
  onVideoError: () => void;
  onLoadedMetadata: (video: HTMLVideoElement) => void;
  onSyncCurrentTime: (video: HTMLVideoElement) => void;
  onPlay: (video: HTMLVideoElement) => void;
  onPause: (video: HTMLVideoElement) => void;
  onHistogram: (source: string | null, histogram: FrameHistogram | null) => void;
  histogramEnabled: boolean;
  traceEnabled: boolean;
  traceFingerprint?: string;
  traceAssetId?: string;
}

interface VideoLayer {
  id: string;
  source: string;
  transform: string;
}

interface VideoLayers {
  requestedSource: string | null;
  current: VideoLayer | null;
  displayed: VideoLayer | null;
}

function VideoLayerElement({
  layerId,
  bindVideo,
  ...props
}: Omit<ComponentProps<"video">, "ref"> & {
  layerId: string;
  bindVideo: (id: string, video: HTMLVideoElement | null) => void;
}) {
  const ref = useCallback(
    (video: HTMLVideoElement | null) => bindVideo(layerId, video),
    [layerId, bindVideo],
  );
  return <video {...props} ref={ref} />;
}

function currentVideo(event: SyntheticEvent<HTMLVideoElement>) {
  return event.currentTarget;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pointerOffsetFromStageCenter(event: WheelEvent, stageRect: DOMRect) {
  return {
    x: event.clientX - (stageRect.left + stageRect.width / 2),
    y: event.clientY - (stageRect.top + stageRect.height / 2),
  };
}

export function VideoDisplay({
  stageRef,
  videoRef,
  videoSrc,
  transientPreview,
  frameRate,
  muted,
  zoomLevel,
  zoomPan,
  onVideoError,
  onLoadedMetadata,
  onSyncCurrentTime,
  onPlay,
  onPause,
  onHistogram,
  histogramEnabled,
  traceEnabled,
  traceFingerprint,
  traceAssetId,
}: VideoDisplayProps) {
  const lifetime = new RenderLifetime();

  const setZoomLevel = useSourceMonitorState((state) => state.setZoomLevel);
  const setZoomPan = useSourceMonitorState((state) => state.setZoomPan);
  const zoomLevelRef = useRef(zoomLevel);
  lifetime.useBeforePaint(() => {
    zoomLevelRef.current = zoomLevel;
  });
  const zoomPanRef = useRef(zoomPan);
  lifetime.useBeforePaint(() => {
    zoomPanRef.current = zoomPan;
  });
  const requestedSource = videoSrc || null;
  const zoomScale = zoomLevel === "fit" ? 1 : zoomLevel / 100;
  const currentZoomPan = zoomLevel === "fit" ? { x: 0, y: 0 } : zoomPan;
  const transform = `translate(${currentZoomPan.x}px, ${currentZoomPan.y}px) scale(${zoomScale})`;
  const [presented, setPresented] = useScopedState<VideoLayer | null>(
    requestedSource !== null,
    null,
  );
  const displayed = requestedSource ? presented : null;
  const current = requestedSource
    ? displayed?.source === requestedSource
      ? displayed
      : { id: requestedSource, source: requestedSource, transform }
    : null;
  const layers: VideoLayers = { requestedSource, current, displayed };
  const layersRef = useRef(layers);
  lifetime.useBeforePaint(() => {
    layersRef.current = layers;
  });
  const displayedTransformRef = useRef(transform);

  const transformRef = useRef(transform);
  lifetime.useBeforePaint(() => {
    transformRef.current = transform;
  });
  const frameRateRef = useRef(frameRate);
  lifetime.useBeforePaint(() => {
    frameRateRef.current = frameRate;
  });
  const videosRef = useRef(new Map<string, HTMLVideoElement>());
  const histogramVideoRef = useRef<HTMLVideoElement | null>(null);
  lifetime.useBeforePaint(() => {
    histogramVideoRef.current = layers.displayed
      ? (videosRef.current.get(layers.displayed.id) ?? null)
      : null;
  });
  lifetime.useBeforePaint(() => {
    if (displayed && displayed.id !== current?.id) {
      const outgoing = videosRef.current.get(displayed.id);
      if (outgoing) outgoing.style.transform = displayedTransformRef.current;
    } else if (displayed) {
      displayedTransformRef.current = transform;
    }
  });
  useVideoHistogram(
    lifetime,
    histogramVideoRef,
    layers.displayed?.id ?? null,
    histogramEnabled && !transientPreview,
    (histogram) => onHistogram(layers.displayed?.source ?? null, histogram),
  );

  useVideoFrameTrace(
    lifetime,
    histogramVideoRef,
    layers.displayed?.id ?? null,
    frameRate,
    traceEnabled && !transientPreview && layers.displayed?.source === requestedSource,
    () => {},
    frameTraceCacheKey(layers.displayed?.source ?? "", frameRate, traceFingerprint, traceAssetId),
  );
  const pendingFrameRef = useRef<{ video: HTMLVideoElement; id: number } | null>(null);
  const pendingRevealRef = useRef<number | null>(null);
  const presentedFrameRef = useRef<{ video: HTMLVideoElement; time: number } | null>(null);

  const finishIncomingFrame = useCallback(
    (video: HTMLVideoElement) => {
      const current = layersRef.current.current;
      if (!current || video !== videoRef.current || video.readyState < 2 || video.seeking)
        return false;
      if (typeof video.requestVideoFrameCallback === "function") {
        const presented = presentedFrameRef.current;
        if (
          !presented ||
          presented.video !== video ||
          Math.abs(presented.time - video.currentTime) > 1 / Math.max(1, frameRateRef.current)
        )
          return false;
      }
      setPresented((previous) =>
        previous?.id === current.id ? previous : { ...current, transform: transformRef.current },
      );
      const pending = pendingFrameRef.current;
      if (pending?.video === video) {
        pending.video.cancelVideoFrameCallback(pending.id);
        pendingFrameRef.current = null;
      }
      if (pendingRevealRef.current !== null) {
        cancelAnimationFrame(pendingRevealRef.current);
        pendingRevealRef.current = null;
      }
      return true;
    },
    [videoRef, setPresented],
  );

  const watchIncomingFrame = useCallback(
    function watchIncomingFrame(video: HTMLVideoElement) {
      if (
        video !== videoRef.current ||
        layersRef.current.displayed?.id === layersRef.current.current?.id
      )
        return;
      if (typeof video.requestVideoFrameCallback === "function" && finishIncomingFrame(video))
        return;
      if (pendingFrameRef.current?.video === video || pendingRevealRef.current !== null) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        const id = video.requestVideoFrameCallback((_now, metadata) => {
          if (video !== videoRef.current) return;
          pendingFrameRef.current = null;
          presentedFrameRef.current = { video, time: metadata.mediaTime };
          if (!finishIncomingFrame(video)) watchIncomingFrame(video);
        });
        pendingFrameRef.current = { video, id };
      } else if (video.readyState >= 2 && !video.seeking) {
        pendingRevealRef.current = requestAnimationFrame(() => {
          pendingRevealRef.current = requestAnimationFrame(() => {
            pendingRevealRef.current = null;
            finishIncomingFrame(video);
          });
        });
      }
    },
    [videoRef, finishIncomingFrame],
  );

  const bindVideo = useCallback(
    (id: string, video: HTMLVideoElement | null) => {
      const previous = videosRef.current.get(id);
      const pending = pendingFrameRef.current;
      if (!video && pending && pending.video === previous) {
        pending.video.cancelVideoFrameCallback(pending.id);
        pendingFrameRef.current = null;
      }
      if (!video && previous === videoRef.current && pendingRevealRef.current !== null) {
        cancelAnimationFrame(pendingRevealRef.current);
        pendingRevealRef.current = null;
      }
      if (video) {
        videosRef.current.set(id, video);
        if (id === layersRef.current.current?.id) {
          videoRef.current = video;
          watchIncomingFrame(video);
        }
      } else {
        videosRef.current.delete(id);
        if (previous === videoRef.current) videoRef.current = null;
      }
      if (previous && previous !== video) {
        // Ref callbacks are replayed in StrictMode without removing the element.
        queueMicrotask(() => {
          if (!previous.isConnected && previous !== videoRef.current) {
            previous.pause();
            previous.removeAttribute("src");
            previous.load();
          }
        });
      }
    },
    [videoRef, watchIncomingFrame],
  );

  lifetime.useBeforePaint(() => {
    const video = layers.current && videosRef.current.get(layers.current.id);
    videoRef.current = video ?? null;
    const pending = pendingFrameRef.current;
    if (pending && pending.video !== video) {
      pending.video.cancelVideoFrameCallback(pending.id);
      pendingFrameRef.current = null;
    }
    if (pendingRevealRef.current !== null) {
      cancelAnimationFrame(pendingRevealRef.current);
      pendingRevealRef.current = null;
    }
    for (const candidate of videosRef.current.values()) {
      if (candidate !== video && !candidate.paused) candidate.pause();
    }
    if (!video) return;
    watchIncomingFrame(video);
  }, [layers.current?.id, videoRef]);

  function handleVideoEvent(
    event: SyntheticEvent<HTMLVideoElement>,
    handler: (video: HTMLVideoElement) => void,
  ) {
    const video = currentVideo(event);
    if (video === videoRef.current) handler(video);
  }

  lifetime.useAfterCommit(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      focusStage(stage);
      handleVideoWheel(event, stage);
    };

    stage.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => stage.removeEventListener("wheel", handleWheel, true);
  }, [stageRef]);

  function focusStage(stage = stageRef.current) {
    if (!stage || document.activeElement === stage) {
      return;
    }
    try {
      stage.focus({ preventScroll: true });
    } catch {
      stage.focus();
    }
  }

  function handleVideoWheel(event: WheelEvent, stage: HTMLDivElement) {
    const hasMedia = Boolean(layersRef.current.requestedSource);
    if (!hasMedia) {
      return;
    }
    const usePointerOrigin = event.ctrlKey || event.metaKey;
    const useCenterOrigin = event.altKey && !usePointerOrigin;
    if (!usePointerOrigin && !useCenterOrigin) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (usePointerOrigin) {
      zoomVideo(delta, pointerOffsetFromStageCenter(event, stage.getBoundingClientRect()));
    } else if (useCenterOrigin) {
      zoomVideo(delta, { x: 0, y: 0 });
    }
  }

  function zoomVideo(delta: number, pointer: { x: number; y: number }) {
    const currentLevel = zoomLevelRef.current;
    const currentPan = zoomPanRef.current;
    const numeric = currentLevel === "fit" ? 100 : currentLevel;
    const k = delta < 0 ? 1.12 : 1 / 1.12;
    const nextNumeric = Math.round(clamp(numeric * k, 10, 1600));
    const actualK = nextNumeric / numeric;
    const nextPan = {
      x: actualK * currentPan.x + (1 - actualK) * pointer.x,
      y: actualK * currentPan.y + (1 - actualK) * pointer.y,
    };
    zoomLevelRef.current = nextNumeric;
    zoomPanRef.current = nextPan;
    setZoomLevel(nextNumeric);
    setZoomPan(nextPan);
  }

  return lifetime.render(
    <div
      ref={stageRef}
      className="source-video-stage"
      data-source-monitor-drop-target
      tabIndex={-1}
      onPointerDown={() => focusStage()}
    >
      {(layers.displayed && layers.displayed.id !== layers.current?.id
        ? [layers.displayed, ...(layers.current ? [layers.current] : [])]
        : layers.current
          ? [layers.current]
          : []
      ).map((layer) => (
        <VideoLayerElement
          key={layer.id}
          layerId={layer.id}
          bindVideo={bindVideo}
          crossOrigin="anonymous"
          src={layer.source}
          className={`source-video-layer ${layer.id === layers.displayed?.id ? "visible" : "loading"}`}
          muted={layer.id !== layers.current?.id || muted}
          controls={false}
          preload="auto"
          onError={(event) => handleVideoEvent(event, onVideoError)}
          onLoadedMetadata={(event) =>
            handleVideoEvent(event, (video) => {
              onLoadedMetadata(video);
              watchIncomingFrame(video);
            })
          }
          onLoadedData={(event) => handleVideoEvent(event, watchIncomingFrame)}
          onCanPlay={(event) => handleVideoEvent(event, watchIncomingFrame)}
          onTimeUpdate={(event) => handleVideoEvent(event, onSyncCurrentTime)}
          onSeeked={(event) =>
            handleVideoEvent(event, (video) => {
              onSyncCurrentTime(video);
              watchIncomingFrame(video);
            })
          }
          onPlay={(event) => handleVideoEvent(event, onPlay)}
          onPause={(event) => handleVideoEvent(event, onPause)}
          style={
            {
              transform: layer.id === layers.current?.id ? transform : undefined,
              transformOrigin: "50% 50%",
            } as CSSProperties
          }
        />
      ))}
      {transientPreview && (
        <TransientVideoPreview
          key={`${transientPreview.sessionId}:${transientPreview.src}`}
          preview={transientPreview}
          histogramEnabled={histogramEnabled}
          onHistogram={(histogram) => onHistogram(requestedSource, histogram)}
          style={{ transform, transformOrigin: "50% 50%" }}
        />
      )}
    </div>,
  );
}
