import { test, expect } from "../../support/fixtures";
import type { Page, Locator } from "@playwright/test";

async function mount(page: Page, empty = false, spread = 1, nodeRadius = 4) {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(
    async ({ empty, spread, nodeRadius }) => {
      const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
      (await import(/* @vite-ignore */ path)).mountGraph(empty, spread, nodeRadius);
    },
    { empty, spread, nodeRadius },
  );
  await expect(page.locator(".storyboard-graph-minimap")).toBeVisible();
  if (!empty) await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
}
async function transform(page: Page) {
  return page.locator(".storyboard-graph-world").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { zoom: matrix.a, x: matrix.e, y: matrix.f };
  });
}
async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const shot = (page: Page, id: number) =>
  page.getByRole("button", { name: `Shot ${id}`, exact: true });
const selected = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).graphSelection);
const activated = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as any).graphActivatedShot);
const activations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).graphActivations);
const sprays = (
  page: Page,
): Promise<Array<{ ids: string[]; historyGroupId: string; eraseWithAlt: boolean }>> =>
  page.evaluate(() => (window as any).graphSprays);
const enableSpray = (page: Page) => page.evaluate(() => (window as any).graphSetSprayActive(true));

async function mountClusters(page: Page, overlap = false) {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async (overlap) => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
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

async function worldPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const stage = document.querySelector<HTMLElement>(".storyboard-graph-view")!;
      const world = document.querySelector(".storyboard-graph-world")!;
      const matrix = new DOMMatrix(getComputedStyle(world).transform);
      const box = stage.getBoundingClientRect();
      return {
        x: box.left + stage.clientLeft + matrix.e + x * matrix.a,
        y: box.top + stage.clientTop + matrix.f + y * matrix.d,
      };
    },
    { x, y },
  );
}

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
  await page.evaluate(() => (window as any).graphSetSelection(new Set(["0"])));
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
    await page.evaluate(() => (window as any).graphSetSelection(new Set(["0", "3", "8"])));
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
  await page.evaluate(() => (window as any).graphSetSelection(new Set()));
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
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
    (await import(/* @vite-ignore */ path)).mountGraph(false, 2, 4, false, true);
  });
  const outlines = page.locator(".storyboard-graph-clusters path");
  await expect(outlines).toHaveCount(3);
  const enclosed = () =>
    page.evaluate(() => {
      const nodes = (window as any).graphComputedGraph.nodes;
      return [...document.querySelectorAll<SVGPathElement>("[data-graph-cluster]")].every((path) =>
        nodes
          .filter((node: any) => String(node.cluster) === path.dataset.graphCluster)
          .every((node: any) =>
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
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
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

test("display edge limits update neighbors and radii from view degrees while preserving the computed layout", async ({
  page,
}) => {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
    (await import(/* @vite-ignore */ path)).mountGraph(false, 1, 4, true);
  });
  const stage = page.locator(".storyboard-graph-view");
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
  const geometry = () =>
    page.locator(".storyboard-graph-dot").evaluateAll((elements) =>
      elements.map((element) => ({
        x: (element as HTMLElement).style.left,
        y: (element as HTMLElement).style.top,
      })),
    );
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
  const beforeGeometry = await geometry();
  const beforeCamera = await transform(page);
  await expect.poll(edgeCount).toBe(36);
  await expect.poll(miniCount).toBe(36);
  for (const limit of [3, 1, 0]) {
    await page.evaluate((limit) => (window as any).graphSetMaxVisibleDegree(limit), limit);
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
    await expect
      .poll(async () => Number(await page.locator('[data-graph-node="4"]').getAttribute("r")))
      .toBeCloseTo((4 + neighborCount * 0.1 - 0.5) * 0.8, 4);
    expect(await geometry()).toEqual(beforeGeometry);
    expect(await transform(page)).toEqual(beforeCamera);
    expect(await page.evaluate(() => (window as any).graphComputedGraph.edges.length)).toBe(36);
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

test("V/H switch graph tools without intercepting text entry, modified keys or toolbar Space", async ({
  page,
}) => {
  await mount(page);
  const stage = page.locator(".storyboard-graph-view");
  await stage.focus();
  await page.keyboard.press("h");
  await expect(stage).toHaveClass(/is-hand/);
  await expect(page.getByRole("button", { name: "手型工具", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("v");
  await expect(stage).toHaveClass(/is-pointer/);
  for (const key of ["Control+h", "Alt+h", "Meta+h"]) {
    await page.keyboard.press(key);
    await expect(stage).toHaveClass(/is-pointer/);
  }
  await stage.evaluate((element) => {
    const input = document.createElement("input");
    input.id = "graph-test-input";
    element.appendChild(input);
  });
  await page.locator("#graph-test-input").focus();
  await page.keyboard.type("hv ");
  await expect(page.locator("#graph-test-input")).toHaveValue("hv ");
  await expect(stage).toHaveClass(/is-pointer/);
  await page.locator("#graph-test-input").evaluate((input) => input.remove());
  await stage.focus();
  await stage.dispatchEvent("keydown", { key: "h", code: "KeyH", isComposing: true });
  await expect(stage).toHaveClass(/is-pointer/);
  await enableSpray(page);
  await page.keyboard.press("h");
  await expect(stage).toHaveClass(/is-hand/);
  await expect(stage).not.toHaveClass(/is-spraying/);
  await page.keyboard.press("v");
  await expect(stage).toHaveClass(/is-pointer/);
  expect(await selected(page)).toEqual([]);
  expect(await activations(page)).toEqual([]);
  expect(await sprays(page)).toEqual([]);
});

test("pointer activation of toolbar controls returns focus for Space panning", async ({ page }) => {
  await mount(page, false, 5);
  const stage = page.locator(".storyboard-graph-view");
  const toggle = page.getByRole("button", { name: "显示缩略图", exact: true });
  const before = await transform(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(stage).toBeFocused();
  await page.keyboard.down("Space");
  await expect(stage).toHaveClass(/is-hand/);
  const start = await center(shot(page, 4));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 18, { steps: 4 });
  await expect.poll(async () => (await transform(page)).x).toBeCloseTo(before.x + 30, 0);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(stage).not.toHaveClass(/is-hand/);
  expect(await selected(page)).toEqual([]);
  expect(await activations(page)).toEqual([]);

  // Keyboard activation keeps the toolbar's native Space behavior.
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toBeFocused();
  await expect(stage).not.toHaveClass(/is-hand/);
});

test("view-degree radius changes preserve an already dragged layout and its camera", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
    (await import(/* @vite-ignore */ path)).mountGraph(false, 5, 4, true);
  });
  await expect(page.locator(".storyboard-graph-dot")).toHaveCount(9);
  const start = await center(shot(page, 4));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 35, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(30, 460);
  const positions = () =>
    page
      .locator(".storyboard-graph-dot")
      .evaluateAll((elements) =>
        elements.map((element) => [
          (element as HTMLElement).style.left,
          (element as HTMLElement).style.top,
        ]),
      );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const read = () =>
          [...document.querySelectorAll<HTMLElement>(".storyboard-graph-dot")]
            .map((element) => element.style.cssText)
            .join("|");
        const before = read();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return before === read();
      }),
    )
    .toBe(true);
  const before = await positions();
  const camera = await transform(page);
  const radius = await page.locator('[data-graph-node="4"]').getAttribute("r");
  await page.evaluate(() => (window as any).graphSetMaxVisibleDegree(2));
  await expect.poll(() => page.locator('[data-graph-node="4"]').getAttribute("r")).not.toBe(radius);
  // Wait until the size spring completes; position must stay fixed throughout.
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(150);
    expect(await positions()).toEqual(before);
    expect(await transform(page)).toEqual(camera);
  }
  expect(await selected(page)).toEqual([]);
  expect(await activations(page)).toEqual([]);
});

for (const original of ["pointer", "hand", "spray"] as const) {
  test(`Space temporarily pans from nodes and restores ${original} even when released before pointerup`, async ({
    page,
  }) => {
    await mount(page, false, 5);
    await page.evaluate(() => (window as any).graphSetSelection(new Set(["8"])));
    const stage = page.locator(".storyboard-graph-view");
    await stage.focus();
    if (original === "hand") await page.keyboard.press("h");
    if (original === "spray") await enableSpray(page);
    const geometry = () =>
      page
        .locator(".storyboard-graph-dot")
        .evaluateAll((dots) => dots.map((dot) => (dot as HTMLElement).style.cssText));
    const beforeGeometry = await geometry();
    const before = await transform(page);
    await page.keyboard.down("Space");
    await expect(stage).toHaveClass(/is-hand/);
    await expect(stage).not.toHaveClass(/is-spraying/);
    const start = await center(shot(page, 4));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 35, start.y + 20, { steps: 4 });
    await expect.poll(async () => (await transform(page)).x).toBeCloseTo(before.x + 35, 0);
    await expect(stage).toHaveClass(/is-panning/);
    await page.keyboard.up("Space");
    await expect(stage).not.toHaveClass(/is-panning/);
    await expect(stage).toHaveClass(original === "hand" ? /is-hand/ : /is-pointer/);
    if (original === "spray") await expect(stage).toHaveClass(/is-spraying/);
    await page.mouse.up();
    expect(await geometry()).toEqual(beforeGeometry);
    expect(await selected(page)).toEqual(["8"]);
    expect(await activations(page)).toEqual([]);
    expect(await sprays(page)).toEqual([]);
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);

    // Space also works over the thumbnail overlay, and a lost window focus
    // releases the temporary tool even if no keyup reaches the graph.
    await page.keyboard.down("Space");
    await shot(page, 4).hover();
    const preview = page.locator('[data-preview-shot-id="4"]');
    await expect(preview).toBeVisible();
    const thumb = await center(preview);
    const beforePreviewPan = await transform(page);
    await page.mouse.move(thumb.x, thumb.y);
    await page.mouse.down();
    await page.mouse.move(thumb.x + 20, thumb.y + 12, { steps: 4 });
    await expect.poll(() => transform(page)).not.toEqual(beforePreviewPan);
    await page.mouse.up();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(stage).toHaveClass(original === "hand" ? /is-hand/ : /is-pointer/);
    if (original === "spray") await expect(stage).toHaveClass(/is-spraying/);
    await page.keyboard.up("Space");
    expect(await selected(page)).toEqual(["8"]);
    expect(await activations(page)).toEqual([]);
    expect(await sprays(page)).toEqual([]);
  });
}

