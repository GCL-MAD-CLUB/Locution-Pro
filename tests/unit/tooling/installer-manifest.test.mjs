import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import { prepareInstallerManifest } from "../../../scripts/prepare-installer-manifest.mjs";

async function fixture(t, resources) {
  const root = await mkdtemp(join(tmpdir(), "locution-installer-manifest-"));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(basename(root).startsWith("locution-installer-manifest-"));
    await rm(root, { recursive: true, force: true });
  });
  const sources = {
    "src-tauri/resources/model/nested/模型.onnx": "model",
    "src-tauri/resources/model/onnxruntime.dll": "runtime",
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
  const manifest = JSON.parse(first);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.files.length, 5);
  const model = manifest.files.find((file) => file.path.endsWith("模型.onnx"));
  assert.deepEqual(model, {
    path: "semantic-search\\nested\\模型.onnx",
    size: 5,
    sha256: createHash("sha256").update("model").digest("hex"),
    group: "semantic-search",
  });
  assert.equal(manifest.files.find((file) => file.path === "LICENSE").group, "core");
  assert.equal(manifest.files.find((file) => file.path === "ffmpeg.exe").group, "ffmpeg");
  await prepareInstallerManifest(root);
  assert.equal(await readFile(output, "utf8"), first);
  await writeFile(join(root, "src-tauri/resources/model/nested/模型.onnx"), "MODEL");
  await prepareInstallerManifest(root);
  assert.notEqual(await readFile(output, "utf8"), first);
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
