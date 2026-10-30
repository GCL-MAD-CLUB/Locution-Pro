import { test, expect } from "../../support/fixtures";
import { SearchPanel } from "../../support/search-panel";

for (const label of ["字幕", "分镜"] as const) {
  test(`${label}快捷规则菜单顺序和宽度稳定`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog } = search;
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
  });
  test(`${label}高级搜索字体和控件与项目样式一致`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog } = search;
    await entry.click();
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
    await expect(dialog.getByLabel("区分大小写", { exact: true })).toHaveCSS("appearance", "none");
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(460);
    expect(bounds!.height).toBeLessThan(460);
  });
  test(`${label}输入框自适应内容且标签点击范围准确`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog } = search;
    await entry.click();
    async function checkAutoSize(name: string) {
      const input = dialog.getByLabel(name, { exact: true });
      const previous = await input.inputValue();
      await expect(input).toHaveCSS("resize", "none");
      for (const [text, height, overflow] of [
        ["", 64, "hidden"],
        ["one", 64, "hidden"],
        ["one\ntwo\nthree\nfour", 74, "hidden"],
        ["one\ntwo\nthree\nfour\nfive", 90, "hidden"],
        ["one\ntwo\nthree\nfour\nfive\nsix", 90, "auto"],
        ["short", 64, "hidden"],
      ] as const) {
        await input.fill(text);
        await expect(input).toHaveCSS("height", `${height}px`);
        await expect(input).toHaveCSS("overflow-y", overflow);
      }
      await input.fill("长".repeat(200));
      await expect(input).toHaveCSS("height", "90px");
      await expect(input).toHaveCSS("overflow-y", "auto");
      await input.fill(previous);
    }
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
    for (const name of ["搜索内容", "排除内容"]) {
      await checkFieldFocus(name);
      await checkAutoSize(name);
    }
    await search.mode("语义", true);
    for (const name of ["正向描述", "反向描述"]) {
      await checkFieldFocus(name);
      await checkAutoSize(name);
    }
  });
}
