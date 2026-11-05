import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CDN_BASE,
  RELEASE_PLATFORM,
  RELEASE_REPOSITORY,
  installerName,
  isReleaseVersion,
} from "../site/src/release-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function prepareReleaseManifest({
  version,
  installer,
  outputDirectory,
  repository = RELEASE_REPOSITORY,
  pubDate = new Date().toISOString(),
}) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  if (!/^[\w-]+\/[\w-][\w.-]*$/u.test(repository)) throw new Error("Invalid release repository");
  if (!Number.isFinite(Date.parse(pubDate))) throw new Error("Invalid publication date");
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
  const signature = hash.digest("hex");
  const name = installerName(version);
  const manifest = {
    version,
    pub_date: new Date(pubDate).toISOString(),
    platforms: {
      [RELEASE_PLATFORM]: {
        signature,
        url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
        cdn_url: `${CDN_BASE}/${name}`,
      },
    },
  };
  await mkdir(outputDirectory, { recursive: true });
  const destination = path.join(outputDirectory, name);
  if (path.resolve(installer) !== path.resolve(destination)) await copyFile(installer, destination);
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(outputDirectory, "latest.json"), json);
  const manifestHash = createHash("sha256").update(json).digest("hex");
  await writeFile(
    path.join(outputDirectory, "SHA256SUMS.txt"),
    `${signature}  ${name}\n${manifestHash}  latest.json\n`,
  );
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (process.argv.length > 2) throw new Error("Usage: npm run prepare:release");
  const manifest = await prepareReleaseManifest({
    version,
    installer: path.join(
      root,
      "src-tauri",
      "target",
      "release",
      "bundle",
      "nsis",
      `Locution Pro_${version}_x64-setup.exe`,
    ),
    outputDirectory: path.join(root, "dist", "release"),
    repository: process.env.GITHUB_REPOSITORY || RELEASE_REPOSITORY,
  });
  console.log(
    `Release ${manifest.version}: installer, latest.json and SHA256SUMS.txt ready in dist/release`,
  );
}
