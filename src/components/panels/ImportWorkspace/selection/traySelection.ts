/** Selection keys that still name an item in the tray. Same set when nothing dropped out. */
export function traySelectionForItems(
  selected: ReadonlySet<string>,
  itemKeys: readonly string[],
): Set<string> {
  const available = new Set(itemKeys);
  for (const key of selected) {
    if (!available.has(key)) {
      return new Set([...selected].filter((item) => available.has(item)));
    }
  }
  return selected as Set<string>;
}
