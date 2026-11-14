import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import type {
  AssetLibraryEntry,
  AssetLibraryFolder,
  ProjectAssetLibraryState,
} from "../../../src/types.ts";

type AssetLibraryModule = typeof import("../../../src/core/editor/assetLibrary.ts");

const load = createModuleLoader(import.meta.url);
const timeline = load<typeof import("../../../src/core/editor/timeline.ts")>(
  "../../../src/core/editor/timeline.ts",
);
const library = load<AssetLibraryModule>("../../../src/core/editor/assetLibrary.ts", {
  "./timeline": timeline,
});

// Values from the VM-loaded module come from another realm; compare them as plain data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const deepEqual = (actual: unknown, expected: unknown) =>
  assert.deepEqual(plain(actual), plain(expected));

const fps = 25;
const frameUs = 40_000;

function folder(
  id: string,
  parentId: string | null,
  name = id,
  root = "subtitles",
): AssetLibraryFolder {
  return { id, root, parent_id: parentId, name, created_at: 1 } as AssetLibraryFolder;
}

function entry(
  id: string,
  folderId: string | null,
  overrides: Partial<AssetLibraryEntry> = {},
): AssetLibraryEntry {
  return {
    id,
    root: "subtitles",
    folder_id: folderId,
    name: id,
    created_at: 1,
    media: {
      video_id: "video",
      path: "D:/media/clip.mp4",
      file_name: "clip.mp4",
      fingerprint: "fp",
      frame_rate: fps,
      duration_us: 10_000_000,
    },
    start_us: 0,
    end_us: 1_000_000,
    text: "",
    annotation: library.emptyAssetLibraryAnnotation(),
    ...overrides,
  };
}

function sequentialIds() {
  let next = 0;
  return (kind: "asset" | "asset-folder") => `${kind}:${(next += 1)}`;
}

function sample(): ProjectAssetLibraryState {
  return {
    folders: [folder("a", null, "Alpha"), folder("b", "a", "Beta"), folder("c", null, "Gamma")],
    entries: [entry("e1", null), entry("e2", "a"), entry("e3", "b")],
  };
}

test("normalization repairs invalid ids, cycles, cross-root parents and annotations", () => {
  const normalized = library.normalizedAssetLibrary({
    folders: [
      folder("x", "y"),
      folder("y", "x"),
      folder("s", null, "Shots", "storyboards"),
      folder("bad-parent", "s"),
      folder("x", null, "duplicate"),
      { id: "", root: "subtitles", parent_id: null, name: "", created_at: 0 },
    ],
    entries: [
      entry("ok", "missing", {
        annotation: {
          ...library.emptyAssetLibraryAnnotation(),
          rating: 9,
          retained: true,
          excluded: true,
          keywords: [" a ", "a", "", "b"],
        },
      }),
      entry("ok", null),
      { id: "broken" },
    ],
  } as unknown as ProjectAssetLibraryState);

  deepEqual(
    normalized.folders.map((item) => item.id),
    ["x", "y", "s", "bad-parent"],
  );
  const parents = new Map(normalized.folders.map((item) => [item.id, item.parent_id]));
  assert.ok(parents.get("x") === null || parents.get("y") === null, "cycle is broken");
  assert.equal(parents.get("bad-parent"), null, "cross-root parent is dropped");
  assert.equal(normalized.entries.length, 1);
  const [repaired] = normalized.entries;
  assert.equal(repaired.folder_id, null);
  assert.equal(repaired.annotation.rating, 5);
  assert.equal(repaired.annotation.retained, true);
  assert.equal(repaired.annotation.excluded, false);
  deepEqual(repaired.annotation.keywords, ["a", "b"]);
  deepEqual(library.normalizedAssetLibrary(undefined), library.emptyAssetLibrary());
});

