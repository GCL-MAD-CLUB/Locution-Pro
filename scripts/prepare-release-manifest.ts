import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
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
  MACOS_PLATFORM,
  RELEASE_PLATFORM,
  RELEASE_REPOSITORY,
  installerName,
  macosInstallerName,
  macosUpdaterName,
  updaterName,
  isReleaseVersion,
  isReleaseRepository,
} from "../site/src/release-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type AssetFormat = "exe" | "gzip" | "dmg";

interface AssetFormatSpec {
  header?: [number, number];
  trailer?: string;
  error: string;
}

interface ReleaseAsset {
  platform: string;
  file: string;
  name: string;
  format: AssetFormat;
  signature?: string;
}

export interface ReleaseLink {
  signature: string;
  url: string;
  cdn_url: string;
}

export interface ReleasePlatform extends ReleaseLink {
  updater: ReleaseLink;
}

export interface ReleaseManifest {
  version: string;
  pub_date: string;
  platforms: Record<string, ReleasePlatform>;
}

export interface MacosAssets {
  installer: string;
  updater: string;
}

export interface ReleaseManifestOptions {
  version: string;
  installer: string;
  updater: string;
  macos?: MacosAssets;
  outputDirectory: string;
  repository?: string;
  pubDate?: string;
}

// File formats accepted for each release asset, checked before hashing.
export const assetFormats: Record<AssetFormat, AssetFormatSpec> = {
  exe: { header: [0x4d, 0x5a], error: "Expected a Windows executable" },
  gzip: { header: [0x1f, 0x8b], error: "Expected a gzip update archive" },
  // A UDIF disk image ends with a 512-byte trailer that starts with "koly".
  dmg: { trailer: "koly", error: "Expected a macOS disk image" },
};

export async function inspectAsset(file: string, format: AssetFormat): Promise<string> {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 2) throw new Error("Missing or empty installer");
  const { header, trailer, error } = assetFormats[format];
  if (trailer) {
    if (metadata.size < 512) throw new Error(error);
    const handle = await open(file, "r");
    try {
      const bytes = Buffer.alloc(trailer.length);
      await handle.read(bytes, 0, bytes.length, metadata.size - 512);
      if (bytes.toString("latin1") !== trailer) throw new Error(error);
    } finally {
      await handle.close();
    }
  }
  const hash = createHash("sha256");
  let first = true;
  for await (const chunk of createReadStream(file)) {
    if (first && header && (chunk[0] !== header[0] || chunk[1] !== header[1])) {
      throw new Error(error);
    }
    first = false;
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function prepareReleaseManifest({
  version,
  installer,
  updater,
  macos,
  outputDirectory,
  repository = RELEASE_REPOSITORY,
  pubDate = new Date().toISOString(),
}: ReleaseManifestOptions): Promise<ReleaseManifest> {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  if (!isReleaseRepository(repository)) throw new Error("Invalid release repository");
  if (!Number.isFinite(Date.parse(pubDate))) throw new Error("Invalid publication date");
  const assets: ReleaseAsset[] = [
    { platform: RELEASE_PLATFORM, file: installer, name: installerName(version), format: "exe" },
    { platform: RELEASE_PLATFORM, file: updater, name: updaterName(version), format: "exe" },
  ];
  if (macos) {
    assets.push(
      {
        platform: MACOS_PLATFORM,
        file: macos.installer,
        name: macosInstallerName(version),
        format: "dmg",
      },
      {
        platform: MACOS_PLATFORM,
        file: macos.updater,
        name: macosUpdaterName(version),
        format: "gzip",
      },
    );
  }
  for (const asset of assets) asset.signature = await inspectAsset(asset.file, asset.format);
  const link = (asset: ReleaseAsset): ReleaseLink => ({
    signature: asset.signature!,
    url: `https://github.com/${repository}/releases/download/v${version}/${asset.name}`,
    cdn_url: `${CDN_BASE}/${asset.name}`,
  });
  const platforms: Record<string, ReleasePlatform> = {};
  for (let index = 0; index < assets.length; index += 2) {
    platforms[assets[index].platform] = {
      ...link(assets[index]),
      updater: link(assets[index + 1]),
    };
  }
  const manifest: ReleaseManifest = {
    version,
    pub_date: new Date(pubDate).toISOString(),
    platforms,
  };
  outputDirectory = path.resolve(outputDirectory);
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  const stage = await mkdtemp(`${outputDirectory}.stage-`);
  const backup = `${stage}.previous`;
  let moved = false;
  try {
    for (const asset of assets) await copyFile(asset.file, path.join(stage, asset.name));
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    const metadataChecksums: string[] = [];
    if (!version.includes("-")) {
      await writeFile(path.join(stage, "latest.json"), json);
      const manifestHash = createHash("sha256").update(json).digest("hex");
      metadataChecksums.push(`${manifestHash}  latest.json\n`);
    }
    await writeFile(
      path.join(stage, "SHA256SUMS.txt"),
      [...assets.map((asset) => `${asset.signature}  ${asset.name}\n`), ...metadataChecksums].join(
        "",
      ),
    );
    const previous = await lstat(outputDirectory).catch((error: NodeJS.ErrnoException) => {
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
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    version: string;
  };
  const target = path.join(root, "src-tauri", "target");
  const outputDirectory = path.join(target, "release-artifacts");
  const repository = process.env.GITHUB_REPOSITORY || RELEASE_REPOSITORY;
  let manifest: ReleaseManifest;
  if (process.argv.length === 3 && process.argv[2] === "--with-macos") {
    // Release CI: add the macOS build to the verified Windows artifact set.
    const macosDirectory = path.join(target, "release-artifacts-macos");
    manifest = await prepareReleaseManifest({
      version,
      installer: path.join(outputDirectory, installerName(version)),
      updater: path.join(outputDirectory, updaterName(version)),
      macos: {
        installer: path.join(macosDirectory, macosInstallerName(version)),
        updater: path.join(macosDirectory, macosUpdaterName(version)),
      },
      outputDirectory,
      repository,
    });
  } else if (process.argv.length === 2) {
    manifest = await prepareReleaseManifest({
      version,
      updater: path.join(target, "installer", `Locution Pro_${version}_x64-update.exe`),
      installer: path.join(
        target,
        "release",
        "bundle",
        "nsis",
        `Locution Pro_${version}_x64-setup.exe`,
      ),
      outputDirectory,
      repository,
    });
  } else {
    throw new Error("Usage: npm run prepare:release -- [--with-macos]");
  }
  console.log(
    `Release ${manifest.version}: ${Object.keys(manifest.platforms).join(", ")} installers, ${version.includes("-") ? "" : "latest.json and "}SHA256SUMS.txt ready in src-tauri/target/release-artifacts`,
  );
}
