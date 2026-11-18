/**
 * Highlight focus follows the active row when that row is a hit.
 * Otherwise it keeps the previous hit, and it clears when highlight search is off.
 */
export function focusedSearchHitId(input: {
  highlight: boolean;
  query: string;
  activeId: string | null;
  activeIsHit: boolean;
  previousHitId: string | null;
}): string | null {
  if (!input.highlight || !input.query.trim()) return null;
  if (input.activeId && input.activeIsHit) return input.activeId;
  return input.previousHitId;
}