test("eye toggle hides all previews across tools while keeping selection, hover and spray behavior", async ({
  page,
}) => {
  await mount(page);
  const toggle = page.getByRole("button", { name: "显示缩略图", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle.locator("svg")).toBeVisible();
  await shot(page, 4).click();
  await expect(page.locator('[data-preview-shot-id="4"]')).toBeVisible();
  const beforeCamera = await transform(page);
  const beforeActivations = await activations(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
  await shot(page, 0).hover();
  await expect(shot(page, 0)).toHaveClass(/is-hovered/);
  await expect(
    page.locator(".storyboard-graph-preview, .storyboard-graph-hover-bridge"),
  ).toHaveCount(0);
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(beforeActivations);
  expect(await transform(page)).toEqual(beforeCamera);
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await shot(page, 0).hover();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
  await toggle.click();
  await shot(page, 0).hover();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(3);
  await enableSpray(page);
  await toggle.click();
  await expect(page.locator(".storyboard-graph-view")).toHaveClass(/is-spraying/);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
  expect(await sprays(page)).toEqual([]);
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(beforeActivations);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-preview-shot-id="4"]')).toBeVisible();
  expect(await sprays(page)).toEqual([]);
});

for (const spread of [1, 5]) {
  test(`pointer node dragging at spread ${spread} pulls neighbors, preserves selection and playback, then cools to rest`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mount(page, false, spread);
    await page.evaluate(() => (window as any).graphSetSelection(new Set(["8"])));
    const positions = () =>
      page.locator(".storyboard-graph-dot").evaluateAll((elements) =>
        elements.map((element) => ({
          x: parseFloat((element as HTMLElement).style.left),
          y: parseFloat((element as HTMLElement).style.top),
        })),
      );
    const before = await positions();
    const initialCamera = await transform(page);
    const start = await center(shot(page, 4));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Holding a node is a grab candidate; blank space still owns marquee selection.
    await page.waitForTimeout(220);
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
    expect(await positions()).toEqual(before);
    const end = { x: start.x + 100, y: start.y + 65 };
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await expect(page.locator(".storyboard-graph-view")).toHaveClass(/is-dragging-node/);
    await expect
      .poll(async () => {
        const point = await center(shot(page, 4));
        return Math.hypot(point.x - end.x, point.y - end.y);
      })
      .toBeLessThan(1);
    await expect
      .poll(async () => {
        const next = await positions();
        return Math.hypot(next[3].x - before[3].x, next[3].y - before[3].y);
      })
      .toBeGreaterThan(2);
    expect(await transform(page)).toEqual(initialCamera);
    expect(await selected(page)).toEqual(["8"]);
    expect(await activations(page)).toEqual([]);
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
    const held = (await positions())[4];
    await page.mouse.up();
    await page.mouse.move(35, 460);
    await expect(page.locator(".storyboard-graph-view")).not.toHaveClass(/is-dragging-node/);
    await expect
      .poll(async () => {
        const next = (await positions())[4];
        return Math.hypot(next.x - held.x, next.y - held.y);
      })
      .toBeGreaterThan(2);
    expect(await selected(page)).toEqual(["8"]);
    expect(await activations(page)).toEqual([]);
    // Sampling two frames after cooling verifies the live timer really stopped.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const read = () =>
            Array.from(
              document.querySelectorAll<HTMLElement>(".storyboard-graph-dot"),
              (node) => node.style.cssText,
            ).join("|");
          const previous = read();
          await new Promise((resolve) => setTimeout(resolve, 80));
          return read() === previous;
        }),
      )
      .toBe(true);
    expect(await transform(page)).toEqual(initialCamera);
    await assertFrame(page);
    await shot(page, 0).click();
    expect(await selected(page)).toEqual(["0"]);
    expect(await activated(page)).toBe("0");
  });
}

