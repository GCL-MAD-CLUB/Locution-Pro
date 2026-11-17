/**
 * Selection in the queue's flat row list (each source followed by its
 * outputs), driven by pointer and keyboard like a file list: plain moves
 * select one row, Shift extends from the anchor, Ctrl moves or toggles
 * without changing the rest of the selection.
 */
export interface TranscodeQueueCursor {
  selectedIds: readonly string[];
  /** The row a Shift range starts from. */
  anchorId: string | null;
  /** The row the keyboard is on. */
  focusId: string | null;
}

export type TranscodeQueueMove = "up" | "down" | "pageUp" | "pageDown" | "home" | "end";

interface Modifiers {
  extend?: boolean;
  toggle?: boolean;
}

const pageRows = 10;
const steps = { up: -1, down: 1, pageUp: -pageRows, pageDown: pageRows } as const;

function targetIndex(index: number, last: number, move: TranscodeQueueMove) {
  if (move === "home") return 0;
  if (move === "end") return last;
  if (index < 0) return steps[move] < 0 ? last : 0;
  return Math.min(last, Math.max(0, index + steps[move]));
}

function rangeIds(rowIds: readonly string[], fromId: string, toId: string) {
  const from = rowIds.indexOf(fromId);
  const to = rowIds.indexOf(toId);
  if (from < 0 || to < 0) return [toId];
  return rowIds.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Selects a row the way a click does: Shift selects a range, Ctrl toggles the row. */
export function clickQueueRow(
  rowIds: readonly string[],
  cursor: TranscodeQueueCursor,
  id: string,
  { extend = false, toggle = false }: Modifiers = {},
): TranscodeQueueCursor {
  if (extend && cursor.anchorId && rowIds.includes(cursor.anchorId)) {
    return { ...cursor, selectedIds: rangeIds(rowIds, cursor.anchorId, id), focusId: id };
  }
  if (toggle) {
    const selectedIds = cursor.selectedIds.includes(id)
      ? cursor.selectedIds.filter((item) => item !== id)
      : [...cursor.selectedIds, id];
    return { selectedIds, anchorId: id, focusId: id };
  }
  return { selectedIds: [id], anchorId: id, focusId: id };
}

/** Moves the keyboard row; without a current row, Down starts at the top and Up at the bottom. */
export function moveQueueCursor(
  rowIds: readonly string[],
  cursor: TranscodeQueueCursor,
  move: TranscodeQueueMove,
  { extend = false, toggle = false }: Modifiers = {},
): TranscodeQueueCursor {
  if (rowIds.length === 0) return cursor;
  const index = cursor.focusId ? rowIds.indexOf(cursor.focusId) : -1;
  const target = rowIds[targetIndex(index, rowIds.length - 1, move)];
  if (toggle) return { ...cursor, focusId: target };
  if (extend) {
    const anchorId =
      cursor.anchorId && rowIds.includes(cursor.anchorId)
        ? cursor.anchorId
        : (cursor.focusId ?? target);
    return { selectedIds: rangeIds(rowIds, anchorId, target), anchorId, focusId: target };
  }
  return { selectedIds: [target], anchorId: target, focusId: target };
}

/** Ctrl+Space: adds or removes the keyboard row from the selection. */
export function toggleQueueFocus(cursor: TranscodeQueueCursor): TranscodeQueueCursor {
  if (!cursor.focusId) return cursor;
  return clickQueueRow([], cursor, cursor.focusId, { toggle: true });
}