test("new folders and renames get Windows-style unique names among siblings", () => {
  const start = { folders: [folder("a", null, "新建文件夹")], entries: [] };
  const first = library.withAssetLibraryFolder(
    start,
    { root: "subtitles", folderId: null },
    "n1",
    5,
  );
  assert.equal(first.folder?.name, "新建文件夹 (2)");
  const nested = library.withAssetLibraryFolder(
    first.library,
    { root: "subtitles", folderId: "a" },
    "n2",
    5,
  );
  assert.equal(nested.folder?.name, "新建文件夹");
  const missing = library.withAssetLibraryFolder(
    start,
    { root: "subtitles", folderId: "nope" },
    "n3",
    5,
  );
  assert.equal(missing.folder, null);
  assert.equal(missing.library, start);

  const renamed = library.renamedAssetLibraryFolder(nested.library, "n1", " 新建文件夹 ");
  assert.equal(renamed.folders.find((item) => item.id === "n1")?.name, "新建文件夹 (2)");
  assert.equal(library.renamedAssetLibraryFolder(renamed, "n1", "   "), renamed);
});

test("removing a folder removes its whole subtree", () => {
  const before = sample();
  const after = library.removedAssetLibraryNodes(before, { folderIds: ["a"], entryIds: ["e1"] });
  deepEqual(
    after.folders.map((item) => item.id),
    ["c"],
  );
  deepEqual(after.entries, []);
  assert.equal(library.removedAssetLibraryNodes(before, { folderIds: [], entryIds: [] }), before);
});

test("moving skips self, descendants, other roots and nodes already in place", () => {
  const before = sample();
  const intoChild = library.movedAssetLibraryNodes(
    before,
    { folderIds: ["a"], entryIds: [] },
    { root: "subtitles", folderId: "b" },
  );
  assert.equal(intoChild.movedCount, 0);
  assert.equal(intoChild.library, before);

  const crossRoot = library.movedAssetLibraryNodes(
    before,
    { folderIds: [], entryIds: ["e1"] },
    { root: "storyboards", folderId: null },
  );
  assert.equal(crossRoot.movedCount, 0);

  const moved = library.movedAssetLibraryNodes(
    before,
    { folderIds: ["b", "c"], entryIds: ["e1", "e3"] },
    { root: "subtitles", folderId: "a" },
  );
  // "b" is already in "a"; "e3" travels with "b" and is not moved separately.
  assert.equal(moved.movedCount, 2);
  assert.equal(moved.library.folders.find((item) => item.id === "c")?.parent_id, "a");
  assert.equal(moved.library.entries.find((item) => item.id === "e1")?.folder_id, "a");
  assert.equal(moved.library.entries.find((item) => item.id === "e3")?.folder_id, "b");
});

test("copy and paste create independent deep copies with new ids", () => {
  const before = sample();
  const clipboard = library.assetLibraryClipboard(before, { folderIds: ["a"], entryIds: ["e1"] });
  assert.ok(clipboard);
  deepEqual(clipboard.topFolderIds, ["a"]);
  deepEqual(clipboard.topEntryIds, ["e1"]);
  assert.equal(clipboard.entries.length, 3);

  const pasted = library.pastedAssetLibraryNodes(
    before,
    clipboard,
    { root: "subtitles", folderId: null },
    sequentialIds(),
    9,
  );
  assert.equal(pasted.library.folders.length, 5);
  assert.equal(pasted.library.entries.length, 6);
  const [copyId] = pasted.folderIds;
  const copiedFolder = pasted.library.folders.find((item) => item.id === copyId)!;
  assert.equal(copiedFolder.name, "Alpha (2)");
  const copiedChild = pasted.library.folders.find((item) => item.parent_id === copyId)!;
  assert.equal(copiedChild.name, "Beta");
  assert.ok(pasted.library.entries.some((item) => item.folder_id === copiedChild.id));
  const copiedEntry = pasted.library.entries.find((item) => item.id === pasted.entryIds[0])!;
  assert.equal(copiedEntry.name, "e1 - 副本");
  assert.notEqual(copiedEntry.annotation.keywords, before.entries[0].annotation.keywords);

  const wrongRoot = library.pastedAssetLibraryNodes(
    before,
    clipboard,
    { root: "storyboards", folderId: null },
    sequentialIds(),
    9,
  );
  assert.equal(wrongRoot.library, before);
});

