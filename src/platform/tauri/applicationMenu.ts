import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../errors";

/** Standard AppKit editing actions, applied to the focused text field. */
export type NativeEditAction = "undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "selectAll";

export type NativePredefinedAction =
  | "services"
  | "hide"
  | "hideOthers"
  | "showAll"
  | "minimize"
  | "zoom"
  | "fullscreen"
  | "cut"
  | "bringAllToFront";

/** Serializable macOS menu bar description; mirrors the native command. */
export type NativeMenuEntry =
  | { kind: "item"; id: string; label: string; enabled: boolean; accelerator?: string }
  | { kind: "check"; id: string; label: string; enabled: boolean; checked: boolean }
  | {
      kind: "submenu";
      label: string;
      enabled: boolean;
      items: NativeMenuEntry[];
      role?: "window" | "help";
    }
  | { kind: "separator" }
  | { kind: "predefined"; action: NativePredefinedAction; label: string };

export async function setNativeApplicationMenu(menu: NativeMenuEntry[]) {
  await invokeCommand("set_application_menu", { menu });
}

export async function performNativeEditAction(action: NativeEditAction) {
  await invokeCommand("perform_native_edit_action", { action });
}

/** Resolves to an unlisten function; the payload is the selected item id. */
export function listenToNativeApplicationMenu(onSelect: (id: string) => void) {
  return listen<string>("application-menu", ({ payload }) => onSelect(payload));
}
