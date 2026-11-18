import { test, expect } from "../../support/fixtures";
import { pointerAt as center } from "../../support/pointer";
import { renderedNodeFill, renderedOpacity, renderedRingStroke } from "./graph-presentation";
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
  await dot.click();
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("hovering selected shots and previews preserves selection and playback; deselection removes only its preview", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => window.graphSetSelection(new Set(["0", "4", "8"])));
  await expect.poll(() => selected(page)).toEqual(["0", "4", "8"]);
  const beforeActivations = await activations(page);
  const beforeActivated = await activated(page);
  const preview = (id: string) => page.locator(`[data-preview-shot-id="${id}"]`);
  async function expectSelectedPreviews(ids: string[]) {
    await expect(page.locator(".storyboard-graph-preview")).toHaveCount(ids.length);
    for (const id of ids) {
      await expect(preview(id)).toBeVisible();
      await expect(preview(id)).toHaveClass(/is-selected/);
      await expect(preview(id)).not.toHaveAttribute("aria-hidden", "true");
    }
    await expect.poll(() => selected(page)).toEqual(ids);
    expect(await activations(page)).toEqual(beforeActivations);
    expect(await activated(page)).toBe(beforeActivated);
  }
  await shot(page, 4).hover();
  await expect(page.getByRole("tooltip")).toHaveAttribute("data-preview-shot-id", "4");
  await expectSelectedPreviews(["0", "4", "8"]);
  await shot(page, 0).hover();
  await expect(page.getByRole("tooltip")).toHaveAttribute("data-preview-shot-id", "0");
  await expectSelectedPreviews(["0", "4", "8"]);
  await preview("8").hover();
  await expectSelectedPreviews(["0", "4", "8"]);
  await shot(page, 8).hover();
  await expect(page.getByRole("tooltip")).toHaveAttribute("data-preview-shot-id", "8");
  await expectSelectedPreviews(["0", "4", "8"]);

  await page.mouse.move(1100, 700);
  await page.evaluate(() => window.graphSetSelection(new Set(["0", "4"])));
  await expect(preview("8")).toHaveCount(0);
  await expectSelectedPreviews(["0", "4"]);
});

test("graph previews respond to zoom while selection and hover keep working", async ({ page }) => {
  await mount(page, false, 10);
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
  await page.mouse.move(30, 30);
  await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(1);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
  await dot.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(stage).toHaveClass(/has-focus/);
  await expect(dot).toHaveAttribute("aria-describedby");

  await stage.focus();
  for (let i = 0; i < 8; i++) await stage.press("-");
  await dot.focus();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(0);
  await expect(dot).toHaveClass(/is-hovered/);
  await expect(stage).toHaveClass(/has-focus/);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("resizing below the preview threshold hides thumbnails while preserving normal hover", async ({
  page,
}) => {
  await mount(page, false, 5);
  const dot = page.getByRole("button", { name: "Shot 4", exact: true });
  await dot.click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#graph-host")!;
    host.style.width = "420px";
    host.style.height = "220px";
  });
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
  await expect(page.locator(".storyboard-graph-preview.is-selected")).toHaveCount(1);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

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

test("unselected pointer hover shows supplementary previews while preserving selection and playback", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => window.graphSetSelection(new Set(["0", "4"])));
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
    await expect
      .poll(async () => (await renderedOpacity(preview(id))) < (await renderedOpacity(preview(5))))
      .toBe(true);
  }
  await expect(preview(4)).not.toHaveClass(/is-neighbor/);
  await expect.poll(displayed).toEqual(["0", "3", "4", "5", "6"]);
  expect(await selected(page)).toEqual(["0", "4"]);
  expect(await activations(page)).toEqual([]);
  await preview(4).hover();
  await preview(5).hover();
  await page.mouse.move(1100, 700);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(2);
  // Hovering an already selected node retains the existing selection behavior.
  await shot(page, 4).hover();
  await expect.poll(displayed).toEqual(["0", "4"]);
});

for (const tool of ["pointer", "hand", "spray"] as const) {
  test(`${tool} mouse events pass through supplementary previews to covered graph nodes`, async ({
    page,
  }) => {
    await mount(page);
    await shot(page, 4).click();
    if (tool === "hand") await page.getByRole("button", { name: "手型工具", exact: true }).click();
    if (tool === "spray") await enableSpray(page);
    const beforeActivations = await activations(page);
    await shot(page, 5).hover();
    const neighbor = page.locator('[data-preview-shot-id="6"]');
    const covered = await center(shot(page, 3));
    await expect(neighbor).toBeVisible();
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

test("graph annotations update readonly thumbnail metadata", async ({ page }) => {
  await mount(page);
  await page.evaluate(() =>
    window.graphSetAnnotations({
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
  await expect(preview).toHaveClass(/has-color-label/);
  const node = page.locator('[data-selection-node="4"]');
  const ring = page.locator('[data-selection-ring="4"]');
  const annotatedFill = await renderedNodeFill(node);
  expect(await renderedRingStroke(ring)).toBe(annotatedFill);
  await page.evaluate(() =>
    window.graphSetAnnotations({
      "4": { rating: 5, retained: false, excluded: true, customLabel: "自定义" },
    }),
  );
  await expect(metadata.getByRole("img", { name: "排除旗标", exact: true })).toBeVisible();
  await expect(metadata.getByRole("img", { name: "5 星", exact: true })).toBeVisible();
  await expect.poll(() => renderedNodeFill(node)).not.toBe(annotatedFill);
  await expect(metadata.getByRole("img", { name: "该分镜包含关键字", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.graphSetAnnotations({}));
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
  const earlier = await center(frame, 0.25);
  const later = await center(frame, 0.75);
  const progress = preview.locator(".shot-hover-progress > span");
  const seekFraction = () => page.evaluate(() => window.graphGeometry.scrubProgress("4") ?? -1);
  await page.mouse.move(earlier.x, earlier.y);
  await expect(progress).toBeVisible();
  const initialFraction = await seekFraction();
  await page.mouse.move(later.x, later.y);
  await expect.poll(seekFraction).toBeGreaterThan(initialFraction);
  await frame.click();
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(before);
  await page.mouse.move(1100, 700);
  await expect(progress).toHaveCount(0);
  await expect(preview).toBeVisible();
});

test("hand thumbnails allow position preview while preserving neighbor previews", async ({
  page,
}) => {
  await mount(page);
  await shot(page, 4).click();
  const before = await activations(page);
  await page.getByRole("button", { name: "手型工具", exact: true }).click();
  await shot(page, 5).hover();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(4);
  const preview = page.locator('[data-preview-shot-id="5"]');
  const frame = preview.getByRole("img", { name: "分镜选帧缩略图", exact: true });
  await frame.hover();
  await expect(preview.locator(".shot-hover-progress")).toBeVisible();
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(4);
  await frame.click();
  expect(await selected(page)).toEqual(["4"]);
  expect(await activations(page)).toEqual(before);
  await page.mouse.move(1100, 700);
  await expect(page.locator(".storyboard-graph-preview")).toHaveCount(1);
});