test("captures become decoupled entries with snapshot annotations", () => {
  const media = library.assetLibraryMediaFromSource(
    "video",
    { path: "D:/clip.mp4", file_name: "clip.mp4", fingerprint: "fp", duration_us: 5_000_000 },
    fps,
  );
  const keywords = ["人物"];
  const captured = library.withAssetLibraryCaptures(
    library.emptyAssetLibrary(),
    "storyboards",
    [
      {
        media,
        startUs: 400_000,
        endUs: 800_000,
        name: library.storyboardAssetName(null, "clip.mp4", 3),
        text: "",
        annotation: { rating: 4, keywords },
      },
    ],
    sequentialIds(),
    7,
  );
  const [created] = captured.entries;
  assert.equal(created.root, "storyboards");
  assert.equal(created.folder_id, null);
  assert.equal(created.name, "clip 镜头 3");
  assert.equal(created.annotation.rating, 4);
  keywords.push("changed later");
  deepEqual(created.annotation.keywords, ["人物"]);
  assert.equal(library.subtitleAssetName("  hello\nworld ", "clip.mp4", 1), "hello\nworld");
  assert.equal(library.subtitleAssetName("", "clip.mp4", 2), "clip 字幕 2");
});

test("captures dropped on a folder land in it, or at the root once it is gone", () => {
  const base = {
    ...library.emptyAssetLibrary(),
    folders: [folder("shots", null, "shots", "storyboards"), folder("cues", null)],
  };
  const capture = {
    media: entry("m", null).media,
    startUs: 0,
    endUs: 400_000,
    name: "shot",
    text: "",
  };
  const add = (folderId: string | null) =>
    library.withAssetLibraryCaptures(base, "storyboards", [capture], sequentialIds(), 7, folderId)
      .entries[0]!.folder_id;
  assert.equal(add("shots"), "shots");
  assert.equal(add("missing"), null);
  // A folder from the other library never takes the capture.
  assert.equal(add("cues"), null);
  assert.equal(add(null), null);
});

test("the folder outline lists one library in tree order with depths", () => {
  const base = {
    ...library.emptyAssetLibrary(),
    folders: [
      folder("b", null, "B"),
      folder("a2", "a", "A2"),
      folder("a", null, "A"),
      folder("a1", "a", "A1"),
      folder("s", null, "Shots", "storyboards"),
    ],
  };
  const outline = library
    .assetLibraryFolderOutline(base, "subtitles")
    .map(({ folder: item, depth }) => `${depth}:${item.id}`);
  assert.equal(outline.join(" "), "1:a 2:a1 2:a2 1:b");
  assert.equal(library.assetLibraryFolderOutline(base, "storyboards").length, 1);
});

test("annotation helpers return the same entry when nothing changes", () => {
  const base = entry("e", null);
  assert.equal(library.withAssetLibraryRating(base, 0), base);
  const flagged = library.withAssetLibraryFlag(base, "excluded");
  assert.equal(library.assetLibraryEntryFlag(flagged), "excluded");
  assert.equal(
    library.assetLibraryEntryFlag(library.withAssetLibraryFlag(flagged, "retained")),
    "retained",
  );
  assert.equal(
    library.withAssetLibraryRatingDelta(library.withAssetLibraryRating(base, 5), 1).annotation
      .rating,
    5,
  );
  assert.equal(library.withAssetLibraryColorLabel(base, "blue").annotation.color_label, "blue");
  deepEqual(library.withAssetLibraryKeywords(base, ["a", "a", " b"]).annotation.keywords, [
    "a",
    "b",
  ]);
});

test("trimming snaps to frames, keeps one frame and stays inside the media", () => {
  const base = entry("e", null);
  const snapped = library.trimmedAssetLibraryEntry(base, 1_010_000, 2_030_000);
  assert.equal(snapped.start_us, 1_000_000);
  assert.equal(snapped.end_us, 2_040_000);
  const collapsed = library.trimmedAssetLibraryEntry(base, 2_000_000, 2_000_000);
  assert.equal(collapsed.end_us - collapsed.start_us, frameUs);
  const clamped = library.trimmedAssetLibraryEntry(base, 9_990_000, 20_000_000);
  assert.equal(clamped.end_us, 10_000_000);
  assert.equal(clamped.start_us, 10_000_000 - frameUs);
  assert.equal(library.trimmedAssetLibraryEntry(base, 0, 1_000_000), base);
});

