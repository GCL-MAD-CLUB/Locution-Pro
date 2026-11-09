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

test("graph frame matches icon view; controls and corner text are absent; hover and selection work", async ({
  page,
}) => {
  await mount(page);
  const styles = await page.evaluate(() => {
    const keys = ["border", "borderRadius", "boxShadow", "backgroundColor"] as const;
    const read = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return keys.map((key) => style[key]);
    };
    return { graph: read(".storyboard-graph-view"), reference: read("#frame-reference") };
  });
  expect(styles.graph).toEqual(styles.reference);
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
  const previewGeometry = await page.evaluate(() => {
    const dot = document.querySelector<HTMLElement>(".storyboard-graph-dot.is-hovered")!;
    const preview = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    const dotBox = dot.getBoundingClientRect();
    const previewBox = preview.getBoundingClientRect();
    const arrow = getComputedStyle(preview, "::after");
    return {
      dotCenterX: dotBox.left + dotBox.width / 2,
      dotTop: dotBox.top,
      arrowCenterX: previewBox.left + Number.parseFloat(arrow.left),
      arrowTipY:
        previewBox.top + Number.parseFloat(arrow.top) + Number.parseFloat(arrow.borderTopWidth),
    };
  });
  expect(previewGeometry.arrowCenterX).toBeCloseTo(previewGeometry.dotCenterX, 1);
  expect(previewGeometry.arrowTipY).toBeLessThan(previewGeometry.dotTop);
  await dot.click();
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("selection preserves the disc geometry; zoom scales it and only hover enlarges it by 1.1", async ({
  page,
}) => {
  await mount(page, false, 3);
  const disc = page.locator('[data-graph-node="4"]');
  const geometry = () =>
    disc.evaluate((element) => {
      const circle = element as SVGCircleElement;
      return {
        radius: circle.r.baseVal.value,
        stroke: getComputedStyle(circle).strokeWidth,
        width: circle.getBoundingClientRect().width,
      };
    });
  const normal = await geometry();
  await page.evaluate(() => (window as any).graphSetSelection(new Set(["4"])));
  await expect(disc).toHaveAttribute("data-selection-node", "4");
  expect(await geometry()).toEqual(normal);
  await shot(page, 4).hover();
  expect((await geometry()).width / normal.width).toBeCloseTo(1.1, 4);
  await page.evaluate(() => (window as any).graphSetSelection(new Set()));
  await expect(disc).not.toHaveAttribute("data-selection-node");
  expect((await geometry()).width / normal.width).toBeCloseTo(1.1, 4);
  await page.mouse.move(1000, 700);
  await expect(shot(page, 4)).not.toHaveClass(/is-hovered/);
  expect(await geometry()).toEqual(normal);
  const initial = await transform(page);
  await page.mouse.move(600, 350);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(initial.zoom);
  const zoom = (await transform(page)).zoom;
  expect((await geometry()).radius / normal.radius).toBeCloseTo(
    Math.min(zoom, 0.8) / Math.min(initial.zoom, 0.8),
    4,
  );
});

test("zoom caps at 2 while node paint, hit targets and rings stop growing at 0.8", async ({
  page,
}) => {
  await mount(page, false, 6, 8);
  const dot = shot(page, 4);
  await dot.click();
  const geometry = () =>
    dot.evaluate((button) => {
      const node = document.querySelector<SVGCircleElement>('[data-graph-node="4"]')!;
      const ring = document.querySelector<SVGCircleElement>('[data-selection-ring="4"]')!;
      const matrix = node.getScreenCTM()!;
      const radius =
        (node.r.baseVal.value + parseFloat(getComputedStyle(node).strokeWidth) / 2) * matrix.a;
      const a = node.getBoundingClientRect();
      const b = ring.getBoundingClientRect();
      return {
        radius,
        hitWidth: button.getBoundingClientRect().width,
        gap: ring.r.baseVal.value * matrix.a - 0.5 - radius,
        ringStroke: getComputedStyle(ring).strokeWidth,
        dx: (a.left + a.right - b.left - b.right) / 2,
        dy: (a.top + a.bottom - b.top - b.bottom) / 2,
      };
    });
  const widths: number[] = [];
  for (const zoom of [0.6, 0.8, 1.2, 2]) {
    const current = (await transform(page)).zoom;
    const anchor = await center(dot);
    await page.locator(".storyboard-graph-view").evaluate(
      (element, input) => {
        element.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: input.x,
            clientY: input.y,
            deltaY: -Math.log(input.zoom / input.current) / 0.0015,
          }),
        );
      },
      { ...anchor, zoom, current },
    );
    await expect.poll(async () => (await transform(page)).zoom).toBeCloseTo(zoom, 5);
    const actual = await geometry();
    expect(actual.radius).toBeCloseTo(8 * Math.min(zoom, 0.8), 4);
    // HTML layout rounds the inverse-scaled hit box to subpixel layout units.
    expect(actual.hitWidth).toBeCloseTo(actual.radius * 2, 1);
    expect(actual.gap).toBeCloseTo(Math.max(1, actual.radius / 4), 4);
    expect(actual.ringStroke).toBe("1px");
    expect(actual.dx).toBeCloseTo(0, 4);
    expect(actual.dy).toBeCloseTo(0, 4);
    widths.push(actual.hitWidth);
    await assertFrame(page);
  }
  expect(widths[0]).toBeLessThan(widths[1]);
  expect(widths[1]).toBeCloseTo(widths[2], 1);
  expect(widths[2]).toBeCloseTo(widths[3], 1);
  const position = await center(dot);
  await page.mouse.move(position.x + widths[3] / 2 + 2, position.y);
  await expect(dot).not.toHaveClass(/is-hovered/);
  await dot.hover();
  const hovered = await geometry();
  expect(hovered.hitWidth).toBeCloseTo(widths[3] * 1.1, 3);
  expect(hovered.hitWidth).toBeCloseTo(hovered.radius * 2, 1);
  expect(hovered.dx).toBeCloseTo(0, 4);
  expect(hovered.dy).toBeCloseTo(0, 4);
});

