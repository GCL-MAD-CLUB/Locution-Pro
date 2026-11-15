import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { createModuleLoader } from "../support/module-loader.ts";

type DropTargetModule =
  typeof import("../../../src/components/common/utils/assetLibraryDropTarget.ts");

const load = createModuleLoader(import.meta.url);

/** A document whose hit test lands on the element marked with these attributes, if any. */
function documentOver(dataset: Record<string, string> | null) {
  return {
    elementFromPoint: () =>
      dataset && {
        closest: (selector: string) => (selector === "[data-asset-drop-root]" ? { dataset } : null),
      },
  };
}

function loadDropTarget(dataset: Record<string, string> | null) {
  let published: unknown = "untouched";
  const dropTarget = load<DropTargetModule>(
    "../../../src/components/common/utils/assetLibraryDropTarget.ts",
    {
      zustand: { useStore: () => null },
      "zustand/vanilla": {
        createStore: (initial: () => { target: unknown }) => {
          const store = createStore(initial);
          store.subscribe((state) => {
            published = state.target;
          });
          return store;
        },
      },
    },
    { document: documentOver(dataset) },
  );
  return { dropTarget, published: () => published };
}

test("a drag from another panel lands only in the library for its kind of item", () => {
  const folderTarget = { assetDropRoot: "storyboards", assetDropFolder: "f1", assetDropKey: "k" };
  const shots = loadDropTarget(folderTarget);
  const location = shots.dropTarget.trackExternalAssetLibraryDrop(1, 2, "storyboards");
  assert.equal(JSON.stringify(location), JSON.stringify({ root: "storyboards", folderId: "f1" }));
  assert.equal((shots.published() as { key: string }).key, "k");

  const subtitles = loadDropTarget(folderTarget);
  assert.equal(subtitles.dropTarget.trackExternalAssetLibraryDrop(1, 2, "subtitles"), null);
  assert.equal(subtitles.published(), "untouched");
});

test("the library root pane drops at the top level and empty space drops nowhere", () => {
  const pane = loadDropTarget({
    assetDropRoot: "subtitles",
    assetDropFolder: "",
    assetDropKey: "content",
  });
  assert.equal(
    JSON.stringify(pane.dropTarget.trackExternalAssetLibraryDrop(0, 0, "subtitles")),
    JSON.stringify({ root: "subtitles", folderId: null }),
  );
  const outside = loadDropTarget(null);
  assert.equal(outside.dropTarget.trackExternalAssetLibraryDrop(0, 0, "subtitles"), null);
});