test("canceling or losing capture releases a dragged node without choosing or seeking it", async ({
  page,
}) => {
  for (const cancel of ["escape", "blur", "pointercancel", "lostcapture"] as const) {
    await mount(page);
    const node = shot(page, 4);
    const start = await center(node);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 50, start.y + 35, { steps: 5 });
    await expect(page.locator(".storyboard-graph-view")).toHaveClass(/is-dragging-node/);
    if (cancel === "escape") await page.keyboard.press("Escape");
    else if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else
      await node.evaluate((element, cancel) => {
        // A real captured pointer is used; force only the exceptional termination.
        const pointerId = Array.from({ length: 10 }, (_, i) => i).find((id) =>
          element.hasPointerCapture(id),
        )!;
        if (cancel === "lostcapture") element.releasePointerCapture(pointerId);
        else element.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true }));
      }, cancel);
    await expect(page.locator(".storyboard-graph-view")).not.toHaveClass(/is-dragging-node/);
    await page.mouse.up();
    expect(await selected(page)).toEqual([]);
    expect(await activations(page)).toEqual([]);
  }
});

async function topRowMarquee(page: Page) {
  const first = await center(shot(page, 0));
  const last = await center(shot(page, 2));
  await page.mouse.move(first.x - 15, first.y - 100);
  await page.mouse.down();
  await expect(page.locator(".storyboard-graph-marquee")).toBeVisible();
  await page.mouse.move(last.x + 15, last.y + 15, { steps: 8 });
}
function isGrayscale(color: string) {
  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match !== null && match[1] === match[2] && match[2] === match[3];
}
function redChannel(color: string) {
  const match = color.match(/^rgba?\((\d+)/);
  return match ? Number(match[1]) : -1;
}
async function assertFrame(page: Page) {
  const mini = page.locator(".storyboard-graph-minimap");
  const frame = page.locator("[data-graph-viewport]");
  const view = page.locator(".storyboard-graph-view");
  const miniBox = (await mini.boundingBox())!;
  const frameBox = await frame.evaluate((element) => {
    const { width, height } = (element as SVGRectElement).getBBox();
    return { width, height };
  });
  const display = await view.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  expect(miniBox.width / miniBox.height).toBeCloseTo(16 / 9, 2);
  expect(frameBox.width / frameBox.height).toBeCloseTo(display.width / display.height, 2);
  const bounds = await frame.evaluate((element) => {
    const rect = element as SVGRectElement;
    return {
      x: rect.x.baseVal.value,
      y: rect.y.baseVal.value,
      w: rect.width.baseVal.value,
      h: rect.height.baseVal.value,
    };
  });
  expect(bounds.x).toBeGreaterThanOrEqual(-0.001);
  expect(bounds.y).toBeGreaterThanOrEqual(-0.001);
  expect(bounds.x + bounds.w).toBeLessThanOrEqual(160.001);
  expect(bounds.y + bounds.h).toBeLessThanOrEqual(90.001);
}

test("graph hover reveals previews and clicking selects the shot", async ({ page }) => {
  await mount(page);
  await expect(
    page.locator(
      ".storyboard-graph-view input, .storyboard-graph-caption, .storyboard-graph-controls",
    ),
  ).toHaveCount(0);
  await assertFrame(page);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  await dot.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(
    page.getByRole("tooltip").getByRole("img", { name: "分镜选帧缩略图" }),
  ).toBeVisible();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(3);
  await expect(page.locator(".storyboard-graph-edges line.is-highlighted")).toHaveCount(3);
  const layering = await page.evaluate(() => {
    const previews = Array.from(
      document.querySelectorAll<HTMLElement>(".storyboard-graph-preview"),
    );
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    return {
      tooltipZ: Number(getComputedStyle(tooltip).zIndex),
      maximumZ: Math.max(...previews.map((preview) => Number(getComputedStyle(preview).zIndex))),
      tooltipOpacity: Number(getComputedStyle(tooltip).opacity),
      neighborOpacities: previews
        .filter((preview) => preview !== tooltip)
        .map((preview) => Number(getComputedStyle(preview).opacity)),
    };
  });
  expect(layering.tooltipZ).toBe(layering.maximumZ);
  expect(layering.tooltipOpacity).toBe(1);
  expect(layering.neighborOpacities).toEqual([0.6, 0.6]);
  const hoverColors = await page.evaluate(() => {
    const hoveredDot = document.querySelector(".storyboard-graph-dot-visual.is-hovered");
    const neighborDot = document.querySelector(
      ".storyboard-graph-dot-visual.is-neighbor:not(.is-hovered)",
    );
    const highlightedEdge = document.querySelector(".storyboard-graph-edges line.is-highlighted");
    const overviewFrame = document.querySelector("[data-graph-viewport]");
    return {
      dot: hoveredDot ? getComputedStyle(hoveredDot.querySelector("circle")!).fill : "",
      neighborDot: neighborDot ? getComputedStyle(neighborDot.querySelector("circle")!).fill : "",
      edge: highlightedEdge ? getComputedStyle(highlightedEdge).stroke : "",
      overviewFill: overviewFrame ? getComputedStyle(overviewFrame).fill : "",
      overviewStroke: overviewFrame ? getComputedStyle(overviewFrame).stroke : "",
    };
  });
  for (const color of Object.values(hoverColors)) expect(isGrayscale(color)).toBe(true);
  await dot.click();
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("selection and hover remain independent while zooming", async ({ page }) => {
  await mount(page, false, 3);
  const dot = shot(page, 4);
  await dot.click();
  await expect.poll(() => selected(page)).toEqual(["4"]);
  await dot.hover();
  await expect(dot).toHaveClass(/is-hovered/);
  await page.mouse.move(1000, 700);
  await expect(dot).not.toHaveClass(/is-hovered/);
  await expect.poll(() => selected(page)).toEqual(["4"]);
  const initial = await transform(page);
  const anchor = await center(dot);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(initial.zoom);
  await expect.poll(() => selected(page)).toEqual(["4"]);
  expect(await activated(page)).toBe("4");
});

test("visible previews keep their DOM position and never restart entry when layers or distance order change", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  await page.clock.install();
  await page.evaluate(() => (window as any).graphSetSelection(new Set(["0", "4", "8"])));
  await shot(page, 4).hover();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(3);
  await page.clock.runFor(200);
  await page.evaluate(() => {
    const removed: string[] = [];
    const entries: string[] = [];
    const root = document.querySelector(".storyboard-graph-previews")!;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes)
          if (node instanceof HTMLElement && node.matches(".storyboard-graph-preview"))
            removed.push(node.dataset.previewShotId!);
    }).observe(root, { childList: true });
    root.addEventListener("transitionrun", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(".storyboard-graph-preview")) return;
      for (const animation of target.getAnimations()) {
        if (!(animation instanceof CSSTransition) || animation.transitionProperty !== "opacity")
          continue;
        const frames = (animation.effect as KeyframeEffect).getKeyframes();
        if (Number(frames[0].opacity) === 0) entries.push(target.dataset.previewShotId!);
      }
    });
    (window as any).graphPreviewLifecycle = { removed, entries };
  });
  // The selected previews stay visible while their distance-based z-indices change.
  await shot(page, 0).hover();
  await page.clock.runFor(200);
  await page.locator('[data-preview-shot-id="8"]').hover();
  await page.clock.runFor(200);
  await shot(page, 8).hover();
  await page.clock.runFor(200);
  expect(await page.evaluate(() => (window as any).graphPreviewLifecycle)).toEqual({
    removed: [],
    entries: [],
  });
  await expect(page.locator(".storyboard-graph-preview.is-exiting")).toHaveCount(0);
  // Actual removal cleans up only the departing preview; the other two persist.
  await page.mouse.move(1100, 700);
  await page.evaluate(() => (window as any).graphSetSelection(new Set(["0", "4"])));
  await page.clock.runFor(200);
  await expect(page.locator('[data-preview-shot-id="8"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).graphPreviewLifecycle)).toEqual({
    removed: ["8"],
    entries: [],
  });
});

