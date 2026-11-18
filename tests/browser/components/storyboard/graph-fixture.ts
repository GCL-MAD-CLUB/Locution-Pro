import { pointerAt as center } from "../../support/pointer";
import { expect } from "../../support/fixtures";
import type { Page } from "@playwright/test";

export async function mount(page: Page, empty = false, spread = 1, nodeRadius = 4) {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(
    async ({ empty, spread, nodeRadius }) => {
      const path = "/tests/browser/components/storyboard/storyboard-graph.harness.ts";
      (await import(/* @vite-ignore */ path)).mountGraph(empty, spread, nodeRadius);
    },
    { empty, spread, nodeRadius },
  );
  await expect(page.locator(".storyboard-graph-minimap")).toBeVisible();
  if (!empty) await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
}

export const transform = (page: Page) => page.evaluate(() => window.graphGeometry.camera());

export const shot = (page: Page, id: number) =>
  page.getByRole("button", { name: `Shot ${id}`, exact: true });

export const selected = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.graphSelection);

export const activated = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.graphActivatedShot);

export const activations = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.graphActivations);

export const sprays = (
  page: Page,
): Promise<Array<{ ids: string[]; historyGroupId: string; eraseWithAlt: boolean }>> =>
  page.evaluate(() => window.graphSprays);

export const enableSpray = (page: Page) => page.evaluate(() => window.graphSetSprayActive(true));

export async function mountClusters(page: Page, overlap = false) {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async (overlap) => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.ts";
    (await import(/* @vite-ignore */ path)).mountGraph(
      false,
      2,
      4,
      false,
      overlap ? "overlap" : true,
    );
  }, overlap);
  await expect(page.locator("[data-graph-cluster]")).toHaveCount(3);
}

export const worldPoint = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => window.graphGeometry.worldPoint(x, y), { x, y });

export async function topRowMarquee(page: Page) {
  const first = await center(shot(page, 0));
  const last = await center(shot(page, 2));
  await page.mouse.move(first.x - 15, first.y - 100);
  await page.mouse.down();
  await expect(page.locator(".storyboard-graph-marquee")).toBeVisible();
  await page.mouse.move(last.x + 15, last.y + 15, { steps: 8 });
}

export async function assertFrame(page: Page) {
  const frame = await page.evaluate(() => window.graphGeometry.viewport());
  expect(frame.x).toBeGreaterThanOrEqual(-0.001);
  expect(frame.y).toBeGreaterThanOrEqual(-0.001);
  expect(frame.x + frame.width).toBeLessThanOrEqual(1.001);
  expect(frame.y + frame.height).toBeLessThanOrEqual(1.001);
}
