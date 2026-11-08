import { test, expect } from "../../support/fixtures";
import type { Page } from "@playwright/test";

async function mount(page: Page) {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
    (await import(/* @vite-ignore */ path)).mountLiveGraph();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).graphLiveTarget?.nodes.length))
    .toBe(9);
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
}

async function assertConnected(page: Page, ids: string[]) {
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).graphLiveTarget?.nodes.map((node: any) => node.id)),
    )
    .toEqual(ids);
  const connected = await page.evaluate(() => {
    const graph = (window as any).graphLiveTarget;
    const visited = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const current = queue.pop();
      for (const edge of graph.edges) {
        const next =
          edge.source === current ? edge.target : edge.target === current ? edge.source : -1;
        if (next >= 0 && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited.size === graph.nodes.length;
  });
  expect(connected).toBe(true);
}

test("a single remaining node eases back after release instead of jumping to the center", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as any).graphLiveFilter(["0"]));
  await assertConnected(page, ["0"]);
  const node = page.locator('.storyboard-graph-dot[data-storyboard-shot-id="0"]');
  const box = (await node.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 40, { steps: 6 });
  await expect
    .poll(() => node.evaluate((element) => parseFloat((element as HTMLElement).style.left)))
    .toBeGreaterThan(90);
  await page.mouse.up();
  expect(
    await node.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
  ).toBeGreaterThan(50);
  await expect
    .poll(() => node.evaluate((element) => parseFloat((element as HTMLElement).style.left)))
    .toBeLessThan(2);
});

test("filtering during a node drag releases capture and transitions from the live layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const node = page.locator('.storyboard-graph-dot[data-storyboard-shot-id="0"]');
  const box = (await node.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 45, { steps: 6 });
  await expect(page.locator(".storyboard-graph-view")).toHaveClass(/is-dragging-node/);
  await page.evaluate(() => (window as any).graphLiveFilter(["0", "2", "4", "6", "8"]));
  await assertConnected(page, ["0", "2", "4", "6", "8"]);
  await expect(page.locator(".storyboard-graph-view")).not.toHaveClass(/is-dragging-node/);
  await page.mouse.up();
  const target = await page.evaluate(() => (window as any).graphLiveTarget.nodes[0]);
  await expect
    .poll(() =>
      node.evaluate(
        (element, target) =>
          Math.hypot(
            parseFloat((element as HTMLElement).style.left) - target.x,
            parseFloat((element as HTMLElement).style.top) - target.y,
          ),
        target,
      ),
    )
    .toBeLessThan(0.05);
  await expect(
    page.locator(".storyboard-graph-message, .topbar-progress, .storyboard-graph-marquee"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).graphLiveWorkers)).toBe(1);
});

test("filter updates reuse vectors and the worker, keep the scene visible and spring into a connected layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const before = await page.evaluate(() => {
    const dot = document.querySelector<HTMLElement>(
      '.storyboard-graph-dot[data-storyboard-shot-id="0"]',
    )!;
    (window as any).graphLiveRetained = dot;
    (window as any).graphLiveTrace = [];
    const sample = () => {
      (window as any).graphLiveTrace.push({
        x: parseFloat(dot.style.left),
        y: parseFloat(dot.style.top),
      });
      if ((window as any).graphLiveTrace.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (window as any).graphLiveHold = true;
    (window as any).graphLiveFilter(["0", "2", "4", "6", "8"]);
    return { x: parseFloat(dot.style.left), y: parseFloat(dot.style.top) };
  });
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(5);
  await expect(page.locator(".storyboard-graph-message, .topbar-progress")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).graphLiveTarget.nodes.length)).toBe(9);
  await page.evaluate(() => (window as any).graphLiveRelease());
  await assertConnected(page, ["0", "2", "4", "6", "8"]);
  const target = await page.evaluate(() =>
    (window as any).graphLiveTarget.nodes.find((node: any) => node.id === "0"),
  );
  expect(Math.hypot(target.x - before.x, target.y - before.y)).toBeGreaterThan(1);
  const position = () =>
    page.locator('.storyboard-graph-dot[data-storyboard-shot-id="0"]').evaluate((element) => ({
      x: parseFloat((element as HTMLElement).style.left),
      y: parseFloat((element as HTMLElement).style.top),
    }));
  await expect
    .poll(async () => Math.hypot((await position()).x - target.x, (await position()).y - target.y))
    .toBeLessThan(0.05);
  const trace = await page.evaluate(
    () => (window as any).graphLiveTrace as Array<{ x: number; y: number }>,
  );
  expect(
    trace.some(
      (point) =>
        Math.hypot(point.x - before.x, point.y - before.y) > 0.1 &&
        Math.hypot(point.x - target.x, point.y - target.y) > 0.1,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.querySelector('.storyboard-graph-dot[data-storyboard-shot-id="0"]') ===
        (window as any).graphLiveRetained,
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).graphLiveFilter(null));
  await assertConnected(page, ["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
  const cache = await page.evaluate(() => ({
    workers: (window as any).graphLiveWorkers,
    vectors: (window as any).graphLiveRequests.filter((request: any) => request.vectors).length,
    reads: (window as any).graphLiveCalls.filter(
      (call: any) => call.command === "read_storyboard_graph_vectors",
    ).length,
    indexes: (window as any).graphLiveCalls.filter(
      (call: any) => call.command === "select_storyboard_frames",
    ).length,
  }));
  expect(cache).toEqual({ workers: 1, vectors: 1, reads: 1, indexes: 1 });
});

