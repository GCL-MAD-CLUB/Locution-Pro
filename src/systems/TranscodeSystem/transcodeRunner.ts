import { mediaKind } from "../../components/panels/ImportWorkspace/browser/importBrowserModel";
import { invokeCommand, runOperation } from "../../errors";
import { normalizeError } from "../../errors/runtime";
import {
  cancelFfmpegTask,
  createFfmpegTaskId,
  listenToFfmpegTaskProgress,
} from "../../platform/tauri/ffmpegProgress";
import { isTauriRuntime } from "../../platform/tauri/runtime";
import { publishEvent } from "../../runtime/events/react";
import { createTaskProgress } from "../TaskSystem";
import { fileName, outputBlocker, resolveOutputDirectory } from "./transcodeOutput";
import {
  findTranscodePreset,
  transcodeConfigSnapshot,
  transcodeQueueStore,
} from "./transcodeQueueState";
import type {
  TranscodeCapabilities,
  TranscodeCodecDetails,
  TranscodeOutput,
  TranscodeResult,
  TranscodeSource,
  TranscodeSourceInfo,
} from "./transcodeTypes";

const transcodeIdentity = { system: "transcode-system" };
const configSaveDelayMs = 400;
const watchIntervalMs = 5000;

interface ImportDirectoryListing {
  entries: Array<{ path: string; is_directory: boolean; is_hidden: boolean; size: number }>;
}

let startup: Promise<void> | null = null;
let configWrite: Promise<unknown> = Promise.resolve();
let configTimer: number | null = null;
let lastSavedConfig = "";
let probeChain: Promise<void> = Promise.resolve();
let stopActive: (() => Promise<void>) | null = null;
let watchTimer: number | null = null;
const watchSizes = new Map<string, number>();
const detailRequests = new Map<string, Promise<TranscodeCodecDetails | null>>();

function scheduleConfigSave() {
  if (!isTauriRuntime() || !transcodeQueueStore.getState().configLoaded) return;
  if (configTimer !== null) window.clearTimeout(configTimer);
  configTimer = window.setTimeout(() => {
    configTimer = null;
    const config = transcodeConfigSnapshot(transcodeQueueStore.getState());
    const serialized = JSON.stringify(config);
    if (serialized === lastSavedConfig) return;
    lastSavedConfig = serialized;
    const write = () =>
      runOperation("transcode.prepare", () => invokeCommand("save_transcode_config", { config }));
    configWrite = configWrite.then(write, write);
  }, configSaveDelayMs);
}

/**
 * Loads the stored queue, presets and watch folders and the installed
 * FFmpeg's capabilities once; later calls share the same load.
 */
export function ensureTranscodeReady(): Promise<void> {
  if (startup) return startup;
  const store = transcodeQueueStore;
  startup = (async () => {
    if (!isTauriRuntime()) {
      store.getState().restore(null);
      return;
    }
    const [config, capabilities] = await Promise.all([
      runOperation("transcode.prepare", () => invokeCommand<unknown>("load_transcode_config")),
      runOperation("transcode.prepare", () =>
        invokeCommand<TranscodeCapabilities>("transcode_capabilities"),
      ),
    ]);
    if (capabilities.status === "success") store.getState().setCapabilities(capabilities.value);
    store.getState().restore(config.status === "success" ? config.value : null);
    lastSavedConfig = JSON.stringify(transcodeConfigSnapshot(store.getState()));
    for (const source of store.getState().sources) {
      if (source.infoStatus === "pending") probeTranscodeSource(source);
    }
    store.subscribe(scheduleConfigSave);
    store.subscribe(syncWatchTimer);
    syncWatchTimer();
  })();
  return startup;
}

function probeTranscodeSource(source: TranscodeSource) {
  if (!isTauriRuntime()) return;
  const probe = async () => {
    // The source may have been removed while earlier probes ran.
    if (!transcodeQueueStore.getState().sources.some((item) => item.id === source.id)) return;
    const outcome = await runOperation(
      "transcode.prepare",
      () => invokeCommand<TranscodeSourceInfo>("probe_transcode_source", { path: source.path }),
      { displayName: fileName(source.path), resourceKind: "media" },
    );
    transcodeQueueStore
      .getState()
      .setSourceInfo(source.id, outcome.status === "success" ? outcome.value : null);
  };
  probeChain = probeChain.then(probe, probe);
}

/** Adds files to the queue with the last-used preset and reads their streams. */
export function enqueueTranscodeSources(
  paths: string[],
  options?: Parameters<ReturnType<typeof transcodeQueueStore.getState>["addSources"]>[1],
) {
  void ensureTranscodeReady();
  const added = transcodeQueueStore.getState().addSources(paths, options);
  for (const source of added) probeTranscodeSource(source);
  return added;
}

export function loadTranscodeCodecDetails(kind: "encoder" | "muxer", name: string) {
  if (!isTauriRuntime() || !name || name === "copy") return Promise.resolve(null);
  const key = `${kind}:${name}`;
  let request = detailRequests.get(key);
  if (!request) {
    request = runOperation("transcode.prepare", () =>
      invokeCommand<TranscodeCodecDetails>("transcode_codec_details", { kind, name }),
    ).then((outcome) => (outcome.status === "success" ? outcome.value : null));
    detailRequests.set(key, request);
  }
  return request;
}

function nextReadyOutput(): { source: TranscodeSource; output: TranscodeOutput } | null {
  for (const source of transcodeQueueStore.getState().sources) {
    for (const output of source.outputs) {
      if (output.status === "ready" && outputBlocker(output) === null) return { source, output };
    }
  }
  return null;
}

