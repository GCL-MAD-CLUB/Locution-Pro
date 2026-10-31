import stylesheet from "../styles.css?raw";
import { clientError } from "../errors/model";
import type { Appearance } from "../types";

// Non-DOM consumers (saved media defaults and standalone SVG images) read the
// same palette as CSS. Keep literal colors exclusively in styles.css. Parsing is
// lazy so a malformed stylesheet surfaces at the point of use instead of during
// module evaluation, where no error boundary can report it.
let themeSource: string | undefined;
let defaultColors: Map<string, string> | undefined;

function themeBlock(): string {
  if (themeSource === undefined) {
    const match = stylesheet.match(/:root[^{]*\{([^}]+)\}/);
    if (!match) throw clientError("UNEXPECTED_ERROR", "styles.css is missing a :root theme block.");
    themeSource = match[1];
  }
  return themeSource;
}

export function defaultThemeColor(name: string): string {
  defaultColors ??= new Map(
    Array.from(
      themeBlock().matchAll(/(--(?:color|palette)-[\w-]+):\s*([^;]+);/g),
      ([, token, value]) => [token, value.trim()],
    ),
  );
  const value = defaultColors.get(name);
  if (!value) throw clientError("UNEXPECTED_ERROR", `Unknown theme color: ${name}`);
  return value.replace(/var\(\s*(--(?:color|palette)-[\w-]+)\s*\)/g, (_, token: string) =>
    defaultThemeColor(token),
  );
}

// index.html reads this key in its head script; the tooling theme test keeps the
// two in sync.
export const appearanceStorageKey = "locution-pro:appearance";
export const knownAppearances = [
  "darkest",
  "dark",
  "light",
] as const satisfies readonly Appearance[];

let appearance: Appearance = "darkest";
const appearanceListeners = new Set<() => void>();

export const currentAppearance = () => appearance;

export function subscribeAppearance(listener: () => void) {
  appearanceListeners.add(listener);
  return () => {
    appearanceListeners.delete(listener);
  };
}

function storedAppearance(): Appearance | null {
  try {
    const value = window.localStorage.getItem(appearanceStorageKey);
    return knownAppearances.find((candidate) => candidate === value) ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply the last recorded appearance before the first paint. Preferences loaded
 * from the backend stay authoritative and reconcile this hint afterwards.
 */
export function initializeAppearance() {
  applyAppearance(storedAppearance() ?? appearance);
}

/** `remember` is false for unsaved previews, which must not seed the next start. */
export function applyAppearance(next: Appearance, remember = true) {
  document.documentElement.dataset.theme = next;
  initializeThemeImages();
  if (remember) {
    try {
      window.localStorage.setItem(appearanceStorageKey, next);
    } catch {
      // Storage only backs the pre-paint hint; unavailable storage is harmless.
    }
  }
  if (appearance === next) return;
  appearance = next;
  for (const listener of appearanceListeners) listener();
}

const mediaColorTokens = [
  "--color-media-video",
  "--color-media-video-audio",
  "--color-media-audio",
  "--color-media-subtitle",
  "--color-media-folder",
];
let mediaDisplayColors: Map<string, string> | undefined;

/** Saved/custom colors remain data; built-in media labels follow the active appearance. */
export function mediaDisplayColor(color: string): string {
  mediaDisplayColors ??= new Map(
    mediaColorTokens.map((token) => [defaultThemeColor(token).toLowerCase(), `var(${token})`]),
  );
  return mediaDisplayColors.get(color.trim().toLowerCase()) ?? color;
}

/** Resolve CSS variables before encoding an SVG: data URLs cannot inherit them. */
export function themeSvgDataUrl(svg: string): string {
  const theme =
    typeof document === "undefined" ? undefined : getComputedStyle(document.documentElement);
  const resolved = svg.replace(
    /var\(\s*(--color-[\w-]+)\s*\)/g,
    (_, token: string) => theme?.getPropertyValue(token).trim() || defaultThemeColor(token),
  );
  return `data:image/svg+xml,${encodeURIComponent(resolved)}`;
}

/** Materialize the shared CSS image templates before mounting the frontend. */
export function initializeThemeImages() {
  for (const [, name, svg] of themeBlock().matchAll(/(--image-[\w-]+):\s*"([^"]+)";/g)) {
    document.documentElement.style.setProperty(name, `url("${themeSvgDataUrl(svg)}")`);
  }
}

export const annotationColors = {
  red: "var(--color-label-red)",
  yellow: "var(--color-label-yellow)",
  green: "var(--color-label-green)",
  blue: "var(--color-label-blue)",
  purple: "var(--color-label-purple)",
  custom: "var(--color-label-custom)",
  none: "var(--color-label-none)",
} as const;
