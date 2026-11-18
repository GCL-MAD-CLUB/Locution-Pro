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
  topRowMarquee,
} from "./graph-fixture";

for (const [keys, mode, label, expected] of [
  [[], "replace", "替换选择", ["0", "1", "2"]],
  [["Shift"], "add", "添加到选择", ["0", "1", "2", "8"]],
  [["Alt"], "subtract", "从选择中减去", ["8"]],
  [["Shift", "Alt"], "intersect", "与选择交集", ["1"]],
] as const) {
  test(`selection modifiers ${mode} drive marquee without seeking`, async ({ page }) => {
    await mount(page);
    await page.evaluate(() => window.graphSetSelection(new Set(["1", "8"])));
    const stage = page.locator(".storyboard-graph-view");
    const before = await transform(page);
    for (const key of keys) await page.keyboard.down(key);
    await topRowMarquee(page);
    await expect(stage).toHaveAttribute("data-selection-mode", mode);
    await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
    const badge = page.locator(".storyboard-graph-selection-cursor");
    if (mode === "replace") await expect(badge).toBeHidden();
    else {
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute("data-selection-mode", mode);
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

test("stationary marquee recomputes modifiers from the original selection and blur releases the modifier", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => window.graphSetSelection(new Set(["1", "8"])));
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

test("selection modifier indicator follows interaction focus", async ({ page }) => {
  await mount(page);
  const badge = page.locator(".storyboard-graph-selection-cursor");
  await page.mouse.move(60, 450);
  await page.keyboard.down("Shift");
  await expect(badge).toBeVisible();
  await page.getByRole("button", { name: "聚类优化", exact: true }).hover();
  await expect(badge).toBeHidden();
  const mini = await center(page.locator(".storyboard-graph-minimap"));
  await page.mouse.move(mini.x, mini.y);
  await expect(badge).toBeHidden();
  await shot(page, 4).hover();
  await expect(badge).toBeVisible();
  await page.locator('[data-preview-shot-id="4"]').hover();
  await expect(badge).toBeHidden();
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await page.mouse.move(70, 460);
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
    await expect.poll(() => selected(page)).toEqual([...box]);
    await page.mouse.up();
    await expect(page.locator(".storyboard-graph-marquee")).toHaveCount(0);
    expect(await selected(page)).toEqual([...box]);
    expect(await activations(page)).toEqual(before);
    expect(await activated(page)).toBe("3");
    expect(await transform(page)).toEqual(beforeCamera);
  });
}

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

test("spray marquee commits its final region in one history group", async ({ page }) => {
  await mount(page);
  await shot(page, 8).click();
  await page.getByRole("radio", { name: "与选择交集", exact: true }).click();
  const before = await activations(page);
  const camera = await transform(page);
  await enableSpray(page);
  await topRowMarquee(page);
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
