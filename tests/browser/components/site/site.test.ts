import { test, expect } from "../../support/fixtures";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`workspace preview opens in a modal and restores focus at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/site/#workspace");
    const originalUrl = page.url();
    const active = page.locator('.workspace-slide[data-position="center"]');
    const dialog = page.getByRole("dialog", { name: "编辑工作区", exact: true });
    const close = page.getByRole("button", { name: "关闭工作区预览" });
    await active.click();
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(dialog.locator("img")).toHaveAttribute(
      "src",
      /locution-app-workspace-light\.webp$/u,
    );
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    const fits = await dialog.locator("img").evaluate((image) => {
      const rect = image.getBoundingClientRect();
      return (
        rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      );
    });
    expect(fits).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(active).toBeFocused();
    await expect(page.locator("html")).not.toHaveClass(/workspace-dialog-open/u);
    await active.press("Enter");
    await expect(dialog).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    await active.click();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(originalUrl);
    expect(page.context().pages()).toHaveLength(1);
  });
}

test("workspace preview shows the selected import or export screenshot", async ({ page }) => {
  await page.goto("/site/#workspace");
  const carousel = page.locator(".workspace-carousel");
  for (const [key, label] of [
    ["import", "导入"],
    ["export", "导出"],
  ]) {
    await carousel.getByRole("button", { name: label, exact: true }).click();
    await carousel.locator('.workspace-slide[data-position="center"]').click();
    const dialog = page.getByRole("dialog", { name: `${label}工作区`, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img")).toHaveAttribute(
      "src",
      new RegExp(`locution-app-${key}-light\\.webp$`, "u"),
    );
    await page.keyboard.press("Escape");
  }
});

test("workspace carousel cycles through screenshots and resets to editing in portrait", async ({
  page,
}) => {
  await page.goto("/site/#workspace");
  const carousel = page.locator(".workspace-carousel");
  const active = carousel.locator('.workspace-slide[data-position="center"]');
  await expect(active).toHaveAttribute("data-workspace", "edit");
  await expect(carousel.locator(".workspace-slide:visible")).toHaveCount(3);

  await carousel.getByRole("button", { name: "下一个工作区" }).click();
  await expect(active).toHaveAttribute("data-workspace", "export");
  await expect(carousel.getByRole("button", { name: "导出", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await carousel.getByRole("button", { name: "下一个工作区" }).click();
  await expect(active).toHaveAttribute("data-workspace", "import");
  await carousel.getByRole("button", { name: "导入", exact: true }).press("ArrowLeft");
  await expect(active).toHaveAttribute("data-workspace", "export");

  const side = carousel.locator('[data-workspace="edit"]');
  // Click the exposed edge; the central screenshot covers the rest of this slide.
  const bounds = await side.boundingBox();
  await side.click({ position: { x: 8, y: bounds!.height / 2 } });
  await expect(active).toHaveAttribute("data-workspace", "edit");
  await expect(active).toBeFocused();
  await active.press("ArrowLeft");
  await expect(active).toHaveAttribute("data-workspace", "import");
  await expect(active).toHaveAttribute("href", /locution-app-import-light\.webp$/u);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(active).toHaveAttribute("data-workspace", "edit");
  await expect(carousel.locator(".workspace-slide:visible")).toHaveCount(1);
  await expect(carousel.locator(".workspace-controls")).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(active).toHaveAttribute("data-workspace", "edit");
  await expect(carousel.getByRole("button", { name: "编辑", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("workspace carousel animates changes and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/#workspace");
  const carousel = page.locator(".workspace-carousel");
  const edit = carousel.locator('[data-workspace="edit"]');
  await expect(edit).toHaveCSS("transition-duration", /0\.52s/u);
  await carousel.getByRole("button", { name: "导出", exact: true }).click();
  await expect(carousel.locator('[data-workspace="export"]')).toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(edit).toHaveCSS("transition-duration", "0s");
});

test("landscape touch swipes switch workspaces without opening the image", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/site/#workspace");
  const viewport = page.locator(".workspace-viewport");
  await viewport.dispatchEvent("touchstart", {
    touches: [{ identifier: 1, clientX: 500, clientY: 180 }],
  });
  await viewport.dispatchEvent("touchend", {
    changedTouches: [{ identifier: 1, clientX: 360, clientY: 184 }],
  });
  await expect(page.locator('.workspace-slide[data-position="center"]')).toHaveAttribute(
    "data-workspace",
    "export",
  );
  await viewport.dispatchEvent("touchstart", {
    touches: [{ identifier: 1, clientX: 500, clientY: 180 }],
  });
  await viewport.dispatchEvent("touchend", {
    changedTouches: [{ identifier: 1, clientX: 490, clientY: 280 }],
  });
  await expect(page.locator('.workspace-slide[data-position="center"]')).toHaveAttribute(
    "data-workspace",
    "export",
  );
});

for (const viewport of [
  { width: 1440, height: 700 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
]) {
  test(`website sections fit the available desktop viewport at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/site/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.chapter-nav a[href="#intro"]')).toHaveAttribute(
      "aria-current",
      "location",
    );
    const layout = await page.evaluate(() => {
      const available =
        innerHeight - document.querySelector(".site-header")!.getBoundingClientRect().height;
      return {
        available,
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        sections: [...document.querySelectorAll("main > section")].map((section) => ({
          id: section.id,
          height: section.getBoundingClientRect().height,
          overflow: section.scrollHeight - section.clientHeight,
        })),
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    for (const section of layout.sections) {
      expect(section.height, section.id).toBeGreaterThanOrEqual(layout.available - 1);
      expect(section.height, section.id).toBeLessThanOrEqual(layout.available + 2);
      expect(section.overflow, section.id).toBeLessThanOrEqual(2);
    }
    const image = page.locator('.workspace-slide[data-position="center"] img');
    const ratio = await image.evaluate((element) => {
      const img = element as HTMLImageElement;
      return { rendered: img.width / img.height, natural: img.naturalWidth / img.naturalHeight };
    });
    expect(ratio.rendered).toBeCloseTo(ratio.natural, 2);
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 667 },
  { width: 768, height: 1024 },
]) {
  test(`mobile reading stays complete at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/site/");
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      sections: [...document.querySelectorAll("main > section")].map((section) => ({
        id: section.id,
        overflow: section.scrollHeight - section.clientHeight,
      })),
    }));
    expect(layout.width).toBe(viewport.width);
    for (const section of layout.sections)
      expect(section.overflow, section.id).toBeLessThanOrEqual(2);
  });
}

test("mobile directory supports navigation, Escape and outside clicks", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/site/");
  const menu = page.locator(".mobile-menu");
  const toggle = menu.locator("summary");
  await toggle.click();
  await expect(menu).toHaveAttribute("open", "");
  await menu.locator('a[href="#search"]').click();
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(page).toHaveURL(/#search$/u);
  await expect(page.locator("#search-title")).toBeInViewport();
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(menu).not.toHaveAttribute("open", "");
  await toggle.click();
  await page.locator("#search-title").click();
  await expect(menu).not.toHaveAttribute("open", "");
});

test("rapid demo changes show the latest choice and clear the busy state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.locator('[data-query="city"]').click();
  await page.locator('[data-query="mountain"]').click();
  await expect(page.locator('[data-query="mountain"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#search-results")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#search-results img").first()).toHaveAttribute(
    "src",
    /official-shot-mountain\.webp$/u,
  );
  await expect(page.locator("#search-status")).toContainText("旷野远山");
});

test("wheel input starts the chapter transition immediately and inertia advances only one screen", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.evaluate(() => document.fonts.ready);
  const boundary = await page
    .locator("#workspace")
    .evaluate((section) =>
      Math.round(
        section.getBoundingClientRect().top +
          scrollY -
          document.querySelector("header")!.getBoundingClientRect().height,
      ),
    );
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 90);
  await page.waitForFunction(() => scrollY > 1, undefined, { polling: "raf", timeout: 160 });
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 15);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(boundary);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => scrollY)).toBe(boundary);
});

test("chapters land completely below the header in both directions and after resizing", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(800, 450);
  for (const id of ["workspace", "features", "search", "workflow", "local", "faq", "download"]) {
    await page.mouse.wheel(0, 90);
    await expect
      .poll(() =>
        page.locator(`#${id}`).evaluate((section) => {
          const rect = section.getBoundingClientRect();
          const header = document.querySelector("header")!.getBoundingClientRect().height;
          return Math.max(Math.abs(rect.top - header), Math.max(0, rect.bottom - innerHeight));
        }),
      )
      .toBeLessThanOrEqual(1);
  }
  await page.mouse.wheel(0, -90);
  await expect
    .poll(() =>
      page
        .locator("#faq")
        .evaluate((section) =>
          Math.abs(
            section.getBoundingClientRect().top -
              document.querySelector("header")!.getBoundingClientRect().height,
          ),
        ),
    )
    .toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect
    .poll(() =>
      page
        .locator("#faq")
        .evaluate((section) =>
          Math.abs(
            section.getBoundingClientRect().top -
              document.querySelector("header")!.getBoundingClientRect().height,
          ),
        ),
    )
    .toBeLessThanOrEqual(1);
});