test("search matches every term across names, text and annotations", () => {
  const item = entry("e", null, {
    name: "开场",
    text: "Hello there",
    annotation: { ...library.emptyAssetLibraryAnnotation(), keywords: ["城市"] },
  });
  assert.equal(library.assetLibraryEntryMatches(item, "hello 城市"), true);
  assert.equal(library.assetLibraryEntryMatches(item, "hello 乡村"), false);
  assert.equal(library.assetLibraryEntryMatches(item, "  "), true);
});

test("sorting keeps folders first and orders names naturally", () => {
  const sorted = library.sortedAssetLibraryNodes(
    [folder("f10", null, "镜头 10"), folder("f2", null, "镜头 2")],
    [
      entry("long", null, { name: "b", end_us: 3_000_000 }),
      entry("short", null, { name: "a", end_us: 500_000 }),
    ],
    { key: "duration", direction: "descending" },
  );
  deepEqual(
    sorted.folders.map((item) => item.id),
    ["f10", "f2"],
  );
  deepEqual(
    sorted.entries.map((item) => item.id),
    ["long", "short"],
  );
});

test("one size control switches between list rows and icons", () => {
  const smallest = library.assetLibraryViewLayout(0);
  deepEqual(smallest, { mode: "list", rowHeight: 24, iconScale: 1 });
  const largeList = library.assetLibraryViewLayout(library.assetLibraryIconThreshold / 2);
  deepEqual(largeList, { mode: "list", rowHeight: 42, iconScale: 1.75 });
  deepEqual(library.assetLibraryViewLayout(library.assetLibraryIconThreshold), {
    mode: "icons",
    cardWidth: 120,
  });
  deepEqual(library.assetLibraryViewLayout(500), { mode: "icons", cardWidth: 320 });
});

test("view presets set the shared size and fall on both sides of the icon threshold", () => {
  for (const preset of library.assetLibraryViewPresets) {
    const mode = library.assetLibraryViewLayout(preset.size).mode;
    assert.equal(mode, preset.id === "details" ? "list" : "icons", preset.id);
  }
  assert.equal(library.assetLibraryViewPresetForSize(100)?.id, "extraLarge");
  assert.equal(library.assetLibraryViewPresetForSize(53), null);
});

test("address-bar paths resolve absolutely, relatively and with parent steps", () => {
  const state: ProjectAssetLibraryState = {
    folders: [
      folder("a", null, "访谈"),
      folder("b", "a", "First Take"),
      folder("c", null, "访谈", "storyboards"),
    ],
    entries: [],
  };
  const root = { root: "subtitles" as const, folderId: null };
  assert.equal(
    library.assetLibraryPathText(state, { root: "subtitles", folderId: "b" }),
    "字幕\\访谈\\First Take",
  );
  deepEqual(library.assetLibraryLocationFromPath(state, "字幕\\访谈\\first take", root), {
    root: "subtitles",
    folderId: "b",
  });
  deepEqual(library.assetLibraryLocationFromPath(state, " 分镜 / 访谈 ", root), {
    root: "storyboards",
    folderId: "c",
  });
  deepEqual(library.assetLibraryLocationFromPath(state, "访谈/First Take", root), {
    root: "subtitles",
    folderId: "b",
  });
  deepEqual(
    library.assetLibraryLocationFromPath(state, "..", { root: "subtitles", folderId: "b" }),
    { root: "subtitles", folderId: "a" },
  );
  assert.equal(library.assetLibraryLocationFromPath(state, "字幕\\missing", root), null);
  assert.equal(library.assetLibraryLocationFromPath(state, "  ", root), null);
});

test("dates use the file-manager form in local time", () => {
  const timestamp = new Date(2026, 8, 23, 18, 5).getTime();
  assert.equal(library.formatAssetLibraryDate(timestamp), "2026/9/23 18:05");
  assert.equal(library.formatAssetLibraryDate(Number.NaN), "");
});

