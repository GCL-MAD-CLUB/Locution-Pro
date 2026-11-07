import { test, expect } from "../../support/fixtures";
import type { Page, Locator } from "@playwright/test";

async function mount(page: Page, empty = false, spread = 1) {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(
    async ({ empty, spread }) => {
      const path = "/tests/browser/components/storyboard/storyboard-graph.harness.js";
      (await import(/* @vite-ignore */ path)).mountGraph(empty, spread);
    },
    { empty, spread },
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
  ["at", 12.91875],
  ["below", 20],
] as const) {
  test(`hover previews stop ${label} 0.2 CSS pixels per unit and resume when zoomed in`, async ({
    page,
  }) => {
    await mount(page, false, spread);
    await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.2);
    if (label === "at") expect((await transform(page)).zoom).toBe(0.2);
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

    await stage.focus();
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.2);
    await page.mouse.move(30, 30);
    await dot.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(stage).toHaveClass(/has-focus/);
    await expect(dot).toHaveAttribute("aria-describedby");

    await stage.focus();
    for (let i = 0; i < 8; i++) await stage.press("-");
    await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.2);
    await dot.focus();
    await expect(
      page.locator(
        ".storyboard-graph-preview, .storyboard-graph-dot.is-hovered, .storyboard-graph-dot.is-neighbor, .storyboard-graph-edges line.is-highlighted",
      ),
    ).toHaveCount(0);
    await expect(stage).not.toHaveClass(/has-focus/);
  });
}

test("resizing below the hover threshold removes existing previews without stale hover returning", async ({
  page,
}) => {
  await mount(page, false, 10);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.2);
  await dot.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "420px";
    host.style.height = "220px";
  });
  await expect.poll(async () => (await transform(page)).zoom).toBeLessThanOrEqual(0.2);
  await expect(
    page.locator(
      ".storyboard-graph-preview, .storyboard-graph-dot.is-hovered, .storyboard-graph-edges line.is-highlighted",
    ),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "800px";
    host.style.height = "500px";
  });
  await expect.poll(async () => (await transform(page)).zoom).toBeGreaterThan(0.2);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
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
