import stylesheet from "../styles.css?raw";
import { clientError } from "../errors/model";
import type { Appearance } from "../types";

// Non-DOM consumers (saved media defaults and standalone SVG images) read the
// same palette as CSS. Keep literal colors exclusively in styles.css.
const rootTheme = stylesheet.match(/:root[^{]*\{([^}]+)\}/)![1];
const defaultColors = new Map(
  Array.from(rootTheme.matchAll(/(--(?:color|palette)-[\w-]+):\s*([^;]+);/g), ([, name, value]) => [
    name,
    value.trim(),
  ]),
);

export function defaultThemeColor(name: string): string {
  const value = defaultColors.get(name);
  if (!value) throw clientError("UNEXPECTED_ERROR", `Unknown theme color: ${name}`);
  return value.replace(/var\(\s*(--(?:color|palette)-[\w-]+)\s*\)/g, (_, token: string) =>
    defaultThemeColor(token),
  );
}

let appearance: Appearance = "darkest";
const appearanceListeners = new Set<() => void>();

export const currentAppearance = () => appearance;

export function subscribeAppearance(listener: () => void) {
  appearanceListeners.add(listener);
  return () => {
    appearanceListeners.delete(listener);
  };
}

export function applyAppearance(next: Appearance) {
  document.documentElement.dataset.theme = next;
  initializeThemeImages();
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
const mediaDisplayColors = new Map(
  mediaColorTokens.map((token) => [defaultThemeColor(token).toLowerCase(), `var(${token})`]),
);

/** Saved/custom colors remain data; built-in media labels follow the active appearance. */
export function mediaDisplayColor(color: string): string {
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
  for (const [, name, svg] of rootTheme.matchAll(/(--image-[\w-]+):\s*"([^"]+)";/g)) {
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
