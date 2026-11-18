import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { readAppStorage } from "../../runtime/storage";
import { getProjectExportContext } from "../ProjectSystem";
import type {
  ExportClip,
  ExportResult,
  ExportSettings,
  ExportSource,
} from "../../core/editor/export/exportTypes";
import { constrainExportSettings } from "./exportSettingsConstraints";

const exportDirStorageKey = "locution-pro:export-dir";

/** Reads the last export directory the user picked, if any. */
export function readRememberedExportDir() {
  try {
    return readAppStorage(exportDirStorageKey) ?? "";
  } catch {
    return "";
  }
}

/** Remembers the export directory so the next export can default to it. */
export function rememberExportDir(dir: string) {
  try {
    window.localStorage.setItem(exportDirStorageKey, dir);
  } catch {
    // Remembering the export directory is a convenience; export itself must still work.
  }
}

export type ExportWorkspaceStatus = "idle" | "running" | "done";

interface ExportRangeHistoryEntry {
  clipId: string;
  before: { startUs: number; endUs: number };
  after: { startUs: number; endUs: number };
  groupId: string | undefined;
}

function withClipRange(clip: ExportClip, range: { startUs: number; endUs: number }): ExportClip {
  return {
    ...clip,
    ...range,
    durationUs:
      range.endUs > 0
        ? Math.max(0, range.endUs - range.startUs)
        : Math.max(0, (clip.sourceMedia?.durationUs ?? clip.durationUs) - range.startUs),
    thumbnail: clip.thumbnail ? { ...clip.thumbnail, timeUs: range.startUs } : undefined,
  };
}

export interface ExportWorkspaceState {
  source: ExportSource | null;
  sourceInput: ExportSource | null;
  sourceProjectId: string | null;
  rangeHistory: ExportRangeHistoryEntry[];
  rangeHistoryCursor: number;
  selectedClipIds: Set<string>;
  settings: ExportSettings;
  /** Project id whose recorded settings back `settings`; null before any project load. */
  settingsProjectId: string | null;
  results: ExportResult | null;
  status: ExportWorkspaceStatus;
  previewClipId: string | null;
  previewVersion: number;
  setSource: (source: ExportSource | null) => void;
  /**
   * Stores the source the export UI is showing and re-constrains settings.
   * The UI refreshes audio bindings without reselecting the export source.
   */
  adoptExportSource: (source: ExportSource | null) => void;
  /** Loads the open project's recorded export settings when the project changed. */
  applyProjectExportSettings: () => void;
  toggleClip: (clipId: string, source?: ExportSource | null) => void;
  setAllSelected: (selected: boolean, source?: ExportSource | null) => void;
  updateSettings: (updates: Partial<ExportSettings>, source?: ExportSource | null) => void;
  setResults: (results: ExportResult | null) => void;
  setStatus: (status: ExportWorkspaceStatus) => void;
  resetResults: () => void;
  setPreviewClip: (clipId: string | null, source?: ExportSource | null) => void;
  updateClipRange: (clipId: string, startUs: number, endUs: number, groupId?: string) => void;
  undoClipRange: () => void;
  redoClipRange: () => void;
}

export function canEditExportClipRange(state: Pick<ExportWorkspaceState, "source">) {
  return state.source !== null;
}

export function defaultExportSettings(): ExportSettings {
  return {
    mode: "individual",
    container: "mp4_h264",
    resolution: "match_source",
    customWidth: 1920,
    customHeight: 1080,
    frameRate: null,
    quality: "high",
    encoderSpeed: "balanced",
    hardwareAcceleration: "auto",
    includeVideo: true,
    includeAudio: true,
    audioCodec: "aac",
    audioSampleRateHz: null,
    audioChannels: "stereo",
    audioBitrateKbps: 192,
    importIntoProject: false,
    useProxy: false,
    destination: "specified",
    useSubfolder: false,
    subfolderName: "",
    outputDir: "",
    outputStem: "",
    renameRule: "filename",
    customName: "",
    startNumber: 1,
    extensionCase: "lower",
    // Key order must match the backend's ExportOptions serialization; exportSettingsEqual compares via JSON.stringify.
    outputName: "",
    existingFileMode: "ask",
  };
}

/** Audio fields that change when a binding is edited away from the export workspace. */
export function exportAudioBindingKey(source: ExportSource | null) {
  if (!source) return "";
  return JSON.stringify(
    source.clips.map((clip) => [
      clip.id,
      clip.hasAudio,
      clip.audioSources,
      clip.sourceMedia?.audioChannels ?? null,
    ]),
  );
}

