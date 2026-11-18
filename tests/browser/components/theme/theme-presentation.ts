import type { Page } from "@playwright/test";

export function generatedThemeImages(page: Page) {
  return page.evaluate(async () => {
    const source = "/src/components/common/AnnotationTools/sprayToolModifiers.ts";
    const cursors: typeof import("../../../../src/components/common/AnnotationTools/sprayToolModifiers") =
      await import(/* @vite-ignore */ source);
    return {
      checkbox: decodeURIComponent(
        document.documentElement.style.getPropertyValue("--image-checkbox-check"),
      ),
      flag: decodeURIComponent(
        document.documentElement.style.getPropertyValue("--image-flag-excluded"),
      ),
      overlay: decodeURIComponent(
        document.documentElement.style.getPropertyValue("--image-flag-overlay-excluded"),
      ),
      cursor: decodeURIComponent(cursors.sprayEraserCursor()),
    };
  });
}
