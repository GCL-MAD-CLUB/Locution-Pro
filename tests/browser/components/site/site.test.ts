import { test, expect } from "../../support/fixtures";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`software demonstrations preserve the native layout at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/site/#workspace");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    const frames = [];
    for (const id of ["import-demo", "product-demo", "export-demo"]) {
      const demo = page.locator(`#${id}`);
      const layout = await demo.locator(".demo-screen").evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        overflow: el.scrollWidth - el.clientWidth,
      }));
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.width / layout.height).toBeCloseTo(3120 / 1940, 1);
      frames.push(
        await demo.locator("..").evaluate((el) => {
          const { width, height } = el.getBoundingClientRect();
          return { width, height };
        }),
      );
      await expect(demo.locator(".demo-screen")).toHaveAttribute("inert", "");
      await expect(
        demo.locator(".demo-screen button, .demo-screen input, .demo-screen a"),
      ).toHaveCount(0);
      await expect(demo.locator(".demo-canvas")).toHaveAttribute("viewBox", "0 0 3120 1940");
      const track = await demo.getAttribute("data-demo-track");
      await expect(demo.locator(`[data-demo-scene="${track}"]`)).not.toHaveAttribute("hidden");
    }
    for (const frame of frames) {
      expect(Math.abs(frame.width - frames[0].width)).toBeLessThan(1);
      expect(Math.abs(frame.height - frames[0].height)).toBeLessThan(1);
    }
  });
}

test("the first screen draws its title and reveals its content on arrival", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/", { waitUntil: "domcontentloaded" });
  const hero = page.locator(".hero");
  await expect(hero).toHaveClass(/hero-entering/u);
  await hero.evaluate((el) => {
    for (const animation of el.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Locution Pro");
  await expect(hero.locator(".hero-letter").first()).toHaveCSS("fill-opacity", "0");
  await expect(hero.locator(".hero-preview")).toHaveCSS("opacity", "0");
  await expect(hero.locator(".hero-actions")).toHaveCSS("opacity", "0");
  await hero.evaluate((el) => {
    for (const animation of el.getAnimations({ subtree: true })) animation.currentTime = 1800;
  });
  await expect(hero.locator(".hero-letter").last()).toHaveCSS("fill-opacity", "1");
  await expect(hero.locator(".hero-preview")).toHaveCSS("opacity", "1");
  await expect(hero.locator(".hero-actions")).toHaveCSS("opacity", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(hero).not.toHaveClass(/hero-entering/u);
  await expect(hero.locator(".hero-preview")).toHaveCSS("animation-name", "none");
  await expect(hero.locator(".hero-preview")).toHaveCSS("opacity", "1");
});

test("the editing demo plays, pauses and resumes without visitor input", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  const demo = page.locator("#product-demo");
  const showDemo = () =>
    demo.evaluate((el) =>
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - 90, behavior: "instant" }),
    );
  await showDemo();
  await page.clock.runFor(100);
  await expect(demo).toHaveAttribute("data-playing", "true");
  await page.clock.runFor(3300);
  await expect(demo.locator("[data-demo-query]")).toHaveText("分镜 156");
  await expect(demo.locator('[data-demo-layer="result"]')).not.toHaveAttribute("hidden");
  await page.clock.runFor(2400);
  await expect(demo.locator('[data-demo-layer="keyword"]')).not.toHaveAttribute("hidden");
  await demo.getByRole("button", { name: "暂停自动演示", exact: true }).click();
  const pausedFrame = await demo.locator(".demo-canvas").getAttribute("viewBox");
  await page.clock.runFor(5000);
  await expect(demo.locator(".demo-canvas")).toHaveAttribute("viewBox", pausedFrame!);
  await expect(demo).toHaveAttribute("data-playing", "false");
  await demo.getByRole("button", { name: "继续自动演示", exact: true }).click();
  await page.clock.runFor(3000);
  await expect(demo).toHaveAttribute("data-scene", "edit");
  await expect(demo.locator('[data-demo-layer="keyword"]')).toHaveAttribute("hidden", "");
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.clock.runFor(100);
  await expect(demo).toHaveAttribute("data-playing", "false");
  const offscreenFrame = await demo.locator(".demo-canvas").getAttribute("viewBox");
  await page.clock.runFor(10000);
  await expect(demo.locator(".demo-canvas")).toHaveAttribute("viewBox", offscreenFrame!);
  await showDemo();
  await page.clock.runFor(100);
  await expect(demo).toHaveAttribute("data-playing", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(100);
  await expect(demo).toHaveAttribute("data-playing", "false");
  await expect(demo).toHaveAttribute("data-scene", "edit");
  await expect(demo.locator(".demo-playback")).toBeHidden();
  await expect(demo.locator("[data-demo-pointer]")).toHaveAttribute("hidden", "");
  await expect(demo.locator(".demo-canvas")).toHaveAttribute("viewBox", "0 0 3120 1940");
});

for (const track of ["import", "export"]) {
  test(`${track} demonstration plays its own software sequence`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/site/");
    await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
    const demo = page.locator(`#${track}-demo`);
    await demo.evaluate((el) =>
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - 90, behavior: "instant" }),
    );
    await page.clock.runFor(100);
    await expect(demo).toHaveAttribute("data-playing", "true");
    await page.clock.runFor(3300);
    await expect(demo).toHaveAttribute("data-scene", track);
    await expect(
      demo.locator(`[data-demo-layer="${track === "import" ? "second-file" : "format-value"}"]`),
    ).not.toHaveAttribute("hidden");
    await page.clock.runFor(8500);
    await expect(demo).toHaveAttribute("data-scene", track);
  });
}

