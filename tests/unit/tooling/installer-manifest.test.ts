import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

import {
  finalizeInstallerManifest,
  prepareInstallerManifest,
} from "../../../scripts/prepare-installer-manifest.ts";
import type { InstallerManifestFile } from "../../../scripts/prepare-installer-manifest.ts";

interface InstallerManifest {
  version: number;
  files: InstallerManifestFile[];
}

async function fixture(t: TestContext, resources: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "locution-installer-manifest-"));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(basename(root).startsWith("locution-installer-manifest-"));
    await rm(root, { recursive: true, force: true });
  });
  const sources = {
    "src-tauri/target/release/locution-pro.exe": "MZ application",
    "src-tauri/resources/model/nested/模型.onnx": "model",
    "src-tauri/resources/model/onnxruntime.dll": "runtime",
    "src-tauri/resources/model/README.md": "model documentation",
    "src-tauri/bin/ffmpeg-x86_64-pc-windows-msvc.exe": "ffmpeg",
    "src-tauri/bin/ffprobe-x86_64-pc-windows-msvc.exe": "ffprobe",
    LICENSE: "license",
    "src-tauri/tauri.conf.json": JSON.stringify({
      bundle: { resources, externalBin: ["bin/ffmpeg", "bin/ffprobe"] },
    }),
  };
  for (const [name, contents] of Object.entries(sources)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

test("installer manifest hashes actual payload bytes and nested Windows destinations", async (t) => {
  const root = await fixture(t, {
    "resources/model": "semantic-search",
    "../LICENSE": "LICENSE",
  });
  const output = await prepareInstallerManifest(root);
  const first = await readFile(output, "utf8");
  const manifest = JSON.parse(first) as InstallerManifest;
  assert.equal(manifest.version, 1);
  assert.equal(manifest.files.length, 7);
  const model = manifest.files.find((file) => file.path.endsWith("模型.onnx"));
  assert.deepEqual(model, {
    path: "semantic-search\\nested\\模型.onnx",
    size: 5,
    sha256: createHash("sha256").update("model").digest("hex"),
    group: "semantic-search",
    bundleInUpdate: false,
  });
  assert.equal(manifest.files.find((file) => file.path === "LICENSE")!.group, "core");
  assert.equal(manifest.files.find((file) => file.path === "LICENSE")!.bundleInUpdate, true);
  assert.equal(
    manifest.files.find((file) => file.path.endsWith("README.md"))!.bundleInUpdate,
    true,
  );
  assert.equal(
    manifest.files.find((file) => file.path.endsWith("onnxruntime.dll"))!.bundleInUpdate,
    false,
  );
  assert.equal(manifest.files.find((file) => file.path === "ffmpeg.exe")!.group, "ffmpeg");
  assert.equal(manifest.files.find((file) => file.path === "ffmpeg.exe")!.bundleInUpdate, false);
  await prepareInstallerManifest(root);
  assert.equal(await readFile(output, "utf8"), first);
  await writeFile(join(root, "src-tauri/resources/model/nested/模型.onnx"), "MODEL");
  await prepareInstallerManifest(root);
  assert.notEqual(await readFile(output, "utf8"), first);
});

test("NSIS finalization hashes the patched executable without changing the resource manifest", async (t) => {
  const root = await fixture(t, { "../LICENSE": "LICENSE" });
  const binary = join(root, "src-tauri/target/release/locution-pro.exe");
  await writeFile(binary, "MZ __TAURI_BUNDLE_TYPE_VAR_UNK");
  const input = await prepareInstallerManifest(root);
  const before = await readFile(input, "utf8");
  const patched = "MZ __TAURI_BUNDLE_TYPE_VAR_NSS";
  await writeFile(binary, patched);
  const output = await finalizeInstallerManifest(input, binary, "locution-pro.exe");
  const final = JSON.parse(await readFile(output, "utf8")) as InstallerManifest;
  assert.deepEqual(
    final.files.find((entry) => entry.path === "locution-pro.exe"),
    {
      path: "locution-pro.exe",
      size: Buffer.byteLength(patched),
      sha256: createHash("sha256").update(patched).digest("hex"),
      group: "core",
      bundleInUpdate: true,
    },
  );
  const resources = (manifest: InstallerManifest) =>
    manifest.files.filter((entry) => entry.path !== "locution-pro.exe");
  assert.deepEqual(resources(final), resources(JSON.parse(before)));
  assert.equal(await readFile(input, "utf8"), before);
  assert.equal(await readFile(binary, "utf8"), patched);
  const signature = " signed";
  await writeFile(binary, patched + signature);
  await finalizeInstallerManifest(input, binary, "locution-pro.exe");
  assert.equal(
    (JSON.parse(await readFile(output, "utf8")) as InstallerManifest).files.find(
      (entry) => entry.path === "locution-pro.exe",
    )!.sha256,
    createHash("sha256")
      .update(patched + signature)
      .digest("hex"),
  );
});

for (const destination of [
  "..\\escape",
  "C:\\escape",
  "model\\..\\escape",
  "model\\bad=key",
  "model.\\x",
  "model\\NUL.onnx",
  "COM1\\x",
  "model\\lpt¹.txt",
]) {
  test(`installer manifest rejects unsafe destination ${destination}`, async (t) => {
    const root = await fixture(t, { "resources/model": destination });
    await assert.rejects(prepareInstallerManifest(root), /Unsafe installer destination/);
  });
}

test("installer manifest rejects missing inputs and case-insensitive collisions", async (t) => {
  const root = await fixture(t, { missing: "transnetv2" });
  await assert.rejects(prepareInstallerManifest(root), /ENOENT/);
  const config = join(root, "src-tauri/tauri.conf.json");
  await writeFile(
    config,
    JSON.stringify({
      bundle: {
        resources: { "../LICENSE": "ffmpeg.EXE" },
        externalBin: ["bin/ffmpeg"],
      },
    }),
  );
  await assert.rejects(prepareInstallerManifest(root), /Duplicate installer destination/);
});
