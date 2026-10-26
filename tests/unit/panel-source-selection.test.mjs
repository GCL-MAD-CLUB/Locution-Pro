import assert from "node:assert/strict";
import test from "node:test";
import {
  readPanelMediaWorkspaces,
  resolvePanelSourceChoices,
  togglePanelSourceChoice,
  recordPanelSourceHistory,
  maximumSourceHistorySteps,
  panelSessionForContext,
} from "../../src/core/editor/panelSourceSelection.ts";

const available = [
  { videoId: "a", tracks: [{ id: "a-1" }, { id: "a-2" }] },
  { videoId: "b", tracks: [{ id: "b-1" }] },
];

test("unavailable selected sources disappear without selecting unrelated media", () => {
  assert.deepEqual(
    resolvePanelSourceChoices([{ videoId: "deleted", trackId: "old" }], available),
    [],
  );
  assert.deepEqual(resolvePanelSourceChoices([], available), []);
});

test("locked sources keep the exact track identity; unlocked sources use the first available track", () => {
  const requested = [{ videoId: "a", trackId: "deleted-track" }];
  assert.equal(resolvePanelSourceChoices(requested, available, true)[0].trackId, "deleted-track");
  assert.equal(resolvePanelSourceChoices(requested, available)[0].trackId, "a-1");
});

test("selection can remove the final source and changing one track preserves other sources", () => {
  const a = { videoId: "a", trackId: "a-1" },
    b = { videoId: "b", trackId: "b-1" };
  assert.deepEqual(togglePanelSourceChoice([a], a, false), []);
  assert.deepEqual(togglePanelSourceChoice([a, b], { videoId: "a", trackId: "a-2" }, true), [
    { videoId: "a", trackId: "a-2" },
    b,
  ]);
  assert.deepEqual(a, { videoId: "a", trackId: "a-1" });
});

test("corrupt workspace profiles reject malformed roots and normalize valid saved frames", () => {
  for (const value of [null, [], "bad", {}, { workspaces: 3 }])
    assert.equal(readPanelMediaWorkspaces(value), null);
  const result = readPanelMediaWorkspaces({
    workspaceId: 1,
    workspaces: [
      {
        id: 1,
        sources: [{ videoId: "a", trackId: "a-1" }],
        videoId: "a",
        trackId: "a-1",
        frame: -10,
      },
      { id: 2, sources: "bad" },
    ],
  });
  assert.equal(result.workspaces.length, 1);
  assert.equal(result.workspaces[0].frame, 0);
  assert.equal(result.workspaceId, 1);
});

test("source history is bounded, branches after back navigation, and playback creates no entry", () => {
  let state = {
    sources: [],
    videoId: "",
    trackId: "",
    frame: 0,
    sourceHistory: [],
    sourceHistoryIndex: 0,
  };
  for (let i = 0; i < 30; i++) {
    const next = {
      sources: [{ videoId: String(i), trackId: "" }],
      videoId: String(i),
      trackId: "",
      frame: 0,
    };
    state = { ...state, ...recordPanelSourceHistory(state, next), ...next };
  }
  assert.equal(state.sourceHistory.length, maximumSourceHistorySteps + 1);
  assert.equal(
    recordPanelSourceHistory(state, { ...state, frame: 77 }).sourceHistory,
    state.sourceHistory,
  );
  const back = { ...state, ...state.sourceHistory[2], sourceHistoryIndex: 2 };
  const branched = recordPanelSourceHistory(back, {
    sources: [{ videoId: "new", trackId: "" }],
    videoId: "new",
    trackId: "",
    frame: 0,
  });
  assert.equal(branched.sourceHistory.length, 4);
  assert.equal(branched.sourceHistory.at(-1).videoId, "new");
});

test("switching sources renders the destination session immediately and cannot leak previous selection", () => {
  const previous = { selectedIds: ["a-shot"] },
    cached = { selectedIds: ["b-shot"] };
  assert.equal(
    panelSessionForContext("a", "b", previous, { b: cached }, () => ({})),
    cached,
  );
  assert.deepEqual(
    panelSessionForContext("a", "c", previous, {}, () => ({ selectedIds: [] })),
    { selectedIds: [] },
  );
  assert.equal(
    panelSessionForContext("a", "a", previous, {}, () => ({})),
    previous,
  );
});
