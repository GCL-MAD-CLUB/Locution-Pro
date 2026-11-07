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
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(1);
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
  expect(layering.neighborOpacities).toEqual([]);
  const hoverColors = await page.evaluate(() => {
    const hoveredDot = document.querySelector(".storyboard-graph-dot.is-hovered");
    const neighborDot = document.querySelector(
      ".storyboard-graph-dot.is-neighbor:not(.is-hovered)",
    );
    const highlightedEdge = document.querySelector(".storyboard-graph-edges line.is-highlighted");
    const overviewFrame = document.querySelector("[data-graph-viewport]");
    return {
      dot: hoveredDot ? getComputedStyle(hoveredDot, "::after").backgroundColor : "",
      neighborDot: neighborDot ? getComputedStyle(neighborDot, "::after").backgroundColor : "",
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

for (const [label, spread] of [
  ["at", 6.434375],
  ["below", 10],
] as const) {
  test(`all previews stop ${label} 0.4 CSS pixels per unit and resume when zoomed in`, async ({
    page,
  }) => {
    await mount(page, false, spread);
    await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.4);
    if (label === "at") expect((await transform(page)).zoom).toBe(0.4);
    const dot = page.getByRole("button", { name: "Shot 4", exact: true });
    const stage = page.locator(".storyboard-graph-view");
    await dot.hover();
    await dot.focus();
    await expect(
      page.locator(
        ".storyboard-graph-preview, .storyboard-graph-dot.is-hovered, .storyboard-graph-dot.is-neighbor, .storyboard-graph-edges line.is-highlighted",
      ),
    ).toHaveCount(0);
    await expect(stage).not.toHaveClass(/has-focus/);
    await expect(dot).not.toHaveAttribute("aria-describedby");
    await dot.click();
    await expect(dot).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await page.getByRole("button", { name: "手型工具", exact: true }).click();
    await dot.hover();
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
    await page.getByRole("button", { name: "指针工具", exact: true }).click();

    await stage.focus();
    const anchor = await center(dot);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.4);
    await page.mouse.move(30, 30);
    await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(1);
    await expect(dot).toHaveAttribute("aria-pressed", "true");
    await dot.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(stage).toHaveClass(/has-focus/);
    await expect(dot).toHaveAttribute("aria-describedby");

    await stage.focus();
    for (let i = 0; i < 8; i++) await stage.press("-");
    await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.4);
    await dot.focus();
    await expect(
      page.locator(
        ".storyboard-graph-preview, .storyboard-graph-dot.is-hovered, .storyboard-graph-dot.is-neighbor, .storyboard-graph-edges line.is-highlighted",
      ),
    ).toHaveCount(0);
    await expect(stage).not.toHaveClass(/has-focus/);
    await expect(dot).toHaveAttribute("aria-pressed", "true");
  });
}

test("resizing below the hover threshold removes existing previews without stale hover returning", async ({
  page,
}) => {
  await mount(page, false, 5);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.4);
  await dot.click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "420px";
    host.style.height = "220px";
  });
  await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.4);
  await expect(
    page.locator(
      ".storyboard-graph-preview, .storyboard-graph-dot.is-hovered, .storyboard-graph-edges line.is-highlighted",
    ),
  ).toHaveCount(0);
  await page.mouse.move(1100, 700);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "800px";
    host.style.height = "500px";
  });
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.4);
  await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(1);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("darkest default graph colors match the dark appearance", async ({ page }) => {
  await mount(page);
  const read = () =>
    page.evaluate(() => {
      const dot = document.querySelector(".storyboard-graph-dot")!;
      const edge = document.querySelector(".storyboard-graph-edges line")!;
      return {
        dot: getComputedStyle(dot, "::after").backgroundColor,
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
      dot: getComputedStyle(document.querySelector(".storyboard-graph-dot.is-hovered")!, "::after")
        .backgroundColor,
      neighborDot: getComputedStyle(
        document.querySelector(".storyboard-graph-dot.is-neighbor:not(.is-hovered)")!,
        "::after",
      ).backgroundColor,
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
  expect(await transform(page)).not.toEqual(beforeLocate);
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

test("selection previews persist, hover adds only its own preview, and selected rings stay one pixel at different zooms", async ({
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
          circle.r.baseVal.value - Number.parseFloat(ring.strokeWidth) / 2 - node.r.baseVal.value,
        stroke: ring.stroke,
        fill: fill.fill,
      };
    });
    expect(ring.width).toBeCloseTo(1, 1);
    expect(ring.gap).toBeCloseTo(1, 1);
    expect(ring.stroke).toBe(ring.fill);
    expect(isGrayscale(ring.fill)).toBe(true);
  }
  // At this scale only central nodes are visible; use a compact graph to inspect all previews.
  await mount(page);
  await shot(page, 4).click();
  await shot(page, 0).hover();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(2);
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
      const radius = node.r.baseVal.value;
      const width = Number.parseFloat(ring.strokeWidth);
      const ringTop = center.y - circle.r.baseVal.value - width / 2;
      const tip =
        preview.getBoundingClientRect().top +
        Number.parseFloat(arrow.top) +
        Number.parseFloat(arrow.borderTopWidth);
      return {
        radius,
        width,
        gap: circle.r.baseVal.value - width / 2 - radius,
        arrowGap: ringTop - tip,
      };
    });
    expect(geometry.width).toBe(1);
    expect(geometry.gap).toBeCloseTo(Math.max(1, geometry.radius / 4), 1);
    expect(geometry.arrowGap).toBeCloseTo(2, 1);
    gaps.push(geometry.gap);
  }
  expect(gaps[0]).toBeCloseTo(1, 1);
  expect(gaps[2]).toBeCloseTo(2, 1);
  expect(gaps[3]).toBeLessThan(gaps[2]);
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
          htmlPaint: getComputedStyle(button, "::after").visibility,
          strokeWidth: getComputedStyle(ring).strokeWidth,
        };
      });
      expect(geometry.sameGroup).toBe(true);
      expect(geometry.sameLocalCenter).toBe(true);
      expect(geometry.dx).toBeCloseTo(0, 3);
      expect(geometry.dy).toBeCloseTo(0, 3);
      expect(geometry.htmlPaint).toBe("hidden");
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
          htmlPaint: getComputedStyle(button, "::after").visibility,
          fill: getComputedStyle(body).fill,
          layerZ: Number(getComputedStyle(layer).zIndex),
          worldZ: getComputedStyle(document.querySelector(".storyboard-graph-world")!).zIndex,
        };
      });
      expect(paint.htmlPaint).toBe("hidden");
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
