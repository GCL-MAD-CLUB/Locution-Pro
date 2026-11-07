import { useEffect, useMemo, useRef, useState } from "react";
import { runBackgroundOperation } from "../../../errors";
import {
  listenToNativeApplicationMenu,
  performNativeEditAction,
  setNativeApplicationMenu,
} from "../../../platform/tauri/applicationMenu";
import type { ApplicationMenuModel } from "./ApplicationMenu";
import { buildNativeMenu } from "./nativeMenu";

// Matches the app's own shortcut handling, which leaves these to the browser.
function isTextEditingElement(element: EventTarget | null) {
  const target = element as HTMLElement | null;
  return (
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.tagName === "SELECT" ||
    Boolean(target?.isContentEditable)
  );
}

interface NativeApplicationMenuProps {
  model: ApplicationMenuModel;
}

/** Mirrors the application menu model into the macOS menu bar. */
export function NativeApplicationMenu({ model }: NativeApplicationMenuProps) {
  const [editingText, setEditingText] = useState(() =>
    isTextEditingElement(document.activeElement),
  );
  const menu = useMemo(() => buildNativeMenu(model, editingText), [model, editingText]);
  const commandsRef = useRef(menu.commands);
  const description = JSON.stringify(menu.entries);

  useEffect(() => {
    commandsRef.current = menu.commands;
  }, [menu]);

  // Bumped after a check item runs: AppKit already flipped its checkmark, so
  // reinstall even when the command left the model, and so the description,
  // unchanged.
  const [resync, setResync] = useState(0);

  useEffect(() => {
    runBackgroundOperation("app.menu", () => setNativeApplicationMenu(JSON.parse(description)));
  }, [description, resync]);

  // Text editing items stay enabled for a focused field even when the app has
  // nothing to copy or undo, so their key equivalents keep working there.
  // Read the active element once focus settles: when the window resigns key,
  // WebKit sends focusout but the field remains the document's active element.
  useEffect(() => {
    let pending: number | undefined;
    const update = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() =>
        setEditingText(isTextEditingElement(document.activeElement)),
      );
    };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      window.clearTimeout(pending);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const onSelect = (id: string) => {
      const command = commandsRef.current.get(id);
      if (!command) return;
      const editAction = command.editAction;
      if (editAction && isTextEditingElement(document.activeElement)) {
        runBackgroundOperation("app.menu", () => performNativeEditAction(editAction));
        return;
      }
      if (command.check) {
        const result = command.enabled ? command.execute() : undefined;
        void Promise.resolve(result).finally(() => setResync((count) => count + 1));
        return;
      }
      if (command.enabled) void command.execute();
    };
    runBackgroundOperation("app.menu", async () => {
      const stop = await listenToNativeApplicationMenu(onSelect);
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}
