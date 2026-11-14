import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { frameToTimeUs, timeUsToFrame } from "../../../../core/editor/timeline";
import { invokeCommand, runBackgroundOperation, runOperation } from "../../../../errors";
import { createFfmpegTaskId } from "../../../../platform/tauri/ffmpegProgress";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import type { TranscodeSettings, TranscodeSource } from "../../../../systems/TranscodeSystem";
import { MonitorRange, TimelineRuler, VideoControls } from "../../SourceMonitor";

type PreviewMode = "source" | "output" | "split" | "sideBySide";

const modes: Array<{ id: PreviewMode; label: string }> = [
  { id: "source", label: "源" },
  { id: "output", label: "输出" },
  { id: "split", label: "分屏对比" },
  { id: "sideBySide", label: "并排" },
];

interface PreviewFrames {
  sourcePath: string;
  outputPath: string | null;
}

/** Filter previews redraw quickly; an encoded preview waits for edits to settle. */
const filterDelayMs = 300;
const encodedDelayMs = 700;

/** Frames per second of a stream rate such as "30000/1001". */
function streamFrameRate(rate: string | null | undefined) {
  const [numerator, denominator = "1"] = (rate ?? "").split("/");
  const value = Number(numerator) / Number(denominator);
  return Number.isFinite(value) && value > 0 ? value : 25;
}

function frameUrl(path: string | null) {
  if (!path) return null;
  // Every still has its own file, so the URL changes whenever the frame does.
  return isTauriRuntime() ? convertFileSrc(path) : path;
}

interface TranscodePreviewProps {
  source: TranscodeSource;
  settings: TranscodeSettings;
  outputName: string;
  /** Sets the source range from the timeline's in and out points; null clears one end. */
  onRangeChange: (startUs: number | null, endUs: number | null) => void;
}

/**
 * Source and output stills of the current settings, side by side or split
 * by a draggable divider, at a time picked on the source range.
 */