test("history jumps keep skipped locations in visiting order", () => {
  const at = (folderId: string) => ({ root: "subtitles" as const, folderId });
  const start = { location: at("d"), backStack: [at("a"), at("b"), at("c")], forwardStack: [] };
  const back = library.steppedAssetLibraryHistory(start, -2)!;
  deepEqual(back, { location: at("b"), backStack: [at("a")], forwardStack: [at("c"), at("d")] });
  deepEqual(library.steppedAssetLibraryHistory(back, 2), start);
  assert.equal(library.steppedAssetLibraryHistory(start, 1), null);
  assert.equal(library.steppedAssetLibraryHistory(start, -9)?.location.folderId, "a");
});

test("sameAssetLibraryLocation compares root and folder", () => {
  const at = (root: string, folderId: string | null) =>
    ({ root, folderId }) as Parameters<AssetLibraryModule["sameAssetLibraryLocation"]>[0];
  assert.equal(library.sameAssetLibraryLocation(at("subtitles", "a"), at("subtitles", "a")), true);
  assert.equal(
    library.sameAssetLibraryLocation(at("subtitles", null), at("subtitles", null)),
    true,
  );
  assert.equal(
    library.sameAssetLibraryLocation(at("subtitles", "a"), at("storyboard", "a")),
    false,
  );
  assert.equal(
    library.sameAssetLibraryLocation(at("subtitles", "a"), at("subtitles", null)),
    false,
  );
});

test("folder sorting follows names, creation time and the selected direction", () => {
  const folders = [
    { ...folder("f2", null, "item 2"), created_at: 20 },
    { ...folder("f10", null, "item 10"), created_at: 10 },
  ];
  for (const key of ["name", "created", "duration", "rating", "start"] as const) {
    const ascending = library.sortedAssetLibraryNodes(folders, [], { key, direction: "ascending" });
    const descending = library.sortedAssetLibraryNodes(folders, [], {
      key,
      direction: "descending",
    });
    deepEqual(
      descending.folders.map((item) => item.id),
      ascending.folders.map((item) => item.id).reverse(),
    );
  }
  deepEqual(
    folders.map((item) => item.id),
    ["f2", "f10"],
  );
});

test("in-point sorting groups entries by source before comparing in-points", () => {
  const media = (fileName: string) => ({
    ...entry("m", null).media,
    path: `/media/${fileName}`,
    file_name: fileName,
  });
  const entries = [
    entry("b-late", null, { media: media("b.mp4"), start_us: 500_000 }),
    entry("a-late", null, { media: media("a.mp4"), start_us: 900_000 }),
    entry("b-early", null, { media: media("b.mp4"), start_us: 100_000 }),
    entry("a-early", null, { media: media("a.mp4"), start_us: 200_000 }),
  ];
  const order = (direction: "ascending" | "descending") =>
    library
      .sortedAssetLibraryNodes([], entries, { key: "start", direction })
      .entries.map((item) => item.id);
  deepEqual(order("ascending"), ["a-early", "a-late", "b-early", "b-late"]);
  deepEqual(order("descending"), ["b-late", "b-early", "a-late", "a-early"]);
});

test("duration uses subtitle time ranges and inclusive storyboard frames", () => {
  const subtitle = entry("subtitle", null, { start_us: 80_000, end_us: 200_000 });
  assert.equal(library.assetLibraryEntryDurationUs(subtitle), 120_000);
  assert.equal(library.assetLibraryEntryDurationUs({ ...subtitle, root: "storyboards" }), 160_000);
  assert.equal(
    library.assetLibraryEntryDurationUs({
      ...subtitle,
      root: "storyboards",
      end_us: subtitle.start_us,
    }),
    frameUs,
  );
  const frameRate = 30000 / 1001;
  const shot = entry("shot", null, {
    root: "storyboards",
    media: { ...subtitle.media, frame_rate: frameRate },
    start_us: timeline.frameToTimeUs(10, frameRate),
    end_us: timeline.frameToTimeUs(39, frameRate),
  });
  assert.equal(library.assetLibraryEntryDurationUs(shot), timeline.frameToTimeUs(30, frameRate));
});

