import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

type KeyboardModule =
  typeof import("../../../src/components/panels/AssetLibrary/assetLibraryKeyboard.ts");
type KeyInput =
  import("../../../src/components/panels/AssetLibrary/assetLibraryKeyboard.ts").AssetLibraryKeyInput;
type KeyContext =
  import("../../../src/components/panels/AssetLibrary/assetLibraryKeyboard.ts").AssetLibraryKeyContext;

const load = createModuleLoader(import.meta.url);
const timeline = load("../../../src/core/editor/timeline.ts");
const library = load("../../../src/core/editor/assetLibrary.ts", { "./timeline": timeline });
const keyboard = load<KeyboardModule>(
  "../../../src/components/panels/AssetLibrary/assetLibraryKeyboard.ts",
  { "../../../core/editor/assetLibrary": library },
);

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const listContext: KeyContext = {
  itemCount: 5,
  focusIndex: 2,
  iconColumns: null,
  hasSelection: true,
};
const iconContext: KeyContext = { ...listContext, itemCount: 10, focusIndex: 4, iconColumns: 3 };

function press(
  key: string,
  modifiers: Partial<Omit<KeyInput, "key">> = {},
  context: KeyContext = listContext,
) {
  const input: KeyInput = {
    key,
    code: modifiers.code ?? "",
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
  };
  return plain(keyboard.assetLibraryKeyCommand(input, context));
}

test("Alt arrows and Alt+Enter navigate history and show properties", () => {
  assert.deepEqual(press("ArrowLeft", { altKey: true }), { kind: "back" });
  assert.deepEqual(press("ArrowRight", { altKey: true }), { kind: "forward" });
  assert.deepEqual(press("ArrowUp", { altKey: true }), { kind: "up" });
  assert.deepEqual(press("Enter", { altKey: true }), { kind: "properties" });
  assert.equal(press("ArrowDown", { altKey: true }), null);
});

test("Alt+Shift+P toggles the properties pane by physical key", () => {
  assert.deepEqual(press("∏", { altKey: true, shiftKey: true, code: "KeyP" }), {
    kind: "toggleDetails",
  });
  assert.equal(press("p", { altKey: true, code: "KeyP" }), null);
});

test("address and search keys follow the file-manager bindings", () => {
  for (const [key, modifiers] of [
    ["d", { altKey: true }],
    ["F4", {}],
    ["l", { ctrlKey: true }],
  ] as const) {
    assert.deepEqual(press(key, modifiers), { kind: "address" });
  }
  for (const [key, modifiers] of [
    ["F3", {}],
    ["f", { ctrlKey: true }],
    ["E", { metaKey: true }],
  ] as const) {
    assert.deepEqual(press(key, modifiers), { kind: "search" });
  }
  assert.deepEqual(press("ContextMenu"), { kind: "contextMenu" });
  assert.deepEqual(press("F10", { shiftKey: true }), { kind: "contextMenu" });
});

test("Ctrl+Shift+digit picks view presets by physical key", () => {
  assert.deepEqual(press("!", { ctrlKey: true, shiftKey: true, code: "Digit1" }), {
    kind: "viewPreset",
    size: 100,
  });
  assert.deepEqual(press("^", { ctrlKey: true, shiftKey: true, code: "Digit6" }), {
    kind: "viewPreset",
    size: 12,
  });
  assert.equal(press("%", { ctrlKey: true, shiftKey: true, code: "Digit5" }), null);
  assert.deepEqual(press("N", { ctrlKey: true, shiftKey: true, code: "KeyN" }), {
    kind: "newFolder",
  });
});

test("Ctrl+Space toggles only a focused item and Ctrl+X cuts", () => {
  assert.deepEqual(press(" ", { ctrlKey: true }), { kind: "toggleFocused" });
  assert.equal(press(" ", { ctrlKey: true }, { ...listContext, focusIndex: -1 }), null);
  assert.deepEqual(press("x", { ctrlKey: true }), { kind: "cut" });
});

