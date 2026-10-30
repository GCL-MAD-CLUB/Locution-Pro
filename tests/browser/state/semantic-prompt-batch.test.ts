import { test, expect } from "../support/fixtures";

for (const kind of ["subtitle", "storyboard"]) {
  test(`${kind} batches prompts, preserves initialization and rejects invalid or stale requests`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/support/blank.html");
    const result = await page.evaluate(async (kind) => {
      const path = "/tests/browser/state/semantic-prompt-batch.harness.js";
      const module = await import(/* @vite-ignore */ path);
      return module.runSemanticPromptBatchTests(kind);
    }, kind);
    expect(result).toBe(true);
  });
}
