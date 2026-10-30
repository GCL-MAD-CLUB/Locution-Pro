import assert from "node:assert/strict";
import test from "node:test";
import {
  preprocessSubtitleCues,
  preprocessProjectSubtitles,
  subtitleSourceCueIds,
} from "../../../src/core/editor/subtitlePreprocessing.ts";

const cue = (id, start_us, end_us, plain_text = "相同字幕", track_id = "track") => ({
  id,
  sequence: Number(id) || 1,
  start_us,
  end_us,
  plain_text,
  raw_text: plain_text,
  track_id,
});

test("overlapping and touching identical subtitles merge transitively without mutating parsed cues", () => {
  const input = [cue("1", 0, 100), cue("2", 100, 150), cue("3", 120, 200)];
  const original = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const result = preprocessSubtitleCues(input);
  assert.equal(result.cues.length, 1);
  assert.equal(result.cues[0].end_us, 200);
  assert.deepEqual([...result.mergedCueIds.get("1")], ["1", "2", "3"]);
  assert.deepEqual(input, original);
  assert.deepEqual([...subtitleSourceCueIds(input, ["1", "2"])], ["1", "2", "3"]);
});

for (const [name, second] of [
  ["a gap", cue("2", 101, 200)],
  ["different text", cue("2", 50, 200, "不同字幕")],
  ["a different track", cue("2", 50, 200, "相同字幕", "other")],
]) {
  test(`subtitles separated by ${name} remain independently editable`, () => {
    const input = [cue("1", 0, 100), second];
    assert.equal(preprocessSubtitleCues(input).cues.length, 2);
    assert.deepEqual([...subtitleSourceCueIds(input, ["2"])], ["2"]);
  });
}

test("unordered cues sort in the derived view, preserve source order and reuse the cached view", () => {
  const input = [cue("2", 200, 300), cue("1", 0, 100)];
  const result = preprocessSubtitleCues(input);
  assert.deepEqual(
    result.cues.map((cue) => cue.id),
    ["1", "2"],
  );
  assert.deepEqual(
    input.map((cue) => cue.id),
    ["2", "1"],
  );
  assert.equal(preprocessSubtitleCues(input), result);
  assert.equal(preprocessSubtitleCues(result.cues), result);
});

test("project projection fixes displayed counts while bitmap tracks and raw counts survive", () => {
  const project = {
    tracks: [
      { id: "track", kind: "text", cue_count: 2 },
      { id: "bitmap", kind: "bitmap", cue_count: 9 },
    ],
    cues: { track: [cue("1", 0, 100), cue("2", 50, 200)], bitmap: [cue("3", 0, 100)] },
  };
  const original = structuredClone(project);
  const result = preprocessProjectSubtitles(project);
  assert.equal(result.tracks[0].cue_count, 1);
  assert.equal(result.tracks[1], project.tracks[1]);
  assert.equal(result.cues.bitmap, project.cues.bitmap);
  assert.deepEqual(project, original);
  assert.equal(preprocessProjectSubtitles(result), result);
});
