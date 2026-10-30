import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  decodeKeywordPresets,
  defaultKeywordPresets,
  keywordPresetNameError,
} from "../../../src/core/editor/keywordPresets.ts";

// Run the actual store with isolated profile storage and real Zustand/keyword parsing.
function profile(initial) {
  const values = new Map(initial ? [["locution-pro:keyword-presets", initial]] : []);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const require = createRequire(import.meta.url);
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", "window", source)(
      (name) =>
        name.startsWith(".") ? load(resolve(dirname(filename), `${name}.ts`)) : require(name),
      exports,
      { localStorage },
    );
    return exports;
  }
  const { useKeywordPresetState } = load(
    fileURLToPath(
      new URL(
        "../../../src/components/panels/StoryboardPanel/annotations/keywordPresetState.ts",
        import.meta.url,
      ),
    ),
  );
  return {
    state: useKeywordPresetState.getState,
    saved: () => values.get("locution-pro:keyword-presets"),
  };
}

test("six builtin presets ship in the requested order with nine slots each", () => {
  const defaults = defaultKeywordPresets();
  assert.deepEqual(
    defaults.map(({ name, keywords }) => [name, keywords.filter(Boolean)]),
    [
      ["画面主体", ["人物", "物件", "动物", "交通工具", "建筑", "自然景观", "文字屏幕"]],
      ["景别取景", ["人物远景", "人物全身", "人物半身", "人物特写", "物件全貌", "物件特写"]],
      ["拍摄视角", ["平拍", "俯拍", "仰拍", "顶拍", "倾斜拍"]],
      ["主体运动", ["静止", "原地动作", "空间移动", "混合运动"]],
      ["镜头运动", ["固定", "推", "拉", "水平摇", "垂直摇", "移", "跟", "升降", "环绕"]],
      ["人物数量", ["无人", "单人", "双人", "多人"]],
    ],
  );
  assert.ok(defaults.every((preset) => preset.keywords.length === 9));
  defaults[0].keywords[0] = "修改副本";
  assert.equal(defaultKeywordPresets()[0].keywords[0], "人物");
  assert.equal(decodeKeywordPresets(null).selected, "recent");
});

test("create snapshots recent keywords, persists edits and selection, and normalizes paths", () => {
  const { state, saved } = profile();
  const recent = ["人物>嘉宾", "", "室外"];
  const id = state().createPreset("我的新预设", recent);
  recent[2] = "改变";
  assert.equal(state().selected, id);
  assert.deepEqual(state().presets.at(-1).keywords.slice(0, 3), ["嘉宾<人物", "", "室外"]);
  state().save(id, ["近景", "", "远景"]);
  state().rename(id, "拍摄");
  const reopened = profile(saved()).state();
  assert.equal(reopened.selected, id);
  assert.equal(reopened.presets.at(-1).name, "拍摄");
  assert.deepEqual(reopened.presets.at(-1).keywords.slice(0, 3), ["近景", "", "远景"]);
});

test("builtin presets are editable and restore leaves custom presets intact", () => {
  const { state } = profile();
  const id = state().createPreset("保留", ["人物"]);
  for (const preset of defaultKeywordPresets()) {
    state().save(preset.id, ["改变"]);
    state().rename(preset.id, "不可重命名");
    state().remove(preset.id);
    const edited = state().presets.find((item) => item.id === preset.id);
    assert.equal(edited.name, preset.name);
    assert.equal(edited.keywords[0], "改变");
  }
  state().restore();
  assert.deepEqual(state().presets.slice(0, 6), defaultKeywordPresets());
  assert.equal(state().presets.at(-1).id, id);
});

test("delete retains active contents as transient custom until another selection", () => {
  const { state, saved } = profile();
  const id = state().createPreset("待删除", ["空镜", "", "近景"]);
  state().remove(id);
  assert.equal(state().selected, "custom");
  assert.deepEqual(state().custom.slice(0, 3), ["空镜", "", "近景"]);
  assert.equal(profile(saved()).state().custom, null);
  state().select("builtin:shot-size");
  assert.equal(state().custom, null);
  state().select("custom");
  assert.equal(state().selected, "builtin:shot-size");
});

