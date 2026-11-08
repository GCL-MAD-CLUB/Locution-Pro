import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareReleaseManifest } from "../../../scripts/prepare-release-manifest.mjs";
import { checkReleaseAssets } from "../../../scripts/check-release-assets.mjs";
import { inspectRelease, prepareReleaseDraft } from "../../../scripts/prepare-release-draft.mjs";
import {
  MACOS_PLATFORM,
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
  const updater = path.join(directory, "update.exe");
  await writeFile(updater, Buffer.from("MZ update-only fixture"));
  return {
    version: "2.1.1",
    installer,
    updater,
    outputDirectory: path.join(directory, "release"),
    bytes,
  };
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
  assert.equal(sums.length, 3);
  assert.match(platform.updater.url, /Locution\.Pro_2\.1\.1_x64-update\.exe$/u);
  assert.equal(
    platform.updater.signature,
    createHash("sha256")
      .update(await readFile(options.updater))
      .digest("hex"),
  );
});

test("release regeneration replaces the complete previous file set without mixing versions", async (t) => {
  const options = await fixture(t);
  await prepareReleaseManifest(options);
  await prepareReleaseManifest({ ...options, version: "2.2.0" });
  const { manifest } = await checkReleaseAssets({
    directory: options.outputDirectory,
    version: "2.2.0",
    repository: "GCL-MAD-CLUB/Locution-Pro",
  });
  assert.equal(manifest.version, "2.2.0");
  await assert.rejects(
    prepareReleaseManifest({
      ...options,
      installer: path.join(options.outputDirectory, "missing.exe"),
    }),
  );
  await checkReleaseAssets({
    directory: options.outputDirectory,
    version: "2.2.0",
    repository: "GCL-MAD-CLUB/Locution-Pro",
  });
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

test("update metadata cannot redirect automatic updates to the full installer", async (t) => {
  const options = await fixture(t);
  const manifest = await prepareReleaseManifest(options);
  manifest.platforms[RELEASE_PLATFORM].updater.url = manifest.platforms[RELEASE_PLATFORM].url;
  assert.throws(() => validateRelease(manifest), /update-only installer/u);
});

test("publisher refuses an update installer changed after manifest generation", async (t) => {
  const options = await fixture(t);
  await prepareReleaseManifest(options);
  await writeFile(
    path.join(options.outputDirectory, "Locution.Pro_2.1.1_x64-update.exe"),
    "MZ corrupted update",
  );
  await assert.rejects(
    checkReleaseAssets({
      directory: options.outputDirectory,
      version: options.version,
      repository: "GCL-MAD-CLUB/Locution-Pro",
    }),
    /checksum mismatch/u,
  );
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

test("prereleases replace stable metadata with checksums and never contain latest.json", async (t) => {
  for (const withMacos of [false, true]) {
    const options = await (withMacos ? macosFixture(t) : fixture(t));
    await prepareReleaseManifest(options);
    const version = "0.4.3-preview";
    await prepareReleaseManifest({ ...options, version });
    const check = () =>
      checkReleaseAssets({
        directory: options.outputDirectory,
        version,
        repository: "GCL-MAD-CLUB/Locution-Pro",
      });
    const { files, manifest } = await check();
    assert.equal(manifest, null);
    assert.equal(files.length, withMacos ? 5 : 3);
    assert(!(await readdir(options.outputDirectory)).includes("latest.json"));
    const sums = await readFile(path.join(options.outputDirectory, "SHA256SUMS.txt"), "utf8");
    assert(!sums.includes("latest.json"));
    assert.equal(sums.trim().split("\n").length, files.length - 1);
    for (const file of files.filter((file) => file.name !== "SHA256SUMS.txt")) {
      assert(sums.includes(`${file.sha256}  ${file.name}\n`));
    }
    const installer = path.join(options.outputDirectory, `Locution.Pro_${version}_x64-setup.exe`);
    const bytes = await readFile(installer);
    await writeFile(installer, "MZ tampered prerelease");
    await assert.rejects(check(), /checksum mismatch/u);
    await writeFile(installer, bytes);
    await writeFile(path.join(options.outputDirectory, "latest.json"), "{}");
    await assert.rejects(check(), /exactly/u);
    await rm(path.join(options.outputDirectory, "latest.json"));
    if (withMacos) {
      await rm(path.join(options.outputDirectory, `Locution.Pro_${version}_aarch64.dmg`));
      await assert.rejects(check(), /exactly/u);
    }
  }
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
  assert.throws(() => validateRelease(manifest), /GitHub installer URL/);
  assert.deepEqual(validateRelease(manifest, { repository: "release-owner/product" }), manifest);
});

async function publicationFixture(t, { version = "2.1.1", absent = false } = {}) {
  const options = {
    ...(await fixture(t)),
    version,
    repository: "release-owner/product",
    token: "test-token",
  };
  await prepareReleaseManifest(options);
  options.directory = options.outputDirectory;
  const { files } = await checkReleaseAssets(options);
  const state = {
    release: absent
      ? null
      : {
          databaseId: 123,
          isDraft: true,
          isPrerelease: version.includes("-"),
          tagName: `v${version}`,
        },
    commands: [],
    assets: [],
    files,
  };
  options.fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-token");
    if (url.endsWith("/graphql")) {
      assert.deepEqual(JSON.parse(init.body).variables, {
        owner: "release-owner",
        name: "product",
        tag: `v${version}`,
      });
      return Response.json({ data: { repository: { release: state.release } } });
    }
    assert.match(url, /\/releases\/123\/assets\?per_page=100$/u);
    return Response.json(state.assets);
  };
  options.run = async (args) => {
    state.commands.push(args);
    if (args[1] === "create") {
      state.release = {
        databaseId: 123,
        isDraft: true,
        isPrerelease: version.includes("-"),
        tagName: `v${version}`,
      };
      return;
    }
    if (args[1] === "edit") {
      assert.equal(version.includes("-"), true);
      assert.equal(args[args.indexOf("--notes") + 1], `Release v${version}`);
      return;
    }
    assert.equal(args[1], "upload");
    const file = files.find((file) => file.path === args[3]);
    assert(file);
    state.assets = state.assets.filter((asset) => asset.name !== file.name);
    state.assets.push({
      name: file.name,
      size: file.size,
      digest: `sha256:${file.sha256}`,
      state: "uploaded",
    });
  };
  options.sleep = async () => {};
  return { options, state };
}

test("publication revalidates the exact artifact file set and byte checksums", async (t) => {
  const { options } = await publicationFixture(t);
  await writeFile(path.join(options.directory, "unexpected.exe"), "MZ other version");
  await assert.rejects(checkReleaseAssets(options), /exactly/u);
  await rm(path.join(options.directory, "unexpected.exe"));
  await writeFile(
    path.join(options.directory, "latest.json"),
    `${await readFile(path.join(options.directory, "latest.json"), "utf8")} `,
  );
  await assert.rejects(checkReleaseAssets(options), /checksum mismatch/u);
  await assert.rejects(
    prepareReleaseDraft({
      ...options,
      fetcher: () => assert.fail("Invalid artifacts must not reach GitHub"),
    }),
    /checksum mismatch/u,
  );
});

test("publication rejects an artifact from another version or repository", async (t) => {
  const { options } = await publicationFixture(t);
  await assert.rejects(
    checkReleaseAssets({ ...options, repository: "another/repository" }),
    /expected version and repository|Invalid GitHub installer URL/u,
  );
  await assert.rejects(checkReleaseAssets({ ...options, version: "2.1.2" }), /exactly/u);
});

test("precise draft lookup distinguishes an absent release from API failures", async (t) => {
  const { options } = await publicationFixture(t, { absent: true });
  assert.equal(await inspectRelease(options), null);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      inspectRelease({ ...options, fetcher: async () => new Response(null, { status }) }),
      /API failed/u,
    );
  }
  await assert.rejects(
    inspectRelease({
      ...options,
      fetcher: async () => Response.json({ errors: [{ message: "failed" }] }),
    }),
    /query failed/u,
  );
  await assert.rejects(
    inspectRelease({
      ...options,
      fetcher: async () => Response.json({ data: { repository: null } }),
    }),
    /repository/u,
  );
});

test("publisher creates channel-specific notes and uploads latest.json only for stable releases", async (t) => {
  for (const version of ["2.1.1", "2.1.1-rc.1"]) {
    const { options, state } = await publicationFixture(t, { version, absent: true });
    await prepareReleaseDraft(options);
    const [creation, ...uploads] = state.commands;
    assert(creation.includes("--draft"));
    assert(creation.includes("--latest=false"));
    assert(creation.includes(`--prerelease=${version.includes("-")}`));
    if (version.includes("-")) {
      assert.equal(creation[creation.indexOf("--notes") + 1], `Release v${version}`);
      assert(!creation.includes("--generate-notes"));
      assert.equal(uploads.length, 3);
      assert(uploads.every((args) => path.basename(args[3]) !== "latest.json"));
    } else {
      assert(creation.includes("--generate-notes"));
      assert.equal(uploads.length, 4);
      assert.equal(path.basename(uploads.at(-1)[3]), "latest.json");
    }
  }
});

test("publisher normalizes existing prerelease notes and rejects stale remote assets", async (t) => {
  const { options, state } = await publicationFixture(t, { version: "0.4.3-preview" });
  await prepareReleaseDraft(options);
  assert.equal(state.commands[0][1], "edit");
  state.commands.length = 0;
  await prepareReleaseDraft(options);
  assert.deepEqual(
    state.commands.map((args) => args[1]),
    ["edit"],
  );
  state.assets.push({ name: "latest.json", state: "uploaded" });
  await assert.rejects(prepareReleaseDraft(options), /unexpected assets/u);
});

test("publication retries only the failed file and reuses matching server digests on rerun", async (t) => {
  const { options, state } = await publicationFixture(t);
  const run = options.run;
  let attempts = 0;
  options.run = async (args) => {
    if (args[3].endsWith("SHA256SUMS.txt") && attempts++ === 0)
      throw new Error("Upload unavailable");
    await run(args);
  };
  const waits = [];
  options.sleep = async (ms) => waits.push(ms);
  await prepareReleaseDraft(options);
  assert.deepEqual(waits, [5000]);
  assert.equal(state.commands.filter((args) => args[3].endsWith(".exe")).length, 2);
  assert.equal(attempts, 2);
  state.commands.length = 0;
  await prepareReleaseDraft(options);
  assert.deepEqual(state.commands, []);
});

test("published releases and mismatched prerelease flags are never overwritten", async (t) => {
  const { options, state } = await publicationFixture(t);
  state.release.isDraft = false;
  await assert.rejects(prepareReleaseDraft(options), /unpublished draft/u);
  state.release.isDraft = true;
  state.release.isPrerelease = true;
  await assert.rejects(prepareReleaseDraft(options), /prerelease status/u);
  assert.deepEqual(state.commands, []);
});

test("publication stops if a maintainer publishes the draft during upload", async (t) => {
  const { options, state } = await publicationFixture(t);
  const run = options.run;
  options.run = async (args) => {
    await run(args);
    state.release.isDraft = false;
  };
  await assert.rejects(prepareReleaseDraft(options), /unpublished draft/u);
  assert.equal(state.commands.length, 1);
});

test("publication requires GitHub to acknowledge matching asset sizes and digests", async (t) => {
  const { options, state } = await publicationFixture(t);
  const run = options.run;
  options.run = async (args) => {
    await run(args);
    state.assets.at(-1).digest = `sha256:${"0".repeat(64)}`;
  };
  await assert.rejects(prepareReleaseDraft(options), /verified artifact bytes/u);
});

test("publication limits upload attempts and fails cleanly for API errors before creation", async (t) => {
  const { options, state } = await publicationFixture(t, { absent: true });
  await assert.rejects(
    prepareReleaseDraft({ ...options, fetcher: async () => new Response(null, { status: 503 }) }),
    /API failed/u,
  );
  assert.deepEqual(state.commands, []);
  state.release = { databaseId: 123, isDraft: true, isPrerelease: false, tagName: "v2.1.1" };
  let attempts = 0;
  const waits = [];
  await assert.rejects(
    prepareReleaseDraft({
      ...options,
      run: async () => {
        attempts++;
        throw new Error("Upload unavailable");
      },
      sleep: async (ms) => waits.push(ms),
    }),
    /Upload unavailable/u,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [5000, 10000]);
});

async function macosFixture(t) {
  const options = await fixture(t);
  const directory = path.dirname(options.installer);
  const image = Buffer.alloc(1024, 0);
  image.write("koly", 512, "latin1");
  options.macos = {
    installer: path.join(directory, "Locution Pro_2.1.1_aarch64.dmg"),
    updater: path.join(directory, "update.tar.gz"),
  };
  await writeFile(options.macos.installer, image);
  await writeFile(options.macos.updater, Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]));
  return options;
}