export function TranscodePreview({
  source,
  settings,
  outputName,
  onRangeChange,
}: TranscodePreviewProps) {
  const durationUs = source.info?.durationUs ?? 0;
  const frameRate = streamFrameRate(source.info?.video[0]?.frameRate);
  const durationFrames = timeUsToFrame(durationUs, frameRate);
  const lastFrame = Math.max(0, durationFrames - 1);
  const rangeStartFrame =
    settings.rangeStartUs !== null ? timeUsToFrame(settings.rangeStartUs, frameRate) : null;
  const rangeEndFrame =
    settings.rangeEndUs !== null
      ? Math.max(0, timeUsToFrame(settings.rangeEndUs, frameRate) - 1)
      : null;
  const hasVideo = (source.info?.video.length ?? 0) > 0 && durationFrames > 0;
  const middleFrame = Math.round(((rangeStartFrame ?? 0) + (rangeEndFrame ?? lastFrame)) / 2);
  const [mode, setMode] = useState<PreviewMode>("split");
  const [currentFrame, setCurrentFrame] = useState(middleFrame);
  const [timelineStartFrame, setTimelineStartFrame] = useState(0);
  const [timelineSpanFrames, setTimelineSpanFrames] = useState(Math.max(1, durationFrames));
  const [minTimelineSpanFrames, setMinTimelineSpanFrames] = useState(0);
  const [encoded, setEncoded] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [frames, setFrames] = useState<PreviewFrames | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const runningTask = useRef<string | null>(null);
  const requestSerial = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  // Media info may arrive after the dialog opens; the timeline then covers the
  // whole clip and starts in the middle, since the first frame is often black.
  const centered = useRef(durationFrames > 0);
  useEffect(() => {
    if (centered.current || durationFrames <= 0) return;
    centered.current = true;
    setCurrentFrame(middleFrame);
    setTimelineStartFrame(0);
    setTimelineSpanFrames(durationFrames);
  }, [durationFrames, middleFrame]);

  const frame = Math.min(Math.max(currentFrame, 0), lastFrame);
  const timeUs = frameToTimeUs(frame, frameRate);
  const seekFrame = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(Math.round(target), 0), lastFrame);
      setCurrentFrame(next);
      return next;
    },
    [lastFrame],
  );
  const stepFrame = useCallback(
    (direction: -1 | 1) =>
      setCurrentFrame((value) => Math.min(Math.max(value + direction, 0), lastFrame)),
    [lastFrame],
  );
  const cueRange =
    rangeStartFrame !== null || rangeEndFrame !== null
      ? { startFrame: rangeStartFrame ?? 0, endFrame: rangeEndFrame ?? lastFrame }
      : null;

  function changeRange(range: { startFrame: number; endFrame: number }) {
    const start = range.startFrame > 0 ? frameToTimeUs(range.startFrame, frameRate) : null;
    const end = range.endFrame < lastFrame ? frameToTimeUs(range.endFrame + 1, frameRate) : null;
    onRangeChange(start, end);
  }

  // The range only decides what is encoded; the still depends on the frame.
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        path: source.path,
        settings: { ...settings, rangeStartUs: null, rangeEndUs: null },
        outputName,
        timeUs,
        encoded,
      }),
    [encoded, outputName, settings, source.path, timeUs],
  );

  useEffect(() => {
    if (!isTauriRuntime() || !hasVideo) return;
    const serial = ++requestSerial.current;
    const timer = window.setTimeout(
      () => {
        const previous = runningTask.current;
        if (previous) {
          // A newer still supersedes the one still rendering.
          runBackgroundOperation("transcode.preview", () =>
            invokeCommand("cancel_task", { taskId: previous }),
          );
        }
        const taskId = createFfmpegTaskId("transcode-preview");
        runningTask.current = taskId;
        setLoading(true);
        void runOperation("transcode.preview", () =>
          invokeCommand<PreviewFrames>("transcode_preview_frames", {
            request: {
              inputPath: source.path,
              outputName: outputName.trim(),
              settings,
              timeUs,
              encoded,
            },
            taskId,
          }),
        ).then((outcome) => {
          if (runningTask.current === taskId) runningTask.current = null;
          if (serial !== requestSerial.current) return;
          setLoading(false);
          if (outcome.status === "success") {
            setFrames(outcome.value);
            setFailed(false);
          } else if (outcome.status !== "cancelled") {
            setFailed(true);
          }
        });
      },
      encoded ? encodedDelayMs : filterDelayMs,
    );
    return () => window.clearTimeout(timer);
    // requestKey stands for every input of the request.
  }, [requestKey, hasVideo]);

  useEffect(
    () => () => {
      const previous = runningTask.current;
      if (previous) {
        runBackgroundOperation("transcode.preview", () =>
          invokeCommand("cancel_task", { taskId: previous }),
        );
      }
    },
    [],
  );

  function dragSplit(event: PointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    // Without this the drag selects the stills like text.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (clientX: number) => {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0)
        setSplitRatio(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    };
    move(event.clientX);
    const target = event.currentTarget;
    const onMove = (moveEvent: globalThis.PointerEvent) => move(moveEvent.clientX);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  const sourceUrl = frameUrl(frames?.sourcePath ?? null);
  const outputUrl = frameUrl(frames?.outputPath ?? null);
  const noOutputVideo = frames !== null && frames.outputPath === null;
  const sizeClass = actualSize ? "is-actual-size" : "is-fit";

  let stage;
  if (!hasVideo) {
    stage = (
      <p className="transcode-preview-empty">
        {source.infoStatus === "pending" ? "正在读取媒体信息…" : "源没有可预览的视频。"}
      </p>
    );
  } else if (!frames) {
    stage = (
      <p className="transcode-preview-empty">
        {failed
          ? "无法生成预览，请检查设置。"
          : isTauriRuntime()
            ? "正在生成预览…"
            : "预览仅在桌面版可用。"}
      </p>
    );
  } else if (mode === "source" || (noOutputVideo && mode !== "sideBySide")) {
    stage = (
      <img
        draggable={false}
        className="transcode-preview-image"
        src={sourceUrl ?? undefined}
        alt="源画面"
      />
    );
  } else if (mode === "output") {
    stage = (
      <img
        draggable={false}
        className="transcode-preview-image"
        src={outputUrl ?? undefined}
        alt="输出画面"
      />
    );
  } else if (mode === "split") {
    stage = (
      <div className="transcode-preview-split" ref={stageRef}>
        <img
          draggable={false}
          className="transcode-preview-image"
          src={outputUrl ?? undefined}
          alt="输出画面"
        />
        <img
          className="transcode-preview-image transcode-preview-split-source"
          src={sourceUrl ?? undefined}
          alt="源画面"
          style={{ clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }}
        />
        <div
          className="transcode-preview-divider"
          role="slider"
          aria-label="对比分界"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          style={{ left: `${splitRatio * 100}%` }}
          onPointerDown={dragSplit}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSplitRatio((ratio) => Math.max(0, ratio - 0.05));
            if (event.key === "ArrowRight") setSplitRatio((ratio) => Math.min(1, ratio + 0.05));
          }}
        />
        <span className="transcode-preview-tag is-left">源</span>
        <span className="transcode-preview-tag is-right">输出</span>
      </div>
    );
  } else {
    stage = (
      <div className="transcode-preview-pair">
        <figure>
          <img
            draggable={false}
            className="transcode-preview-image"
            src={sourceUrl ?? undefined}
            alt="源画面"
          />
          <figcaption>源</figcaption>
        </figure>
        <figure>
          {outputUrl ? (
            <img
              draggable={false}
              className="transcode-preview-image"
              src={outputUrl}
              alt="输出画面"
            />
          ) : (
            <p className="transcode-preview-empty">未导出视频</p>
          )}
          <figcaption>输出</figcaption>
        </figure>
      </div>
    );
  }

  return (
    <section className="transcode-preview" aria-label="预览">
      <div className="transcode-preview-toolbar">
        <div className="transcode-segmented" role="tablist" aria-label="预览方式">
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? "active" : ""}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="transcode-preview-range" role="group" aria-label="源范围">
          <button
            type="button"
            className="toolbar-button"
            disabled={!hasVideo}
            title="把当前帧设为源范围的入点"
            onClick={() =>
              changeRange({
                startFrame: frame,
                endFrame: Math.max(frame, rangeEndFrame ?? lastFrame),
              })
            }
          >
            设为入点
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={!hasVideo}
            title="把当前帧设为源范围的出点"
            onClick={() =>
              changeRange({ startFrame: Math.min(frame, rangeStartFrame ?? 0), endFrame: frame })
            }
          >
            设为出点
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={!cueRange}
            onClick={() => onRangeChange(null, null)}
          >
            清除范围
          </button>
        </div>
        <span className="transcode-toolbar-spacer" />
        {loading && (
          <Loader2 className="spin transcode-preview-busy" size={14} aria-label="正在生成预览" />
        )}
        <label
          className="export-check-label"
          title="用实际编码器压缩一小段再取帧，可看到压缩后的画质"
        >
          <input
            type="checkbox"
            checked={encoded}
            onChange={(event) => setEncoded(event.currentTarget.checked)}
          />
          按实际编码画质
        </label>
        <label className="export-check-label">
          <input
            type="checkbox"
            checked={actualSize}
            onChange={(event) => setActualSize(event.currentTarget.checked)}
          />
          100%
        </label>
      </div>
      <div className={`transcode-preview-stage ${sizeClass}`}>{stage}</div>
      <div className="source-controls transcode-preview-timeline">
        <VideoControls
          mediaKey={source.path}
          hasMedia={hasVideo}
          currentFrame={frame}
          durationFrames={durationFrames}
          frameRate={frameRate}
          timelineStartFrame={timelineStartFrame}
          timelineSpanFrames={timelineSpanFrames}
          minTimelineSpanFrames={minTimelineSpanFrames}
          isPlaying={false}
          showZoom={false}
          onSeekFrame={seekFrame}
          onPlaybackFrameRequest={() => frame}
          onPauseForPreciseSeek={() => {}}
          onTimelineStartFrameChange={setTimelineStartFrame}
          onTimelineSpanFramesChange={setTimelineSpanFrames}
          onStepFrame={stepFrame}
        />
        <TimelineRuler
          hasMedia={hasVideo}
          currentFrame={frame}
          durationFrames={durationFrames}
          timelineStartFrame={timelineStartFrame}
          timelineSpanFrames={timelineSpanFrames}
          cueRange={cueRange}
          onCueRangeChange={changeRange}
          onCueRangePreviewFrame={seekFrame}
          onMinTimelineSpanFramesChange={setMinTimelineSpanFrames}
          onTimelineStartFrameChange={setTimelineStartFrame}
          onSeekFrame={seekFrame}
          onStepFrame={stepFrame}
        />
        <MonitorRange
          hasMedia={hasVideo}
          durationFrames={durationFrames}
          timelineStartFrame={timelineStartFrame}
          timelineSpanFrames={timelineSpanFrames}
          minTimelineSpanFrames={minTimelineSpanFrames}
          onTimelineStartFrameChange={setTimelineStartFrame}
          onTimelineSpanFramesChange={setTimelineSpanFrames}
        />
      </div>
      {noOutputVideo && <p className="transcode-note">当前设置不导出视频，只显示源画面。</p>}
    </section>
  );
}
