import { test, expect } from "../../support/fixtures";
import { pointerAt as center } from "../../support/pointer";
import {
  transform,
  shot,
  selected,
  activated,
  activations,
  sprays,
  enableSpray,
  mountClusters,
  worldPoint,
} from "./graph-fixture";

test("cluster hover highlights its boundary, members and internal edges independently of previews", async ({
  page,
}) => {
  await mountClusters(page);
  const point = await worldPoint(page, 120, 0);
  for (const tool of ["指针工具", "手型工具"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.mouse.move(point.x, point.y);
    await expect(page.locator("[data-graph-cluster].is-hovered")).toHaveAttribute(
      "data-graph-cluster",
      "1",
    );
    await expect(page.locator(".storyboard-graph-dot-visual.is-neighbor")).toHaveCount(3);
    await expect(page.locator(".storyboard-graph-edges line.is-highlighted")).toHaveCount(3);
    expect(
      await page
        .locator(".storyboard-graph-edges line.is-highlighted")
        .evaluateAll((lines) =>
          lines.every((line) => line.getAttribute("y1") === "0" && line.getAttribute("y2") === "0"),
        ),
    ).toBe(true);
    const memberIds = await page
      .locator(".storyboard-graph-dot-visual.is-neighbor")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-overlay-node")),
      );
    expect(memberIds.sort()).toEqual(["3", "4", "5"]);
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await page.mouse.move(850, 560);
    await expect(page.locator("[data-graph-cluster].is-hovered")).toHaveCount(0);
  }
  await page.evaluate(() => window.graphSetSelection(new Set(["0"])));
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(1);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("[data-graph-cluster].is-hovered")).toHaveCount(1);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(1);
  await shot(page, 4).hover();
  await expect(page.locator("[data-graph-cluster].is-hovered")).toHaveCount(0);
  await expect(shot(page, 4)).toHaveClass(/is-hovered/);
});

for (const [mode, expected] of [
  ["替换选择", ["3", "4", "5"]],
  ["添加到选择", ["0", "3", "4", "5", "8"]],
  ["从选择中减去", ["0", "8"]],
  ["与选择交集", ["3"]],
] as const) {
  test(`cluster double-click follows ${mode} without seeking or clearing the base on its first click`, async ({
    page,
  }) => {
    await mountClusters(page);
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await page.evaluate(() => window.graphSetSelection(new Set(["0", "3", "8"])));
    await expect.poll(() => selected(page)).toEqual(["0", "3", "8"]);
    const point = await worldPoint(page, 120, 0);
    await page.mouse.click(point.x, point.y);
    expect(await selected(page)).toEqual(["0", "3", "8"]);
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(() => selected(page)).toEqual([...expected]);
    expect(await activated(page)).toBeNull();
    expect(await activations(page)).toEqual([]);
  });
}

test("overlapping clusters target only the upper region; hand and spray do not select it", async ({
  page,
}) => {
  await mountClusters(page, true);
  const point = await worldPoint(page, 120, 8);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("[data-graph-cluster].is-hovered")).toHaveAttribute(
    "data-graph-cluster",
    "2",
  );
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => selected(page)).toEqual(["6", "7", "8"]);
  await page.evaluate(() => window.graphSetSelection(new Set()));
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await page.mouse.dblclick(point.x, point.y);
  expect(await selected(page)).toEqual([]);
  await enableSpray(page);
  await page.mouse.dblclick(point.x, point.y);
  expect(await selected(page)).toEqual([]);
  expect(await sprays(page)).toEqual([]);
  expect(await activated(page)).toBeNull();
});

test("cluster outlines follow zooming and dragging without selecting or seeking", async ({
  page,
}) => {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.ts";
    (await import(/* @vite-ignore */ path)).mountGraph(false, 2, 4, false, true);
  });
  const outlines = page.locator(".storyboard-graph-clusters path");
  await expect(outlines).toHaveCount(3);
  const enclosed = () =>
    page.evaluate(() => {
      const nodes = window.graphComputedGraph.nodes;
      return [...document.querySelectorAll<SVGPathElement>("[data-graph-cluster]")].every((path) =>
        nodes
          .filter((node) => String(node.cluster) === path.dataset.graphCluster)
          .every((node) =>
            [0, Math.PI / 2, Math.PI, Math.PI * 1.5].every((angle) =>
              path.isPointInFill(
                new DOMPoint(
                  node.x + Math.cos(angle) * node.radius,
                  node.y + Math.sin(angle) * node.radius,
                ),
              ),
            ),
          ),
      );
    });
  expect(await enclosed()).toBe(true);
  const stage = page.locator(".storyboard-graph-view");
  const bounds = await center(stage);
  await page.mouse.move(bounds.x, bounds.y);
  const beforeZoom = await transform(page);
  await page.mouse.wheel(0, -250);
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(beforeZoom.zoom);
  expect(await enclosed()).toBe(true);
  const outline = page.locator('[data-graph-cluster="1"]');
  const before = await outline.getAttribute("d");
  await page.getByRole("button", { name: "指针工具", exact: true }).click();
  const point = await center(shot(page, 4));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 45, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => outline.getAttribute("d")).not.toBe(before);
  await expect(outlines).toHaveCount(3);
  expect(await selected(page)).toEqual([]);
  expect(await activated(page)).toBeNull();
  await expect(shot(page, 4)).toBeVisible();
});

