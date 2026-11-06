import assert from "node:assert/strict";
import { test } from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

const module = createModuleLoader(import.meta.url)(
  "../../../src/components/common/ApplicationMenu/nativeMenu.ts",
);
// The module runs in its own realm; clone the plain entries into this one.
const buildNativeMenu = (...args) => {
  const menu = module.buildNativeMenu(...args);
  return { entries: structuredClone(menu.entries), commands: menu.commands };
};

function createModel(calls, enabled = true) {
  const command = (name, isEnabled = enabled) => ({
    enabled: isEnabled,
    execute: () => calls.push(name),
  });
  const toggle = (name, label, checked) => ({ ...command(name), label, checked });
  return {
    file: {
      newProject: command("newProject"),
      openProject: command("openProject"),
      recentProjects: {
        enabled: true,
        items: [{ id: "/projects/a.lpp", label: "a.lpp", execute: () => calls.push("a") }],
      },
      closeFocusedPanel: command("closeFocusedPanel"),
      closeProject: command("closeProject"),
      saveProject: command("saveProject"),
      saveProjectAs: command("saveProjectAs"),
      saveProjectCopy: command("saveProjectCopy"),
      restoreProject: command("restoreProject"),
      replaceMedia: command("replaceMedia"),
      linkMedia: command("linkMedia"),
      makeMediaOffline: command("makeMediaOffline"),
      importMedia: command("importMedia"),
      recentMedia: { enabled: true, items: [] },
      exportSelection: command("exportSelection"),
      quickExportSelection: command("quickExportSelection"),
      exit: command("exit"),
    },
    edit: {
      undo: command("undo"),
      redo: command("redo"),
      copy: command("copy"),
      paste: command("paste"),
      clear: command("clear"),
      duplicate: command("duplicate"),
      selectAll: command("selectAll"),
      clearSelection: command("clearSelection"),
      preferences: {
        enabled: true,
        items: [
          { id: "general", label: "常规", execute: () => calls.push("general") },
          { id: "media", label: "媒体", execute: () => calls.push("media") },
        ],
      },
    },
    window: {
      source: toggle("source", "源", true),
      project: { enabled: true, items: [{ id: "p1", ...toggle("p1", "　项目 1", false) }] },
      subtitles: toggle("subtitles", "字幕", false),
      storyboard: toggle("storyboard", "分镜", true),
      history: toggle("history", "历史记录", false),
    },
    help: {
      aboutLocutionPro: command("about"),
      checkForUpdates: command("checkForUpdates"),
      locutionProHelp: command("help"),
      showLogFiles: command("showLogFiles"),
    },
  };
}

function find(entries, predicate) {
  for (const entry of entries) {
    if (predicate(entry)) return entry;
    if (entry.kind === "submenu") {
      const found = find(entry.items, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

test("the menu bar follows the macOS layout with system roles", () => {
  const { entries } = buildNativeMenu(createModel([]), false);
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.label, entry.role]),
    [
      ["submenu", "Locution Pro", undefined],
      ["submenu", "文件", undefined],
      ["submenu", "编辑", undefined],
      ["submenu", "窗口", "window"],
      ["submenu", "帮助", "help"],
    ],
  );
  const appMenu = entries[0].items;
  assert.equal(appMenu.at(-1).id, "app.quit");
  assert.equal(appMenu.at(-1).accelerator, "Cmd+Q");
  assert.ok(appMenu.some((entry) => entry.kind === "predefined" && entry.action === "services"));
  const settings = find(entries, (entry) => entry.label === "设置");
  assert.deepEqual(
    settings.items.map((entry) => [entry.id, entry.accelerator]),
    [
      ["app.settings.general", "Cmd+Comma"],
      ["app.settings.media", undefined],
    ],
  );
  const project = find(entries, (entry) => entry.id === "window.project.p1");
  assert.equal(project.kind, "check");
  assert.equal(project.label, "　项目 1");
  assert.equal(find(entries, (entry) => entry.label === "导入最近使用的文件").enabled, false);
});

test("every item id resolves to its command", () => {
  const calls = [];
  const { entries, commands } = buildNativeMenu(createModel(calls), false);
  const ids = [];
  const collect = (items) =>
    items.forEach((entry) => {
      if (entry.id) ids.push(entry.id);
      if (entry.kind === "submenu") collect(entry.items);
    });
  collect(entries);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...commands.keys()].sort(), ids.sort());
  commands.get("file.save").execute();
  commands.get("file.recentProject:/projects/a.lpp").execute();
  commands.get("app.settings.media").execute();
  assert.deepEqual(calls, ["saveProject", "a", "media"]);
});

test("text editing items stay enabled while a text field has focus", () => {
  const model = createModel([], false);
  const idle = buildNativeMenu(model, false);
  const editing = buildNativeMenu(model, true);
  const enabled = (menu, id) => find(menu.entries, (entry) => entry.id === id).enabled;
  for (const id of ["edit.undo", "edit.redo", "edit.copy", "edit.paste", "edit.selectAll"]) {
    assert.equal(enabled(idle, id), false, id);
    assert.equal(enabled(editing, id), true, id);
  }
  assert.equal(enabled(editing, "edit.duplicate"), false);
  assert.equal(editing.commands.get("edit.copy").editAction, "copy");
  assert.equal(editing.commands.get("edit.copy").enabled, false);
});