test("editing recent keywords creates transient contents without changing presets or recent history", () => {
  const { state } = profile();
  const recent = ["人物", "", "室外"];
  state().save("recent", recent);
  recent[0] = "改变";
  assert.equal(state().selected, "custom");
  assert.equal(state().custom[0], "人物");
  assert.deepEqual(state().presets, defaultKeywordPresets());
  const id = state().createPreset("从自定保存", state().custom);
  assert.equal(state().selected, id);
  assert.equal(state().custom, null);
  assert.equal(state().presets.at(-1).keywords[2], "室外");
  state().select("recent");
  state().remove(id);
  assert.equal(state().selected, "recent");
  assert.equal(state().custom, null);
});

test("names reject blanks, reserved names and duplicates while allowing the same rename", () => {
  const { state } = profile();
  for (const name of [
    " ",
    ...defaultKeywordPresets().map((preset) => preset.name),
    "自定",
    "最近使用过的关键字",
  ])
    assert.equal(state().createPreset(name, []), null);
  const id = state().createPreset("人像", []);
  assert.equal(state().createPreset(" 人像 ", []), null);
  assert.equal(keywordPresetNameError("人像", state().presets, id), null);
  state().rename(id, "景别取景");
  assert.equal(state().presets.at(-1).name, "人像");
});

test("invalid profile data recovers defaults, and edited defaults survive reloading", () => {
  assert.deepEqual(profile("broken").state().presets, defaultKeywordPresets());
  const { state, saved } = profile();
  state().save("builtin:shot-size", ["新内容"]);
  assert.equal(
    profile(saved())
      .state()
      .presets.find((preset) => preset.id === "builtin:shot-size").keywords[0],
    "新内容",
  );
  const decoded = decodeKeywordPresets({
    selected: "missing",
    presets: [null, { id: "bad", name: "坏", keywords: [1] }],
  });
  assert.deepEqual(decoded.presets, defaultKeywordPresets());
  assert.equal(decoded.selected, "recent");
});

test("older profiles gain all six defaults and upgrade the unchanged former shot size preset", () => {
  const custom = { id: "preset:old", name: "自建集", keywords: ["自建关键字"] };
  const decoded = decodeKeywordPresets({
    selected: "builtin:shot-size",
    presets: [
      { id: "builtin:shot-size", name: "景别", keywords: ["特写", "近景", "中景", "远景", "空镜"] },
      custom,
    ],
  });
  assert.deepEqual(decoded.presets.slice(0, 6), defaultKeywordPresets());
  assert.equal(decoded.selected, "builtin:shot-size");
  assert.equal(decoded.presets.at(-1).id, custom.id);
  assert.equal(decoded.presets.at(-1).keywords[0], "自建关键字");

  const edited = decodeKeywordPresets({
    presets: [{ id: "builtin:shot-size", name: "景别", keywords: ["用户编辑"] }],
  });
  assert.equal(edited.presets[1].name, "景别取景");
  assert.equal(edited.presets[1].keywords[0], "用户编辑");
});

test("new builtin names cannot discard older custom presets with matching names", () => {
  const decoded = decodeKeywordPresets({
    selected: "preset:existing",
    presets: [{ id: "preset:existing", name: "画面主体", keywords: ["我的分类"] }],
  });
  assert.equal(decoded.selected, "preset:existing");
  assert.equal(decoded.presets.at(-1).name, "画面主体（自定义）");
  assert.equal(decoded.presets.at(-1).keywords[0], "我的分类");
  assert.equal(new Set(decoded.presets.map((preset) => preset.name)).size, decoded.presets.length);
  assert.deepEqual(decodeKeywordPresets(decoded), decoded);
});