test("wheel zoom anchors to the pointer; canvas and overview drags stay synchronized and bounded", async ({
  page,
}) => {
  await mount(page, false, 5);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  const anchor = await center(dot);
  const initial = await transform(page);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(initial.zoom);
  const anchored = await center(dot);
  expect(anchored.x).toBeCloseTo(anchor.x, 1);
  expect(anchored.y).toBeCloseTo(anchor.y, 1);
  await assertFrame(page);

  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  const beforePan = await transform(page);
  await page.mouse.move(100, 90);
  await page.mouse.down();
  await page.mouse.move(145, 115, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).toBeCloseTo(beforePan.x + 45, 0);
  await expect.poll(async () => (await transform(page)).y).toBeCloseTo(beforePan.y + 25, 0);

  const frame = page.locator("[data-graph-viewport]");
  const handle = await center(frame);
  const beforeMini = await transform(page);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await transform(page)).toEqual(beforeMini);
  await page.mouse.down();
  await page.mouse.move(handle.x - 8, handle.y - 5, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).toBeGreaterThan(beforeMini.x);
  await assertFrame(page);
  const mini = (await page.locator(".storyboard-graph-minimap").boundingBox())!;
  await page.mouse.click(mini.x + 5, mini.y + 5);
  await assertFrame(page);
  await page.mouse.move(150, 150);
  await page.mouse.down();
  await page.mouse.move(1300, 800, { steps: 6 });
  await page.mouse.up();
  await assertFrame(page);
});

test("zoom cap applies across graph sizes and survives panel resizing", async ({ page }) => {
  for (const spread of [0.01, 1, 30]) {
    await mount(page, false, spread);
    const dot = page.getByRole("button", { name: "Shot 4", exact: true });
    const anchor = await center(dot);
    await page.mouse.move(anchor.x, anchor.y);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -600);
    await assertFrame(page);
    const maximum = await transform(page);
    expect(maximum.zoom).toBe(2);
    const miniCenter = await center(page.locator(".storyboard-graph-minimap"));
    await page.mouse.move(miniCenter.x, miniCenter.y);
    await page.mouse.wheel(0, -600);
    const stage = page.locator(".storyboard-graph-view");
    await stage.focus();
    await stage.press("+");
    expect((await transform(page)).zoom).toBe(maximum.zoom);
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>("#graph-host")!;
      host.style.width = "420px";
      host.style.height = "650px";
    });
    await expect.poll(async () => (await transform(page)).zoom).toBe(maximum.zoom);
    await assertFrame(page);
  }
});

// The harness host is 800x500 with 1px borders, so the fit camera clamps to a
// 798x498 content box. This spread puts the 16:9 canvas cover exactly at 0.35.
for (const [label, spread] of [
  ["at", 7.360714285714286],
  ["below", 10],
] as const) {
  test(`only previews stop ${label} 0.35 CSS pixels per unit while hover remains active`, async ({
    page,
  }) => {
    await mount(page, false, spread);
    await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.35);
    if (label === "at") expect((await transform(page)).zoom).toBe(0.35);
    const dot = page.getByRole("button", { name: "Shot 4", exact: true });
    const stage = page.locator(".storyboard-graph-view");
    await dot.hover();
    await dot.focus();
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await expect(dot).toHaveClass(/is-hovered/);
    await expect(page.locator(".storyboard-graph-dot.is-neighbor")).toHaveCount(3);
    await expect(page.locator(".storyboard-graph-edges line.is-highlighted")).toHaveCount(3);
    await expect(stage).toHaveClass(/has-focus/);
    await expect(dot).not.toHaveAttribute("aria-describedby");
    await dot.click();
    await expect(dot).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await page.getByRole("button", { name: "手型工具", exact: true }).click();
    await dot.hover();
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await expect(dot).toHaveClass(/is-hovered/);
    await expect(stage).toHaveClass(/has-focus/);
    await page.getByRole("button", { name: "指针工具", exact: true }).click();

    await stage.focus();
    const anchor = await center(dot);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.35);
    await page.mouse.move(30, 30);
    await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(1);
    await expect(dot).toHaveAttribute("aria-pressed", "true");
    await dot.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(stage).toHaveClass(/has-focus/);
    await expect(dot).toHaveAttribute("aria-describedby");

    await stage.focus();
    for (let i = 0; i < 8; i++) await stage.press("-");
    await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.35);
    await dot.focus();
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await expect(dot).toHaveClass(/is-hovered/);
    await expect(stage).toHaveClass(/has-focus/);
    await expect(dot).toHaveAttribute("aria-pressed", "true");
  });
}

test("resizing below the preview threshold hides thumbnails while preserving normal hover", async ({
  page,
}) => {
  await mount(page, false, 5);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.35);
  await dot.click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "420px";
    host.style.height = "220px";
  });
  await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.35);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
  await dot.hover();
  await expect(dot).toHaveClass(/is-hovered/);
  await expect(page.locator(".storyboard-graph-edges line.is-highlighted")).toHaveCount(3);
  await page.mouse.move(1100, 700);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "800px";
    host.style.height = "500px";
  });
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.35);
  await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(1);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("darkest default graph colors match the dark appearance", async ({ page }) => {
  await mount(page);
  const read = () =>
    page.evaluate(() => {
      const dot = document.querySelector(".storyboard-graph-dot-visual")!;
      const edge = document.querySelector(".storyboard-graph-edges path")!;
      return {
        dot: getComputedStyle(dot.querySelector("circle")!).fill,
        edge: getComputedStyle(edge).stroke,
      };
    });
  const darkest = await read();
  expect(isGrayscale(darkest.dot)).toBe(true);
  expect(isGrayscale(darkest.edge)).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect.poll(read).toEqual(darkest);
});

test("hover emphasis is brighter in dark appearances and deeper in light", async ({ page }) => {
  await mount(page);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  for (const [theme, expectedChannel] of [
    ["darkest", 255],
    ["dark", 255],
    ["light", 0],
  ] as const) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await dot.hover();
    const colors = await page.evaluate(() => ({
      dot: getComputedStyle(
        document.querySelector(".storyboard-graph-dot-visual.is-hovered circle")!,
      ).fill,
      neighborDot: getComputedStyle(
        document.querySelector(".storyboard-graph-dot-visual.is-neighbor:not(.is-hovered) circle")!,
      ).fill,
      edge: getComputedStyle(document.querySelector(".storyboard-graph-edges line.is-highlighted")!)
        .stroke,
    }));
    expect(redChannel(colors.dot)).toBe(expectedChannel);
    expect(redChannel(colors.neighborDot)).toBe(expectedChannel);
    expect(redChannel(colors.edge)).toBe(expectedChannel);
  }
});