test("footer scrolling stays at the user's position instead of returning to the last chapter", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/#download");
  await page.evaluate(() => document.fonts.ready);
  const start = await page
    .locator("#download")
    .evaluate((section) =>
      Math.round(
        section.getBoundingClientRect().top +
          scrollY -
          document.querySelector("header")!.getBoundingClientRect().height,
      ),
    );
  await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), start);
  const footerPosition = await page.evaluate(
    (top) => Math.min(top + 200, document.documentElement.scrollHeight - innerHeight),
    start,
  );
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(footerPosition);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY)).toBe(footerPosition);
  await page.mouse.wheel(0, -30);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(footerPosition - 30);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scrollY)).toBe(footerPosition - 30);
});

test("reverse wheel input interrupts an unfinished chapter animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 90);
  await page.waitForFunction(() => scrollY > 100 && scrollY < 500, undefined, { polling: "raf" });
  await page.mouse.wheel(0, -90);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("long expanded chapters and nested scroll containers retain native scrolling", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.evaluate(() => document.fonts.ready);
  const start = await page.locator("#faq").evaluate((section) => {
    section.querySelectorAll("details").forEach((item) => (item.open = true));
    (section as HTMLElement).style.minHeight = "1800px";
    return (
      Math.round(
        section.getBoundingClientRect().top +
          scrollY -
          document.querySelector("header")!.getBoundingClientRect().height,
      ) + 200
    );
  });
  await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), start);
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 90);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(start + 90);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scrollY)).toBe(start + 90);
  await page.evaluate(() => {
    const element = document.createElement("div");
    element.id = "nested-scroll";
    element.style.cssText =
      "position:fixed;top:200px;left:200px;width:200px;height:120px;overflow:auto;z-index:100;background:white";
    const content = document.createElement("div");
    content.style.height = "900px";
    element.append(content);
    document.body.append(element);
  });
  await page.mouse.move(250, 250);
  await page.mouse.wheel(0, 150);
  await expect
    .poll(() => page.locator("#nested-scroll").evaluate((element) => element.scrollTop))
    .toBe(150);
  expect(await page.evaluate(() => scrollY)).toBe(start + 90);
});

