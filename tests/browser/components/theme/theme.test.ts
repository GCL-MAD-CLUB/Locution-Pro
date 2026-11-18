import { test, expect } from "../../support/fixtures";
import { generatedThemeImages } from "./theme-presentation";

test("appearance changes notify runtime subscribers until cleanup", async ({ page }) => {
  await page.goto("/tests/browser/support/blank.html");
  const result = await page.evaluate(async () => {
    const url = "/src/runtime/theme.ts";
    const theme: typeof import("../../../../src/runtime/theme") = await import(
      /* @vite-ignore */ url
    );
    const notifications: string[] = [];
    const unsubscribe = theme.subscribeAppearance(() =>
      notifications.push(theme.currentAppearance()),
    );
    for (const appearance of ["dark", "light", "darkest"] as const)
      theme.applyAppearance(appearance, false);
    unsubscribe();
    theme.applyAppearance("dark", false);
    return { notifications, applied: document.documentElement.dataset.theme };
  });
  expect(result.notifications).toEqual(["dark", "light", "darkest"]);
  expect(result.applied).toBe("dark");
});

test("appearance preview regenerates themed artwork and cancel restores it", async ({
  app,
  native,
}) => {
  const baseline = await generatedThemeImages(app);
  for (const image of Object.values(baseline)) {
    expect(image).toContain("data:image/svg+xml,");
    expect(image).not.toContain("var(");
  }
  await app.getByRole("button", { name: "编辑(E)", exact: true }).click();
  await app.getByRole("menuitem", { name: "首选项(N)", exact: true }).click();
  await app.getByRole("menuitem", { name: /^外观\(/ }).click();
  const dialog = app.getByRole("dialog", { name: "首选项", exact: true });
  await dialog.getByRole("radio", { name: "浅色", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  const preview = await generatedThemeImages(app);
  expect(preview.checkbox).not.toBe(baseline.checkbox);
  expect(preview.flag).not.toBe(baseline.flag);
  expect(preview.overlay).toBe(baseline.overlay);
  for (const image of Object.values(preview)) expect(image).not.toContain("var(");

  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "darkest");
  await expect.poll(() => generatedThemeImages(app)).toEqual(baseline);
  expect(await native.calls("update_preferences")).toHaveLength(0);
});
