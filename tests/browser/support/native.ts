import type { ImportEntry } from "../../../src/components/panels/ImportWorkspace/browser/importBrowserModel";
import type { Project } from "../../../src/types";
import type { ExportResult } from "../../../src/systems/ExportSystem/exportTypes";

export const mediaEntries: ImportEntry[] = (
  [
    ["nested", true],
    ["clip.MP4", false],
    ["take.WAV", false],
    ["frame.webp", false],
    ["captions.srt", false],
    ["notes.txt", false],
    [".hidden.mp4", false],
  ] as const
).map(([name, is_directory]) => ({
  name,
  path: `C:/media/${name}`,
  is_directory,
  is_hidden: String(name).startsWith("."),
  size: 1024,
  created_at: 1_700_000_000,
}));

// This runs before application imports. Only the native IPC boundary is replaced.
// Unknown commands are recorded AND rejected so swallowed application errors cannot pass.
export function installNative({ entries }: { entries: typeof mediaEntries }) {
  const w = window as any;
  // The media transport/decoder is outside these UI workflows. Do not feed fake
  // bytes to a real decoder (which would trigger the application's proxy flow).
  const setAttribute = HTMLMediaElement.prototype.setAttribute;
  HTMLMediaElement.prototype.setAttribute = function (name, value) {
    if (name === "src") {
      this.dataset.testMediaSrc = value;
      return;
    }
    setAttribute.call(this, name, value);
  };
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    get() {
      return this.dataset.testMediaSrc ?? "";
    },
    set(value) {
      this.dataset.testMediaSrc = value;
    },
  });
  HTMLMediaElement.prototype.load = () => {};
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  let sequence = 0;
  const callbacks = new Map<number, (...args: any[]) => void>();
  const projects: Record<string, Project> = {};
  // One static PNG, wrapped in the backend's thumbnail batch protocol.
  const thumbnail = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    ),
    (char) => char.charCodeAt(0),
  );
  function thumbnailBatch(args: any, cached: boolean) {
    const buffer = new ArrayBuffer(
      (cached ? 8 : 0) + args.widths.length * ((cached ? 5 : 4) + thumbnail.length),
    );
    const bytes = new Uint8Array(buffer),
      view = new DataView(buffer);
    let offset = cached ? 8 : 0;
    if (cached) view.setBigInt64(0, BigInt(args.timeUs), true);
    for (const _width of args.widths) {
      if (cached) bytes[offset++] = 1;
      view.setUint32(offset, thumbnail.length, true);
      offset += 4;
      bytes.set(thumbnail, offset);
      offset += thumbnail.length;
    }
    return Array.from(bytes);
  }
  const state = {
    calls: [] as Array<{ command: string; args: any }>,
    unexpected: [] as string[],
    expectedFailures: [] as string[],
    existingFiles: false,
    existingPaths: [] as string[],
    failures: {} as Record<string, string>,
    held: {} as Record<string, boolean>,
    pending: [] as Array<{ command: string; args: any; resolve: (value: any) => void }>,
    config: { favorites: [], lastDirectory: "C:/media", settings: {} } as any,
    savedWorkspace: null as any,
    savedProjectId: "",
    latestRelease: {
      version: "v0.0.0",
      title: "Locution Pro 0.0.0",
      body: "Current release",
      url: "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.0.0",
    },
    preferences: {
      appearance: "darkest",
      show_home_on_startup: false,
      auto_save_enabled: false,
      auto_save_current_project: false,
      auto_save_dir: "",
      cache_dir: "",
      ffmpeg_path: "ffmpeg",
      ffprobe_path: "ffprobe",
      auto_save_interval_minutes: 5,
      auto_save_max_snapshots: 20,
    },
  };
  w.__nativeTest = state;
  const result = (command: string, args: any): any => {
    switch (command) {
      case "plugin:event|listen":
        return ++sequence;
      case "plugin:event|unlisten":
      case "set_media_import_drop_region":
      case "record_frontend_incident":
      case "plugin:window|set_title":
      case "save_workspace_config":
      case "save_project_panel_state":
      case "save_project_state":
      case "prune_project_states":
      case "sync_project_workspace":
      case "close_project":
      case "open_external_url":
        return null;
      case "load_workspace_config":
      case "take_preferences_startup_error":
      case "take_launch_project_path":
      case "get_cached_video_cover_thumbnail":
      case "get_video_cover_thumbnail":
      case "get_cached_storyboard_thumbnail":
        return null;
      case "load_project_states":
        return {};
      case "find_media_needing_analysis":
        return [];
      case "recent_project_sizes":
        return {};
      case "get_cached_storyboard_thumbnails":
      case "get_cached_subtitle_thumbnails":
        return thumbnailBatch(args, true);
      case "generate_storyboard_thumbnails":
      case "generate_subtitle_thumbnails":
        return thumbnailBatch(args, false);
      case "fetch_latest_release":
        return state.latestRelease;
      case "get_preferences":
        return state.preferences;
      case "update_preferences":
        state.preferences = args.preferences;
        return state.preferences;
      case "semantic_search_available":
      case "storyboard_semantic_search_available":
      case "cancel_task":
        return false;
      case "list_import_locations":
      case "list_media_browser_roots":
        return [{ path: "C:/media", name: "测试媒体", kind: "folder" }];
      case "load_import_browser_config":
        return structuredClone(state.config);
      case "update_import_browser_config":
        Object.assign(state.config, args.patch);
        return null;
      case "list_import_directory":
      case "list_media_browser_directory":
        return {
          directory: args.directory,
          canonical_path: args.directory,
          parent: args.directory === "C:/media" ? "C:/" : "C:/media",
          entries:
            args.directory === "C:/media"
              ? entries
              : [{ ...entries[1], name: "nested.mov", path: `${args.directory}/nested.mov` }],
        };
      case "probe_import_preview":
        return {
          duration_us: 10_000_000,
          width: 1920,
          height: 1080,
          frame_rate: "24/1",
          codec: "h264",
        };
      case "media_browser_frame":
        return [];
      case "media_browser_icon":
        return null;
      case "path_is_directory":
        return args.path === "C:/media" || args.path === "C:/media/nested";
      case "path_is_file":
        return state.existingFiles || state.existingPaths.includes(args.path);
      case "export_clips": {
        const exported: ExportResult = {
          outputs: args.clips.map((clip: any) => ({
            clipId: clip.id,
            path: `C:/exports/${clip.outputName}`,
            status: "completed",
            error: null,
            durationUs: clip.endUs - clip.startUs,
          })),
          warnings: [],
        };
        return exported;
      }
      case "list_media_link_files":
        return entries
          .filter(
            (entry) =>
              !entry.is_directory &&
              args.extensions.includes(entry.path.split(".").pop()?.toLowerCase()),
          )
          .map((entry) => ({ path: entry.path, file_name: entry.name }));
      case "probe_media_link_files":
        return args.paths.map((path: string) => ({
          path,
          start_time_us: 0,
          tape_name: null,
          has_video: /\.(mp4|mov)$/i.test(path),
          has_audio: /\.wav$/i.test(path),
        }));
      case "register_import_media": {
        const id = `asset-${Object.keys(projects).length + 1}`;
        const file_name = args.path.split(/[\\/]/).pop();
        const audio = /\.wav$/i.test(args.path);
        const project: Project = {
          asset: {
            id,
            path: args.path,
            file_name,
            file_size: 1024,
            modified_at: 0,
            fingerprint: id,
            duration_us: 10_000_000,
            start_time_us: 0,
            tape_name: null,
            video_stream_index: audio ? null : 0,
            audio_stream_index: audio ? 0 : null,
          },
          streams: [
            {
              index: 0,
              codec_type: audio ? "audio" : "video",
              codec_name: audio ? "pcm_s16le" : "h264",
              avg_frame_rate: "24/1",
              width: 1920,
              height: 1080,
              disposition: {},
              language: null,
              title: null,
              channels: audio ? 2 : null,
            },
          ],
          tracks: [],
          cues: {},
          proxy_path: null,
          cache_dir: "C:/cache",
        };
        projects[id] = project;
        return { project, warnings: [] };
      }
      case "analyze_imported_media":
        return { project: projects[args.assetId], warnings: [] };
      case "copy_import_media":
        return `${args.directory}/${args.path.split(/[\\/]/).pop()}`;
      case "save_project_file":
        state.savedWorkspace = structuredClone(args.workspace);
        state.savedProjectId = args.projectId;
        return args.path;
      case "open_project_file":
        return {
          workspace: state.savedWorkspace,
          path: args.path,
          project_id: state.savedProjectId,
          warnings: [],
        };
      case "plugin:dialog|save":
        return "C:/projects/回归项目.lcp";
      case "plugin:dialog|open":
        return args.options?.directory ? "C:/exports" : "C:/projects/回归项目.lcp";
      default:
        state.unexpected.push(command);
        throw new Error(`Unexpected native command: ${command}`);
    }
  };
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (callback: (...args: any[]) => void) => {
      const id = ++sequence;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: () => "data:video/mp4;base64,",
    invoke: async (command: string, args: any = {}) => {
      state.calls.push({ command, args });
      const failure =
        state.failures[`${command}:${args.path ?? args.directory ?? ""}`] ??
        state.failures[command];
      if (failure) throw new Error(failure);
      if (state.held[command]) {
        await new Promise((resolve) => state.pending.push({ command, args, resolve }));
      }
      return result(command, args);
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}
