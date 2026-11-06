import type { NativeEditAction, NativeMenuEntry } from "../../../platform/tauri/applicationMenu";
import type { ApplicationMenuModel } from "./ApplicationMenu";

type Handler = () => void | Promise<void>;

export interface NativeMenuCommand {
  enabled: boolean;
  execute: Handler;
  /** While a text field has focus, the item edits text instead. */
  editAction?: NativeEditAction;
  /** AppKit flips the checkmark on click, before the model decides. */
  check?: boolean;
}

export interface NativeMenu {
  entries: NativeMenuEntry[];
  commands: Map<string, NativeMenuCommand>;
}

/**
 * Lays the in-window menu model out as a macOS menu bar: the application menu
 * gains About, Settings, the standard Services/Hide items and Quit; Window
 * gains the standard window items; mnemonics are dropped and shortcuts use
 * Command. The app's own keydown handlers still own every shortcut; the menu
 * only receives a key equivalent the page left unhandled (in text fields).
 */
export function buildNativeMenu(model: ApplicationMenuModel, editingText: boolean): NativeMenu {
  const { file, edit, window: windowMenu, help } = model;
  const commands = new Map<string, NativeMenuCommand>();

  function item(
    id: string,
    label: string,
    command: { enabled: boolean; execute: Handler },
    accelerator?: string,
    editAction?: NativeEditAction,
  ): NativeMenuEntry {
    commands.set(id, { enabled: command.enabled, execute: command.execute, editAction });
    const enabled = command.enabled || (editAction !== undefined && editingText);
    return accelerator
      ? { kind: "item", id, label, enabled, accelerator }
      : { kind: "item", id, label, enabled };
  }

  function check(
    id: string,
    entry: { label: string; enabled: boolean; checked: boolean; execute: Handler },
  ): NativeMenuEntry {
    commands.set(id, { enabled: entry.enabled, execute: entry.execute, check: true });
    return {
      kind: "check",
      id,
      label: entry.label,
      enabled: entry.enabled,
      checked: entry.checked,
    };
  }

  function recent(
    prefix: string,
    label: string,
    group: ApplicationMenuModel["file"]["recentProjects"],
  ): NativeMenuEntry {
    return {
      kind: "submenu",
      label,
      enabled: group.enabled && group.items.length > 0,
      // Keyed by path, not position: a selection from a menu built before the
      // list reordered must still open the entry it showed.
      items: group.items.map((entry) =>
        item(`${prefix}:${entry.id}`, entry.label, {
          enabled: group.enabled,
          execute: entry.execute,
        }),
      ),
    };
  }

  const separator: NativeMenuEntry = { kind: "separator" };

  const applicationMenu: NativeMenuEntry = {
    kind: "submenu",
    label: "Locution Pro",
    enabled: true,
    items: [
      item("app.about", "关于 Locution Pro", help.aboutLocutionPro),
      item("app.checkForUpdates", "检查更新…", help.checkForUpdates),
      separator,
      {
        kind: "submenu",
        label: "设置",
        enabled: edit.preferences.enabled,
        items: edit.preferences.items.map((category, index) =>
          item(
            `app.settings.${category.id}`,
            `${category.label}…`,
            { enabled: edit.preferences.enabled, execute: category.execute },
            index === 0 ? "Cmd+Comma" : undefined,
          ),
        ),
      },
      separator,
      { kind: "predefined", action: "services", label: "服务" },
      separator,
      { kind: "predefined", action: "hide", label: "隐藏 Locution Pro" },
      { kind: "predefined", action: "hideOthers", label: "隐藏其他" },
      { kind: "predefined", action: "showAll", label: "全部显示" },
      separator,
      item("app.quit", "退出 Locution Pro", file.exit, "Cmd+Q"),
    ],
  };

  const fileMenu: NativeMenuEntry = {
    kind: "submenu",
    label: "文件",
    enabled: true,
    items: [
      item("file.newProject", "新建项目…", file.newProject, "Cmd+N"),
      item("file.openProject", "打开项目…", file.openProject, "Cmd+O"),
      recent("file.recentProject", "打开最近使用的项目", file.recentProjects),
      separator,
      item("file.close", "关闭", file.closeFocusedPanel, "Cmd+W"),
      item("file.closeProject", "关闭项目", file.closeProject, "Cmd+Shift+W"),
      item("file.save", "保存", file.saveProject, "Cmd+S"),
      item("file.saveAs", "另存为…", file.saveProjectAs, "Cmd+Shift+S"),
      item("file.saveCopy", "保存副本…", file.saveProjectCopy, "Cmd+Alt+S"),
      item("file.restore", "还原", file.restoreProject),
      separator,
      item("file.replaceMedia", "替换素材…", file.replaceMedia),
      item("file.linkMedia", "链接媒体…", file.linkMedia),
      item("file.makeMediaOffline", "设为脱机…", file.makeMediaOffline),
      separator,
      item("file.import", "导入…", file.importMedia, "Cmd+I"),
      recent("file.recentMedia", "导入最近使用的文件", file.recentMedia),
      separator,
      item("file.export", "导出…", file.exportSelection, "Cmd+Shift+E"),
      item("file.quickExport", "使用上次设置导出", file.quickExportSelection, "Cmd+Alt+Shift+E"),
    ],
  };

  const editMenu: NativeMenuEntry = {
    kind: "submenu",
    label: "编辑",
    enabled: true,
    items: [
      item("edit.undo", "撤销", edit.undo, "Cmd+Z", "undo"),
      item("edit.redo", "重做", edit.redo, "Cmd+Shift+Z", "redo"),
      separator,
      { kind: "predefined", action: "cut", label: "剪切" },
      item("edit.copy", "复制", edit.copy, "Cmd+C", "copy"),
      item("edit.paste", "粘贴", edit.paste, "Cmd+V", "paste"),
      // No key equivalent: a bare Delete would be taken from text fields.
      item("edit.clear", "清除", edit.clear, undefined, "delete"),
      separator,
      item("edit.duplicate", "重复", edit.duplicate),
      item("edit.selectAll", "全选", edit.selectAll, "Cmd+A", "selectAll"),
      item("edit.clearSelection", "取消全选", edit.clearSelection, "Cmd+Shift+A"),
    ],
  };

  const windowMenuEntry: NativeMenuEntry = {
    kind: "submenu",
    label: "窗口",
    enabled: true,
    role: "window",
    items: [
      { kind: "predefined", action: "minimize", label: "最小化" },
      { kind: "predefined", action: "zoom", label: "缩放" },
      { kind: "predefined", action: "fullscreen", label: "进入全屏幕" },
      separator,
      check("window.source", windowMenu.source),
      {
        kind: "submenu",
        label: "项目",
        enabled: windowMenu.project.enabled,
        items: windowMenu.project.items.map((entry) => check(`window.project.${entry.id}`, entry)),
      },
      check("window.subtitles", windowMenu.subtitles),
      check("window.storyboard", windowMenu.storyboard),
      check("window.history", windowMenu.history),
      separator,
      { kind: "predefined", action: "bringAllToFront", label: "前置全部窗口" },
    ],
  };

  const helpMenu: NativeMenuEntry = {
    kind: "submenu",
    label: "帮助",
    enabled: true,
    role: "help",
    items: [
      item("help.guide", "Locution Pro 帮助", help.locutionProHelp),
      item("help.logFiles", "显示日志文件", help.showLogFiles),
    ],
  };

  return {
    entries: [applicationMenu, fileMenu, editMenu, windowMenuEntry, helpMenu],
    commands,
  };
}
