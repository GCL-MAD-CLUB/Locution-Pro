/** "Show only selected" cannot stay on once nothing is selected. */
export function withoutEmptySelectionFilter<T extends { showOnlySelected: boolean }>(
  selectedCount: number,
  session: T,
): T {
  if (selectedCount === 0 && session.showOnlySelected) {
    return { ...session, showOnlySelected: false };
  }
  return session;
}
