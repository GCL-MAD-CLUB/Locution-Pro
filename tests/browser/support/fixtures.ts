import type { NativeCall } from "./native-types";
import { test as base, expect, type Page } from "@playwright/test";

import { installNative, mediaEntries } from "./native";

type Fixtures = {
  betaTranscode: boolean;
  _diagnostics: void;
  native: {
    calls: (command: string) => Promise<NativeCall[]>;
    fail: (command: string, message?: string, path?: string) => Promise<void>;
    hold: (command: string) => Promise<void>;
    release: (command: string, directory?: string) => Promise<void>;
  };
  app: Page;
};

export const test = base.extend<Fixtures>({
  betaTranscode: [false, { option: true }],
  native: async ({ page, betaTranscode }, provideFixture, testInfo) => {
    await page.addInitScript(installNative, { entries: mediaEntries, betaTranscode });
    await provideFixture({
      calls: (command) =>
        page.evaluate(
          (cmd) => window.__nativeTest.calls.filter((call) => call.command === cmd),
          command,
        ),
      fail: (command, message, path) =>
        page.evaluate(
          ({ command, message, path }) => {
            const key = path ? `${command}:${path}` : command;
            if (message) window.__nativeTest.failures[key] = message;
            else delete window.__nativeTest.failures[key];
            if (message) window.__nativeTest.expectedFailures.push(`tauri:${command}`);
          },
          { command, message, path },
        ),
      hold: (command) =>
        page.evaluate((cmd) => {
          window.__nativeTest.held[cmd] = true;
        }, command),
      release: (command, directory) =>
        page.evaluate(
          ({ command, directory }) => {
            const state = window.__nativeTest;
            delete state.held[command];
            const pending = state.pending.filter(
              (call) =>
                call.command === command && (!directory || call.args.directory === directory),
            );
            state.pending = state.pending.filter((call) => !pending.includes(call));
            pending.forEach((call) => call.resolve());
          },
          { command, directory },
        ),
    });
    const snapshot = await page.evaluate(() => {
      const state = window.__nativeTest;
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
      (call) =>
        call.command === "record_frontend_incident" &&
        !snapshot.expectedFailures.includes(call.args.incident.source),
    );
    expect(unexpectedIncidents, "Unexpected application errors, including handled errors").toEqual(
      [],
    );
  },
  app: async ({ page, native }, provideFixture) => {
    void native;
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "工作区", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "项目首页", exact: true })).toHaveCount(0);
    await provideFixture(page);
  },
  // Automatic even for the retained hook suites. Attach diagnostics before teardown assertions.
  _diagnostics: [
    async ({ page }, provideFixture, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await provideFixture();
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