async function runOutput(source: TranscodeSource, output: TranscodeOutput) {
  const store = transcodeQueueStore;
  const { projectDirectory } = store.getState();
  const outputDir = resolveOutputDirectory(output.destination, source.path, projectDirectory);
  if (!outputDir) return;
  const taskId = createFfmpegTaskId("transcode");
  let cancelled = false;
  const cancel = async () => {
    cancelled = true;
    await cancelFfmpegTask(taskId);
  };
  store.getState().updateOutput(output.id, {
    status: "encoding",
    progress: 0,
    failure: null,
    outputPath: null,
    startedAt: Date.now(),
    finishedAt: null,
  });
  store.getState().setActiveOutput(output.id);
  const progressListener = listenToFfmpegTaskProgress(taskId);
  const task = await createTaskProgress({
    operation: "transcode.run",
    label: `转码 ${fileName(source.path)}`,
    current: 0,
    total: 1,
    listener: (publish) =>
      progressListener((update) => {
        publish(update);
        if (update.current !== undefined) {
          store.getState().updateOutput(output.id, { progress: update.current });
        }
      }),
    on_cancel: cancel,
  });
  const finish = (patch: Partial<TranscodeOutput>) => {
    stopActive = null;
    store.getState().updateOutput(output.id, { ...patch, finishedAt: Date.now() });
    store.getState().setActiveOutput(null);
  };
  if (task.cancelled) {
    task.remove();
    store.getState().requestStop(true);
    finish({ status: "stopped", progress: 0 });
    return;
  }
  stopActive = async () => {
    try {
      await cancel();
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "TASK_NOT_RUNNING")
        throw normalizeError(error);
    }
  };
  try {
    const result = await invokeCommand<TranscodeResult>("transcode_media", {
      job: {
        inputPath: source.path,
        outputDir,
        outputName: output.outputName.trim(),
        overwrite: false,
        settings: output.settings,
      },
      taskId,
    });
    task.remove();
    finish({ status: "done", progress: 1, outputPath: result.outputPath });
    if (output.destination?.kind === "mediaBin") {
      void publishEvent(
        "transcode.output.completed",
        { paths: [result.outputPath, ...result.sidecarPaths] },
        transcodeIdentity,
      );
    }
  } catch (error) {
    if (cancelled || task.cancelled) {
      task.remove();
      // Cancelling the running encode stops the queue; the rest stays ready.
      store.getState().requestStop(true);
      finish({ status: "stopped", progress: 0 });
      return;
    }
    const failure = normalizeError(error);
    task.fail(error, { displayName: fileName(source.path), resourceKind: "media" });
    finish({ status: "failed", failure: { code: failure.code, errorId: failure.errorId } });
  }
}

/** Encodes every ready output in order until the queue is empty or stopped. */
export async function startTranscodeQueue() {
  const store = transcodeQueueStore;
  if (store.getState().running || !isTauriRuntime()) return;
  store.getState().setRunning(true);
  store.getState().requestStop(false);
  try {
    while (!store.getState().stopRequested) {
      const next = nextReadyOutput();
      if (!next) break;
      await runOutput(next.source, next.output);
    }
  } finally {
    store.getState().setRunning(false);
    store.getState().requestStop(false);
    store.getState().setActiveOutput(null);
  }
}

/** Stops after cancelling the running encode; unfinished outputs stay queued. */
export async function stopTranscodeQueue() {
  const store = transcodeQueueStore;
  if (!store.getState().running) return;
  store.getState().requestStop(true);
  await stopActive?.();
}

/**
 * Sends new media files of every watch folder to the queue. A file is taken
 * only once its size has stopped changing between two scans, so a copy that
 * is still in progress is left alone.
 */
export async function scanTranscodeWatchFolders({ settle = true } = {}) {
  if (!isTauriRuntime()) return 0;
  const store = transcodeQueueStore;
  let queued = 0;
  for (const folder of store.getState().watchFolders) {
    const outcome = await runOperation("transcode.prepare", () =>
      invokeCommand<ImportDirectoryListing>("list_import_directory", { directory: folder.path }),
    );
    if (outcome.status !== "success") continue;
    const processed = new Set(folder.processed);
    const ready: Array<{ path: string; key: string }> = [];
    for (const entry of outcome.value.entries) {
      if (entry.is_directory || entry.is_hidden || !mediaKind(entry.path) || entry.size <= 0)
        continue;
      const key = `${entry.path}|${entry.size}`;
      if (processed.has(key)) continue;
      const stable = !settle || watchSizes.get(entry.path) === entry.size;
      watchSizes.set(entry.path, entry.size);
      if (stable) ready.push({ path: entry.path, key });
    }
    if (ready.length === 0) continue;
    const current = store.getState().watchFolders.find((item) => item.id === folder.id);
    if (!current) continue;
    const added = enqueueTranscodeSources(
      ready.map((entry) => entry.path),
      {
        preset: findTranscodePreset(store.getState(), current.presetId),
        settings: current.settings,
        presetName: current.presetName,
        destination: current.destination,
        watchFolderId: current.id,
      },
    );
    store.getState().markWatchProcessed(
      current.id,
      ready.map((entry) => entry.key),
    );
    queued += added.length;
  }
  return queued;
}

function syncWatchTimer() {
  const { autoEncodeWatchFolders, watchFolders } = transcodeQueueStore.getState();
  const wanted = autoEncodeWatchFolders && watchFolders.length > 0;
  if (wanted && watchTimer === null) {
    watchTimer = window.setInterval(() => {
      void scanTranscodeWatchFolders().then((queued) => {
        if (queued > 0) void startTranscodeQueue();
      });
    }, watchIntervalMs);
  } else if (!wanted && watchTimer !== null) {
    window.clearInterval(watchTimer);
    watchTimer = null;
    watchSizes.clear();
  }
}
