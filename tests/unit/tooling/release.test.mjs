import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareReleaseManifest } from "../../../scripts/prepare-release-manifest.mjs";
import {
  RELEASE_PLATFORM,
  isReleaseVersion,
  validateRelease,
} from "../../../site/src/release-contract.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "locution-release-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith("locution-release-"));
    await rm(directory, { recursive: true, force: true });
  });
  const installer = path.join(directory, "Locution Pro_2.1.1_x64-setup.exe");
  const bytes = Buffer.from("MZ test installer bytes");
  await writeFile(installer, bytes);
  return { version: "2.1.1", installer, outputDirectory: path.join(directory, "release"), bytes };
}

test("release artifacts contain the actual installer SHA-256 and immutable download URLs", async (t) => {
  const options = await fixture(t);
  const manifest = await prepareReleaseManifest({ ...options, pubDate: "2026-10-05T16:40:45Z" });
  assert.deepEqual(Object.keys(manifest.platforms), ["windows-x86_64"]);
  assert.deepEqual(validateRelease(manifest), manifest);
  assert.equal(manifest.pub_date, "2026-10-05T16:40:45.000Z");
  const platform = manifest.platforms[RELEASE_PLATFORM];
  assert.equal(platform.signature, createHash("sha256").update(options.bytes).digest("hex"));
  assert.equal(
    platform.url,
    "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/download/v2.1.1/Locution.Pro_2.1.1_x64-setup.exe",
  );
  assert.equal(
    platform.cdn_url,
    "https://openlist.frameneo.com/sd/YRrdPxj2/Locution.Pro_2.1.1_x64-setup.exe",
  );
  const json = await readFile(path.join(options.outputDirectory, "latest.json"), "utf8");
  assert.deepEqual(JSON.parse(json), manifest);
  const sums = (await readFile(path.join(options.outputDirectory, "SHA256SUMS.txt"), "utf8"))
    .trim()
    .split("\n");
  for (const line of sums) {
    const [hash, name] = line.split("  ");
    assert.equal(
      createHash("sha256")
        .update(await readFile(path.join(options.outputDirectory, name)))
        .digest("hex"),
      hash,
    );
  }
  assert.equal(sums.length, 2);
});

test("release generation rejects missing, empty and non-executable installers", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    prepareReleaseManifest({ ...options, installer: `${options.installer}.missing` }),
    /ENOENT/u,
  );
  for (const bytes of [Buffer.alloc(0), Buffer.from("an HTML error page")]) {
    await writeFile(options.installer, bytes);
    await assert.rejects(prepareReleaseManifest(options), /empty installer|Windows executable/u);
  }
});

test("release generation supports prerelease artifacts without accepting invalid semver or paths", async (t) => {
  const options = await fixture(t);
  const manifest = await prepareReleaseManifest({ ...options, version: "2.1.1-rc.1" });
  assert.equal(manifest.version, "2.1.1-rc.1");
  assert.throws(() => validateRelease(manifest), /stable release/u);
  for (const version of ["01.2.3", "2.1.1-01", "2.1.1+build", "../2.1.1", "2.1", "2.1.1-"]) {
    assert.equal(isReleaseVersion(version), false, version);
    await assert.rejects(prepareReleaseManifest({ ...options, version }), /release version/u);
  }
  await assert.rejects(
    prepareReleaseManifest({ ...options, repository: "../repo/path" }),
    /repository/u,
  );
  await assert.rejects(prepareReleaseManifest({ ...options, pubDate: "bad" }), /date/u);
});

test("the manifest links to the repository that actually owns the release", async (t) => {
  const options = await fixture(t);
  const manifest = await prepareReleaseManifest({
    ...options,
    repository: "release-owner/product",
  });
  assert.match(
    manifest.platforms[RELEASE_PLATFORM].url,
    /^https:\/\/github\.com\/release-owner\/product\/releases\/download\/v2\.1\.1\//u,
  );
  assert.deepEqual(validateRelease(manifest), manifest);
});
