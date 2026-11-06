import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  buildMacosUpdate,
  buildUpdateInstaller,
} from "../../../scripts/build-update-installer.mjs";

for (const failed of [false, true]) {
  test(`update bundling preserves the full installer when ${failed ? "bundling fails" : "bundling succeeds"}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "locution-update-bundle-"));
    t.after(async () => {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert(basename(root).startsWith("locution-update-bundle-"));
      await rm(root, { recursive: true, force: true });
    });
    const installer = join(
      root,
      "src-tauri/target/release/bundle/nsis/Locution Pro_1.2.3_x64-setup.exe",
    );
    await mkdir(dirname(installer), { recursive: true });
    await mkdir(join(root, "src-tauri/windows"), { recursive: true });
    await writeFile(join(root, "src-tauri/windows/installer.nsi"), "Unicode true\n");
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(installer, "MZ full installer");
    const run = (_, args) => {
      assert(args.includes("bundle"));
      assert(!args.includes("build"));
      const config = JSON.parse(readFileSync(args.at(-1), "utf8"));
      assert.equal(config.build.beforeBundleCommand, null);
      assert.match(
        readFileSync(config.bundle.windows.nsis.template, "utf8"),
        /^!define LOCUTION_UPDATE_ONLY\nUnicode true/u,
      );
      writeFileSync(installer, "MZ update installer");
      if (failed) throw new Error("Bundle failed after writing its output");
    };
    if (failed) await assert.rejects(buildUpdateInstaller(root, run), /Bundle failed/u);
    else {
      const update = await buildUpdateInstaller(root, run);
      assert.equal(await readFile(update, "utf8"), "MZ update installer");
    }
    assert.equal(await readFile(installer, "utf8"), "MZ full installer");
  });
}

test("the macOS update archive reuses FFmpeg, model weights and runtimes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "locution-update-bundle-"));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(basename(root).startsWith("locution-update-bundle-"));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  const bundle = join(root, "src-tauri/target/release/bundle");
  const app = join(bundle, "macos/Locution Pro.app/Contents");
  const files = {
    "Info.plist": "plist",
    "MacOS/locution-pro": "main",
    "MacOS/ffmpeg": "ffmpeg",
    "Resources/semantic-search/MODEL.md": "metadata",
    "Resources/semantic-search/tokenizer.json": "tokenizer",
    "Resources/semantic-search/model_quantized.onnx_data": "weights",
    "Resources/transnetv2/libonnxruntime.dylib": "runtime",
    "_CodeSignature/CodeResources": "seal",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(app, path)), { recursive: true });
    await writeFile(join(app, path), content);
  }
  await mkdir(join(bundle, "dmg"), { recursive: true });
  await writeFile(join(bundle, "dmg/Locution Pro_1.2.3_aarch64.dmg"), "image");
  let archived;
  const run = (program, args) => {
    assert.equal(program, "/usr/bin/tar");
    const directory = args[args.indexOf("-C") + 1];
    archived = {
      files: readFileSync(args[args.indexOf("-T") + 1], "utf8")
        .trim()
        .split("\n"),
      reuse: JSON.parse(readFileSync(join(directory, "update-reuse.json"), "utf8")),
    };
    writeFileSync(args[args.indexOf("-czf") + 1], "archive");
  };
  const archive = await buildMacosUpdate(root, run);
  assert.equal(basename(archive), "Locution.Pro_1.2.3_aarch64-update.tar.gz");
  assert.deepEqual(archived.files, [
    "Locution Pro.app/Contents/Info.plist",
    "Locution Pro.app/Contents/MacOS/locution-pro",
    "Locution Pro.app/Contents/Resources/semantic-search/MODEL.md",
    "Locution Pro.app/Contents/Resources/semantic-search/tokenizer.json",
    "Locution Pro.app/Contents/_CodeSignature/CodeResources",
    "update-reuse.json",
  ]);
  assert.equal(archived.reuse.version, "1.2.3");
  assert.deepEqual(
    archived.reuse.files.map((file) => [file.path, file.size]),
    [
      ["Contents/MacOS/ffmpeg", 6],
      ["Contents/Resources/semantic-search/model_quantized.onnx_data", 7],
      ["Contents/Resources/transnetv2/libonnxruntime.dylib", 7],
    ],
  );
  const output = join(root, "src-tauri/target/release-artifacts-macos");
  assert.equal(await readFile(join(output, "Locution.Pro_1.2.3_aarch64.dmg"), "utf8"), "image");
  assert(
    !existsSync(join(bundle, "macos/update-reuse.json")),
    "temporary reuse manifest is removed",
  );
});
