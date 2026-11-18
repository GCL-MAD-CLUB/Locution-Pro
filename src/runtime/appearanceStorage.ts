import type { Appearance } from "../types";

export const appearanceStorageKey = "locution-pro:appearance";
export const knownAppearances = [
  "darkest",
  "dark",
  "light",
] as const satisfies readonly Appearance[];

// Also serialized into the generated HTML head. Keep dependencies as parameters.
export function readAppearanceHint<T extends string>(key: string, choices: readonly T[]): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return choices.find((candidate) => candidate === value) ?? null;
  } catch {
    return null;
  }
}

export function storedAppearance(): Appearance | null {
  return readAppearanceHint(appearanceStorageKey, knownAppearances);
}

export function seedAppearanceHint(
  read: typeof readAppearanceHint,
  key: string,
  choices: readonly Appearance[],
) {
  const appearance = read(key, choices);
  if (appearance) document.documentElement.dataset.theme = appearance;
}
