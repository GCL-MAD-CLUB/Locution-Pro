/**
 * Keep keyboard selection inside the rows that are still on screen.
 * Returns the next focus and anchor when the current focus left the list.
 */
export function selectionFocusForVisibleIds(
  visibleIds: readonly string[],
  focusId: string | null,
): { focusId: string | null; anchorId: string | null } | null {
  if (visibleIds.length === 0) {
    return { focusId: null, anchorId: null };
  }
  if (focusId && visibleIds.includes(focusId)) return null;
  const fallbackId = visibleIds[visibleIds.length - 1]!;
  return { focusId: fallbackId, anchorId: fallbackId };
}
