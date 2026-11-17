import { open } from "@tauri-apps/plugin-dialog";
import { CopyPlus, ListPlus, ListX, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { VideoGlyph } from "../../../common/MediaKindIcons/MediaKindIcons";
import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import { useEditCapability } from "../../../../runtime/capabilities/EditCapability";
import { useStableIdentity } from "../../../../runtime/state/react";
import { usePanelActive, usePanelInstanceId } from "../../../../runtime/systems/PanelState";
import { useProjectPort } from "../../../../systems/ProjectSystem";
import {
  clickQueueRow,
  containerLabel,
  destinationLabel,
  enqueueTranscodeSources,
  fileName,
  findTranscodePreset,
  moveQueueCursor,
  outputBlocker,
  plannedOutputPath,
  selectedOutputIds,
  startTranscodeQueue,
  stopTranscodeQueue,
  toggleQueueFocus,
  transcodeQueueStore,
  transcodePresetLabel,
  useTranscodeQueueState,
  type TranscodeOutput,
  type TranscodeQueueCursor,
  type TranscodeQueueMove,
  type TranscodeSource,
} from "../../../../systems/TranscodeSystem";
import { usePanelManagerState } from "../../../common/DockLayout";
import { TranscodeDestinationField } from "../controls/TranscodeDestinationField";
import {
  TranscodeQueueContextMenu,
  type TranscodeQueueMenuTarget,
} from "./TranscodeQueueContextMenu";

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

const moveKeys: Record<string, TranscodeQueueMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  PageUp: "pageUp",
  PageDown: "pageDown",
  Home: "home",
  End: "end",
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

function countOutputs(
  sources: readonly TranscodeSource[],
  matches: (output: TranscodeOutput) => boolean,
) {
  return sources.reduce((count, source) => count + source.outputs.filter(matches).length, 0);
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
  const { mediaFolders } = useProjectPort(["mediaFolders"], []);
  const panelInstanceId = usePanelInstanceId();
  const panelActive = usePanelActive();
  const focusedPanelId = usePanelManagerState((state) => state.focusedPanelId);
  const identity = useStableIdentity("transcode-queue", panelInstanceId);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<TranscodeQueueMenuTarget | null>(null);
  const store = transcodeQueueStore.getState;
  const selected = new Set(selectedIds);
  const outputIds = selectedOutputIds(sources, selectedIds);
  const selectedOutputs = sources.flatMap((source) =>
    source.outputs.filter((output) => outputIds.includes(output.id)),
  );
  const readyCount = countOutputs(
    sources,
    (output) => output.status === "ready" && !outputBlocker(output),
  );
  const doneCount = countOutputs(sources, (output) => output.status === "done");
  const outputCount = countOutputs(sources, () => true);
  const rowIds = sources.flatMap((source) => [
    source.id,
    ...source.outputs.map((output) => output.id),
  ]);
  const cursor: TranscodeQueueCursor = {
    selectedIds,
    anchorId,
    focusId: focusId && rowIds.includes(focusId) ? focusId : null,
  };
  const focusedSource = sources.find(
    (source) =>
      source.id === cursor.focusId || source.outputs.some((output) => output.id === cursor.focusId),
  );
  const firstSelectedSource = sources.find(
    (source) => selected.has(source.id) || source.outputs.some((output) => selected.has(output.id)),
  );
  const targetSource = focusedSource ?? firstSelectedSource ?? null;
  const editable = editableOutput();

  useEditCapability({
    identity,
    active: panelActive && focusedPanelId === panelInstanceId,
    selectedCount: selectedIds.length,
    visibleCount: rowIds.length,
    handlers: {
      clear: () => store().removeSelected(),
      duplicate: () => store().duplicateSelected(),
      selectAll: () => store().select(rowIds),
      clearSelection: () => store().select([]),
    },
  });

  /** The focused output, the first output of a focused source, or the first selected output. */
  function editableOutput() {
    for (const source of sources) {
      if (source.id === cursor.focusId && source.outputs[0])
        return { source, output: source.outputs[0] };
      const output = source.outputs.find((item) => item.id === cursor.focusId);
      if (output) return { source, output };
    }
    const output = selectedOutputs[0];
    const source = output && sources.find((item) => item.outputs.includes(output));
    return source ? { source, output } : null;
  }

  function applyCursor(next: TranscodeQueueCursor) {
    store().select([...next.selectedIds]);
    setAnchorId(next.anchorId);
    setFocusId(next.focusId);
    if (next.focusId) {
      tableRef.current
        ?.querySelector(`[data-queue-row-id="${CSS.escape(next.focusId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  function clickRow(id: string, event: MouseEvent) {
    // Controls inside an already selected row act on the whole selection.
    if (
      selected.has(id) &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.target as Element).closest("button")
    ) {
      setFocusId(id);
      return;
    }
    applyCursor(
      clickQueueRow(rowIds, cursor, id, {
        extend: event.shiftKey,
        toggle: event.ctrlKey || event.metaKey,
      }),
    );
  }

  function openMenu(event: MouseEvent, id: string | null) {
    event.preventDefault();
    if (id && !selected.has(id)) applyCursor(clickQueueRow(rowIds, cursor, id));
    else if (id) setFocusId(id);
    setMenu({ x: event.clientX, y: event.clientY });
  }

  /** Opens the menu below the focused row, for the menu key and Shift+F10. */
  function openMenuFromKeyboard() {
    const row = cursor.focusId
      ? tableRef.current?.querySelector(`[data-queue-row-id="${CSS.escape(cursor.focusId)}"]`)
      : null;
    const rect = (row ?? tableRef.current)?.getBoundingClientRect();
    if (rect) setMenu({ x: rect.left + 24, y: row ? rect.bottom : rect.top + 24 });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey) return;
    const move = moveKeys[event.key];
    const toggle = event.ctrlKey || event.metaKey;
    if (move) {
      event.preventDefault();
      applyCursor(moveQueueCursor(rowIds, cursor, move, { extend: event.shiftKey, toggle }));
    } else if (event.key === " " && toggle) {
      event.preventDefault();
      applyCursor(toggleQueueFocus(cursor));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (editable && editable.output.status !== "encoding")
        onEditOutput(editable.source, editable.output);
    } else if (event.key === "Escape" && selectedIds.length > 0) {
      event.preventDefault();
      store().select([]);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      openMenuFromKeyboard();
    }
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

  function rowClass(id: string, base: string) {
    return [
      base,
      selected.has(id) ? "selected" : "",
      cursor.focusId === id ? "is-focused" : "",
      dropTarget === id ? "is-drop-target" : "",
    ].join(" ");
  }

  function renderOutput(source: TranscodeSource, output: TranscodeOutput) {
    const blocker = output.status === "ready" ? outputBlocker(output) : null;
    const path = plannedOutputPath(output, source, projectDirectory);
    const locked = output.status === "encoding";
    // Bin outputs are named by their bin folder; the disk path stays in the tooltip.
    const location =
      output.destination?.kind === "mediaBin"
        ? `${destinationLabel(output.destination, mediaFolders)} / ${fileName(path)}`
        : output.destination
          ? path
          : "未设置";
    const targets = selected.has(output.id) ? outputIds : [output.id];
    return (
      <div
        key={output.id}
        role="row"
        data-queue-row-id={output.id}
        aria-selected={selected.has(output.id)}
        className={`${rowClass(output.id, "transcode-queue-row")} is-${output.status}`}
        onClick={(event) => clickRow(output.id, event)}
        onContextMenu={(event) => openMenu(event, output.id)}
        onDoubleClick={(event) => {
          if (!locked && !(event.target as Element).closest("button")) onEditOutput(source, output);
        }}
        onDragOver={(event) => allowPresetDrop(event, output.id)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => dropPreset(event, [output.id])}
      >
        <span role="gridcell">
          <button
            type="button"
            tabIndex={-1}
            className="transcode-link"
            disabled={locked}
            onClick={() => onEditOutput(source, output)}
          >
            {containerLabel(output.settings.container)}
          </button>
        </span>
        <span role="gridcell">
          <button
            type="button"
            tabIndex={-1}
            className="transcode-link"
            disabled={locked}
            onClick={() => onEditOutput(source, output)}
          >
            {transcodePresetLabel({ userPresets }, output.presetId, output.presetName)}
          </button>
        </span>
        <span role="gridcell" className="transcode-output-cell">
          <TranscodeDestinationField
            variant="link"
            linkLabel={location}
            destination={output.destination}
            disabled={locked || output.status === "done"}
            onChange={(destination) => store().setDestination(targets, destination)}
          />
        </span>
        <span role="gridcell" className="transcode-status" title={blocker ?? undefined}>
          {output.status === "encoding"
            ? `${Math.round(output.progress * 100)}%`
            : blocker
              ? "待设置"
              : statusLabels[output.failure ? "failed" : output.status]}
          {output.status === "encoding" && (
            <span className="transcode-row-progress" aria-hidden="true">
              <span style={{ width: `${output.progress * 100}%` }} />
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="transcode-queue">
      <div className="transcode-panel-toolbar">
        <button
          type="button"
          className="transcode-icon-button"
          title="添加源"
          onClick={() => void pickTranscodeSources()}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="添加输出"
          disabled={!targetSource}
          onClick={() => targetSource && store().addOutput(targetSource.id)}
        >
          <ListPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="重复"
          disabled={selectedIds.length === 0}
          onClick={() => store().duplicateSelected()}
        >
          <CopyPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="重置状态"
          disabled={selectedOutputs.every(
            (output) => output.status === "ready" || output.status === "encoding",
          )}
          onClick={() => store().resetSelected()}
        >
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="从队列中移除"
          disabled={selectedIds.length === 0}
          onClick={() => store().removeSelected()}
        >
          <Trash2 aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="清除已完成"
          disabled={doneCount === 0}
          onClick={() => store().clearFinished()}
        >
          <ListX aria-hidden="true" />
        </button>
        <span className="transcode-toolbar-spacer" />
        {outputCount > 0 && (
          <span className="transcode-queue-count" role="status">
            {doneCount} / {outputCount}
          </span>
        )}
        {running ? (
          <button
            type="button"
            className="transcode-icon-button transcode-stop"
            title="停止队列"
            disabled={stopRequested}
            onClick={() => void stopTranscodeQueue()}
          >
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="transcode-icon-button transcode-start"
            title="启动队列"
            disabled={readyCount === 0}
            onClick={() => void startTranscodeQueue()}
          >
            <Play aria-hidden="true" />
          </button>
        )}
      </div>
      <div
        ref={tableRef}
        className="transcode-queue-table"
        // Media dragged from the media bin is added here (see MediaBinTable).
        data-transcode-queue-drop-target=""
        role="grid"
        aria-label="转码队列"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => openMenu(event, null)}
      >
        <div className="transcode-queue-row is-heading" role="row">
          <span role="columnheader">格式</span>
          <span role="columnheader">预设</span>
          <span role="columnheader">输出位置</span>
          <span role="columnheader">状态</span>
        </div>
        {sources.length === 0 && (
          <p className="transcode-empty">从媒体箱拖入素材，或单击 + 添加源。</p>
        )}
        {sources.map((source) => (
          <div key={source.id} role="rowgroup">
            <div
              role="row"
              data-queue-row-id={source.id}
              aria-selected={selected.has(source.id)}
              className={rowClass(source.id, "transcode-queue-source")}
              title={source.path}
              onClick={(event) => clickRow(source.id, event)}
              onContextMenu={(event) => openMenu(event, source.id)}
              onDragOver={(event) => allowPresetDrop(event, source.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) =>
                dropPreset(
                  event,
                  source.outputs.map((output) => output.id),
                )
              }
            >
              <VideoGlyph />
              <span className="transcode-queue-source-name">{fileName(source.path)}</span>
              {source.infoStatus === "failed" && (
                <span className="transcode-warning">无法读取</span>
              )}
            </div>
            {source.outputs.map((output) => renderOutput(source, output))}
          </div>
        ))}
      </div>
      {menu && (
        <TranscodeQueueContextMenu
          target={menu}
          identity={identity}
          editable={editable}
          sourceId={targetSource?.id ?? null}
          selectedOutputs={selectedOutputs}
          hasSelection={selectedIds.length > 0}
          doneCount={doneCount}
          onEditOutput={onEditOutput}
          onClose={() => {
            setMenu(null);
            tableRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