test("hover time scrubs inside the entry's range and stops on its last frame", () => {
  const subtitle = entry("subtitle", null, { start_us: 80_000, end_us: 480_000 });
  assert.equal(library.assetLibraryEntryHoverTimeUs(subtitle, 0), 80_000);
  assert.equal(library.assetLibraryEntryHoverTimeUs(subtitle, 0.5), 280_000);
  assert.equal(library.assetLibraryEntryHoverTimeUs(subtitle, 1), 480_000 - frameUs);
  assert.equal(library.assetLibraryEntryHoverTimeUs(subtitle, 2), 480_000 - frameUs);
  assert.equal(library.assetLibraryEntryHoverTimeUs(subtitle, -1), 80_000);
  assert.equal(library.assetLibraryEntryHoverTimeUs(subtitle, Number.NaN), 80_000);
  const singleFrame = entry("shot", null, {
    root: "storyboards",
    start_us: 80_000,
    end_us: 80_000,
  });
  assert.equal(library.assetLibraryEntryHoverTimeUs(singleFrame, 1), 80_000);
  // Storyboard ranges include their last frame, so the far edge lands on end_us itself.
  const shot = entry("shot", null, { root: "storyboards", start_us: 80_000, end_us: 480_000 });
  assert.equal(library.assetLibraryEntryHoverTimeUs(shot, 1), 480_000);
});

test("drops stay in their root and never enter a dragged folder", () => {
  const state = {
    folders: [folder("a", null), folder("b", "a"), folder("c", null)],
    entries: [],
  } as ProjectAssetLibraryState;
  const at = (folderId: string | null, root = "subtitles") =>
    ({ root, folderId }) as Parameters<typeof library.assetLibraryCanDropInto>[3];
  assert.equal(library.assetLibraryCanDropInto(state, "subtitles", ["a"], at(null)), true);
  assert.equal(library.assetLibraryCanDropInto(state, "subtitles", ["a"], at("c")), true);
  assert.equal(library.assetLibraryCanDropInto(state, "subtitles", ["a"], at("a")), false);
  assert.equal(library.assetLibraryCanDropInto(state, "subtitles", ["a"], at("b")), false);
  assert.equal(library.assetLibraryCanDropInto(state, "subtitles", [], at("b")), true);
  assert.equal(
    library.assetLibraryCanDropInto(state, "subtitles", [], at(null, "storyboards")),
    false,
  );
});

test("icon cards fill the row and each icon size keeps its own width", () => {
  const sizes = library.assetLibraryViewPresets
    .map((preset) => library.assetLibraryViewLayout(preset.size))
    .flatMap((layout) => (layout.mode === "icons" ? [layout.cardWidth] : []));
  for (const available of [520, 800, 1200]) {
    for (const size of sizes) {
      const { columns, cardWidth } = library.assetLibraryGridLayout(available, size, 12);
      assert.ok(Math.abs(columns * cardWidth + 12 * (columns - 1) - available) < 1e-6);
    }
  }
  for (const available of [800, 1200]) {
    const widths = sizes.map(
      (size) => library.assetLibraryGridLayout(available, size, 12).cardWidth,
    );
    assert.equal(new Set(widths).size, widths.length);
  }
  deepEqual(library.assetLibraryGridLayout(800, 240, 12), { columns: 3, cardWidth: 776 / 3 });
  deepEqual(library.assetLibraryGridLayout(200, 320, 12), { columns: 1, cardWidth: 200 });
  deepEqual(library.assetLibraryGridLayout(0, 120, 12), { columns: 1, cardWidth: 0 });
});

test("entry names preserve authored line breaks through capture, rename and reload", () => {
  const base = entry("multiline", null, { name: "first\nsecond" });
  const renamed = library.renamedAssetLibraryEntry(base, "new first\r\nnew second");
  assert.equal(renamed.name, "new first\nnew second");
  assert.equal(
    library.normalizedAssetLibrary({ folders: [], entries: [renamed] }).entries[0]?.name,
    renamed.name,
  );
});