test("hover scale, node and edge colors, and preview entry and exit ease immediately together", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const entering = await page.evaluate(async () => {
    for (const element of document.querySelectorAll(
      ".storyboard-graph-node-paint, .storyboard-graph-node",
    ))
      getComputedStyle(element).getPropertyValue("scale");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const button = document.querySelector('[data-storyboard-shot-id="4"].storyboard-graph-dot')!;
    button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return document
      .querySelector(".storyboard-graph-view")!
      .getAnimations({ subtree: true })
      .filter((animation) => animation instanceof CSSTransition)
      .map((animation) => {
        animation.pause();
        const effect = animation.effect as KeyframeEffect;
        const frames = effect.getKeyframes();
        return {
          target: (effect.target as Element).getAttribute("class"),
          property: (animation as CSSTransition).transitionProperty,
          duration: effect.getTiming().duration,
          easing: effect.getTiming().easing,
          from: frames[0],
          to: frames.at(-1)!,
        };
      });
  });
  for (const [target, property] of [
    ["storyboard-graph-node-paint", "scale"],
    ["storyboard-graph-node", "fill"],
    ["is-highlighted", "stroke"],
    ["storyboard-graph-preview", "opacity"],
  ]) {
    const transition = entering.find(
      (item) => item.target?.includes(target) && item.property === property,
    );
    expect(transition, `${target} ${property}: ${JSON.stringify(entering)}`).toBeDefined();
    expect(transition!.duration).toBe(120);
    expect(transition!.easing).toBe("ease");
  }
  const scaling = entering.find((item) => item.property === "scale")!;
  expect(parseFloat(String(scaling.to.scale))).toBe(1.1);
  const fadingIn = entering.find(
    (item) =>
      item.target?.includes("storyboard-graph-preview") && !item.target.includes("is-neighbor"),
  )!;
  expect(Number(fadingIn.from.opacity)).toBe(0);
  expect(Number(fadingIn.to.opacity)).toBe(1);
  const exiting = await page.evaluate(async () => {
    for (const animation of document
      .querySelector(".storyboard-graph-view")!
      .getAnimations({ subtree: true }))
      animation.finish();
    // Commit the finished values before asking React to remove the hover.
    document.querySelector(".storyboard-graph-preview")!.getBoundingClientRect();
    const button = document.querySelector('[data-storyboard-shot-id="4"].storyboard-graph-dot')!;
    button.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const preview = document.querySelector<HTMLElement>(".storyboard-graph-preview.is-exiting");
    const transition = preview
      ?.getAnimations()
      .find((animation) => (animation as CSSTransition).transitionProperty === "opacity");
    const effect = transition?.effect as KeyframeEffect | undefined;
    return {
      hoverCleared: !button.classList.contains("is-hovered"),
      inert: preview?.inert,
      pointerEvents: preview && getComputedStyle(preview).pointerEvents,
      frames: effect?.getKeyframes(),
      duration: effect?.getTiming().duration,
    };
  });
  expect(exiting.hoverCleared).toBe(true);
  expect(exiting.inert).toBe(true);
  expect(exiting.pointerEvents).toBe("none");
  expect(exiting.duration).toBe(120);
  expect(Number(exiting.frames?.at(-1)?.opacity)).toBe(0);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
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

test("maximum zoom gives equal node pixels for small and large graphs and survives panel resizing", async ({
  page,
}) => {
  let referenceDiameter = 0;
  for (const spread of [0.01, 1, 30]) {
    await mount(page, false, spread);
    const dot = page.getByRole("button", { name: "Shot 4", exact: true });
    const anchor = await center(dot);
    await page.mouse.move(anchor.x, anchor.y);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -600);
    // The first, tiny graph already reaches the pixel cap in its fitted view.
    if (!referenceDiameter) referenceDiameter = (await dot.boundingBox())!.width;
    await expect
      .poll(async () => (await dot.boundingBox())!.width)
      .toBeCloseTo(referenceDiameter, 1);
    expect(referenceDiameter).toBeLessThanOrEqual(40);
    expect(referenceDiameter).toBeGreaterThan(0);
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
    await expect
      .poll(async () => (await dot.boundingBox())!.width)
      .toBeCloseTo(referenceDiameter, 1);
    await expect
      .poll(async () => {
        const { width, height } = await page
          .locator("[data-graph-viewport]")
          .evaluate((element) => {
            const box = (element as SVGRectElement).getBBox();
            return { width: box.width, height: box.height };
          });
        return width / height;
      })
      .toBeCloseTo(418 / 648, 2);
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

test("selection previews persist, unselected hover adds missing neighbors, and selected rings stay one pixel at different zooms", async ({
  page,
}) => {
  await mount(page, false, 5);
  const dot = shot(page, 4);
  await dot.click();
  for (const wheel of [-300, 200]) {
    const position = await center(dot);
    await page.mouse.move(position.x, position.y);
    await page.mouse.wheel(0, wheel);
    await dot.hover();
    const ring = await dot.evaluate(() => {
      const circle = document.querySelector<SVGCircleElement>('[data-selection-ring="4"]')!;
      const node = document.querySelector<SVGCircleElement>('[data-selection-node="4"]')!;
      const ring = getComputedStyle(circle);
      const fill = getComputedStyle(node);
      return {
        width: Number.parseFloat(ring.strokeWidth),
        gap:
          (circle.r.baseVal.value -
            node.r.baseVal.value -
            Number.parseFloat(fill.strokeWidth) / 2) *
            node.getScreenCTM()!.a -
          Number.parseFloat(ring.strokeWidth) / 2,
        stroke: ring.stroke,
        fill: fill.fill,
      };
    });
    expect(ring.width).toBeCloseTo(1, 1);
    expect(ring.gap).toBeGreaterThanOrEqual(0.99);
    expect(ring.stroke).toBe(ring.fill);
    expect(isGrayscale(ring.fill)).toBe(true);
  }
  // At this scale only central nodes are visible; use a compact graph to inspect all previews.
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

test("ring gaps grow beyond 8px diameter and preview arrows follow the ring", async ({ page }) => {
  await mount(page, false, 6, 8);
  const dot = shot(page, 4);
  await dot.click();
  const gaps: number[] = [];
  for (const wheel of [0, -300, -600, 400]) {
    const position = await center(dot);
    await page.mouse.move(position.x, position.y);
    if (wheel) await page.mouse.wheel(0, wheel);
    await dot.hover();
    const geometry = await dot.evaluate(() => {
      const circle = document.querySelector<SVGCircleElement>('[data-selection-ring="4"]')!;
      const node = document.querySelector<SVGCircleElement>('[data-selection-node="4"]')!;
      const ring = getComputedStyle(circle);
      const preview = document.querySelector<HTMLElement>('[data-preview-shot-id="4"]')!;
      const arrow = getComputedStyle(preview, "::after");
      const center = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(
        circle.getScreenCTM()!,
      );
      const scale = node.getScreenCTM()!.a;
      const radius =
        (node.r.baseVal.value + parseFloat(getComputedStyle(node).strokeWidth) / 2) * scale;
      const width = Number.parseFloat(ring.strokeWidth);
      const ringTop = center.y - circle.r.baseVal.value * scale - width / 2;
      const tip =
        preview.getBoundingClientRect().top +
        Number.parseFloat(arrow.top) +
        Number.parseFloat(arrow.borderTopWidth);
      return {
        radius,
        width,
        gap: circle.r.baseVal.value * scale - width / 2 - radius,
        arrowGap: ringTop - tip,
      };
    });
    expect(geometry.width).toBe(1);
    expect(geometry.gap).toBeCloseTo(Math.max(1, geometry.radius / 4), 1);
    expect(geometry.arrowGap).toBeCloseTo(2, 1);
    gaps.push(geometry.gap);
  }
  expect(gaps[0]).toBeGreaterThanOrEqual(1 - 1e-5);
  expect(gaps[2]).toBeCloseTo(1.6, 1);
  expect(gaps[3]).toBeCloseTo(gaps[2], 1);
});

test("selected node and ring share one SVG center through fractional zoom, pan and panel resize", async ({
  page,
}) => {
  for (const radius of [4, 13.4]) {
    await mount(page, false, 6, radius);
    const dot = shot(page, 4);
    await dot.click();
    const assertConcentric = async () => {
      const geometry = await page.evaluate(() => {
        const node = document.querySelector<SVGCircleElement>('[data-selection-node="4"]')!;
        const ring = document.querySelector<SVGCircleElement>('[data-selection-ring="4"]')!;
        const a = node.getBoundingClientRect();
        const b = ring.getBoundingClientRect();
        const button = document.querySelector(".storyboard-graph-dot.is-selected")!;
        return {
          sameGroup: node.parentElement === ring.parentElement,
          sameLocalCenter:
            node.cx.baseVal.value === ring.cx.baseVal.value &&
            node.cy.baseVal.value === ring.cy.baseVal.value,
          dx: (a.left + a.right - b.left - b.right) / 2,
          dy: (a.top + a.bottom - b.top - b.bottom) / 2,
          htmlHitTarget: button instanceof HTMLButtonElement,
          strokeWidth: getComputedStyle(ring).strokeWidth,
        };
      });
      expect(geometry.sameGroup).toBe(true);
      expect(geometry.sameLocalCenter).toBe(true);
      expect(geometry.dx).toBeCloseTo(0, 3);
      expect(geometry.dy).toBeCloseTo(0, 3);
      expect(geometry.htmlHitTarget).toBe(true);
      expect(geometry.strokeWidth).toBe("1px");
    };
    await assertConcentric();
    const position = await center(dot);
    await page.mouse.move(position.x, position.y);
    await page.mouse.wheel(0, -317);
    await assertConcentric();
    await page.getByRole("button", { name: "手型工具", exact: true }).click();
    await page.mouse.move(100, 170);
    await page.mouse.down();
    await page.mouse.move(137.5, 191.25, { steps: 4 });
    await page.mouse.up();
    await assertConcentric();
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>("#graph-host")!;
      host.style.width = "731.5px";
      host.style.height = "481.25px";
    });
    await expect
      .poll(async () => (await page.locator(".storyboard-graph-view").boundingBox())!.width)
      .toBeCloseTo(731.5, 1);
    await assertConcentric();
    const stage = page.locator(".storyboard-graph-view");
    await stage.focus();
    await stage.press("+");
    await assertConcentric();
    await stage.press("-");
    await assertConcentric();
  }
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
  const badgeBox = (await metadata.boundingBox())!;
  const previewBox = (await preview.boundingBox())!;
  expect(badgeBox.x).toBeGreaterThan(previewBox.x);
  expect(badgeBox.y).toBeGreaterThan(previewBox.y);
  expect(badgeBox.x + badgeBox.width).toBeLessThan(previewBox.x + previewBox.width);
  expect(badgeBox.y + badgeBox.height).toBeLessThan(previewBox.y + previewBox.height);
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