test("list arrows move by row and leave left and right alone", () => {
  assert.deepEqual(press("ArrowDown"), {
    kind: "move",
    index: 3,
    extend: false,
    keepSelection: false,
  });
  assert.deepEqual(press("ArrowUp", { shiftKey: true }), {
    kind: "move",
    index: 1,
    extend: true,
    keepSelection: false,
  });
  assert.equal(press("ArrowLeft"), null);
  assert.equal(press("ArrowRight"), null);
});

test("icon arrows move across and down the grid, clamped to the items", () => {
  const move = (key: string, context = iconContext) =>
    (press(key, {}, context) as { index: number } | null)?.index;
  assert.equal(move("ArrowRight"), 5);
  assert.equal(move("ArrowLeft"), 3);
  assert.equal(move("ArrowDown"), 7);
  assert.equal(move("ArrowUp"), 1);
  assert.equal(move("ArrowDown", { ...iconContext, focusIndex: 8 }), 9);
  assert.equal(move("ArrowUp", { ...iconContext, focusIndex: 1 }), 0);
});

test("icon rows end at each group, and up and down cross into the neighboring group", () => {
  // Groups of 5 and 4 items in three columns: rows [0 1 2] [3 4] | [5 6 7] [8].
  const grouped: KeyContext = { ...iconContext, itemCount: 9, groupStarts: [0, 5] };
  const move = (key: string, focusIndex: number) =>
    (press(key, {}, { ...grouped, focusIndex }) as { index: number }).index;
  assert.equal(move("ArrowDown", 1), 4);
  assert.equal(move("ArrowDown", 2), 4);
  assert.equal(move("ArrowDown", 4), 6);
  assert.equal(move("ArrowDown", 3), 5);
  assert.equal(move("ArrowDown", 7), 8);
  assert.equal(move("ArrowUp", 6), 4);
  assert.equal(move("ArrowUp", 7), 4);
  assert.equal(move("ArrowUp", 8), 5);
  assert.equal(move("ArrowRight", 4), 5);
});

test("Home, End and the first arrow press start from the ends", () => {
  assert.deepEqual(press("End", { ctrlKey: true }), {
    kind: "move",
    index: 4,
    extend: false,
    keepSelection: true,
  });
  assert.equal((press("Home") as { index: number }).index, 0);
  assert.equal(
    (press("ArrowDown", {}, { ...listContext, focusIndex: -1 }) as { index: number }).index,
    0,
  );
  assert.equal(press("Home", {}, { ...listContext, itemCount: 0, focusIndex: -1 }), null);
});

test("Enter opens, F2 renames and Escape clears only an existing selection", () => {
  assert.deepEqual(press("Enter"), { kind: "open" });
  assert.deepEqual(press("F2"), { kind: "rename" });
  assert.deepEqual(press("Escape"), { kind: "clearSelection" });
  assert.equal(press("Escape", {}, { ...listContext, hasSelection: false }), null);
});

test("annotation letters and application edit shortcuts are left to others", () => {
  assert.equal(press("p"), null);
  assert.equal(press("3"), null);
  assert.equal(press("c", { ctrlKey: true }), null);
  assert.equal(press("Enter", { ctrlKey: true }), null);
  assert.equal(press("Backspace"), null);
});

test("editable targets are recognized by tag and contentEditable", () => {
  const target = (value: object) => value as unknown as EventTarget;
  assert.equal(keyboard.isAssetLibraryEditableTarget(target({ tagName: "INPUT" })), true);
  assert.equal(keyboard.isAssetLibraryEditableTarget(target({ tagName: "TEXTAREA" })), true);
  assert.equal(
    keyboard.isAssetLibraryEditableTarget(target({ tagName: "DIV", isContentEditable: true })),
    true,
  );
  assert.equal(keyboard.isAssetLibraryEditableTarget(target({ tagName: "BUTTON" })), false);
  assert.equal(keyboard.isAssetLibraryEditableTarget(null), false);
});