test("overview persists without graph data and its viewport follows panel resizing", async ({
  page,
}) => {
  await mount(page, true);
  await assertFrame(page);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "420px";
    host.style.height = "650px";
  });
  await expect
    .poll(async () => {
      const box = await page.locator("[data-graph-viewport]").evaluate((element) => {
        const { width, height } = (element as SVGRectElement).getBBox();
        return { width, height };
      });
      return box.width / box.height;
    })
    .toBeCloseTo(418 / 648, 2);
  await assertFrame(page);
});

test("hand pans from nodes without selecting or seeking; pointer zooms and selects without panning", async ({
  page,
}) => {
  await mount(page, false, 5);
  await shot(page, 4).click();
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "图谱选择模式" })).toHaveCount(0);
  await shot(page, 5).hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(4);
  await expect(page.locator(".storyboard-graph-preview.is-neighbor")).toHaveCount(2);
  await shot(page, 5).dblclick();
  expect(await selected(page)).toEqual(["4"]);
  expect(await activated(page)).toBe("4");
  const beforeHand = await transform(page);
  const node = await center(shot(page, 4));
  await page.mouse.move(node.x, node.y);
  await page.mouse.down();
  await page.mouse.move(node.x + 30, node.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).toBeCloseTo(beforeHand.x + 30, 0);
  expect(await selected(page)).toEqual(["4"]);
  expect(await activated(page)).toBe("4");
  await page.getByRole("button", { name: "指针工具", exact: true }).click();
  const beforePointer = await transform(page);
  await page.mouse.move(100, 170);
  await page.mouse.down();
  await page.mouse.move(150, 200, { steps: 5 });
  await page.mouse.up();
  expect(await transform(page)).toEqual(beforePointer);
  expect(await activated(page)).toBe("4");
  const beforeSelection = await selected(page);
  const beforeActivations = await activations(page);
  const mini = await center(page.locator("[data-graph-viewport]"));
  await page.mouse.move(mini.x, mini.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await transform(page)).toEqual(beforePointer);
  await page.mouse.down();
  await expect(page.locator(".storyboard-graph-minimap")).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(mini.x + 10, mini.y + 5);
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).toBeLessThan(beforePointer.x);
  expect((await transform(page)).zoom).toBe(beforePointer.zoom);
  await assertFrame(page);
  const overview = page.locator(".storyboard-graph-minimap");
  await expect(overview).toHaveCSS("cursor", "grab");
  const bounds = (await overview.boundingBox())!;
  const beforeLocate = await transform(page);
  await page.mouse.click(bounds.x + 5, bounds.y + 5);
  await expect.poll(() => transform(page)).not.toEqual(beforeLocate);
  await assertFrame(page);
  const beforeKey = await transform(page);
  await overview.press("ArrowRight");
  await expect.poll(async () => (await transform(page)).x).toBeLessThan(beforeKey.x);
  await assertFrame(page);
  const stage = page.locator(".storyboard-graph-view");
  await stage.focus();
  const beforeStageKey = await transform(page);
  await stage.press("ArrowRight");
  expect(await transform(page)).toEqual(beforeStageKey);
  expect(await selected(page)).toEqual(beforeSelection);
  expect(await activations(page)).toEqual(beforeActivations);
  await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
  await page.mouse.move(425, 274);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(beforePointer.zoom);
});

for (const [keys, mode, label, expected] of [
  [[], "replace", "替换选择", ["0", "1", "2"]],
  [["Shift"], "add", "添加到选择", ["0", "1", "2", "8"]],
  [["Alt"], "subtract", "从选择中减去", ["8"]],
  [["Shift", "Alt"], "intersect", "与选择交集", ["1"]],
] as const) {
  test(`selection modifiers ${mode} drive marquee and cursor without seeking`, async ({ page }) => {
    await mount(page);
    await page.evaluate(() => (window as any).graphSetSelection(new Set(["1", "8"])));
    const stage = page.locator(".storyboard-graph-view");
    const before = await transform(page);
    for (const key of keys) await page.keyboard.down(key);
    await topRowMarquee(page);
    await expect(stage).toHaveAttribute("data-selection-mode", mode);
    await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
    await expect(stage).toHaveCSS("cursor", "default");
    const badge = page.locator(".storyboard-graph-selection-cursor");
    if (mode === "replace") await expect(badge).toBeHidden();
    else {
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute("data-selection-mode", mode);
      await expect(badge).toHaveCSS("pointer-events", "none");
    }
    await expect.poll(() => selected(page)).toEqual([...expected]);
    await page.mouse.up();
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
    await expect(stage).toHaveAttribute("data-selection-mode", "replace");
    await expect(badge).toBeHidden();
    expect(await selected(page)).toEqual([...expected]);
    expect(await activations(page)).toEqual([]);
    expect(await transform(page)).toEqual(before);
  });
}

test("stationary marquee recomputes modifiers from the original selection and blur resets the cursor", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as any).graphSetSelection(new Set(["1", "8"])));
  await topRowMarquee(page);
  await expect.poll(() => selected(page)).toEqual(["0", "1", "2"]);
  await page.keyboard.down("Shift");
  await expect(page.locator(".storyboard-graph-selection-cursor")).toHaveAttribute(
    "data-selection-mode",
    "add",
  );
  await expect(page.locator(".storyboard-graph-selection-cursor")).toBeVisible();
  await expect.poll(() => selected(page)).toEqual(["0", "1", "2", "8"]);
  await page.keyboard.down("Alt");
  await expect(page.locator(".storyboard-graph-selection-cursor")).toHaveAttribute(
    "data-selection-mode",
    "intersect",
  );
  await expect.poll(() => selected(page)).toEqual(["1"]);
  await page.keyboard.up("Shift");
  await expect(page.locator(".storyboard-graph-selection-cursor")).toHaveAttribute(
    "data-selection-mode",
    "subtract",
  );
  await expect.poll(() => selected(page)).toEqual(["8"]);
  await page.keyboard.up("Alt");
  await expect(page.locator(".storyboard-graph-selection-cursor")).toBeHidden();
  await expect.poll(() => selected(page)).toEqual(["0", "1", "2"]);
  await page.keyboard.down("Alt");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => selected(page)).toEqual(["1", "8"]);
  await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
  await expect(page.locator(".storyboard-graph-view")).toHaveAttribute(
    "data-selection-mode",
    "replace",
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(await activations(page)).toEqual([]);
});

test("modifier clicks and double-clicks override the toolbar temporarily", async ({ page }) => {
  await mount(page);
  await shot(page, 8).click();
  await shot(page, 4).click({ modifiers: ["Shift"] });
  await expect.poll(() => selected(page)).toEqual(["4", "8"]);
  await shot(page, 4).dblclick({ modifiers: ["Alt"] });
  await expect.poll(() => selected(page)).toEqual(["8"]);
  await page.getByRole("radio", { name: "添加到选择", exact: true }).click();
  await shot(page, 8).click({ modifiers: ["Alt"] });
  await expect.poll(() => selected(page)).toEqual([]);
  await expect(page.getByRole("radio", { name: "添加到选择", exact: true })).toBeChecked();
  expect(await activated(page)).toBe("8");
});