function authoritativeSource(stored: ExportSource | null, source?: ExportSource | null) {
  if (source === undefined) return stored;
  if (exportAudioBindingKey(source) === exportAudioBindingKey(stored)) return stored;
  return source;
}

function constrainedSettings(
  settings: ExportSettings,
  source: ExportSource | null,
  selectedClipIds: ReadonlySet<string>,
  previewClipId: string | null,
) {
  return constrainExportSettings(settings, { source, selectedClipIds, previewClipId });
}

function reconcileSettings(
  settings: ExportSettings,
  settingsProjectId: string | null,
): { settings: ExportSettings; settingsProjectId: string | null } {
  const { projectId, exportState } = getProjectExportContext();
  if (projectId === settingsProjectId) {
    return { settings, settingsProjectId };
  }
  return {
    settings: exportState
      ? { ...defaultExportSettings(), ...exportState }
      : defaultExportSettings(),
    settingsProjectId: projectId,
  };
}

export const exportWorkspaceStore = createStore<ExportWorkspaceState>()((set) => ({
  source: null,
  sourceInput: null,
  sourceProjectId: null,
  rangeHistory: [],
  rangeHistoryCursor: 0,
  selectedClipIds: new Set<string>(),
  settings: defaultExportSettings(),
  settingsProjectId: null,
  results: null,
  status: "idle",
  previewClipId: null,
  previewVersion: 0,
  setSource: (source) =>
    set((state) => {
      const { projectId } = getProjectExportContext();
      if (source === state.sourceInput && projectId === state.sourceProjectId) return state;
      const sameProject = projectId === state.sourceProjectId;
      const previousClips = new Map(
        sameProject ? state.source?.clips.map((clip) => [clip.id, clip] as const) : [],
      );
      const retainedIds = new Set<string>();
      const nextSource = source
        ? {
            ...source,
            clips: source.clips.map((clip) => {
              const previous = previousClips.get(clip.id);
              if (!previous || previous.sourcePath !== clip.sourcePath) return clip;
              retainedIds.add(clip.id);
              return withClipRange(clip, previous);
            }),
          }
        : null;
      const rangeHistory = sameProject
        ? state.rangeHistory.filter((entry) => retainedIds.has(entry.clipId))
        : [];
      const rangeHistoryCursor = sameProject
        ? state.rangeHistory
            .slice(0, state.rangeHistoryCursor)
            .filter((entry) => retainedIds.has(entry.clipId)).length
        : 0;
      const reconciled = reconcileSettings(state.settings, state.settingsProjectId);
      const selectedClipIds = nextSource
        ? new Set(nextSource.clips.map((clip) => clip.id))
        : new Set<string>();
      const previewClipId = nextSource?.clips[0]?.id ?? null;
      return {
        source: nextSource,
        sourceInput: source,
        sourceProjectId: projectId,
        rangeHistory,
        rangeHistoryCursor,
        selectedClipIds,
        previewClipId,
        previewVersion: state.previewVersion + 1,
        // The output stem is derived by the export workspace from the project/source,
        // so it is left untouched here.
        settings: constrainedSettings(
          reconciled.settings,
          nextSource,
          selectedClipIds,
          previewClipId,
        ),
        settingsProjectId: reconciled.settingsProjectId,
        results: null,
        status: "idle",
      };
    }),
  adoptExportSource: (source) =>
    set((state) => {
      if (!source || exportAudioBindingKey(source) === exportAudioBindingKey(state.source)) {
        return state;
      }
      const settings = constrainedSettings(
        state.settings,
        source,
        state.selectedClipIds,
        state.previewClipId,
      );
      return settings === state.settings ? { source } : { source, settings };
    }),
  applyProjectExportSettings: () =>
    set((state) => {
      const reconciled = reconcileSettings(state.settings, state.settingsProjectId);
      const settings = constrainedSettings(
        reconciled.settings,
        state.source,
        state.selectedClipIds,
        state.previewClipId,
      );
      if (settings === state.settings && reconciled.settingsProjectId === state.settingsProjectId) {
        return state;
      }
      return { settings, settingsProjectId: reconciled.settingsProjectId };
    }),
  toggleClip: (clipId, source) =>
    set((state) => {
      const authoritative = authoritativeSource(state.source, source);
      const selectedClipIds = new Set(state.selectedClipIds);
      if (selectedClipIds.has(clipId)) {
        selectedClipIds.delete(clipId);
      } else {
        selectedClipIds.add(clipId);
      }
      const settings = constrainedSettings(
        state.settings,
        authoritative,
        selectedClipIds,
        state.previewClipId,
      );
      return {
        ...(authoritative === state.source ? {} : { source: authoritative }),
        selectedClipIds,
        ...(settings === state.settings ? {} : { settings }),
      };
    }),
  setAllSelected: (selected, source) =>
    set((state) => {
      const authoritative = authoritativeSource(state.source, source);
      const selectedClipIds =
        selected && authoritative
          ? new Set(authoritative.clips.map((clip) => clip.id))
          : new Set<string>();
      const settings = constrainedSettings(
        state.settings,
        authoritative,
        selectedClipIds,
        state.previewClipId,
      );
      return {
        ...(authoritative === state.source ? {} : { source: authoritative }),
        selectedClipIds,
        ...(settings === state.settings ? {} : { settings }),
      };
    }),
  updateSettings: (updates, source) =>
    set((state) => {
      const authoritative = authoritativeSource(state.source, source);
      const settings = constrainedSettings(
        { ...state.settings, ...updates },
        authoritative,
        state.selectedClipIds,
        state.previewClipId,
      );
      if (authoritative === state.source && settings === state.settings) return state;
      return {
        ...(authoritative === state.source ? {} : { source: authoritative }),
        settings,
      };
    }),
  setResults: (results) => set({ results }),
  setStatus: (status) => set({ status }),
  resetResults: () => set({ results: null, status: "idle" }),
  setPreviewClip: (previewClipId, source) =>
    set((state) => {
      const authoritative = authoritativeSource(state.source, source);
      const settings = constrainedSettings(
        state.settings,
        authoritative,
        state.selectedClipIds,
        previewClipId,
      );
      return {
        ...(authoritative === state.source ? {} : { source: authoritative }),
        previewClipId,
        previewVersion: state.previewVersion + 1,
        ...(settings === state.settings ? {} : { settings }),
      };
    }),
  updateClipRange: (clipId, startUs, endUs, groupId) =>
    set((state) => {
      if (!canEditExportClipRange(state)) return state;
      const clip = state.source?.clips.find((candidate) => candidate.id === clipId);
      if (!clip || (clip.startUs === startUs && clip.endUs === endUs)) return state;
      const before = { startUs: clip.startUs, endUs: clip.endUs };
      const after = { startUs, endUs };
      const history = state.rangeHistory.slice(0, state.rangeHistoryCursor);
      const last = history.at(-1);
      if (groupId && last?.groupId === groupId && last.clipId === clipId) {
        history[history.length - 1] = { ...last, after };
      } else {
        history.push({ clipId, before, after, groupId });
      }
      return {
        source: {
          ...state.source!,
          clips: state.source!.clips.map((candidate) =>
            candidate.id === clipId ? withClipRange(candidate, after) : candidate,
          ),
        },
        rangeHistory: history,
        rangeHistoryCursor: history.length,
      };
    }),
  undoClipRange: () =>
    set((state) => {
      if (!canEditExportClipRange(state) || !state.source || state.rangeHistoryCursor === 0)
        return state;
      const entry = state.rangeHistory[state.rangeHistoryCursor - 1];
      return {
        source: {
          ...state.source,
          clips: state.source.clips.map((clip) =>
            clip.id === entry.clipId ? withClipRange(clip, entry.before) : clip,
          ),
        },
        rangeHistoryCursor: state.rangeHistoryCursor - 1,
      };
    }),
  redoClipRange: () =>
    set((state) => {
      if (
        !canEditExportClipRange(state) ||
        !state.source ||
        state.rangeHistoryCursor >= state.rangeHistory.length
      )
        return state;
      const entry = state.rangeHistory[state.rangeHistoryCursor];
      return {
        source: {
          ...state.source,
          clips: state.source.clips.map((clip) =>
            clip.id === entry.clipId ? withClipRange(clip, entry.after) : clip,
          ),
        },
        rangeHistoryCursor: state.rangeHistoryCursor + 1,
      };
    }),
}));

export function useExportWorkspaceState<Selection>(
  selector: (state: ExportWorkspaceState) => Selection,
) {
  return useStore(exportWorkspaceStore, selector);
}
