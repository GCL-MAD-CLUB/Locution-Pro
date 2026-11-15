import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import type {
  AssetLibraryAnnotation,
  AssetLibraryEntry,
  AssetLibraryRoot,
} from "../../../src/types.ts";

type FilterModule = typeof import("../../../src/core/editor/assetLibraryFilter.ts");

const load = createModuleLoader(import.meta.url);
const timeline = load<typeof import("../../../src/core/editor/timeline.ts")>(
  "../../../src/core/editor/timeline.ts",
);
const assetLibrary = load<typeof import("../../../src/core/editor/assetLibrary.ts")>(
  "../../../src/core/editor/assetLibrary.ts",
  { "./timeline": timeline },
);
const filters = load<FilterModule>("../../../src/core/editor/assetLibraryFilter.ts", {
  "./assetLibrary": assetLibrary,
});
const empty = filters.emptyAssetLibraryFilter;

function entry(
  annotation: Partial<AssetLibraryAnnotation> = {},
  root: AssetLibraryRoot = "subtitles",
): AssetLibraryEntry {
  return {
    id: "e",
    root,
    folder_id: null,
    name: "e",
    created_at: 1,
    media: {} as unknown as AssetLibraryEntry["media"],
    start_us: 0,
    end_us: 1,
    text: "",
    annotation: {
      rating: 0,
      retained: false,
      excluded: false,
      color_label: null,
      custom_label: null,
      title: null,
      keywords: [],
      ...annotation,
    },
    hidden: false,
  };
}

test("an empty filter matches everything and is inactive", () => {
  assert.equal(filters.assetLibraryFilterActive(empty), false);
  assert.equal(filters.assetLibraryEntryMatchesFilter(entry(), empty), true);
  assert.equal(filters.assetLibraryFilterActive({ ...empty, colors: ["none"] }), true);
});

test("flags, colors and edit state match any chosen value", () => {
  const retained = entry({ retained: true, color_label: "red" });
  const plain = entry();
  const flagged = { ...empty, flags: ["retained", "excluded"] as const };
  assert.equal(filters.assetLibraryEntryMatchesFilter(retained, flagged), true);
  assert.equal(filters.assetLibraryEntryMatchesFilter(plain, flagged), false);
  const uncolored = { ...empty, colors: ["none"] as const };
  assert.equal(filters.assetLibraryEntryMatchesFilter(plain, uncolored), true);
  assert.equal(filters.assetLibraryEntryMatchesFilter(retained, uncolored), false);
  const unedited = { ...empty, edits: ["unedited"] as const };
  assert.equal(filters.assetLibraryEntryMatchesFilter(plain, unedited), true);
  assert.equal(filters.assetLibraryEntryMatchesFilter(retained, unedited), false);
});

test("a custom label counts as the custom color, not its color label", () => {
  const custom = entry({ color_label: "red", custom_label: "精选" });
  const match = (colors: FilterModule["assetLibraryFilterColors"]) =>
    filters.assetLibraryEntryMatchesFilter(custom, { ...empty, colors });
  assert.equal(match(["custom"]), true);
  assert.equal(match(["red"]), false);
  assert.equal(match(["none"]), false);
  assert.equal(filters.assetLibraryEntryColorFilter(entry({ custom_label: " " })), "none");
});

test("titles and keywords count as edits only for storyboards", () => {
  assert.equal(filters.assetLibraryEntryIsEdited(entry({ keywords: ["a"] }, "storyboards")), true);
  assert.equal(filters.assetLibraryEntryIsEdited(entry({ title: "t" }, "storyboards")), true);
  assert.equal(filters.assetLibraryEntryIsEdited(entry({ keywords: ["a"] })), false);
  assert.equal(filters.assetLibraryEntryIsEdited(entry({ custom_label: "  " })), false);
});

test("ratings compare by the chosen comparator", () => {
  const three = entry({ rating: 3 });
  const match = (ratingComparator: "gte" | "lte" | "eq", rating: number) =>
    filters.assetLibraryEntryMatchesFilter(three, { ...empty, rating, ratingComparator });
  assert.equal(match("gte", 3), true);
  assert.equal(match("gte", 4), false);
  assert.equal(match("lte", 2), false);
  assert.equal(match("lte", 3), true);
  assert.equal(match("eq", 3), true);
  assert.equal(match("eq", 2), false);
});

test("toggling keeps listed order and a repeated rating clears", () => {
  const order = filters.assetLibraryFilterFlags;
  const toggled = (values: Parameters<typeof filters.toggledAssetLibraryFilterValue>[0]) =>
    JSON.stringify(filters.toggledAssetLibraryFilterValue(values, "retained", order));
  assert.equal(toggled(["excluded"]), JSON.stringify(["retained", "excluded"]));
  assert.equal(toggled(["retained"]), "[]");
  const rated = filters.toggledAssetLibraryFilterRating(empty, 4);
  assert.equal(rated.rating, 4);
  assert.equal(filters.toggledAssetLibraryFilterRating(rated, 4).rating, 0);
});
