import { test, expect } from "@playwright/test";

for (const label of ["字幕", "分镜"]) {
  test(`${label}高级搜索复用控件、应用取消与焦点隔离`, async ({ page }, testInfo) => {
    await page.goto("/tests/browser/blank.html");
    await page.evaluate(async (label) => {
      const path = "/tests/browser/advanced-search.harness.js";
      const module = await import(/* @vite-ignore */ path);
      module.mountAdvancedSearch(label);
      (window as any).leakedKeys = [];
      window.addEventListener("keydown", (event) => (window as any).leakedKeys.push(event.key));
    }, label);
    const entry = page.getByRole("button", { name: `${label}高级搜索` });
    const quickRule = page.locator(".panel-search-rule");
    await expect(quickRule).toContainText("包含");
    await page.evaluate(() => document.fonts.ready);
    const initialRuleBounds = await quickRule.boundingBox();
    const initialEntryBounds = await entry.boundingBox();
    const rules = [
      "包含",
      "包含所有",
      "包含单词",
      "不含",
      "开头为",
      "结尾为",
      "完全相等",
      "为空",
      "不为空",
      "正则表达式",
    ];
    for (const rule of [...rules, "包含"]) {
      await quickRule.click();
      const ruleMenu = page.getByRole("menu", { name: `${label}搜索规则` });
      await expect(ruleMenu.getByRole("menuitemcheckbox")).toHaveText(rules);
      await expect(ruleMenu.getByRole("separator")).toHaveCount(3);
      await ruleMenu.getByRole("menuitemcheckbox", { name: rule, exact: true }).click();
      expect((await quickRule.boundingBox())!.width).toBe(initialRuleBounds!.width);
      expect((await entry.boundingBox())!.x).toBe(initialEntryBounds!.x);
      const valueBounds = await quickRule.locator(".panel-search-option-value").boundingBox();
      const arrowBounds = await quickRule.locator("svg").boundingBox();
      expect(arrowBounds!.x - (valueBounds!.x + valueBounds!.width)).toBeCloseTo(4, 1);
      expect(
        await quickRule
          .locator(".panel-search-option-value")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await entry.click();
    const dialog = page.getByRole("dialog");
    async function checkFieldFocus(name: string) {
      const input = dialog.getByLabel(name, { exact: true });
      await dialog.getByRole("button", { name: "取消", exact: true }).focus();
      const bounds = await input.boundingBox();
      await page.mouse.click(bounds!.x - 10, bounds!.y + bounds!.height - 5);
      await expect(input).not.toBeFocused();
      await input.locator("..").locator("label").click();
      await expect(input).toBeFocused();
      await input.click();
      await expect(input).toBeFocused();
    }
    await expect(dialog).toBeVisible();
    const fonts = await dialog.evaluate((element) => {
      const body = element.querySelector(".advanced-search-body")!;
      const family = (target: Element) => getComputedStyle(target).fontFamily;
      return {
        dialog: family(element),
        body: family(body),
        input: family(body.querySelector("textarea")!),
        dropdown: family(body.querySelector(".select-dropdown-trigger")!),
        title: family(element.querySelector("h2")!),
        buttons: Array.from(element.querySelectorAll(".modal-dialog-actions button"), family),
      };
    });
    expect(fonts.body).not.toBe(fonts.dialog);
    expect(fonts.input).toBe(fonts.body);
    expect(fonts.dropdown).toBe(fonts.body);
    expect(fonts.title).toBe(fonts.dialog);
    expect(fonts.buttons.every((font) => font === fonts.dialog)).toBe(true);
    await expect(dialog.locator(".advanced-search-dropdown")).toHaveCount(label === "分镜" ? 3 : 2);
    const parity = await page.evaluate(async () => {
      const cssPath = "/src/components/panels/StoryboardPanel/StoryboardPanel.css";
      await import(/* @vite-ignore */ cssPath);
      const reference = document.createElement("div");
      reference.style.cssText = "position:fixed;left:-10000px;font:12px var(--font-sans)";
      reference.innerHTML = `<form class="storyboard-keyword-inline-entry"><input placeholder="test"></form><div class="select-dropdown"><button class="select-dropdown-trigger"><span>test</span><svg></svg></button></div>`;
      document.body.append(reference);
      function styles(element: Element, properties: string[]) {
        const style = getComputedStyle(element);
        return properties.map((property) => style.getPropertyValue(property));
      }
      const textarea = document.querySelector(".advanced-search-body textarea")!;
      const trigger = document.querySelector(".advanced-search-dropdown .select-dropdown-trigger")!;
      (textarea as HTMLElement).blur();
      const fields = [
        "background-color",
        "color",
        "border-top-width",
        "border-right-width",
        "border-bottom",
        "border-left-width",
        "border-radius",
        "line-height",
      ];
      const control = [
        "background-color",
        "border-width",
        "border-radius",
        "grid-template-columns",
        "padding",
      ];
      const result = {
        text: styles(textarea, fields),
        referenceText: styles(reference.querySelector("input")!, fields),
        input: styles(document.querySelector('input[aria-label="最短时长"]')!, fields),
        referenceInput: styles(reference.querySelector("input")!, fields),
        trigger: styles(trigger, control),
        referenceTrigger: [] as string[],
        focus: [] as string[][],
        referenceFocus: [] as string[],
        placeholders: [] as string[][],
        referencePlaceholder: [] as string[],
      };
      const referenceInput = reference.querySelector("input")!;
      const input = document.querySelector<HTMLInputElement>('input[aria-label="最短时长"]')!;
      result.input.push(...styles(input, ["height", "min-height"]));
      result.referenceInput.push(...styles(referenceInput, ["height", "min-height"]));
      for (const element of [textarea, input]) {
        (element as HTMLElement).focus({ preventScroll: true });
        result.focus.push(styles(element, fields));
        const placeholder = getComputedStyle(element, "::placeholder");
        result.placeholders.push([placeholder.color, placeholder.fontStyle, placeholder.opacity]);
      }
      referenceInput.style.backgroundColor = result.referenceText[0];
      referenceInput.style.borderBottomColor = "var(--color-accent)";
      referenceInput.focus({ preventScroll: true });
      result.referenceFocus = styles(referenceInput, fields);
      const placeholder = getComputedStyle(referenceInput, "::placeholder");
      result.referencePlaceholder = [placeholder.color, placeholder.fontStyle, placeholder.opacity];
      (reference.querySelector("button") as HTMLElement).style.width =
        `${trigger.getBoundingClientRect().width}px`;
      result.referenceTrigger = styles(reference.querySelector("button")!, control);
      reference.remove();
      return result;
    });
    expect(parity.text).toEqual(parity.referenceText);
    expect(parity.input).toEqual(parity.referenceInput);
    for (const focus of parity.focus) expect(focus).toEqual(parity.referenceFocus);
    for (const placeholder of parity.placeholders)
      expect(placeholder).toEqual(parity.referencePlaceholder);
    expect(parity.trigger).toEqual(parity.referenceTrigger);
    await expect(dialog.locator(".advanced-search-dropdown").first()).toHaveCSS(
      "border-radius",
      "0px",
    );
    expect(await dialog.locator("p").count()).toBe(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(460);
    expect(bounds!.height).toBeLessThan(460);
    await checkFieldFocus("搜索内容");
    await checkFieldFocus("排除内容");
    await dialog.getByLabel("搜索内容", { exact: true }).fill("draft");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(entry).toBeFocused();
    await expect(page.getByRole("combobox")).toHaveValue("hello");
    await entry.click();
    await dialog.getByRole("button", { name: "匹配规则", exact: true }).click();
    await expect(page.getByRole("menu", { name: "匹配规则" }).getByRole("separator")).toHaveCount(
      3,
    );
    await expect(
      page.getByRole("menu", { name: "匹配规则" }).getByRole("menuitemcheckbox"),
    ).toHaveText(rules);
    const optionFonts = await page
      .getByRole("menu", { name: "匹配规则" })
      .evaluate((menu) =>
        Array.from(
          menu.querySelectorAll(".popup-menu-item, .popup-menu-label"),
          (item) => getComputedStyle(item).fontFamily,
        ),
      );
    expect(optionFonts.length).toBeGreaterThan(0);
    expect(optionFonts.every((font) => font === fonts.dialog)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("advanced-options.png") });
    await page.getByRole("menuitemcheckbox", { name: "正则表达式", exact: true }).click();
    await dialog.getByLabel("搜索内容", { exact: true }).fill("[");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "应用", exact: true })).toBeDisabled();
    await dialog.getByLabel("搜索内容", { exact: true }).fill("hello.*");
    await dialog.getByLabel("排除内容", { exact: true }).fill("draft\nrough cut");
    await dialog.getByLabel("区分大小写", { exact: true }).check();
    await expect(dialog.getByLabel("区分大小写", { exact: true })).toHaveCSS("appearance", "none");
    await dialog.getByLabel("最短时长").fill("2");
    await dialog.getByLabel("最长时长").fill("1");
    await expect(dialog.getByRole("button", { name: "应用", exact: true })).toBeDisabled();
    await dialog.getByLabel("最长时长").fill("5");
    await dialog.getByRole("button", { name: "取消", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await page.keyboard.press("j");
    expect(await page.evaluate(() => (window as any).leakedKeys)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("advanced-text.png") });
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    const snapshot = await page.evaluate(() => (window as any).searchSnapshot);
    expect(snapshot.rule).toBe("regex");
    expect(snapshot.advanced).toMatchObject({
      caseSensitive: true,
      excludedText: "draft\nrough cut",
      minDuration: "2",
      maxDuration: "5",
    });
    await expect(entry).toHaveClass(/active/);
    await entry.click();
    await dialog.getByRole("button", { name: "搜索模式", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await dialog.getByRole("button", { name: "搜索模式", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "语义", exact: true }).click();
    await checkFieldFocus("正向描述");
    await checkFieldFocus("反向描述");
    await dialog.getByLabel("正向描述", { exact: true }).fill("sunset\nbeach");
    await dialog.getByLabel("反向描述", { exact: true }).fill("crowd\ncity");
    await expect(dialog.getByLabel("最低匹配度", { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 640, height: 480 });
    await page.screenshot({ path: testInfo.outputPath("advanced-semantic.png") });
    const compact = await dialog.boundingBox();
    expect(compact!.height).toBeLessThanOrEqual(448);
    expect(compact!.y).toBeGreaterThanOrEqual(0);
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    expect(await page.evaluate(() => (window as any).searchSnapshot)).toMatchObject({
      query: "sunset\nbeach",
      mode: "semantic",
      threshold: 0,
      advanced: { negativePrompts: "crowd\ncity" },
    });
    await expect(page.getByRole("combobox")).toHaveValue("sunset");
    await page.getByRole("combobox").fill("ocean");
    expect(await page.evaluate(() => (window as any).searchSnapshot.query)).toBe("ocean\nbeach");
    await entry.click();
    await dialog.getByRole("button", { name: "重置", exact: true }).click();
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).not.toHaveClass(/active/);
    expect(await page.evaluate(() => (window as any).searchSnapshot.rule)).toBe("contains");
  });
}
