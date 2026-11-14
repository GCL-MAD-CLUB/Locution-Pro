import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { defaultPresetId, resolvePresetSettings, systemPresets } from "./transcodePresets";
import { fileStem } from "./transcodeOutput";
import {
  cloneTranscodeSettings,
  defaultTranscodeSettings,
  normalizeTranscodeSettings,
  type TranscodeCapabilities,
  type TranscodeDestination,
  type TranscodeOutput,
  type TranscodePreset,
  type TranscodeSettings,
  type TranscodeSource,
  type TranscodeSourceInfo,
  type TranscodeWatchFolder,
} from "./transcodeTypes";

const watchProcessedLimit = 2000;

export interface AddTranscodeSourcesOptions {
  preset?: TranscodePreset | null;
  settings?: TranscodeSettings;
  presetName?: string;
  destination?: TranscodeDestination | null;
  watchFolderId?: string | null;
}

export interface TranscodeQueueState {
  sources: TranscodeSource[];
  /** Selected source and output ids. */
  selectedIds: string[];
  userPresets: TranscodePreset[];
  watchFolders: TranscodeWatchFolder[];
  autoEncodeWatchFolders: boolean;
  lastDestination: TranscodeDestination | null;
  defaultPresetId: string;
  capabilities: TranscodeCapabilities | null;
  configLoaded: boolean;
  running: boolean;
  stopRequested: boolean;
  activeOutputId: string | null;
  /** Folder of the saved project file; empty until the project is saved. */
  projectDirectory: string;

  addSources: (paths: string[], options?: AddTranscodeSourcesOptions) => TranscodeSource[];
  setSourceInfo: (sourceId: string, info: TranscodeSourceInfo | null) => void;
  select: (ids: string[]) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  resetSelected: () => void;
  clearFinished: () => void;
  addOutput: (sourceId: string) => void;
  updateOutput: (outputId: string, patch: Partial<TranscodeOutput>) => void;
  applyPreset: (outputIds: string[], preset: TranscodePreset) => void;
  setDestination: (outputIds: string[], destination: TranscodeDestination) => void;
  saveUserPreset: (name: string, settings: TranscodeSettings, comment?: string) => TranscodePreset;
  deleteUserPreset: (presetId: string) => void;
  addWatchFolder: (path: string) => void;
  updateWatchFolder: (folderId: string, patch: Partial<TranscodeWatchFolder>) => void;
  removeWatchFolder: (folderId: string) => void;
  markWatchProcessed: (folderId: string, keys: string[]) => void;
  setAutoEncodeWatchFolders: (enabled: boolean) => void;
  setCapabilities: (capabilities: TranscodeCapabilities | null) => void;
  setProjectDirectory: (directory: string) => void;
  setRunning: (running: boolean) => void;
  requestStop: (requested: boolean) => void;
  setActiveOutput: (outputId: string | null) => void;
  restore: (config: unknown) => void;
}

function newId(prefix: string) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function allTranscodePresets(state: Pick<TranscodeQueueState, "userPresets">) {
  return [...systemPresets, ...state.userPresets];
}

export function findTranscodePreset(
  state: Pick<TranscodeQueueState, "userPresets">,
  presetId: string | null,
) {
  return allTranscodePresets(state).find((preset) => preset.id === presetId) ?? null;
}

/** The preset new sources start with: the last one used, when it still works here. */
function startingPreset(state: TranscodeQueueState): {
  preset: TranscodePreset | null;
  settings: TranscodeSettings;
} {
  const candidates = [
    findTranscodePreset(state, state.defaultPresetId),
    findTranscodePreset(state, defaultPresetId),
    ...systemPresets,
  ];
  for (const preset of candidates) {
    const settings = preset ? resolvePresetSettings(preset, state.capabilities) : null;
    if (preset && settings) return { preset, settings };
  }
  return { preset: null, settings: defaultTranscodeSettings() };
}

function newOutput(
  sourcePath: string,
  presetId: string | null,
  presetName: string,
  settings: TranscodeSettings,
  destination: TranscodeDestination | null,
): TranscodeOutput {
  return {
    id: newId("transcode-output"),
    presetId,
    presetName,
    settings: cloneTranscodeSettings(settings),
    destination: destination ? { ...destination } : null,
    outputName: fileStem(sourcePath),
    status: "ready",
    progress: 0,
    outputPath: null,
    failure: null,
    startedAt: null,
    finishedAt: null,
  };
}

function resetOutput(output: TranscodeOutput): TranscodeOutput {
  return {
    ...output,
    status: "ready",
    progress: 0,
    outputPath: null,
    failure: null,
    startedAt: null,
    finishedAt: null,
  };
}