test("selection badge follows the native arrow and stays out of tools, previews and navigation", async ({
  page,
}) => {
  await mount(page);
  const stage = page.locator(".storyboard-graph-view");
  const badge = page.locator(".storyboard-graph-selection-cursor");
  await page.mouse.move(60, 450);
  await page.keyboard.down("Shift");
  await expect(badge).toBeVisible();
  await expect(stage).toHaveCSS("cursor", "default");
  await page.getByRole("button", { name: "聚类优化", exact: true }).hover();
  await expect(badge).toBeHidden();
  const mini = await center(page.locator(".storyboard-graph-minimap"));
  await page.mouse.move(mini.x, mini.y);
  await expect(badge).toBeHidden();
  await shot(page, 4).hover();
  await expect(badge).toBeVisible();
  await expect(shot(page, 4)).toHaveCSS("cursor", "default");
  await page.locator('[data-preview-shot-id="4"]').hover();
  await expect(badge).toBeHidden();
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await page.mouse.move(70, 460);
  await expect(stage).toHaveCSS("cursor", "grab");
  await expect(badge).toBeHidden();
  await enableSpray(page);
  await page.mouse.move(70, 460);
  await expect(badge).toBeHidden();
  await page.keyboard.up("Shift");
});

for (const [mode, single, group, box] of [
  ["替换选择", ["4"], ["3", "4", "5"], ["0", "1", "2"]],
  ["添加到选择", ["4", "8"], ["2", "3", "4", "5"], ["0", "1", "2", "3", "4", "5"]],
  ["从选择中减去", ["8"], ["2"], ["3", "4", "5"]],
  ["与选择交集", [], ["3", "4", "5"], ["2"]],
] as const) {
  test(`${mode} applies to clicks, double-click neighbors and live marquee without changing playback on marquee`, async ({
    page,
  }) => {
    await mount(page);
    await shot(page, 8).click();
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await shot(page, 4).click();
    await expect.poll(() => selected(page)).toEqual([...single]);
    expect(await activated(page)).toBe("4");
    await page.getByRole("radio", { name: "替换选择", exact: true }).click();
    await shot(page, 3).dblclick();
    await expect.poll(() => selected(page)).toEqual(["2", "3", "4", "5"]);
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await shot(page, 4).dblclick();
    await expect.poll(() => selected(page)).toEqual([...group]);
    expect(await activated(page)).toBe("4");

    await page.getByRole("radio", { name: "替换选择", exact: true }).click();
    await shot(page, 3).dblclick();
    await page.getByRole("radio", { name: mode, exact: true }).click();
    const before = await activations(page);
    const beforeCamera = await transform(page);
    await topRowMarquee(page);
    await expect(page.locator(".storyboard-graph-view")).toHaveCSS("cursor", "default");
    await expect.poll(() => selected(page)).toEqual([...box]);
    const colors = await page.locator(".storyboard-graph-marquee").evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopColor, style.backgroundColor];
    });
    expect(colors.every(isGrayscale)).toBe(true);
    await page.mouse.up();
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
    expect(await selected(page)).toEqual([...box]);
    expect(await activations(page)).toEqual(before);
    expect(await activated(page)).toBe("3");
    expect(await transform(page)).toEqual(beforeCamera);
  });
}

test("selection previews persist and unselected hover adds missing neighbors", async ({ page }) => {
  await mount(page);
  await shot(page, 4).click();
  await shot(page, 0).hover();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(3);
  await expect(page.locator('[data-preview-shot-id="4"]')).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveAttribute("data-preview-shot-id", "0");
  expect(await activated(page)).toBe("4");
  await page.mouse.move(1100, 700);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(1);
  await expect(page.locator('[data-preview-shot-id="4"]')).toBeVisible();
  await shot(page, 4).dblclick();
  await page.mouse.move(1100, 700);
  await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(3);
});

test("unselected pointer hover reveals missing neighbors at 60% while selected previews keep their own opacity", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as any).graphSetSelection(new Set(["0", "4"])));
  const preview = (id: number) => page.locator(`[data-preview-shot-id="${id}"]`);
  const displayed = () =>
    page
      .locator(".storyboard-graph-preview:not(.is-exiting)")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-preview-shot-id")).sort(),
      );
  await expect.poll(displayed).toEqual(["0", "4"]);
  await shot(page, 5).hover();
  await expect.poll(displayed).toEqual(["0", "3", "4", "5", "6"]);
  for (const id of [3, 6]) {
    await expect(preview(id)).toHaveClass(/is-neighbor/);
    await expect(preview(id)).toHaveCSS("opacity", "0.6");
  }
  for (const id of [0, 4, 5]) await expect(preview(id)).toHaveCSS("opacity", "1");
  await expect(preview(4)).not.toHaveClass(/is-neighbor/);
  const zIndex = (id: number) =>
    preview(id).evaluate((element) => Number(getComputedStyle(element).zIndex));
  const neighborZ = await zIndex(3);
  // Supplementary previews are visual only; selected and directly hovered
  // previews keep normal pointer emphasis and stacking behavior.
  await expect(preview(3)).toHaveCSS("pointer-events", "none");
  await expect(preview(6)).toHaveCSS("pointer-events", "none");
  expect(await zIndex(3)).toBe(neighborZ);
  expect(await zIndex(3)).toBeLessThan(await zIndex(5));
  await expect(preview(3)).toHaveCSS("opacity", "0.6");
  await expect.poll(displayed).toEqual(["0", "3", "4", "5", "6"]);
  await expect(preview(4)).toHaveCSS("opacity", "1");
  await expect(preview(0)).toHaveCSS("opacity", "1");
  expect(await selected(page)).toEqual(["0", "4"]);
  expect(await activations(page)).toEqual([]);
  await preview(4).hover();
  expect(await zIndex(4)).toBeGreaterThan(await zIndex(5));
  await expect(preview(0)).toHaveCSS("opacity", "0.6");
  await preview(5).hover();
  expect(await zIndex(5)).toBeGreaterThan(await zIndex(4));
  await page.mouse.move(1100, 700);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(2);
  for (const id of [0, 4]) await expect(preview(id)).toHaveCSS("opacity", "1");
  // Hovering an already selected node retains the existing selection behavior.
  await shot(page, 4).hover();
  await expect.poll(displayed).toEqual(["0", "4"]);
  await expect(preview(4)).toHaveCSS("opacity", "1");
  await expect(preview(0)).toHaveCSS("opacity", "0.6");
});

