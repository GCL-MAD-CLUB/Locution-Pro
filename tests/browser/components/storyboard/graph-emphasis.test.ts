import { test, expect } from "../../support/fixtures";
import { activations, mount, selected, shot } from "./graph-fixture";
import { renderedLayer, renderedOpacity } from "./graph-presentation";

test("pointer emphasis follows the hovered preview and leaves selection and playback intact", async ({
  page,
}) => {
  await mount(page);
  const ids = [1, 4, 8];
  await shot(page, 1).click();
  await page.getByRole("radio", { name: "添加到选择", exact: true }).click();
  await shot(page, 4).click();
  await shot(page, 8).click();

  const preview = (id: number) => page.locator(`[data-preview-shot-id="${id}"]`);
  const displayed = () =>
    page
      .locator(".storyboard-graph-preview:not(.is-exiting)")
      .evaluateAll((elements) =>
        elements.map((element) => Number(element.getAttribute("data-preview-shot-id"))).sort(),
      );
  const opacity = () => Promise.all(ids.map((id) => renderedOpacity(preview(id))));
  const before = await activations(page);
  await page.mouse.move(1100, 700);
  await expect.poll(displayed).toEqual(ids);
  await expect(page.locator(".storyboard-graph-preview.is-muted")).toHaveCount(0);
  const neutral = await opacity();

  async function expectEmphasis(id: number) {
    await expect(preview(id)).not.toHaveClass(/is-muted/);
    for (const other of ids.filter((candidate) => candidate !== id)) {
      await expect(preview(other)).toHaveClass(/is-muted/);
      await expect
        .poll(() => renderedOpacity(preview(other)))
        .toBeLessThan(neutral[ids.indexOf(other)]);
    }
    await expect.poll(() => renderedOpacity(preview(id))).toBe(neutral[ids.indexOf(id)]);
    await expect.poll(displayed).toEqual(ids);
    await expect
      .poll(async () => {
        const layers = await Promise.all(ids.map((visible) => renderedLayer(preview(visible))));
        return layers.every((layer, index) => ids[index] === id || layer < layers[ids.indexOf(id)]);
      })
      .toBe(true);
  }

  await shot(page, 4).hover();
  await expectEmphasis(4);
  await preview(1).hover();
  await expectEmphasis(1);
  await preview(1).click();
  expect(await selected(page)).toEqual(ids.map(String));
  expect(await activations(page)).toEqual(before);

  await page.mouse.move(1100, 700);
  await expect.poll(opacity).toEqual(neutral);
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await shot(page, 4).hover();
  await expect(shot(page, 4)).toHaveClass(/is-hovered/);
  await expect(page.locator(".storyboard-graph-preview.is-muted")).toHaveCount(0);
  await expect.poll(opacity).toEqual(neutral);
  expect(await selected(page)).toEqual(ids.map(String));
  expect(await activations(page)).toEqual(before);
});

test("hover dims unrelated nodes while keeping neighbors and selections emphasized", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 4).click();
  await page.mouse.move(1100, 700);
  const graph = page.locator(".storyboard-graph-view");
  await expect(graph).not.toHaveClass(/has-focus/);

  const node = (id: number) => page.locator(`[data-overlay-node="${id}"]`);
  const neutral = await renderedOpacity(node(8));
  await shot(page, 0).hover();
  await expect(node(0)).toHaveClass(/is-hovered/);
  await expect(node(1)).toHaveClass(/is-neighbor/);
  await expect(node(4)).toHaveClass(/is-selected/);
  await expect.poll(() => renderedOpacity(node(8))).toBeLessThan(neutral);
  await expect
    .poll(async () => (await renderedOpacity(node(1))) > (await renderedOpacity(node(8))))
    .toBe(true);
  await expect
    .poll(async () => (await renderedOpacity(node(4))) > (await renderedOpacity(node(8))))
    .toBe(true);

  await page.mouse.move(1100, 700);
  await expect(graph).not.toHaveClass(/has-focus/);
  await expect.poll(() => renderedOpacity(node(8))).toBe(neutral);
});

test("hover brings each node above the selection overlay in pointer and hand tools", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 1).click();
  await page.getByRole("radio", { name: "添加到选择", exact: true }).click();
  await shot(page, 8).click();
  const before = await activations(page);
  const paint = page.locator(".storyboard-graph-selection-rings");
  const world = page.locator(".storyboard-graph-world");

  for (const tool of ["指针工具", "手型工具"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    for (const id of [1, 4, 8]) {
      await shot(page, id).hover();
      await expect(paint.locator(":scope > g:last-child")).toHaveAttribute(
        "data-overlay-node",
        String(id),
      );
      expect(await renderedLayer(paint)).toBeGreaterThan(await renderedLayer(world));
    }
  }
  expect(await selected(page)).toEqual(["1", "8"]);
  expect(await activations(page)).toEqual(before);
});
