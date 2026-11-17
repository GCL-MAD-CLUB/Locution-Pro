export interface SelectionChoice {
  value: string;
  disabled: boolean;
}

/** The value to select when the current one disappeared or became disabled. */
export function fallbackSelectionValue(
  items: readonly SelectionChoice[],
  selected: string | null | undefined,
): string | null | undefined {
  const selectedItem = items.find((item) => item.value === selected);
  if (selectedItem && !selectedItem.disabled) return undefined;
  return items.find((item) => !item.disabled)?.value ?? items[0]?.value ?? null;
}
