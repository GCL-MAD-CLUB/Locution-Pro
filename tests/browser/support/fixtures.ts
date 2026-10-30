import { test as base, expect, type Page } from "@playwright/test";

import { installNative, mediaEntries } from "./native";

type Fixtures = {
  _diagnostics: void;
  native: {
    calls: (command: string) => Promise<any[]>;
    fail: (command: string, message?: string, path?: string) => Promise<void>;
    hold: (command: string) => Promise<void>;
    release: (command: string, directory?: string) => Promise<void>;
  };
  app: Page;
};

export const test = base.extend<Fixtures>({
  native: async ({ page }, use, testInfo) => {
    await page.addInitScript(installNative, { entries: mediaEntries });
    await use({
      calls: (command) =>
        page.evaluate(
          (cmd) => (window as any).__nativeTest.calls.filter((call: any) => call.command === cmd),
          command,
        ),
      fail: (command, message, path) =>
        page.evaluate(
          ({ command, message, path }) => {
            const key = path ? `${command}:${path}` : command;
            if (message) (window as any).__nativeTest.failures[key] = message;
            else delete (window as any).__nativeTest.failures[key];
            if (message) (window as any).__nativeTest.expectedFailures.push(`tauri:${command}`);
          },
          { command, message, path },
        ),
      hold: (command) =>
        page.evaluate((cmd) => {
          (window as any).__nativeTest.held[cmd] = true;
        }, command),
      release: (command, directory) =>
        page.evaluate(
          ({ command, directory }) => {
            const state = (window as any).__nativeTest;
            delete state.held[command];
            const pending = state.pending.filter(
              (call: any) =>
                call.command === command && (!directory || call.args.directory === directory),
            );
            state.pending = state.pending.filter((call: any) => !pending.includes(call));
            pending.forEach((call: any) => call.resolve());
          },
          { command, directory },
        ),
    });
    const snapshot = await page.evaluate(() => {
      const state = (window as any).__nativeTest;
      return {
        calls: state.calls,
        unexpected: state.unexpected,
        expectedFailures: state.expectedFailures,
      };
    });
    await testInfo.attach("native-commands", {
      body: JSON.stringify(snapshot, null, 2),
      contentType: "application/json",
    });
    expect(snapshot.unexpected).toEqual([]);
    const unexpectedIncidents = snapshot.calls.filter(
      (call: any) =>
        call.command === "record_frontend_incident" &&
        !snapshot.expectedFailures.includes(call.args.incident.source),
    );
    expect(unexpectedIncidents, "Unexpected application errors, including handled errors").toEqual(
      [],
    );
  },
  app: async ({ page, native }, use) => {
    void native;
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "工作区", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "项目首页", exact: true })).toHaveCount(0);
    await use(page);
  },
  // Automatic even for the retained hook suites. Attach diagnostics before teardown assertions.
  _diagnostics: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await use();
      await testInfo.attach("browser-errors", {
        body: JSON.stringify({ errors, consoleErrors }, null, 2),
        contentType: "application/json",
      });
      expect(errors, "Unhandled browser exceptions").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openImport(page: Page) {
  await page
    .getByRole("navigation", { name: "工作区", exact: true })
    .getByRole("button", { name: "导入", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "选择 clip.MP4", exact: true })).toBeVisible();
}
