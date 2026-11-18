import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL(
    "../../../../src/components/common/PanelMediaSources/panelMediaSources.ts",
    import.meta.url,
  ),
  "utf8",
);
const start = source.indexOf("  const { videoId: selectedVideoId");
const end = source.indexOf("  // Shared media follow", start);
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test("persisting playback frames does not reopen media; explicit opens and focus still restore frames", () => {
  let frame = 0;
  let publishes = 0;
  let activeChanges = 0;
  let restoredFrame = -1;
  let previousKeys: readonly unknown[] = [];
  let previousCallback: unknown;
  const control = { current: null };
  const savedFrame = () => frame;
  const context = {
    selection: { videoId: "video", savedFrame, openVersion: 1, frame },
    selectionInitialized: true,
    identity: {},
    kind: "storyboard",
    activeVideoId: "video",
    activeTrackId: "",
    hasProject: true,
    panelActive: true,
    panelFocused: true,
    canOpenSource: true,
    PLAYBACK_SOURCE_MODE_PROJECTION: "source-mode",
    stateHub: {
      publish: (_: unknown, __: unknown, value: { frame: number }) => {
        publishes++;
        restoredFrame = value.frame;
      },
    },
    activeVideoChanged: () => {
      activeChanges++;
    },
    sourcePreviewCleared: () => assert.fail("unexpected clear"),
    previewTrackChanged: () => assert.fail("unexpected track change"),
    useRef: () => control,
    useCallback: (callback: unknown, keys: readonly unknown[]) => {
      if (keys.length !== previousKeys.length || keys.some((key, i) => key !== previousKeys[i])) {
        previousKeys = keys;
        previousCallback = callback;
      }
      return previousCallback;
    },
    lifetime: { useBeforePaint: (acquire: () => void) => acquire() },
  };
  const render = () => runInNewContext(`{ ${compiled} }`, context);
  render();
  assert.equal(publishes, 1);
  for (frame = 1; frame <= 30; frame++) {
    context.selection = { ...context.selection, frame };
    render();
  }
  assert.equal(publishes, 1);
  assert.equal(activeChanges, 1);
  context.selection = { ...context.selection, openVersion: 2 };
  render();
  assert.equal(publishes, 2);
  assert.equal(restoredFrame, frame);
  context.panelFocused = false;
  render();
  context.panelFocused = true;
  render();
  assert.equal(publishes, 3);
});
