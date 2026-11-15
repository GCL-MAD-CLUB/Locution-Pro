import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

type HomeModule = typeof import("../../../src/core/editor/assetLibraryHome.ts");

const load = createModuleLoader(import.meta.url);
const timeline = load<typeof import("../../../src/core/editor/timeline.ts")>(
  "../../../src/core/editor/timeline.ts",
);
const assetLibrary = load<typeof import("../../../src/core/editor/assetLibrary.ts")>(
  "../../../src/core/editor/assetLibrary.ts",
  { "./timeline": timeline },
);
const home = load<HomeModule>("../../../src/core/editor/assetLibraryHome.ts", {
  "./assetLibrary": assetLibrary,
});
const json = (value: unknown) => JSON.stringify(value);

test("pinning appends once, and unpinning removes only the given folders", () => {
  let state = home.emptyAssetLibraryHome();
  state = home.withAssetLibraryPins(state, ["a", "b"], true);
  state = home.withAssetLibraryPins(state, ["c", "a"], true);
  assert.equal(json(state.pinnedFolderIds), json(["a", "b", "c"]));
  state = home.withAssetLibraryPins(state, ["b"], false);
  assert.equal(json(state.pinnedFolderIds), json(["a", "c"]));
});

test("library tops pin beside folders, in pinning order, and missing folders drop out", () => {
  const folder = {
    id: "f",
    root: "storyboards" as const,
    parent_id: null,
    name: "镜头",
    created_at: 1,
    hidden: false,
  };
  const pins = [home.assetLibraryPinnedRootId("subtitles"), "gone", "f", "root:unknown"];
  const state = home.withAssetLibraryPins(home.emptyAssetLibraryHome(), pins, true);
  const places = home.assetLibraryPinnedPlaces(state, [folder]);
  assert.equal(
    json(places.map((place) => [place.id, place.root, place.folder?.name ?? null])),
    json([
      ["root:subtitles", "subtitles", null],
      ["f", "storyboards", "镜头"],
    ]),
  );
});

test("new favorites go first while existing ones keep their place", () => {
  let state = home.withAssetLibraryFavorites(home.emptyAssetLibraryHome(), ["a", "b"], true);
  state = home.withAssetLibraryFavorites(state, ["b", "c"], true);
  assert.equal(json(state.favoriteEntryIds), json(["c", "a", "b"]));
  state = home.withAssetLibraryFavorites(state, ["a", "c"], false);
  assert.equal(json(state.favoriteEntryIds), json(["b"]));
});

test("a use moves a material to the front, within the recent limit", () => {
  let state = home.emptyAssetLibraryHome();
  for (let index = 0; index <= home.assetLibraryRecentLimit; index += 1) {
    state = home.withAssetLibraryUse(state, `e${index}`, index);
  }
  assert.equal(state.recent.length, home.assetLibraryRecentLimit);
  assert.equal(state.recent[0]!.entryId, `e${home.assetLibraryRecentLimit}`);
  state = home.withAssetLibraryUse(state, "e5", 999);
  assert.equal(json(state.recent[0]), json({ entryId: "e5", usedAt: 999 }));
  assert.equal(state.recent.filter((use) => use.entryId === "e5").length, 1);
  state = home.withoutAssetLibraryRecent(state, ["e5"]);
  assert.ok(state.recent.every((use) => use.entryId !== "e5"));
});

test("a saved home is repaired rather than rejected", () => {
  assert.equal(json(home.normalizedAssetLibraryHome(null)), json(home.emptyAssetLibraryHome()));
  const repaired = home.normalizedAssetLibraryHome({
    pinnedFolderIds: ["a", "a", 3, ""],
    favoriteEntryIds: "b",
    recent: [
      { entryId: "x", usedAt: 2 },
      { entryId: "x", usedAt: 1 },
      { entryId: "y", usedAt: "soon" },
      null,
    ],
  });
  assert.equal(
    json(repaired),
    json({ pinnedFolderIds: ["a"], favoriteEntryIds: [], recent: [{ entryId: "x", usedAt: 2 }] }),
  );
});
