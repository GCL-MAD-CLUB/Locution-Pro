import { assetLibraryViewPresets } from "../../../core/editor/assetLibrary";

export interface AssetLibraryKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface AssetLibraryKeyContext {
  itemCount: number;
  /** Index of the focused item, or -1. */
  focusIndex: number;
  /** Items per row in icon view; `null` in the list. */
  iconColumns: number | null;
  /** First index of each shown group; each group starts its own rows of icons. */
  groupStarts?: readonly number[];
  hasSelection: boolean;
}

export type AssetLibraryKeyCommand =
  | { kind: "back" | "forward" | "up" | "properties" | "address" | "search" | "contextMenu" }
  | { kind: "toggleDetails" }
  | { kind: "newFolder" | "cut" | "toggleFocused" | "open" | "rename" | "clearSelection" }
  | { kind: "viewPreset"; size: number }
  /** Moves focus to `index`; Shift extends and Ctrl keeps the selection, as in a file manager. */
  | { kind: "move"; index: number; extend: boolean; keepSelection: boolean };

/** Keys a focused button handles itself instead of the panel. */
export const assetLibraryButtonKeys: ReadonlySet<string> = new Set([
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export function isAssetLibraryEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === "INPUT" ||
    element?.tagName === "TEXTAREA" ||
    element?.tagName === "SELECT" ||
    Boolean(element?.isContentEditable)
  );
}

/** Ctrl+Shift+digit view presets, keyed by physical key because Shift changes `key`. */
const viewPresetByCode = new Map(
  assetLibraryViewPresets.map((preset) => [`Digit${preset.shortcut.slice(-1)}`, preset]),
);

/**
 * Up or down one row of icons. Each group lays out its own rows, so leaving a group's first
 * or last row lands in the same column of the neighboring group's nearest row.
 */
function iconRowTarget(index: number, down: boolean, context: AssetLibraryKeyContext) {
  const columns = context.iconColumns!;
  const last = context.itemCount - 1;
  const starts = (context.groupStarts ?? []).filter((start) => start > 0 && start <= last);
  const groupIndex = starts.filter((start) => start <= index).length;
  const bounds = [0, ...starts, last + 1];
  const start = bounds[groupIndex]!;
  const end = bounds[groupIndex + 1]!;
  const column = (index - start) % columns;
  if (down) {
    if (index + columns < end) return index + columns;
    const lastRowStart = start + Math.floor((end - 1 - start) / columns) * columns;
    if (index < lastRowStart || end > last) return end - 1;
    return Math.min(bounds[groupIndex + 2]! - 1, end + column);
  }
  if (index - columns >= start) return index - columns;
  if (start === 0) return index - columns;
  const previousStart = bounds[groupIndex - 1]!;
  const previousLastRow =
    previousStart + Math.floor((start - 1 - previousStart) / columns) * columns;
  return Math.min(start - 1, previousLastRow + column);
}

/**
 * File-manager keys for the item pane. Returns `null` for keys the panel leaves to others,
 * such as annotation shortcuts and the application's edit commands.
 */
export function assetLibraryKeyCommand(
  input: AssetLibraryKeyInput,
  context: AssetLibraryKeyContext,
): AssetLibraryKeyCommand | null {
  const ctrl = input.ctrlKey || input.metaKey;
  const { key, shiftKey, altKey } = input;
  const lowered = key.toLocaleLowerCase();
  if (altKey && !ctrl) {
    if (key === "ArrowLeft") return { kind: "back" };
    if (key === "ArrowRight") return { kind: "forward" };
    if (key === "ArrowUp") return { kind: "up" };
    if (key === "Enter") return { kind: "properties" };
    // Physical key: Alt changes `key` on macOS.
    if (shiftKey && input.code === "KeyP") return { kind: "toggleDetails" };
    if (lowered === "d") return { kind: "address" };
    return null;
  }
  if (key === "F4" || (ctrl && !shiftKey && lowered === "l")) return { kind: "address" };
  if (key === "F3" || (ctrl && !shiftKey && (lowered === "f" || lowered === "e"))) {
    return { kind: "search" };
  }
  if (key === "ContextMenu" || (shiftKey && key === "F10")) return { kind: "contextMenu" };
  const preset = ctrl && shiftKey ? viewPresetByCode.get(input.code) : undefined;
  if (preset) return { kind: "viewPreset", size: preset.size };
  if (ctrl && shiftKey && lowered === "n") return { kind: "newFolder" };
  if (ctrl && !shiftKey && key === " ") {
    return context.focusIndex >= 0 ? { kind: "toggleFocused" } : null;
  }
  if (ctrl && !shiftKey && lowered === "x") return { kind: "cut" };

  const rowStep = context.iconColumns ?? 1;
  const steps: Record<string, number> = {
    ArrowUp: -rowStep,
    ArrowDown: rowStep,
    ...(context.iconColumns === null ? {} : { ArrowLeft: -1, ArrowRight: 1 }),
  };
  const last = context.itemCount - 1;
  const verticalIcons = context.iconColumns !== null && (key === "ArrowUp" || key === "ArrowDown");
  const target =
    key in steps
      ? context.focusIndex < 0
        ? 0
        : verticalIcons
          ? iconRowTarget(context.focusIndex, key === "ArrowDown", context)
          : context.focusIndex + steps[key]!
      : key === "Home"
        ? 0
        : key === "End"
          ? last
          : null;
  if (target !== null) {
    if (last < 0) return null;
    return {
      kind: "move",
      index: Math.min(last, Math.max(0, target)),
      extend: shiftKey,
      keepSelection: ctrl,
    };
  }
  if (ctrl) return null;
  if (key === "Enter") return { kind: "open" };
  if (key === "F2") return { kind: "rename" };
  if (key === "Escape" && context.hasSelection) return { kind: "clearSelection" };
  return null;
}