test("scrolling reveals equal-sized software spreads without stretching the first section", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await expect(page.locator("html")).toHaveClass(/motion-ready/u);
  const directions = await page
    .locator(".product-story")
    .evaluateAll((els) => els.map((el) => new DOMMatrix(getComputedStyle(el).transform).m41));
  expect(directions[0]).toBeLessThan(0);
  expect(directions[1]).toBeGreaterThan(0);
  expect(directions[2]).toBeLessThan(0);
  const sizes = [];
  for (const id of ["features", "workspace", "workflow"]) {
    const section = page.locator(`#${id}`);
    await section.evaluate((el) =>
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - 100, behavior: "instant" }),
    );
    await expect(section).toHaveCSS("opacity", "1");
    await expect
      .poll(() => section.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41))
      .toBe(0);
    sizes.push(
      await section.evaluate((el) => {
        const { width, height } = el.getBoundingClientRect();
        const visual = el.querySelector(".story-visual")!.getBoundingClientRect();
        return { width, height, visualWidth: visual.width, visualHeight: visual.height };
      }),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  }
  for (const size of sizes) {
    expect(size.height).toBeLessThan(900);
    expect(Math.abs(size.height - sizes[0].height)).toBeLessThan(1);
    expect(Math.abs(size.visualWidth - sizes[0].visualWidth)).toBeLessThan(1);
    expect(Math.abs(size.visualHeight - sizes[0].visualHeight)).toBeLessThan(1);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator("#features")).toHaveCSS("opacity", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).not.toHaveClass(/motion-ready/u);
  await expect(page.locator("#features")).toHaveCSS("transform", "none");
});

test("mobile transitions stay in normal flow without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await expect(page.locator("#features")).toHaveCSS("position", "static");
  for (const id of ["features", "workspace", "workflow", "download", "support"]) {
    await page
      .locator(`#${id}`)
      .evaluate((el) =>
        scrollTo({ top: el.getBoundingClientRect().top + scrollY - 100, behavior: "instant" }),
      );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    if (id === "workspace" || id === "workflow")
      await expect(page.locator(`#${id}`)).toHaveCSS("opacity", "1");
  }
});

test("without JavaScript each native software scene and download remain available", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/site/");
    await expect(
      page.locator(".hero-actions").getByRole("link", { name: "GitHub", exact: true }),
    ).toHaveAttribute("href", "https://github.com/GCL-MAD-CLUB/Locution-Pro");
    for (const [id, track] of [
      ["import-demo", "import"],
      ["product-demo", "edit"],
      ["export-demo", "export"],
    ]) {
      const demo = page.locator(`#${id}`);
      await expect(demo.locator(".demo-screen")).toBeVisible();
      await expect(demo.locator(`[data-demo-scene="${track}"]`)).not.toHaveAttribute("hidden");
      await expect(demo.locator(".demo-playback")).toBeHidden();
      await expect(demo.locator("[data-demo-pointer]")).toHaveAttribute("hidden", "");
    }
    await expect(page.getByRole("link", { name: "下载 Windows 版", exact: true })).toHaveAttribute(
      "href",
      "/api/download",
    );
  } finally {
    await context.close();
  }
});

test("support keeps compact content in its own viewport and the footer spans the page", async ({
  page,
}) => {
  await page.goto("/site/#support");
  const support = await page.locator("#support").boundingBox();
  expect(support!.height).toBeGreaterThanOrEqual(836);
  const content = await page.locator(".support-content").boundingBox();
  expect(content!.width).toBeLessThanOrEqual(800);
  expect(content!.height / support!.height).toBeLessThan(0.4);
  await expect(page.locator("#support .support-card")).toHaveCount(3);
  await expect(page.getByText("鸣谢", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "给视频创作者的一封信" })).toBeVisible();
  await expect(page.locator("#download-title")).toHaveAttribute("lang", "en");
  const footer = await page.locator("footer").boundingBox();
  expect(footer!.x).toBe(0);
  expect(footer!.width).toBe(1440);
});

test("the footer is uncovered by scrolling and its navigation can receive keyboard focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/site/");
  await page.locator("main").evaluate((el) =>
    scrollTo({
      top: el.getBoundingClientRect().bottom + scrollY - innerHeight / 2,
      behavior: "instant",
    }),
  );
  await expect
    .poll(() =>
      page
        .locator("footer")
        .evaluate((el) => Number((el as HTMLElement).style.getPropertyValue("--footer-reveal"))),
    )
    .toBeCloseTo(0.5, 1);
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  await expect
    .poll(() =>
      page
        .locator("footer")
        .evaluate((el) => Number((el as HTMLElement).style.getPropertyValue("--footer-reveal"))),
    )
    .toBe(1);
  const brand = page.locator("footer .brand");
  await brand.focus();
  await expect(brand).toBeFocused();
  await expect(brand).toBeInViewport();
});

test("FAQ and page scrolling remain native alongside the demonstration", async ({ page }) => {
  await page.goto("/site/");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  await page.evaluate(() => scrollTo({ top: 200, behavior: "instant" }));
  await page.mouse.move(100, 200);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(300);
  await page.getByText("需要什么运行环境？", { exact: true }).click();
  await expect(page.getByText(/64 位 Windows 10 或 Windows 11/u)).toBeVisible();
});