test("semantic thresholds rebuild the visible topology; deletion reuses search scores with no native work or progress", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as any).graphLiveQuery("sun"));
  await assertConnected(page, ["4", "5", "6", "7", "8"]);
  await expect(page.locator(".storyboard-graph-message, .topbar-progress")).toHaveCount(0);
  const calls = await page.evaluate(() => {
    (window as any).graphLiveProgress = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof Element &&
            (node.matches(".topbar-progress, .storyboard-graph-spinner") ||
              node.querySelector(".topbar-progress, .storyboard-graph-spinner"))
          )
            (window as any).graphLiveProgress.push(node.className);
    }).observe(document.body, { subtree: true, childList: true });
    return (window as any).graphLiveCalls.length;
  });
  await page.evaluate(() => (window as any).graphLiveThreshold(0.7));
  await assertConnected(page, ["6", "7", "8"]);
  await page.evaluate(() => (window as any).graphLiveDelete(["7"]));
  await assertConnected(page, ["6", "8"]);
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(2);
  // Let the search debounce elapse too: deletion must not enqueue a later search.
  await page.clock.install();
  await page.clock.runFor(500);
  const after = await page.evaluate(() => ({
    calls: (window as any).graphLiveCalls.length,
    status: (window as any).graphLiveSearchStatus,
    progress: (window as any).graphLiveProgress,
    workers: (window as any).graphLiveWorkers,
  }));
  expect(after).toEqual({ calls, status: "ready", progress: [], workers: 1 });
});

test("deleting during an in-flight semantic search accepts its remaining scores without another search", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    (window as any).graphLiveHoldSearch = true;
    (window as any).graphLiveQuery("sun");
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).graphLiveCalls.filter((call: any) =>
            call.command.startsWith("search_storyboards_semantic"),
          ).length,
      ),
    )
    .toBe(1);
  const calls = await page.evaluate(() => (window as any).graphLiveCalls.length);
  await page.evaluate(() => (window as any).graphLiveDelete(["7"]));
  await assertConnected(page, ["0", "1", "2", "3", "4", "5", "6", "8"]);
  await page.evaluate(() => (window as any).graphLiveReleaseSearch());
  await assertConnected(page, ["4", "5", "6", "8"]);
  await page.clock.install();
  await page.clock.runFor(500);
  expect(await page.evaluate(() => (window as any).graphLiveCalls.length)).toBe(calls);
  expect(await page.evaluate(() => (window as any).graphLiveSearchStatus)).toBe("ready");
});

test("deleting during initial indexing shares the covering job instead of launching another progress task", async ({
  page,
}) => {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
    (await import(/* @vite-ignore */ path)).mountLiveGraph(true);
  });
  const indexes = () =>
    page.evaluate(
      () =>
        (window as any).graphLiveCalls.filter(
          (call: any) => call.command === "select_storyboard_frames",
        ).length,
    );
  await expect.poll(indexes).toBe(1);
  await page.evaluate(async () => {
    (window as any).graphLiveDelete(["7"]);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(await indexes()).toBe(1);
  await page.evaluate(() => (window as any).graphLiveReleaseIndex());
  await assertConnected(page, ["0", "1", "2", "3", "4", "5", "6", "8"]);
  expect(await indexes()).toBe(1);
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(8);
  await expect(page.locator(".topbar-progress")).toHaveCount(0);
});