for (const tool of ["pointer", "hand", "spray"] as const) {
  test(`${tool} mouse events pass through supplementary 60% previews to covered graph nodes`, async ({
    page,
  }) => {
    await mount(page);
    await shot(page, 4).click();
    if (tool === "hand") await page.getByRole("button", { name: "手型工具", exact: true }).click();
    if (tool === "spray") await enableSpray(page);
    const beforeActivations = await activations(page);
    await shot(page, 5).hover();
    const neighbor = page.locator('[data-preview-shot-id="6"]');
    await expect(neighbor).toHaveCSS("opacity", "0.6");
    await expect(neighbor).toHaveCSS("pointer-events", "none");
    await expect(neighbor.locator(".shot-frame-button")).toHaveCSS("pointer-events", "none");
    const covered = await center(shot(page, 3));
    const box = (await neighbor.boundingBox())!;
    expect(covered.x).toBeGreaterThan(box.x);
    expect(covered.x).toBeLessThan(box.x + box.width);
    expect(covered.y).toBeGreaterThan(box.y);
    expect(covered.y).toBeLessThan(box.y + box.height);
    const hit = await page.evaluate((point) => {
      const target = document.elementFromPoint(point.x, point.y);
      return {
        node: target?.closest<HTMLElement>(".storyboard-graph-dot")?.dataset.storyboardShotId,
        preview: Boolean(target?.closest(".storyboard-graph-preview")),
      };
    }, covered);
    expect(hit).toEqual({ node: "3", preview: false });
    // A real move and click must reach the node under the painted thumbnail.
    await page.mouse.move(covered.x, covered.y);
    await expect(shot(page, 3)).toHaveClass(/is-hovered/);
    await page.mouse.click(covered.x, covered.y);
    if (tool === "pointer") {
      expect(await selected(page)).toEqual(["3"]);
      expect(await activated(page)).toBe("3");
    } else {
      expect(await selected(page)).toEqual(["4"]);
      expect(await activations(page)).toEqual(beforeActivations);
      if (tool === "spray") expect((await sprays(page)).map((spray) => spray.ids)).toEqual([["3"]]);
    }
  });
}

test("pointer preview emphasis dims only already displayed thumbnails without changing selection or playback", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 1).click();
  await page.getByRole("radio", { name: "添加到选择", exact: true }).click();
  await shot(page, 4).click();
  await shot(page, 8).click();
  const preview = (id: number) => page.locator(`[data-preview-shot-id="${id}"]`);
  const displayed = () =>
    page
      .locator(".storyboard-graph-preview")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-preview-shot-id")).sort(),
      );
  const before = await activations(page);
  const expectPreviewOnTop = async (id: number) => {
    await expect
      .poll(() =>
        preview(id).evaluate((element) => {
          const z = Number(getComputedStyle(element).zIndex);
          return Array.from(document.querySelectorAll(".storyboard-graph-preview")).every(
            (other) => other === element || Number(getComputedStyle(other).zIndex) < z,
          );
        }),
      )
      .toBe(true);
  };

  await shot(page, 4).hover();
  await expectPreviewOnTop(4);
  await expect.poll(displayed).toEqual(["1", "4", "8"]);
  await expect(preview(4)).toHaveCSS("opacity", "1");
  await expect(preview(1)).toHaveCSS("opacity", "0.6");
  await expect(preview(8)).toHaveCSS("opacity", "0.6");
  await preview(1).hover();
  await expectPreviewOnTop(1);
  await expect(preview(1)).toHaveCSS("opacity", "1");
  await expect(preview(4)).toHaveCSS("opacity", "0.6");
  await expect(preview(8)).toHaveCSS("opacity", "0.6");
  expect(await displayed()).toEqual(["1", "4", "8"]);
  await preview(1).click();
  expect(await selected(page)).toEqual(["1", "4", "8"]);
  expect(await activations(page)).toEqual(before);

  await shot(page, 0).hover();
  await expect.poll(displayed).toEqual(["0", "1", "4", "8"]);
  const visibleBefore = await displayed();
  await preview(0).hover();
  await expectPreviewOnTop(0);
  await expect(preview(0)).toHaveCSS("opacity", "1");
  await expect(preview(1)).toHaveCSS("opacity", "1");
  await expect(preview(4)).toHaveCSS("opacity", "0.6");
  await expect(preview(8)).toHaveCSS("opacity", "0.6");
  expect(await displayed()).toEqual(visibleBefore);
  await preview(4).hover();
  await expectPreviewOnTop(4);
  await expect(preview(4)).toHaveCSS("opacity", "1");
  await expect(preview(0)).toHaveCSS("opacity", "0.6");
  await expect(preview(1)).toHaveCSS("opacity", "0.6");
  expect(await displayed()).toEqual(visibleBefore);
  expect(await selected(page)).toEqual(["1", "4", "8"]);
  expect(await activations(page)).toEqual(before);
  await page.mouse.move(1100, 700);
  await expect.poll(displayed).toEqual(["1", "4", "8"]);
  for (const id of [1, 4, 8]) await expect(preview(id)).toHaveCSS("opacity", "1");
});

test("hovered nodes paint above selected bodies and rings in either tool", async ({ page }) => {
  await mount(page);
  await shot(page, 1).click();
  await page.getByRole("radio", { name: "添加到选择", exact: true }).click();
  await shot(page, 8).click();
  const before = await activations(page);
  for (const tool of ["指针工具", "手型工具"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    for (const id of [1, 4, 8]) {
      await shot(page, id).hover();
      await expect(
        page.locator(".storyboard-graph-selection-rings > g:last-child"),
      ).toHaveAttribute("data-overlay-node", String(id));
      const paint = await shot(page, id).evaluate((button) => {
        const layer = document.querySelector(".storyboard-graph-selection-rings")!;
        const body = layer.lastElementChild!.querySelector("circle")!;
        return {
          htmlHitTarget: button instanceof HTMLButtonElement,
          fill: getComputedStyle(body).fill,
          layerZ: Number(getComputedStyle(layer).zIndex),
          worldZ: getComputedStyle(document.querySelector(".storyboard-graph-world")!).zIndex,
        };
      });
      expect(paint.htmlHitTarget).toBe(true);
      expect(isGrayscale(paint.fill)).toBe(true);
      expect(paint.layerZ).toBeGreaterThan(Number(paint.worldZ) || 0);
    }
  }
  expect(await selected(page)).toEqual(["1", "8"]);
  expect(await activations(page)).toEqual(before);
});

test("Escape and window blur cancel an active marquee and restore the original selection without seeking", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 8).click();
  const before = await activations(page);
  for (const cancel of ["escape", "blur"] as const) {
    await topRowMarquee(page);
    await expect.poll(() => selected(page)).toEqual(["0", "1", "2"]);
    if (cancel === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
    expect(await selected(page)).toEqual(["8"]);
    await page.mouse.up();
    expect(await activations(page)).toEqual(before);
  }
});

test("graph annotations update readonly thumbnail badges, colored nodes and concentric rings", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() =>
    (window as any).graphSetAnnotations({
      "4": { rating: 3, retained: true, keywordIds: ["keyword"], colorLabel: "red" },
      "8": { rating: 0, retained: false, colorLabel: "blue" },
    }),
  );
  await shot(page, 4).click();
  const preview = page.locator('[data-preview-shot-id="4"]');
  const metadata = preview.locator(".storyboard-graph-preview-metadata");
  await expect(metadata.getByRole("img", { name: "留用旗标", exact: true })).toBeVisible();
  await expect(metadata.getByRole("img", { name: "3 星", exact: true })).toBeVisible();
  await expect(metadata.getByRole("img", { name: "该分镜包含关键字", exact: true })).toBeVisible();
  await expect(metadata.locator("button")).toHaveCount(0);
  await expect(metadata).toHaveCSS("pointer-events", "none");
  const node = page.locator('[data-selection-node="4"]');
  const ring = page.locator('[data-selection-ring="4"]');
  const fill = await node.evaluate((element) => getComputedStyle(element).fill);
  expect(isGrayscale(fill)).toBe(false);
  await expect(ring).toHaveCSS("stroke", fill);
  await expect(preview).toHaveClass(/has-color-label/);
  expect(
    await preview
      .locator(".shot-frame-button")
      .evaluate((element) => getComputedStyle(element).boxShadow),
  ).toContain(fill);
  await shot(page, 0).hover();
  await expect(shot(page, 8)).toHaveCSS("opacity", "0.2");
  await expect(shot(page, 4)).toHaveCSS("opacity", "1");
  await expect(ring).toHaveCSS("stroke", fill);
  await page.evaluate(() =>
    (window as any).graphSetAnnotations({
      "4": { rating: 5, retained: false, excluded: true, customLabel: "自定义" },
    }),
  );
  await expect(metadata.getByRole("img", { name: "排除旗标", exact: true })).toBeVisible();
  await expect(metadata.getByRole("img", { name: "5 星", exact: true })).toBeVisible();
  await expect(metadata.getByRole("img", { name: "该分镜包含关键字", exact: true })).toHaveCount(0);
  await expect(node).not.toHaveCSS("fill", fill);
  await page.evaluate(() => (window as any).graphSetAnnotations({}));
  await expect(preview).not.toHaveClass(/has-color-label/);
  await expect(metadata.locator('[role="img"]')).toHaveCount(0);
  expect(await selected(page)).toEqual(["4"]);
});

