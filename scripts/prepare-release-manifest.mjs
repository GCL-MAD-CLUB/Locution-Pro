import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CDN_BASE,
  RELEASE_PLATFORM,
  RELEASE_REPOSITORY,
  installerName,
  updaterName,
  isReleaseVersion,
  isReleaseRepository,
} from "../site/src/release-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function prepareReleaseManifest({
  version,
  installer,
  updater,
  outputDirectory,
  repository = RELEASE_REPOSITORY,
  pubDate = new Date().toISOString(),
}) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  if (!isReleaseRepository(repository)) throw new Error("Invalid release repository");
  if (!Number.isFinite(Date.parse(pubDate))) throw new Error("Invalid publication date");
  async function inspect(installer) {
    const metadata = await stat(installer);
    if (!metadata.isFile() || metadata.size < 2) throw new Error("Missing or empty installer");
    const hash = createHash("sha256");
    let first = true;
    for await (const chunk of createReadStream(installer)) {
      if (first && (chunk[0] !== 0x4d || chunk[1] !== 0x5a))
        throw new Error("Expected a Windows executable");
      first = false;
      hash.update(chunk);
    }
    return hash.digest("hex");
  }
  const signature = await inspect(installer);
  const updateSignature = await inspect(updater);
  const name = installerName(version);
  const updateName = updaterName(version);
  const manifest = {
    version,
    pub_date: new Date(pubDate).toISOString(),
    platforms: {
      [RELEASE_PLATFORM]: {
        signature,
        url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
        cdn_url: `${CDN_BASE}/${name}`,
        updater: {
          signature: updateSignature,
          url: `https://github.com/${repository}/releases/download/v${version}/${updateName}`,
          cdn_url: `${CDN_BASE}/${updateName}`,
        },
      },
    },
  };
  outputDirectory = path.resolve(outputDirectory);
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  const stage = await mkdtemp(`${outputDirectory}.stage-`);
  const backup = `${stage}.previous`;
  let moved = false;
  try {
    await copyFile(installer, path.join(stage, name));
    await copyFile(updater, path.join(stage, updateName));
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(path.join(stage, "latest.json"), json);
    const manifestHash = createHash("sha256").update(json).digest("hex");
    await writeFile(
      path.join(stage, "SHA256SUMS.txt"),
      `${signature}  ${name}\n${updateSignature}  ${updateName}\n${manifestHash}  latest.json\n`,
    );
    const previous = await lstat(outputDirectory).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (previous) {
      if (!previous.isDirectory() || previous.isSymbolicLink())
        throw new Error("Release output must be a real directory");
      await rename(outputDirectory, backup);
      moved = true;
    }
    try {
      await rename(stage, outputDirectory);
    } catch (error) {
      if (moved) await rename(backup, outputDirectory);
      throw error;
    }
    if (moved) await rm(backup, { recursive: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (process.argv.length > 2) throw new Error("Usage: npm run prepare:release");
  const manifest = await prepareReleaseManifest({
    version,
    updater: path.join(
      root,
      "src-tauri",
      "target",
      "installer",
      `Locution Pro_${version}_x64-update.exe`,
    ),
    installer: path.join(
      root,
      "src-tauri",
      "target",
      "release",
      "bundle",
      "nsis",
      `Locution Pro_${version}_x64-setup.exe`,
    ),
    outputDirectory: path.join(root, "src-tauri", "target", "release-artifacts"),
    repository: process.env.GITHUB_REPOSITORY || RELEASE_REPOSITORY,
  });
  console.log(
    `Release ${manifest.version}: full installer, update installer, latest.json and SHA256SUMS.txt ready in src-tauri/target/release-artifacts`,
  );
}
