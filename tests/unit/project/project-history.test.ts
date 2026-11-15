import assert from "node:assert/strict";
import test from "node:test";
import {
  appendProjectHistoryEntry,
  applyProjectFileEvent,
  createProjectHistory,
  createProjectHistoryEntry,
  discardFutureProjectHistory,
  isProjectHistoryDirty,
  markProjectHistorySaved,
  markProjectHistorySavedAt,
  projectHistoryRowLimit,
  type ProjectFileState,
  type ProjectHistoryState,
} from "../../../src/systems/ProjectSystem/ProjectHistory.ts";
import type {
  AssetLibraryEntry,
  MediaBinFolder,
  MediaBinItem,
  MediaDocument,
  StoryboardState,
  SubtitleCueAnnotation,
} from "../../../src/types.ts";

function state(): ProjectFileState {
  return {
    projects: {},
    mediaItems: [],
    mediaFolders: [],
    activeVideoId: "",
    activeTrackId: "",
    detachedVideoIds: new Set<string>(),
    useProxy: false,
    subtitles: {},
    storyboards: {},
    assetLibrary: { folders: [], entries: [] },
  };
}
function edit(before: ProjectFileState, after: ProjectFileState, group?: string) {
  return createProjectHistoryEntry("edit", "default", before, after, group);
}
function append(history: ProjectHistoryState, id: string) {
  return appendProjectHistoryEntry(history, edit(state(), { ...state(), activeVideoId: id })!);
}

test("project events round-trip media order, nested folders, annotations and editor settings", () => {
  const before = state();
  const cueAnnotations: Record<string, SubtitleCueAnnotation> = {
    cue: { rating: 5 } as SubtitleCueAnnotation,
  };
  const after: ProjectFileState = {
    ...before,
    projects: { a: { asset: { id: "a" } } as MediaDocument },
    mediaItems: [
      { id: "a", file_name: "a.mp4" },
      { id: "b", file_name: "b.wav" },
    ] as MediaBinItem[],
    mediaFolders: [
      { id: "root", parent_id: null as string | null },
      { id: "child", parent_id: "root" },
    ] as MediaBinFolder[],
    activeVideoId: "a",
    activeTrackId: "track",
    useProxy: true,
    detachedVideoIds: new Set(["a"]),
    subtitles: { track: { cueAnnotations } },
    storyboards: { a: { shots: [{ id: "shot" }] } as StoryboardState },
  };
  const change = edit(before, after)!;
  assert.deepEqual(applyProjectFileEvent(before, change.event), after);
  assert.deepEqual(applyProjectFileEvent(after, change.inverseEvent), before);
  assert.equal(edit(before, before), null);
});

test("asset-library edits undo, redo and merge as one library operation", () => {
  const before = state();
  const entry = { id: "asset:1", name: "clip" } as AssetLibraryEntry;
  const added = { ...before, assetLibrary: { folders: [], entries: [entry] } };
  const trimmed = {
    ...before,
    assetLibrary: { folders: [], entries: [{ ...entry, end_us: 40_000 }] },
  };
  const change = createProjectHistoryEntry("添加到素材库", "library", before, added)!;
  assert.equal(change.category, "library");
  assert.deepEqual(
    change.event.operations.map((operation) => operation.type),
    ["asset-library.set"],
  );
  assert.deepEqual(applyProjectFileEvent(before, change.event), added);
  assert.deepEqual(applyProjectFileEvent(added, change.inverseEvent), before);

  let history = appendProjectHistoryEntry(
    createProjectHistory(true),
    createProjectHistoryEntry("调整切点", "library", before, added, "trim")!,
  );
  history = appendProjectHistoryEntry(
    history,
    createProjectHistoryEntry("调整切点", "library", added, trimmed, "trim")!,
  );
  assert.equal(history.entries.length, 1);
  assert.deepEqual(applyProjectFileEvent(trimmed, history.entries[0].inverseEvent), before);
});

test("background save marks the captured cursor and leaves subsequent edits dirty", () => {
  const captured = append(createProjectHistory(true), "a");
  const current = append(captured, "b");
  const saved = markProjectHistorySavedAt(current, captured);
  assert.equal(saved.savedCursor, 1);
  assert.equal(saved.cursor, 2);
  assert.equal(isProjectHistoryDirty(saved), true);
  assert.equal(isProjectHistoryDirty({ ...saved, cursor: 1 }), false);
});

test("late save from a discarded undo branch cannot mark the replacement branch clean", () => {
  const captured = append(createProjectHistory(true), "a");
  const branched = append({ ...captured, cursor: 0 }, "b");
  const saved = markProjectHistorySavedAt(branched, captured);
  assert.equal(saved.savedCursor, -1);
  assert.equal(isProjectHistoryDirty(saved), true);
});

test("grouped edits retain original undo values and cannot reuse a stale saved marker", () => {
  const before = state(),
    middle = { ...before, activeVideoId: "a" },
    after = { ...before, activeVideoId: "b" };
  const first = edit(before, middle, "batch")!;
  let history = appendProjectHistoryEntry(createProjectHistory(true), first);
  history = markProjectHistorySaved(history);
  const second = edit(middle, after, "batch")!;
  history = appendProjectHistoryEntry(history, second);
  assert.equal(history.entries.length, 1);
  assert.equal(isProjectHistoryDirty(history), true);
  assert.deepEqual(applyProjectFileEvent(before, history.entries[0].event), after);
  assert.deepEqual(applyProjectFileEvent(after, history.entries[0].inverseEvent), before);
});

test("history eviction bounds retained entries and invalidates a removed savepoint", () => {
  let history = createProjectHistory(true);
  for (let i = 0; i < projectHistoryRowLimit + 10; i++) history = append(history, String(i));
  assert.equal(history.entries.length, projectHistoryRowLimit - 1);
  assert.equal(history.cursor, history.entries.length);
  assert.equal(history.savedCursor, -1);
});

test("editing after undo drops redo entries and a savepoint in the discarded future", () => {
  const history = markProjectHistorySaved(append(append(createProjectHistory(true), "a"), "b"));
  const undone = { ...history, cursor: 1 };
  const truncated = discardFutureProjectHistory(undone);
  assert.equal(truncated.entries.length, 1);
  assert.equal(truncated.savedCursor, -1);
  const branched = append(undone, "c");
  assert.equal(branched.entries[0], history.entries[0]);
  assert.notEqual(branched.entries[1], history.entries[1]);
  assert.equal(isProjectHistoryDirty(branched), true);
});