test("the macOS build adds a darwin-aarch64 entry beside the Windows files", async (t) => {
  const options = await macosFixture(t);
  const manifest = await prepareReleaseManifest(options);
  assert.deepEqual(Object.keys(manifest.platforms), [RELEASE_PLATFORM, MACOS_PLATFORM]);
  assert.deepEqual(validateRelease(manifest), manifest);
  const macos = manifest.platforms[MACOS_PLATFORM];
  assert.equal(
    macos.url,
    "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/download/v2.1.1/Locution.Pro_2.1.1_aarch64.dmg",
  );
  assert.equal(
    macos.updater.cdn_url,
    "https://openlist.frameneo.com/sd/YRrdPxj2/Locution.Pro_2.1.1_aarch64-update.tar.gz",
  );
  assert.equal(
    macos.updater.signature,
    createHash("sha256")
      .update(await readFile(options.macos.updater))
      .digest("hex"),
  );
  const { files } = await checkReleaseAssets({
    directory: options.outputDirectory,
    version: options.version,
    repository: "GCL-MAD-CLUB/Locution-Pro",
  });
  assert.equal(files.length, 6);
  const sums = await readFile(path.join(options.outputDirectory, "SHA256SUMS.txt"), "utf8");
  assert.equal(sums.trim().split("\n").length, 5);
});

