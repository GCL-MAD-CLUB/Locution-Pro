import { test, expect } from "../../support/fixtures";
import { pointerAt as center } from "../../support/pointer";
import {
  mount,
  transform,
  shot,
  selected,
  activated,
  activations,
  sprays,
  enableSpray,
  assertFrame,
} from "./graph-fixture";

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

for (const original of ["pointer", "hand", "spray"] as const) {
  test(`Space temporarily pans from nodes and restores ${original} even when released before pointerup`, async ({
    page,
  }) => {
    await mount(page, false, 5);
    await page.evaluate(() => window.graphSetSelection(new Set(["8"])));
    const stage = page.locator(".storyboard-graph-view");
    await stage.focus();
    if (original === "hand") await page.keyboard.press("h");
    if (original === "spray") await enableSpray(page);
    const geometry = () => page.evaluate(() => window.graphGeometry.positions());
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

for (const spread of [1, 5]) {
  test(`pointer node dragging at spread ${spread} pulls neighbors, preserves selection and playback, then cools to rest`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mount(page, false, spread);
    await page.evaluate(() => window.graphSetSelection(new Set(["8"])));
    const positions = () => page.evaluate(() => window.graphGeometry.positions());
    const before = await positions();
    const initialCamera = await transform(page);
    const start = await center(shot(page, 4));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Holding a node is a grab candidate; blank space still owns marquee selection.
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
    await expect.poll(() => page.evaluate(() => window.graphGeometry.settled())).toBe(true);
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
  const mini = await center(page.locator(".storyboard-graph-minimap"), 0.03, 0.05);
  await page.mouse.click(mini.x, mini.y);
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

test("overview persists without graph data and its viewport follows panel resizing", async ({
  page,
}) => {
  await mount(page, true);
  const before = await page.evaluate(() => window.graphGeometry.viewport());
  await assertFrame(page);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "420px";
    host.style.height = "650px";
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.graphGeometry.viewport())).width)
    .not.toBe(before.width);
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
  await page.mouse.move(mini.x + 10, mini.y + 5);
  await page.mouse.up();
  await expect.poll(async () => (await transform(page)).x).toBeLessThan(beforePointer.x);
  expect((await transform(page)).zoom).toBe(beforePointer.zoom);
  await assertFrame(page);
  const overview = page.locator(".storyboard-graph-minimap");
  const bounds = await center(overview, 0.03, 0.05);
  const beforeLocate = await transform(page);
  await page.mouse.click(bounds.x, bounds.y);
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
