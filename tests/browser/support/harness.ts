import type { Page } from "@playwright/test";

/** A fresh page isolates each React/module-state scenario; its harness owns unmounting. */
export async function runStateHarness(page: Page, file: string, entry: string, argument?: unknown) {
  await page.goto("/tests/browser/support/blank.html");
  return page.evaluate(
    async ({ file, entry, argument }) => {
      const module = await import(/* @vite-ignore */ `/tests/browser/state/${file}.harness.js`);
      return module[entry](argument);
    },
    { file, entry, argument },
  );
}