test("display edge limits update neighbors and node radius while preserving the computed layout", async ({
  page,
}) => {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.ts";
    (await import(/* @vite-ignore */ path)).mountGraph(false, 1, 4, true);
  });
  const stage = page.locator(".storyboard-graph-view");
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
  const geometry = () => page.evaluate(() => window.graphGeometry.positions());
  const edgeCount = () =>
    page
      .locator(".storyboard-graph-base-edges")
      .evaluateAll((elements) =>
        elements.reduce(
          (count, element) => count + (element.getAttribute("d")?.match(/M/g)?.length ?? 0),
          0,
        ),
      );
  const miniCount = () =>
    page
      .locator(".storyboard-graph-minimap-content > path")
      .evaluate((path) => path.getAttribute("d")?.match(/M/g)?.length ?? 0);
  const nodeRadius = () => page.evaluate(() => window.graphGeometry.nodeRadius("4"));
  const beforeGeometry = await geometry();
  const beforeCamera = await transform(page);
  await expect.poll(edgeCount).toBe(36);
  await expect.poll(miniCount).toBe(36);
  await shot(page, 4).hover();
  let radius = await nodeRadius();
  await page.mouse.move(30, 460);
  for (const limit of [3, 1, 0]) {
    await page.evaluate((limit) => window.graphSetMaxVisibleDegree(limit), limit);
    if (limit === 3) await expect.poll(edgeCount).toBeGreaterThan(10);
    else await expect.poll(edgeCount).toBe(10);
    const visible = await edgeCount();
    await expect.poll(miniCount).toBe(visible);
    await shot(page, 4).hover();
    await expect(stage).toHaveClass(/has-focus/);
    const neighborCount = Math.max(2, limit);
    await expect(page.locator(".storyboard-graph-edges line.is-highlighted")).toHaveCount(
      neighborCount,
    );
    await expect(page.locator(".storyboard-graph-dot.is-neighbor")).toHaveCount(neighborCount + 1);
    if (limit > 0) await expect.poll(nodeRadius).toBeLessThan(radius);
    else expect(await nodeRadius()).toBe(radius);
    radius = await nodeRadius();
    expect(await geometry()).toEqual(beforeGeometry);
    expect(await transform(page)).toEqual(beforeCamera);
    expect(await page.evaluate(() => window.graphComputedGraph.edges.length)).toBe(36);
    await page.mouse.move(30, 460);
  }
  expect(await selected(page)).toEqual([]);
  expect(await activations(page)).toEqual([]);
  await shot(page, 4).dblclick();
  expect(await selected(page)).toEqual(["3", "4", "5"]);
  await enableSpray(page);
  await shot(page, 4).dblclick();
  expect((await sprays(page)).at(-1)?.ids).toEqual(["3", "4", "5"]);
});

test("changing the edge limit preserves an already dragged layout and its camera", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.ts";
    (await import(/* @vite-ignore */ path)).mountGraph(false, 5, 4, true);
  });
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
  const start = await center(shot(page, 4));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 35, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(30, 460);
  const positions = () => page.evaluate(() => window.graphGeometry.positions());
  await expect.poll(() => page.evaluate(() => window.graphGeometry.settled())).toBe(true);
  const before = await positions();
  const camera = await transform(page);
  await page.evaluate(() => window.graphSetMaxVisibleDegree(2));
  await shot(page, 4).hover();
  await expect(page.locator(".storyboard-graph-dot.is-neighbor")).toHaveCount(3);
  expect(await positions()).toEqual(before);
  expect(await transform(page)).toEqual(camera);
  expect(await selected(page)).toEqual([]);
  expect(await activations(page)).toEqual([]);
});
