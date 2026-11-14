import { open } from "@tauri-apps/plugin-dialog";
import { Copy, Film, ListPlus, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { useState, type DragEvent, type MouseEvent } from "react";
import { runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import {
  containerLabel,
  destinationLabel,
  enqueueTranscodeSources,
  fileName,
  findTranscodePreset,
  outputBlocker,
  plannedOutputPath,
  selectedOutputIds,
  startTranscodeQueue,
  stopTranscodeQueue,
  transcodeQueueStore,
  useTranscodeQueueState,
  type TranscodeOutput,
  type TranscodeSource,
} from "../../../../systems/TranscodeSystem";
import { TranscodeDestinationField } from "../controls/TranscodeDestinationField";

const presetDragType = "application/x-locution-pro-transcode-preset";
const mediaExtensions = [
  "mp4",
  "mkv",
  "mov",
  "webm",
  "avi",
  "ts",
  "m2ts",
  "mts",
  "mpeg",
  "mpg",
  "m4v",
  "mxf",
  "flv",
  "wmv",
  "3gp",
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "opus",
  "wma",
  "aiff",
  "ac3",
  "srt",
  "ass",
  "ssa",
  "vtt",
  "sup",
];

const statusLabels: Record<TranscodeOutput["status"], string> = {
  ready: "就绪",
  encoding: "正在编码",
  done: "完成",
  failed: "失败",
  stopped: "已停止",
};

export async function pickTranscodeSources() {
  if (!isTauriRuntime()) return;
  const outcome = await runOperation("transcode.prepare", () =>
    open({
      multiple: true,
      title: "添加源",
      filters: [{ name: "媒体文件", extensions: mediaExtensions }],
    }),
  );
  if (outcome.status !== "success" || !outcome.value) return;
  enqueueTranscodeSources(Array.isArray(outcome.value) ? outcome.value : [outcome.value]);
}

interface TranscodeQueueProps {
  onEditOutput: (source: TranscodeSource, output: TranscodeOutput) => void;
}

export function TranscodeQueue({ onEditOutput }: TranscodeQueueProps) {
  const sources = useTranscodeQueueState((state) => state.sources);
  const selectedIds = useTranscodeQueueState((state) => state.selectedIds);
  const running = useTranscodeQueueState((state) => state.running);
  const stopRequested = useTranscodeQueueState((state) => state.stopRequested);
  const projectDirectory = useTranscodeQueueState((state) => state.projectDirectory);
  const userPresets = useTranscodeQueueState((state) => state.userPresets);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const store = transcodeQueueStore.getState;
  const selected = new Set(selectedIds);
  const outputIds = selectedOutputIds(sources, selectedIds);
  const selectedOutputs = sources.flatMap((source) =>
    source.outputs.filter((output) => outputIds.includes(output.id)),
  );
  const readyCount = sources.reduce(
    (count, source) =>
      count +
      source.outputs.filter((output) => output.status === "ready" && !outputBlocker(output)).length,
    0,
  );
  const blockedCount = sources.reduce(
    (count, source) =>
      count +
      source.outputs.filter((output) => output.status === "ready" && outputBlocker(output)).length,
    0,
  );
  const doneCount = sources.reduce(
    (count, source) => count + source.outputs.filter((output) => output.status === "done").length,
    0,
  );
  const outputCount = sources.reduce((count, source) => count + source.outputs.length, 0);
  const rowIds = sources.flatMap((source) => [
    source.id,
    ...source.outputs.map((output) => output.id),
  ]);

  function select(id: string, event: MouseEvent) {
    if (event.shiftKey && anchor) {
      const from = rowIds.indexOf(anchor);
      const to = rowIds.indexOf(id);
      if (from >= 0 && to >= 0) {
        store().select(rowIds.slice(Math.min(from, to), Math.max(from, to) + 1));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      store().select(
        selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id],
      );
    } else {
      store().select([id]);
    }
    setAnchor(id);
  }

  function dropPreset(event: DragEvent, ids: string[]) {
    const presetId = event.dataTransfer.getData(presetDragType);
    setDropTarget(null);
    if (!presetId) return;
    event.preventDefault();
    const preset = findTranscodePreset({ userPresets }, presetId);
    if (preset) store().applyPreset(ids, preset);
  }

  function allowPresetDrop(event: DragEvent, id: string) {
    if (event.dataTransfer.types.includes(presetDragType)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropTarget(id);
    }
  }

  return (
    <div className="transcode-queue">
      <div className="transcode-panel-toolbar">
        <button
          type="button"
          className="transcode-icon-button"
          title="添加源"
          aria-label="添加源"
          onClick={() => void pickTranscodeSources()}
        >
          <Plus />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="添加输出"
          aria-label="添加输出"
          disabled={
            selectedOutputs.length === 0 && !sources.some((source) => selected.has(source.id))
          }
          onClick={() => {
            const source = sources.find(
              (candidate) =>
                selected.has(candidate.id) ||
                candidate.outputs.some((output) => selected.has(output.id)),
            );
            if (source) store().addOutput(source.id);
          }}
        >
          <ListPlus />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="删除"
          aria-label="删除"
          disabled={selectedIds.length === 0}
          onClick={() => store().removeSelected()}
        >
          <Trash2 />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="复制"
          aria-label="复制"
          disabled={selectedIds.length === 0}
          onClick={() => store().duplicateSelected()}
        >
          <Copy />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="重置状态"
          aria-label="重置状态"
          disabled={selectedOutputs.every(
            (output) => output.status === "ready" || output.status === "encoding",
          )}
          onClick={() => store().resetSelected()}
        >
          <RotateCcw />
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={doneCount === 0}
          onClick={() => store().clearFinished()}
        >
          清除已完成
        </button>
        <span className="transcode-toolbar-spacer" />
        <span className="transcode-queue-count" role="status">
          已处理 {doneCount} 项，共 {outputCount}
        </span>
        {running ? (
          <button
            type="button"
            className="transcode-icon-button transcode-stop"
            title="停止队列"
            aria-label="停止队列"
            disabled={stopRequested}
            onClick={() => void stopTranscodeQueue()}
          >
            <Square />
          </button>
        ) : (
          <button
            type="button"
            className="transcode-icon-button transcode-start"
            title={
              readyCount > 0
                ? "启动队列"
                : blockedCount > 0
                  ? "请先为输出选择输出位置"
                  : "队列中没有就绪的输出"
            }
            aria-label="启动队列"
            disabled={readyCount === 0}
            onClick={() => void startTranscodeQueue()}
          >
            <Play />
          </button>
        )}
      </div>
      {selectedOutputs.length > 0 && !running && (
        <div className="transcode-queue-destination">
          <span className="transcode-queue-destination-label">输出位置</span>
          <TranscodeDestinationField
            destination={selectedOutputs[0].destination}
            disabled={selectedOutputs.every((output) => output.status === "encoding")}
            onChange={(destination) => store().setDestination(outputIds, destination)}
          />
        </div>
      )}
      <div
        className="transcode-queue-table"
        role="grid"
        aria-label="转码队列"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
            event.preventDefault();
            store().removeSelected();
          }
        }}
      >
        <div className="transcode-queue-row is-heading" role="row">
          <span role="columnheader">格式</span>
          <span role="columnheader">预设</span>
          <span role="columnheader">输出文件</span>
          <span role="columnheader">状态</span>
        </div>
        {sources.length === 0 && (
          <p className="transcode-empty">
            要将项目添加到队列，请单击“添加源”按钮，在左侧媒体箱中右键选择“添加到转码队列”，或在导入时勾选“在转码页面打开导入素材”。要开始编码，请单击“启动队列”按钮。
          </p>
        )}
        {sources.map((source) => (
          <div key={source.id} role="rowgroup">
            <div
              role="row"
              aria-selected={selected.has(source.id)}
              className={`transcode-queue-source ${selected.has(source.id) ? "selected" : ""} ${dropTarget === source.id ? "is-drop-target" : ""}`}
              title={source.path}
              onClick={(event) => select(source.id, event)}
              onDragOver={(event) => allowPresetDrop(event, source.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) =>
                dropPreset(
                  event,
                  source.outputs.map((output) => output.id),
                )
              }
            >
              <Film />
              <span className="transcode-queue-source-name">{fileName(source.path)}</span>
              {source.infoStatus === "failed" && (
                <span className="transcode-warning">无法读取</span>
              )}
            </div>
            {source.outputs.map((output) => {
              const blocker = output.status === "ready" ? outputBlocker(output) : null;
              const path = plannedOutputPath(output, source, projectDirectory);
              return (
                <div
                  key={output.id}
                  role="row"
                  aria-selected={selected.has(output.id)}
                  className={`transcode-queue-row ${selected.has(output.id) ? "selected" : ""} ${dropTarget === output.id ? "is-drop-target" : ""} is-${output.status}`}
                  onClick={(event) => select(output.id, event)}
                  onDoubleClick={() => output.status !== "encoding" && onEditOutput(source, output)}
                  onDragOver={(event) => allowPresetDrop(event, output.id)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => dropPreset(event, [output.id])}
                >
                  <button
                    type="button"
                    className="transcode-link"
                    disabled={output.status === "encoding"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditOutput(source, output);
                    }}
                  >
                    {containerLabel(output.settings.container)}
                  </button>
                  <button
                    type="button"
                    className="transcode-link"
                    disabled={output.status === "encoding"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditOutput(source, output);
                    }}
                  >
                    {output.presetName}
                  </button>
                  <span
                    className={`transcode-output-path ${output.destination ? "" : "is-missing"}`}
                    title={output.destination ? path : destinationLabel(null)}
                  >
                    {output.destination ? path : "未选择输出位置（必填）"}
                  </span>
                  <span className="transcode-status" title={blocker ?? undefined}>
                    {output.status === "encoding"
                      ? `${Math.round(output.progress * 100)}%`
                      : blocker
                        ? "待设置"
                        : output.failure
                          ? `${statusLabels.failed}`
                          : statusLabels[output.status]}
                    {output.status === "encoding" && (
                      <span className="transcode-row-progress" aria-hidden="true">
                        <span style={{ width: `${output.progress * 100}%` }} />
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
