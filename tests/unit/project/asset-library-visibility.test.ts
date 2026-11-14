import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import type {
  AssetLibraryEntry,
  AssetLibraryFolder,
  ProjectAssetLibraryState,
} from "../../../src/types.ts";

type VisibilityModule = typeof import("../../../src/core/editor/assetLibraryVisibility.ts");

const load = createModuleLoader(import.meta.url);
const visibility = load<VisibilityModule>("../../../src/core/editor/assetLibraryVisibility.ts");

function folder(id: string, parentId: string | null, hidden = false): AssetLibraryFolder {
  return {
    id,
    root: "subtitles",
    parent_id: parentId,
    name: id,
    created_at: 1,
    hidden,
  };
}

function entry(id: string, hidden = false) {
  return { id, root: "subtitles", folder_id: null, hidden } as AssetLibraryEntry;
}

test("hiding sets the flag on the chosen folders and entries only", () => {
  const library: ProjectAssetLibraryState = {
    folders: [folder("a", null), folder("b", null)],
    entries: [entry("1"), entry("2")],
  };
  const hidden = visibility.withAssetLibraryNodesHidden(
    library,
    { folderIds: ["a"], entryIds: ["2"] },
    true,
  );
  assert.equal(
    hidden.folders.map((item) => `${item.id}:${item.hidden}`).join(" "),
    "a:true b:false",
  );
  assert.equal(
    hidden.entries.map((item) => `${item.id}:${item.hidden}`).join(" "),
    "1:false 2:true",
  );
  assert.equal(library.folders[0]!.hidden, false);

  const unchanged = visibility.withAssetLibraryNodesHidden(
    hidden,
    { folderIds: ["a"], entryIds: [] },
    true,
  );
  assert.equal(unchanged, hidden);
});

test("folders under a hidden folder count as hidden, even through a parent cycle", () => {
  const ids = visibility.assetLibraryHiddenFolderIds([
    folder("top", null, true),
    folder("child", "top"),
    folder("grandchild", "child"),
    folder("other", null),
    folder("loop-a", "loop-b"),
    folder("loop-b", "loop-a"),
  ]);
  assert.equal([...ids].sort().join(" "), "child grandchild top");
});

test("a search also leaves out what sits inside a hidden folder", () => {
  const library: ProjectAssetLibraryState = {
    folders: [folder("top", null, true), folder("child", "top"), folder("open", null)],
    entries: [
      { ...entry("in-hidden"), folder_id: "child" },
      { ...entry("hidden"), hidden: true },
      entry("shown"),
    ],
  };
  const names = (state: ProjectAssetLibraryState) =>
    [...state.folders, ...state.entries].map((item) => item.id).join(" ");
  assert.equal(
    names(visibility.withoutHiddenAssetLibraryNodes(library, library, true)),
    "open shown",
  );
  // Browsing a folder lists its children by their own flag only.
  assert.equal(
    names(visibility.withoutHiddenAssetLibraryNodes(library, library, false)),
    "child open in-hidden shown",
  );
});

test("隐藏 shows checked only when every chosen item is hidden", () => {
  const library: ProjectAssetLibraryState = {
    folders: [folder("a", null, true)],
    entries: [entry("1", true), entry("2")],
  };
  const hidden = (folderIds: string[], entryIds: string[]) =>
    visibility.assetLibrarySelectionHidden(library, { folderIds, entryIds });
  assert.equal(hidden(["a"], ["1"]), true);
  assert.equal(hidden(["a"], ["1", "2"]), false);
  assert.equal(hidden([], []), false);
});