function mapOutputs(
  sources: TranscodeSource[],
  outputIds: readonly string[],
  update: (output: TranscodeOutput) => TranscodeOutput,
) {
  const ids = new Set(outputIds);
  return sources.map((source) =>
    source.outputs.some((output) => ids.has(output.id))
      ? {
          ...source,
          outputs: source.outputs.map((output) => (ids.has(output.id) ? update(output) : output)),
        }
      : source,
  );
}

/** Output ids named by a selection of source and output ids. */
export function selectedOutputIds(
  sources: readonly TranscodeSource[],
  selectedIds: readonly string[],
) {
  const selected = new Set(selectedIds);
  return sources.flatMap((source) =>
    source.outputs
      .filter((output) => selected.has(source.id) || selected.has(output.id))
      .map((output) => output.id),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreDestination(value: unknown): TranscodeDestination | null {
  if (!isRecord(value)) return null;
  if (value.kind === "mediaBin") return { kind: "mediaBin" };
  if (value.kind === "folder" && typeof value.directory === "string")
    return { kind: "folder", directory: value.directory };
  return null;
}

function restorePreset(value: unknown): TranscodePreset | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string")
    return null;
  return {
    id: value.id,
    name: value.name,
    group: "用户预设及组",
    system: false,
    comment: typeof value.comment === "string" ? value.comment : undefined,
    settings: normalizeTranscodeSettings(value.settings),
  };
}

function restoreOutput(value: unknown, sourcePath: string): TranscodeOutput | null {
  if (!isRecord(value)) return null;
  const output = newOutput(
    sourcePath,
    typeof value.presetId === "string" ? value.presetId : null,
    typeof value.presetName === "string" ? value.presetName : "自定义",
    normalizeTranscodeSettings(value.settings),
    restoreDestination(value.destination),
  );
  const finished = value.status === "done" || value.status === "failed";
  return {
    ...output,
    outputName: typeof value.outputName === "string" ? value.outputName : output.outputName,
    // An encode interrupted by quitting starts over; finished results are kept.
    status: finished ? (value.status as TranscodeOutput["status"]) : "ready",
    progress: value.status === "done" ? 1 : 0,
    outputPath: finished && typeof value.outputPath === "string" ? value.outputPath : null,
  };
}

function restoreSource(value: unknown): TranscodeSource | null {
  if (!isRecord(value) || typeof value.path !== "string" || !Array.isArray(value.outputs))
    return null;
  const path = value.path;
  const outputs = value.outputs.flatMap((output) => restoreOutput(output, path) ?? []);
  if (outputs.length === 0) return null;
  return {
    id: newId("transcode-source"),
    path,
    info: null,
    infoStatus: "pending",
    watchFolderId: typeof value.watchFolderId === "string" ? value.watchFolderId : null,
    outputs,
  };
}

function restoreWatchFolder(value: unknown): TranscodeWatchFolder | null {
  if (!isRecord(value) || typeof value.path !== "string" || !value.path) return null;
  return {
    id: typeof value.id === "string" ? value.id : newId("transcode-watch"),
    path: value.path,
    presetId: typeof value.presetId === "string" ? value.presetId : null,
    presetName: typeof value.presetName === "string" ? value.presetName : "自定义",
    settings: normalizeTranscodeSettings(value.settings),
    destination: restoreDestination(value.destination) ?? {
      kind: "folder",
      directory: watchOutputDirectory(value.path),
    },
    processed: Array.isArray(value.processed)
      ? value.processed.filter((key): key is string => typeof key === "string")
      : [],
  };
}

export function watchOutputDirectory(path: string) {
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  return `${path.replace(/[\\/]+$/u, "")}${separator}Output`;
}

/** The persisted part of the store; runtime status never leaves the session. */
export function transcodeConfigSnapshot(state: TranscodeQueueState) {
  return {
    version: 1,
    userPresets: state.userPresets.map(({ id, name, comment, settings }) => ({
      id,
      name,
      comment,
      settings,
    })),
    watchFolders: state.watchFolders,
    autoEncodeWatchFolders: state.autoEncodeWatchFolders,
    lastDestination: state.lastDestination,
    defaultPresetId: state.defaultPresetId,
    queue: state.sources.map((source) => ({
      path: source.path,
      watchFolderId: source.watchFolderId,
      outputs: source.outputs.map((output) => ({
        presetId: output.presetId,
        presetName: output.presetName,
        settings: output.settings,
        destination: output.destination,
        outputName: output.outputName,
        status: output.status,
        outputPath: output.outputPath,
      })),
    })),
  };
}

export const transcodeQueueStore = createStore<TranscodeQueueState>()((set, get) => ({
  sources: [],
  selectedIds: [],
  userPresets: [],
  watchFolders: [],
  autoEncodeWatchFolders: false,
  lastDestination: null,
  defaultPresetId,
  capabilities: null,
  configLoaded: false,
  running: false,
  stopRequested: false,
  activeOutputId: null,
  projectDirectory: "",

  addSources: (paths, options = {}) => {
    const state = get();
    const known = new Set(
      // The same file may be queued again once its earlier outputs finished.
      state.sources
        .filter((source) => source.outputs.some((output) => output.status === "ready"))
        .map((source) => source.path),
    );
    const start = options.settings
      ? { preset: options.preset ?? null, settings: options.settings }
      : options.preset
        ? {
            preset: options.preset,
            settings:
              resolvePresetSettings(options.preset, state.capabilities) ?? options.preset.settings,
          }
        : startingPreset(state);
    const destination =
      options.destination === undefined ? state.lastDestination : options.destination;
    const added: TranscodeSource[] = [];
    for (const path of paths) {
      if (!path || known.has(path)) continue;
      known.add(path);
      added.push({
        id: newId("transcode-source"),
        path,
        info: null,
        infoStatus: "pending",
        watchFolderId: options.watchFolderId ?? null,
        outputs: [
          newOutput(
            path,
            start.preset?.id ?? null,
            options.presetName ?? start.preset?.name ?? "自定义",
            start.settings,
            destination,
          ),
        ],
      });
    }
    if (added.length > 0) {
      set({
        sources: [...state.sources, ...added],
        selectedIds: added.map((source) => source.outputs[0].id),
      });
    }
    return added;
  },

  setSourceInfo: (sourceId, info) =>
    set((state) => ({
      sources: state.sources.map((source) =>
        source.id === sourceId
          ? { ...source, info, infoStatus: info ? "ready" : "failed" }
          : source,
      ),
    })),

  select: (ids) => set({ selectedIds: [...new Set(ids)] }),

  removeSelected: () =>
    set((state) => {
      const selected = new Set(state.selectedIds);
      const sources = state.sources.flatMap((source) => {
        if (source.outputs.some((output) => output.status === "encoding")) {
          // The running encode is stopped first, never removed underneath itself.
          const outputs = source.outputs.filter(
            (output) => output.status === "encoding" || !selected.has(output.id),
          );
          return [{ ...source, outputs }];
        }
        if (selected.has(source.id)) return [];
        const outputs = source.outputs.filter((output) => !selected.has(output.id));
        return outputs.length > 0 ? [{ ...source, outputs }] : [];
      });
      return { sources, selectedIds: [] };
    }),

  duplicateSelected: () =>
    set((state) => {
      const selected = new Set(state.selectedIds);
      const copies: string[] = [];
      const sources = state.sources.flatMap((source) => {
        if (selected.has(source.id)) {
          const copy: TranscodeSource = {
            ...source,
            id: newId("transcode-source"),
            outputs: source.outputs.map((output) =>
              resetOutput({ ...output, id: newId("transcode-output") }),
            ),
          };
          copies.push(copy.id);
          return [source, copy];
        }
        const outputs = source.outputs.flatMap((output) => {
          if (!selected.has(output.id)) return [output];
          const copy = resetOutput({ ...output, id: newId("transcode-output") });
          copies.push(copy.id);
          return [output, copy];
        });
        return [{ ...source, outputs }];
      });
      return copies.length > 0 ? { sources, selectedIds: copies } : state;
    }),

  resetSelected: () =>
    set((state) => ({
      sources: mapOutputs(
        state.sources,
        selectedOutputIds(state.sources, state.selectedIds),
        (output) => (output.status === "encoding" ? output : resetOutput(output)),
      ),
    })),

  clearFinished: () =>
    set((state) => ({
      sources: state.sources.flatMap((source) => {
        const outputs = source.outputs.filter((output) => output.status !== "done");
        return outputs.length > 0 ? [{ ...source, outputs }] : [];
      }),
    })),

  addOutput: (sourceId) =>
    set((state) => {
      const source = state.sources.find((candidate) => candidate.id === sourceId);
      if (!source) return state;
      const template = source.outputs.at(-1);
      const output = template
        ? resetOutput({
            ...template,
            id: newId("transcode-output"),
            settings: cloneTranscodeSettings(template.settings),
          })
        : newOutput(source.path, null, "自定义", defaultTranscodeSettings(), state.lastDestination);
      return {
        sources: state.sources.map((candidate) =>
          candidate.id === sourceId
            ? { ...candidate, outputs: [...candidate.outputs, output] }
            : candidate,
        ),
        selectedIds: [output.id],
      };
    }),

  updateOutput: (outputId, patch) =>
    set((state) => ({
      sources: mapOutputs(state.sources, [outputId], (output) => ({ ...output, ...patch })),
      lastDestination: patch.destination ?? state.lastDestination,
    })),

  applyPreset: (outputIds, preset) =>
    set((state) => {
      const settings = resolvePresetSettings(preset, state.capabilities);
      if (!settings) return state;
      return {
        defaultPresetId: preset.id,
        sources: mapOutputs(state.sources, outputIds, (output) =>
          output.status === "encoding"
            ? output
            : resetOutput({
                ...output,
                presetId: preset.id,
                presetName: preset.name,
                settings: cloneTranscodeSettings(settings),
              }),
        ),
      };
    }),

  setDestination: (outputIds, destination) =>
    set((state) => ({
      lastDestination: destination,
      sources: mapOutputs(state.sources, outputIds, (output) =>
        output.status === "encoding" ? output : { ...output, destination: { ...destination } },
      ),
    })),

  saveUserPreset: (name, settings, comment) => {
    const preset: TranscodePreset = {
      id: newId("user"),
      name: name.trim() || "未命名预设",
      group: "用户预设及组",
      system: false,
      comment,
      settings: cloneTranscodeSettings(settings),
    };
    set((state) => ({ userPresets: [...state.userPresets, preset] }));
    return preset;
  },

  deleteUserPreset: (presetId) =>
    set((state) => ({
      userPresets: state.userPresets.filter((preset) => preset.id !== presetId),
      defaultPresetId: state.defaultPresetId === presetId ? defaultPresetId : state.defaultPresetId,
    })),

  addWatchFolder: (path) =>
    set((state) => {
      if (!path || state.watchFolders.some((folder) => folder.path === path)) return state;
      const start = startingPreset(state);
      return {
        watchFolders: [
          ...state.watchFolders,
          {
            id: newId("transcode-watch"),
            path,
            presetId: start.preset?.id ?? null,
            presetName: start.preset?.name ?? "自定义",
            settings: cloneTranscodeSettings(start.settings),
            destination: { kind: "folder", directory: watchOutputDirectory(path) },
            processed: [],
          },
        ],
      };
    }),

  updateWatchFolder: (folderId, patch) =>
    set((state) => ({
      watchFolders: state.watchFolders.map((folder) =>
        folder.id === folderId ? { ...folder, ...patch } : folder,
      ),
    })),

  removeWatchFolder: (folderId) =>
    set((state) => ({
      watchFolders: state.watchFolders.filter((folder) => folder.id !== folderId),
    })),

  markWatchProcessed: (folderId, keys) =>
    set((state) => ({
      watchFolders: state.watchFolders.map((folder) =>
        folder.id === folderId
          ? {
              ...folder,
              processed: [...new Set([...folder.processed, ...keys])].slice(-watchProcessedLimit),
            }
          : folder,
      ),
    })),

  setAutoEncodeWatchFolders: (autoEncodeWatchFolders) => set({ autoEncodeWatchFolders }),
  setCapabilities: (capabilities) => set({ capabilities }),
  setProjectDirectory: (projectDirectory) => set({ projectDirectory }),
  setRunning: (running) => set({ running }),
  requestStop: (stopRequested) => set({ stopRequested }),
  setActiveOutput: (activeOutputId) => set({ activeOutputId }),

  restore: (config) => {
    if (!isRecord(config)) {
      set({ configLoaded: true });
      return;
    }
    const list = (value: unknown) => (Array.isArray(value) ? value : []);
    set((state) => ({
      configLoaded: true,
      userPresets: list(config.userPresets).flatMap((preset) => restorePreset(preset) ?? []),
      watchFolders: list(config.watchFolders).flatMap((folder) => restoreWatchFolder(folder) ?? []),
      autoEncodeWatchFolders: config.autoEncodeWatchFolders === true,
      lastDestination: restoreDestination(config.lastDestination),
      defaultPresetId:
        typeof config.defaultPresetId === "string" ? config.defaultPresetId : defaultPresetId,
      // Sources queued before the config finished loading stay ahead of nothing.
      sources: [
        ...list(config.queue).flatMap((source) => restoreSource(source) ?? []),
        ...state.sources,
      ],
    }));
  },
}));

export function useTranscodeQueueState<Selection>(
  selector: (state: TranscodeQueueState) => Selection,
) {
  return useStore(transcodeQueueStore, selector);
}