test("macOS release files must match their formats and the manifest", async (t) => {
  const options = await macosFixture(t);
  const check = () =>
    checkReleaseAssets({
      directory: options.outputDirectory,
      version: options.version,
      repository: "GCL-MAD-CLUB/Locution-Pro",
    });
  await writeFile(options.macos.installer, Buffer.alloc(1024, 0));
  await assert.rejects(prepareReleaseManifest(options), /disk image/u);
  const image = Buffer.alloc(1024, 0);
  image.write("koly", 512, "latin1");
  await writeFile(options.macos.installer, image);
  await writeFile(options.macos.updater, "MZ not an archive");
  await assert.rejects(prepareReleaseManifest(options), /gzip/u);
  await writeFile(options.macos.updater, Buffer.from([0x1f, 0x8b, 8, 0]));
  await prepareReleaseManifest(options);
  await rm(path.join(options.outputDirectory, "Locution.Pro_2.1.1_aarch64-update.tar.gz"));
  await assert.rejects(check(), /exactly/u);
  // A Windows-only manifest cannot be published beside stray macOS files.
  const { macos, ...windows } = options;
  await prepareReleaseManifest(windows);
  await writeFile(path.join(options.outputDirectory, "Locution.Pro_2.1.1_aarch64.dmg"), image);
  await writeFile(
    path.join(options.outputDirectory, "Locution.Pro_2.1.1_aarch64-update.tar.gz"),
    Buffer.from([0x1f, 0x8b]),
  );
  await assert.rejects(check(), /disagree on the macOS build/u);
  assert(macos);
});

test("the macOS manifest entry uses immutable URLs of the releasing repository", async (t) => {
  const manifest = await prepareReleaseManifest(await macosFixture(t));
  const tampered = structuredClone(manifest);
  tampered.platforms[MACOS_PLATFORM].updater.url =
    "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/latest/download/update.tar.gz";
  assert.throws(() => validateRelease(tampered), /update-only installer/u);
  tampered.platforms[MACOS_PLATFORM] = { ...manifest.platforms[MACOS_PLATFORM], signature: "x" };
  assert.throws(() => validateRelease(tampered), /platform installer/u);
});
