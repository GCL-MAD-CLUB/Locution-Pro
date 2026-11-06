import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildUpdateInstaller } from "../../../scripts/build-update-installer.mjs";

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
