import { createModuleLoader, deferred } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { useShallow } from "zustand/shallow";
import type { Preferences } from "../../../src/types.ts";

const loadModule = createModuleLoader(import.meta.url);

interface PreferencesModule {
  defaultPreferences(): Preferences;
  loadPreferences(): Promise<void>;
  readPreferencesState(): { preferences: Preferences; loaded: boolean };
  updatePreferences(preferences: Preferences): Promise<Preferences | null>;
}

function preferencesModule(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  return loadModule<PreferencesModule>(
    "../../../src/systems/PreferencesSystem/PreferencesState.ts",
    {
      zustand: { useStore: () => assert.fail("the test calls the store directly") },
      "zustand/shallow": { useShallow },
      "zustand/vanilla": { createStore },
      "../../errors": {
        invokeCommand: invoke,
        async runOperation(_operation: string, action: () => Promise<unknown>) {
          try {
            return { status: "success", value: await action() };
          } catch (error) {
            return { status: "failed", error };
          }
        },
      },
      "../../platform/tauri/ffmpegProgress": {
        createFfmpegTaskId: () => "preferences:test",
      },
    },
  );
}

function savedPreferences(patch: Partial<Preferences> = {}): Preferences {
  return {
    appearance: "light",
    show_home_on_startup: false,
    auto_save_enabled: false,
    auto_save_current_project: false,
    auto_save_dir: "autosave",
    cache_dir: "cache",
    ffmpeg_path: "ffmpeg",
    ffprobe_path: "ffprobe",
    auto_save_interval_minutes: 11,
    auto_save_max_snapshots: 4,
    ...patch,
  };
}

test("loading reads the startup diagnostic and saved preferences together", async () => {
  const started = deferred<void>();
  const calls: string[] = [];
  const saved = savedPreferences();
  const system = preferencesModule(async (command) => {
    calls.push(command);
    if (command === "take_preferences_startup_error") {
      await started.promise;
      return null;
    }
    started.resolve();
    return saved;
  });
  assert.equal(system.readPreferencesState().loaded, false);
  assert.equal(system.readPreferencesState().preferences.appearance, "darkest");
  await system.loadPreferences();
  assert.deepEqual(calls, ["take_preferences_startup_error", "get_preferences"]);
  assert.equal(system.readPreferencesState().loaded, true);
  assert.deepEqual(system.readPreferencesState().preferences, saved);
});

test("a failed load leaves the defaults unloaded", async () => {
  const system = preferencesModule(async (command) => {
    if (command === "get_preferences") throw new Error("unreadable");
    return null;
  });
  await system.loadPreferences();
  const state = system.readPreferencesState();
  assert.equal(state.loaded, false);
  assert.deepEqual(state.preferences, system.defaultPreferences());
});

test("updating stores the persisted document and a failure keeps the previous one", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  let failSave = false;
  let defaults: Preferences | undefined;
  const system = preferencesModule(async (command, args) => {
    calls.push({ command, args });
    if (command === "get_preferences") return defaults;
    if (failSave) throw new Error("disk full");
    const preferences = args?.preferences;
    if (!preferences || typeof preferences !== "object") throw new Error("missing preferences");
    return { ...preferences, cache_dir: "normalized-cache" };
  });
  defaults = system.defaultPreferences();
  await system.loadPreferences();
  const next = savedPreferences({ cache_dir: "typed-cache" });
  const saved = await system.updatePreferences(next);
  assert.equal(saved?.cache_dir, "normalized-cache");
  assert.equal(system.readPreferencesState().preferences.cache_dir, "normalized-cache");
  const update = calls.find((call) => call.command === "update_preferences");
  assert.equal(update?.args?.taskId, "preferences:test");
  assert.equal(
    (update?.args?.preferences as Preferences | undefined)?.auto_save_interval_minutes,
    11,
  );
  failSave = true;
  assert.equal(await system.updatePreferences(savedPreferences({ cache_dir: "other" })), null);
  assert.equal(system.readPreferencesState().preferences.cache_dir, "normalized-cache");
  assert.equal(system.readPreferencesState().loaded, true);
});
