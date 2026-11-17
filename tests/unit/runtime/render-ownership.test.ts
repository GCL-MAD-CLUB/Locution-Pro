import assert from "node:assert/strict";
import test from "node:test";
import { fallbackSelectionValue } from "../../../src/components/common/PopupMenu/selectionValue.ts";
import { traySelectionForItems } from "../../../src/components/panels/ImportWorkspace/selection/traySelection.ts";
import { mediaBinFolderNavigation } from "../../../src/components/panels/MediaBin/folderNavigation.ts";
import { cellEditReset } from "../../../src/core/editor/cellEditReset.ts";
import { sourceDraftIdentity } from "../../../src/core/editor/multiSource.ts";
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

test("a subtitle track switch cancels the open edit and a 350ms delayed edit; a fingerprint change does not", () => {
  const trackA = sourceDraftIdentity(["video:asset:old:track-a"]);
  const sameTrackAfterAnalysis = sourceDraftIdentity(["video:asset:new:track-a"]);
  const trackB = sourceDraftIdentity(["video:asset:old:track-b"]);
  const bothTracks = sourceDraftIdentity(["video:asset:old:track-a", "video:asset:old:track-b"]);
  const pendingDelay = 350;
  assert.equal(cellEditReset(trackA, sameTrackAfterAnalysis, pendingDelay), null);
  assert.deepEqual(cellEditReset(trackA, trackB, pendingDelay), { cancelPendingTimer: true });
  assert.deepEqual(cellEditReset(trackA, trackB, null), { cancelPendingTimer: false });
  assert.deepEqual(cellEditReset(trackA, bothTracks, pendingDelay), { cancelPendingTimer: true });
  assert.deepEqual(cellEditReset(bothTracks, trackB, pendingDelay), { cancelPendingTimer: true });
});

test("import tray selection forgets paths that are no longer in the tray", () => {
  const selected = new Set(["a", "b"]);
  assert.equal(traySelectionForItems(selected, ["a", "b", "c"]), selected);
  assert.deepEqual([...traySelectionForItems(selected, ["b"])], ["b"]);
  assert.deepEqual([...traySelectionForItems(selected, [])], []);
});
