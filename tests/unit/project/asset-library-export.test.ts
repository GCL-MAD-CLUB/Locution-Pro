import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import type {
  AssetLibraryEntry,
  AssetLibraryFolder,
  AssetLibraryRoot,
  MediaBinItem,
  MediaDocument,
  ProjectAssetLibraryState,
} from "../../../src/types.ts";

type ExportModule = typeof import("../../../src/core/editor/assetLibrary/assetLibraryExport.ts");
type ResolversModule = typeof import("../../../src/systems/ExportSystem/exportResolvers.ts");

const load = createModuleLoader(import.meta.url);
const timeline = load<typeof import("../../../src/core/editor/playback/timeline.ts")>(
  "../../../src/core/editor/playback/timeline.ts",
);
const assetLibrary = load<typeof import("../../../src/core/editor/assetLibrary/assetLibrary.ts")>(
  "../../../src/core/editor/assetLibrary/assetLibrary.ts",
  { "../playback/timeline": timeline },
);
const visibility = load<
  typeof import("../../../src/core/editor/assetLibrary/assetLibraryVisibility.ts")
>("../../../src/core/editor/assetLibrary/assetLibraryVisibility.ts");
const exporting = load<ExportModule>(
  "../../../src/core/editor/assetLibrary/assetLibraryExport.ts",
  {
    "./assetLibrary": assetLibrary,
    "./assetLibraryVisibility": visibility,
  },
);
const json = (value: unknown) => JSON.stringify(value);

function folder(
  id: string,
  parentId: string | null,
  hidden = false,
  root: AssetLibraryRoot = "subtitles",
): AssetLibraryFolder {
  return { id, root, parent_id: parentId, name: id, created_at: 1, hidden };
}

function entry(
  id: string,
  folderId: string | null,
  { hidden = false, root = "subtitles" as AssetLibraryRoot, videoId = "v1" } = {},
): AssetLibraryEntry {
  return {
    id,
    root,
    folder_id: folderId,
    name: `素材 ${id}`,
    created_at: 1,
    media: {
      video_id: videoId,
      path: "D:/a.mp4",
      file_name: "a.mp4",
      fingerprint: "fp",
      frame_rate: 25,
      duration_us: 10_000_000,
    },
    start_us: 1_000_000,
    end_us: 2_000_000,
    text: "",
    annotation: {
      rating: 0,
      retained: false,
      excluded: false,
      color_label: null,
      custom_label: null,
      title: null,
      keywords: root === "storyboards" ? ["人物", "室内"] : [],
    },
    hidden,
  };
}

// a ─ b(hidden) ─ c ; a holds e1, b holds e2, c holds e3; e4 sits at the top, e5 is hidden.
const library: ProjectAssetLibraryState = {
  folders: [folder("a", null), folder("b", "a", true), folder("c", "b")],
  entries: [
    entry("e1", "a"),
    entry("e2", "b"),
    entry("e3", "c"),
    entry("e4", null),
    entry("e5", "a", { hidden: true }),
    entry("s1", null, { root: "storyboards" }),
  ],
};
const ids = (entries: readonly AssetLibraryEntry[]) => entries.map((item) => item.id);
const none = { roots: [], folderIds: [], entryIds: [] };

test("folders export everything inside them, each material once and in library order", () => {
  const picked = exporting.assetLibraryExportEntries(
    library,
    { ...none, folderIds: ["a"], entryIds: ["e4", "e1"] },
    true,
  );
  assert.equal(json(ids(picked)), json(["e1", "e2", "e3", "e4", "e5"]));
});

test("hidden materials and hidden folders stay out unless chosen directly", () => {
  const fromFolder = exporting.assetLibraryExportEntries(
    library,
    { ...none, folderIds: ["a"] },
    false,
  );
  assert.equal(json(ids(fromFolder)), json(["e1"]));
  const hiddenFolder = exporting.assetLibraryExportEntries(
    library,
    { ...none, folderIds: ["b"], entryIds: ["e5"] },
    false,
  );
  assert.equal(json(ids(hiddenFolder)), json(["e2", "e3", "e5"]));
});

test("a library exports its own materials only", () => {
  const picked = exporting.assetLibraryExportEntries(
    library,
    { ...none, roots: ["storyboards"] },
    false,
  );
  assert.equal(json(ids(picked)), json(["s1"]));
});

function resolvers() {
  const project = {
    asset: {
      id: "asset-1",
      path: "D:/a.mp4",
      file_name: "a.mp4",
      fingerprint: "fp",
      duration_us: 10_000_000,
      file_size: 1,
      video_stream_index: 0,
    },
    streams: [],
    proxy_path: null,
  } as unknown as MediaDocument;
  const mediaItems = [
    { id: "v1", kind: "video", file_name: "访谈.mp4" },
  ] as unknown as MediaBinItem[];
  const module = load<ResolversModule>("../../../src/systems/ExportSystem/exportResolvers.ts", {
    "../../core/editor/playback/timeline": timeline,
    "../../core/editor/storyboard/storyboardKeywords": {},
    "../../core/editor/storyboard/storyboard": {},
    "../../systems/ProjectSystem": {
      isMediaItemEnabled: () => true,
      isMediaItemOffline: () => false,
      mediaItemProject: () => project,
      resolvedMediaAudioSources: () => [],
    },
  });
  return { module, mediaItems, projects: { "asset-1": project } };
}

test("materials become clips with their own name, range and keywords", () => {
  const { module, mediaItems, projects } = resolvers();
  const build = (items: AssetLibraryEntry[]) =>
    module.buildAssetLibraryExportSource({
      items: items.map((item) => ({ entry: item, videoId: "v1" })),
      mediaItems,
      projects,
      detachedVideoIds: new Set(),
    });
  const storyboard = build([entry("s1", null, { root: "storyboards" })])!;
  assert.equal(storyboard.kind, "storyboard");
  const clip = storyboard.clips[0]!;
  assert.equal(
    json([clip.id, clip.label, clip.sourceName, clip.startUs, clip.endUs, clip.keywordText]),
    json(["asset:s1", "素材 s1", "访谈.mp4", 1_000_000, 2_000_000, "人物,室内"]),
  );
  assert.equal(build([entry("e1", null)])!.kind, "subtitle");
  const mixed = build([entry("e1", null), entry("s1", null, { root: "storyboards" })])!;
  assert.equal(json([mixed.kind, mixed.title]), json(["asset-library", "2 个素材"]));
  assert.equal(build([]), null);
});

test("a mixed selection names files by material", () => {
  const rename = load<typeof import("../../../src/systems/ExportSystem/exportRename.ts")>(
    "../../../src/systems/ExportSystem/exportRename.ts",
    {
      "../../core/editor/playback/time": {},
      "../../core/editor/export/exportTypes": {},
    },
  );
  const options = rename.exportRenameRuleOptions("individual", "asset-library");
  assert.equal(json(options[0]), json(["label", "素材"]));
});
