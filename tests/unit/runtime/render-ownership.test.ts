import assert from "node:assert/strict";
import test from "node:test";
import { fallbackSelectionValue } from "../../../src/components/common/PopupMenu/selectionValue.ts";
import { traySelectionForItems } from "../../../src/components/panels/ImportWorkspace/selection/traySelection.ts";
import { mediaBinFolderNavigation } from "../../../src/components/panels/MediaBin/folderNavigation.ts";
import { selectionFocusForVisibleIds } from "../../../src/core/editor/selectionFocus.ts";

test("keyboard focus stays on a visible row and falls back to the last visible row", () => {
  assert.equal(selectionFocusForVisibleIds(["a", "b"], "b"), null);
  assert.deepEqual(selectionFocusForVisibleIds(["a", "b"], "missing"), {
    focusId: "b",
    anchorId: "b",
  });
  assert.deepEqual(selectionFocusForVisibleIds(["a", "b"], null), {
    focusId: "b",
    anchorId: "b",
  });
  assert.deepEqual(selectionFocusForVisibleIds([], "a"), { focusId: null, anchorId: null });
});

test("a disabled or missing popup choice falls back to the first enabled item", () => {
  const items = [
    { value: "gone", disabled: false },
    { value: "kept", disabled: true },
    { value: "next", disabled: false },
  ];
  assert.equal(fallbackSelectionValue(items, "kept"), "gone");
  assert.equal(fallbackSelectionValue(items, "missing"), "gone");
  assert.equal(fallbackSelectionValue(items, "next"), undefined);
  assert.equal(
    fallbackSelectionValue(
      [
        { value: "only", disabled: true },
        { value: "last", disabled: true },
      ],
      "only",
    ),
    "only",
  );
});

test("media bin folder navigation drops a folder that left the scope and keeps a valid one", () => {
  const scoped = new Set(["child"]);
  const expanded = new Set(["child", "removed"]);
  assert.deepEqual(mediaBinFolderNavigation("removed", "root", scoped, expanded), {
    currentFolderId: "root",
    expandedFolderIds: new Set(["child"]),
  });
  const staying = mediaBinFolderNavigation("child", "root", scoped, new Set(["child"]));
  assert.equal(staying.currentFolderId, "child");
  assert.equal(staying.expandedFolderIds.size, 1);
  assert.equal(
    mediaBinFolderNavigation("root", "root", scoped, new Set(["child"])).currentFolderId,
    "root",
  );
});

test("import tray selection forgets paths that are no longer in the tray", () => {
  const selected = new Set(["a", "b"]);
  assert.equal(traySelectionForItems(selected, ["a", "b", "c"]), selected);
  assert.deepEqual([...traySelectionForItems(selected, ["b"])], ["b"]);
  assert.deepEqual([...traySelectionForItems(selected, [])], []);
});
