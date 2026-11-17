/**
 * A new reset key closes the cell editor. A timer that has not fired yet is
 * cancelled with it, so a delayed edit cannot open on the next source.
 */
export function cellEditReset(previousKey: string, nextKey: string, pendingTimer: number | null) {
  if (previousKey === nextKey) return null;
  return { cancelPendingTimer: pendingTimer !== null };
}