test("graph thumbnails scrub by pointer position without selecting or seeking the source player", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 4).click();
  const before = await activations(page);
  const preview = page.locator('[data-preview-shot-id="4"]');
  const frame = preview.getByRole("img", { name: "分镜选帧缩略图", exact: true });
  const bounds = (await frame.boundingBox())!;
  const progress = preview.locator(".shot-hover-progress > span");
  for (const fraction of [0.25, 0.75]) {
    await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2);
    await expect
      .poll(() => progress.evaluate((element) => parseFloat((element as HTMLElement).style.width)))
      .toBeCloseTo(fraction * 100, 1);
  }
  await frame.click();
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(before);
  await page.mouse.move(1100, 700);
  await expect(progress).toHaveCount(0);
  await expect(preview).toBeVisible();
});

test("hand thumbnails allow position preview while preserving neighbor previews and opacity", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 4).click();
  const before = await activations(page);
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await shot(page, 5).hover();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(4);
  const stacking = () =>
    page.locator(".storyboard-graph-preview").evaluateAll((elements) =>
      elements
        .map((element) => ({
          id: element.getAttribute("data-preview-shot-id"),
          z: Number(getComputedStyle(element).zIndex),
        }))
        .sort((a, b) => a.z - b.z),
    );
  const distanceOrder = await stacking();
  expect(distanceOrder.map(({ id }) => id)).toEqual(["6", "3", "4", "5"]);
  const preview = page.locator('[data-preview-shot-id="5"]');
  const frame = preview.getByRole("img", { name: "分镜选帧缩略图", exact: true });
  await frame.hover();
  expect(await stacking()).toEqual(distanceOrder);
  await expect(page.locator('[data-preview-shot-id="6"]')).toHaveCSS("pointer-events", "none");
  expect(await stacking()).toEqual(distanceOrder);
  await frame.hover();
  await expect(preview.locator(".shot-hover-progress")).toBeVisible();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(4);
  await expect(preview).toHaveCSS("opacity", "1");
  for (const id of [3, 6])
    await expect(page.locator(`[data-preview-shot-id="${id}"]`)).toHaveCSS("opacity", "0.6");
  await frame.click();
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(before);
  await page.mouse.move(1100, 700);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(1);
});

test("spray clicks, double-clicks and thumbnail clicks use paint targets without changing selection or playback", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 8).click();
  const before = await activations(page);
  await enableSpray(page);
  await expect(page.getByRole("radiogroup", { name: "图谱选择模式" })).toHaveCount(0);
  await shot(page, 4).click();
  await expect.poll(() => sprays(page)).toHaveLength(1);
  expect((await sprays(page))[0]).toMatchObject({ ids: ["4"], eraseWithAlt: false });
  await shot(page, 3).dblclick();
  const double = (await sprays(page)).slice(-2);
  expect(double[0].ids).toEqual(["3"]);
  expect(double[1].ids).toEqual(["2", "3", "4", "5"]);
  expect(double[0].historyGroupId).toBe(double[1].historyGroupId);
  await shot(page, 4).click({ modifiers: ["Alt"] });
  expect((await sprays(page)).at(-1)).toMatchObject({ ids: ["4"], eraseWithAlt: true });
  const frame = page
    .locator('[data-preview-shot-id="8"]')
    .getByRole("img", { name: "分镜选帧缩略图", exact: true });
  await frame.click();
  expect((await sprays(page)).at(-1)).toMatchObject({ ids: ["8"], eraseWithAlt: false });
  await frame.dblclick();
  expect((await sprays(page)).at(-1)?.ids).toEqual(["7", "8"]);
  expect(await selected(page)).toEqual(["8"]);
  expect(await activations(page)).toEqual(before);
  await page.getByRole("button", { name: "指针工具", exact: true }).click();
  await expect(page.locator(".storyboard-graph-view")).not.toHaveClass(/is-spraying/);
  await shot(page, 4).click();
  expect(await selected(page)).toEqual(["4"]);
  expect(await activated(page)).toBe("4");
});

test("spray marquee uses a dashed frame and commits its final region in one history group", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 8).click();
  await page.getByRole("radio", { name: "与选择交集", exact: true }).click();
  const before = await activations(page);
  const camera = await transform(page);
  await enableSpray(page);
  await topRowMarquee(page);
  await expect(page.locator(".storyboard-graph-marquee")).toHaveCSS("border-top-style", "dashed");
  expect(await sprays(page)).toEqual([]);
  expect(await selected(page)).toEqual(["8"]);
  await page.keyboard.down("Alt");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(() => sprays(page)).toHaveLength(1);
  expect((await sprays(page))[0]).toMatchObject({ ids: ["0", "1", "2"], eraseWithAlt: true });
  expect((await sprays(page))[0].historyGroupId).toBeTruthy();
  expect(await selected(page)).toEqual(["8"]);
  expect(await activations(page)).toEqual(before);
  expect(await transform(page)).toEqual(camera);
});

test("cancelled spray regions never paint or change selection", async ({ page }) => {
  await mount(page);
  await shot(page, 8).click();
  const before = await activations(page);
  await enableSpray(page);
  for (const cancel of ["escape", "blur"] as const) {
    await topRowMarquee(page);
    if (cancel === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
    await page.mouse.up();
    expect(await sprays(page)).toEqual([]);
    expect(await selected(page)).toEqual(["8"]);
    expect(await activations(page)).toEqual(before);
  }
});

test("spray mode keeps overview navigation available without painting", async ({ page }) => {
  await mount(page, false, 5);
  await shot(page, 4).click();
  const anchor = await center(shot(page, 4));
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -400);
  const before = await transform(page);
  const beforeActivations = await activations(page);
  await enableSpray(page);
  const handle = await center(page.locator("[data-graph-viewport]"));
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 8, handle.y - 5, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).toBeGreaterThan(before.x);
  await assertFrame(page);
  expect(await sprays(page)).toEqual([]);
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(beforeActivations);
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await expect(page.locator(".storyboard-graph-view")).toHaveClass(/is-hand/);
  await expect(page.locator(".storyboard-graph-view")).not.toHaveClass(/is-spraying/);
});
