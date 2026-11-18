import { useMemo, useRef, useState } from "react";
import { pathKey } from "../browser/importBrowserModel";
import type { ImportSelectionItem } from "../browser/importFolderScan";
import { traySelectionForItems } from "./traySelection";

interface TraySelectionModifiers {
  range: boolean;
  toggle: boolean;
}

export function useImportTraySelection(items: ImportSelectionItem[]) {
  const [selection, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef("");
  const itemKeys = useMemo(() => items.map((item) => pathKey(item.entry.path)), [items]);
  const selected = traySelectionForItems(selection, itemKeys);

  function select(path: string, { range, toggle }: TraySelectionModifiers) {
    const key = pathKey(path);
    const targetIndex = itemKeys.indexOf(key);
    const anchorIndex = itemKeys.indexOf(anchor.current);
    if (range && targetIndex >= 0 && anchorIndex >= 0) {
      const rangeKeys = itemKeys.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      );
      setSelected(
        (current) =>
          new Set(toggle ? [...traySelectionForItems(current, itemKeys), ...rangeKeys] : rangeKeys),
      );
      return;
    }
    if (toggle) {
      setSelected((current) => {
        const next = new Set(traySelectionForItems(current, itemKeys));
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      setSelected(new Set([key]));
    }
    anchor.current = key;
  }

  function selectForContextMenu(path: string) {
    const key = pathKey(path);
    if (selected.has(key)) return;
    setSelected(new Set([key]));
    anchor.current = key;
  }

  function selectAll() {
    setSelected(new Set(itemKeys));
    anchor.current = itemKeys.at(-1) ?? "";
  }

  function clearSelection() {
    setSelected(new Set());
    anchor.current = "";
  }

  const selectedPaths = items
    .filter((item) => selected.has(pathKey(item.entry.path)))
    .map((item) => item.entry.path);

  return {
    selected,
    selectedPaths,
    select,
    selectForContextMenu,
    selectAll,
    clearSelection,
  };
}
