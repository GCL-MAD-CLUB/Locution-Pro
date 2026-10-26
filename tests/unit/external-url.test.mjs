import { createModuleLoader } from "./support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";

const loadModule = createModuleLoader(import.meta.url);

function loadExternalUrl({ tauri, opened = [], invocations = [] }) {
  return loadModule(
    "../../src/platform/tauri/externalUrl.ts",
    {
      "../../errors/runtime": {
        invokeCommand: async (command, args) => {
          invocations.push([command, args]);
        },
      },
      "./runtime": { isTauriRuntime: () => tauri },
    },
    { URL, window: { open: (...args) => opened.push(args) } },
  );
}

test("resolveExternalUrl accepts web links and rejects other protocols", () => {
  const externalUrl = loadExternalUrl({ tauri: false });

  assert.equal(
    externalUrl.resolveExternalUrl("https://space.bilibili.com/99325557"),
    "https://space.bilibili.com/99325557",
  );

  for (const value of [
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
    "/relative/path",
    "",
    "not a url",
  ]) {
    assert.equal(externalUrl.resolveExternalUrl(value), null);
  }
});

test("openExternalUrl leaves the webview untouched and uses window.open in previews", async () => {
  const opened = [];
  const externalUrl = loadExternalUrl({ tauri: false, opened });

  await externalUrl.openExternalUrl("https://example.com/docs");
  await externalUrl.openExternalUrl("file:///C:/secret.txt");

  assert.deepEqual(opened, [["https://example.com/docs", "_blank", "noopener,noreferrer"]]);
});

test("openExternalUrl delegates to the native opener in the desktop shell", async () => {
  const invocations = [];
  const externalUrl = loadExternalUrl({ tauri: true, invocations });

  await externalUrl.openExternalUrl("https://example.com/docs");

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0][0], "open_external_url");
  assert.equal(invocations[0][1].url, "https://example.com/docs");
});
