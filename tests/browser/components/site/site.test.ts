import { test, expect } from "../../support/fixtures";

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
    const image = page.locator(".workspace-image img");
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

test("manual settling approaches the next section without pulling back after an overshoot", async ({
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
  await page.evaluate(
    (target) => window.scrollTo({ top: target - 120, behavior: "instant" }),
    boundary,
  );
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, 90);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(boundary, 0);
  await page.mouse.wheel(0, 100);
  // The idle interval is the product's settling contract; detect a late unwanted pullback.
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(boundary + 80);
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