test("page keys use the same measured chapter destinations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.keyboard.press("PageDown");
  await expect
    .poll(() =>
      page
        .locator("#workspace")
        .evaluate((section) =>
          Math.abs(
            section.getBoundingClientRect().top -
              document.querySelector("header")!.getBoundingClientRect().height,
          ),
        ),
    )
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("PageUp");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("touch gestures stay free on a desktop viewport with a fine primary pointer", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.evaluate(() => document.fonts.ready);
  const boundary = await page
    .locator("#features")
    .evaluate(
      (section) =>
        section.getBoundingClientRect().top +
        scrollY -
        document.querySelector("header")!.getBoundingClientRect().height,
    );
  await page.dispatchEvent("body", "touchstart");
  await page.evaluate(
    (target) => window.scrollTo({ top: target - 30, behavior: "instant" }),
    boundary,
  );
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(boundary - 30, 0);
  await page.dispatchEvent("body", "touchend");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(boundary - 30, 0);
});

test("reduced motion keeps the user's scroll position and FAQ expansion remains readable", async ({
  page,
}) => {
  await page.goto("/site/");
  const boundary = await page
    .locator("#features")
    .evaluate(
      (section) =>
        section.getBoundingClientRect().top +
        scrollY -
        document.querySelector("header")!.getBoundingClientRect().height,
    );
  await page.evaluate(
    (target) => window.scrollTo({ top: target - 120, behavior: "instant" }),
    boundary,
  );
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 90);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(boundary - 30, 0);
  await page.setViewportSize({ width: 375, height: 667 });
  for (const summary of await page.locator(".faq-list summary").all()) await summary.click();
  await expect(page.locator(".faq-list details[open]")).toHaveCount(4);
  expect(
    await page.locator("#faq").evaluate((section) => section.scrollHeight - section.clientHeight),
  ).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});
