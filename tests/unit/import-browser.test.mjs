import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports });
  return exports;
}

const importBrowser = loadModule(
  "../../src/components/panels/ImportWorkspace/browser/importBrowserModel.ts",
);

test("fileExtension reads the extension after the final dot", () => {
  assert.equal(importBrowser.fileExtension("C:\\media\\clip.MP4"), "mp4");
  assert.equal(importBrowser.fileExtension("/media/clip.tar.gz"), "gz");
  assert.equal(importBrowser.fileExtension("clip.mkv"), "mkv");
  assert.equal(importBrowser.fileExtension("README"), "");
  assert.equal(importBrowser.fileExtension(".gitignore"), "");
});

test("mediaKind recognizes every supported media category", () => {
  assert.equal(importBrowser.mediaKind("C:\\media\\clip.mp4"), "video");
  assert.equal(importBrowser.mediaKind("/media/take.WAV"), "audio");
  assert.equal(importBrowser.mediaKind("/media/frame.webp"), "image");
  assert.equal(importBrowser.mediaKind("/media/captions.srt"), "subtitle");
  assert.equal(importBrowser.mediaKind("/media/notes.txt"), null);
  assert.equal(importBrowser.mediaKind("/media/folder"), null);
});
