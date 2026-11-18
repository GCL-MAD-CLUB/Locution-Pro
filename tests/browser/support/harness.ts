import type { Page } from "@playwright/test";

/** A fresh page isolates each React/module-state scenario; its harness owns unmounting. */
export async function runStateHarness(
  page: Page,
  file: `/tests/browser/state/${string}.harness.ts`,
  entry: string,
  argument?: unknown,
) {
  await page.goto("/tests/browser/support/blank.html");
  return page.evaluate(
    async ({ file, entry, argument }) => {
      const module = await import(/* @vite-ignore */ file);
      return module[entry](argument);
    },
    { file, entry, argument },
  );
}
