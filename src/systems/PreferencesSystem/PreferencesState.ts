import { invokeCommand, runOperation } from "../../errors";
import { createFfmpegTaskId } from "../../platform/tauri/ffmpegProgress";
import type { Preferences } from "../../types";
import { useStore } from "zustand";
import { useShallow } from "zustand/shallow";
import { createStore } from "zustand/vanilla";

interface PreferencesCommands {
  loadPreferences: () => Promise<void>;
  updatePreferences: (preferences: Preferences) => Promise<Preferences | null>;
}

interface PreferencesSystemState {
  preferences: Preferences;
  loaded: boolean;
  commands: PreferencesCommands;
}

type PreferencesData = Omit<PreferencesSystemState, "commands">;

export function defaultPreferences(): Preferences {
  return {
    appearance: "darkest",
    show_home_on_startup: true,
    auto_save_enabled: true,
    auto_save_current_project: true,
    auto_save_dir: "",
    cache_dir: "",
    ffmpeg_path: "ffmpeg",
    ffprobe_path: "ffprobe",
    auto_save_interval_minutes: 5,
    auto_save_max_snapshots: 20,
  };
}

const preferencesState = createStore<PreferencesSystemState>()((set) => ({
  preferences: defaultPreferences(),
  loaded: false,
  commands: {
    loadPreferences: async () => {
      // The startup diagnostic and the saved document are independent reads.
      const startupError = runOperation("preferences.load", () =>
        invokeCommand("take_preferences_startup_error"),
      );
      const loaded = runOperation("preferences.load", () =>
        invokeCommand<Preferences>("get_preferences"),
      );
      await startupError;
      const outcome = await loaded;
      if (outcome.status === "success") {
        set({ preferences: outcome.value, loaded: true });
      }
    },
    updatePreferences: async (preferences) => {
      const outcome = await runOperation("preferences.update", () =>
        invokeCommand<Preferences>("update_preferences", {
          preferences,
          taskId: createFfmpegTaskId("preferences"),
        }),
      );
      if (outcome.status !== "success") return null;
      set({ preferences: outcome.value, loaded: true });
      return outcome.value;
    },
  },
}));

export function readPreferencesState() {
  const { preferences, loaded } = preferencesState.getState();
  return { preferences, loaded };
}

export function loadPreferences() {
  return preferencesState.getState().commands.loadPreferences();
}

export function updatePreferences(preferences: Preferences) {
  return preferencesState.getState().commands.updatePreferences(preferences);
}

function usePreferencesState<Selection>(selector: (state: PreferencesSystemState) => Selection) {
  return useStore(preferencesState, selector);
}

export function usePreferencesPort<
  const StateKey extends keyof PreferencesData,
  const CommandKey extends keyof PreferencesCommands,
>(stateKeys: readonly StateKey[], commandKeys: readonly CommandKey[]) {
  return usePreferencesState(
    useShallow((state) => {
      const port = {} as Pick<PreferencesData, StateKey> & Pick<PreferencesCommands, CommandKey>;
      const writablePort = port as Record<PropertyKey, unknown>;
      for (const key of stateKeys) writablePort[key] = state[key];
      for (const key of commandKeys) writablePort[key] = state.commands[key];
      return port;
    }),
  );
}
