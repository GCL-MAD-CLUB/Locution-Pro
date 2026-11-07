import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MACOS_PLATFORM,
  RELEASE_PLATFORM,
  RELEASE_REPOSITORY,
  installerName,
  macosInstallerName,
  macosUpdaterName,
  updaterName,
  validateRelease,
} from "../site/src/release-contract.js";
import { inspectAsset } from "./prepare-release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function checkReleaseAssets({ directory, version, repository }) {
  const name = installerName(version);
  const updateName = updaterName(version);
  const macosNames = [macosInstallerName(version), macosUpdaterName(version)];
  const entries = await readdir(directory);
  const extras = entries.filter(
    (entry) => ![name, updateName, "latest.json", "SHA256SUMS.txt"].includes(entry),
  );
  const macos = extras.length > 0;
  const names = [name, updateName, ...(macos ? macosNames : []), "latest.json", "SHA256SUMS.txt"];
  if (
    entries.length !== names.length ||
    names.some((entry) => !entries.includes(entry)) ||
    (macos && macosNames.some((entry) => !extras.includes(entry)))
  ) {
    throw new Error(
      "Release artifacts must contain exactly the full installer, update installer, latest.json and SHA256SUMS.txt, plus both macOS files when present",
    );
  }
  const sizes = new Map();
  for (const entry of names) {
    const metadata = await lstat(path.join(directory, entry));
    if (!metadata.isFile() || metadata.size === 0)
      throw new Error(`Invalid release file: ${entry}`);
    sizes.set(entry, metadata.size);
  }
  if (sizes.get("latest.json") > 65536 || sizes.get("SHA256SUMS.txt") > 1024) {
    throw new Error("Release metadata is too large");
  }
  const manifest = validateRelease(
    JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8")),
    { stable: false, repository },
  );
  if (
    manifest.version !== version ||
    manifest.platforms[RELEASE_PLATFORM].url !==
      `https://github.com/${repository}/releases/download/v${version}/${name}` ||
    manifest.platforms[RELEASE_PLATFORM].updater?.url !==
      `https://github.com/${repository}/releases/download/v${version}/${updateName}`
  ) {
    throw new Error("Release manifest does not match the expected version and repository");
  }
  if (macos !== Boolean(manifest.platforms[MACOS_PLATFORM])) {
    throw new Error("Release manifest and artifacts disagree on the macOS build");
  }
  const lines = (await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8"))
    .trim()
    .split(/\r?\n/u);
  const checksums = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (
      !match ||
      checksums.has(match[2]) ||
      !names.includes(match[2]) ||
      match[2] === "SHA256SUMS.txt"
    ) {
      throw new Error("Invalid release checksum manifest");
    }
    checksums.set(match[2], match[1]);
  }
  if (checksums.size !== names.length - 1) throw new Error("Missing release checksums");
  const formats = {
    [name]: "exe",
    [updateName]: "exe",
    [macosNames[0]]: "dmg",
    [macosNames[1]]: "gzip",
  };
  const files = [];
  for (const entry of names) {
    let sha256;
    if (formats[entry]) {
      sha256 = await inspectAsset(path.join(directory, entry), formats[entry]);
    } else {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path.join(directory, entry))) hash.update(chunk);
      sha256 = hash.digest("hex");
    }
    if (checksums.has(entry) && sha256 !== checksums.get(entry)) {
      throw new Error(`Release checksum mismatch: ${entry}`);
    }
    if (entry === name && sha256 !== manifest.platforms[RELEASE_PLATFORM].signature) {
      throw new Error("Installer checksum does not match latest.json");
    }
    if (entry === updateName && sha256 !== manifest.platforms[RELEASE_PLATFORM].updater.signature) {
      throw new Error("Update installer checksum does not match latest.json");
    }
    if (entry === macosNames[0] && sha256 !== manifest.platforms[MACOS_PLATFORM].signature) {
      throw new Error("macOS disk image checksum does not match latest.json");
    }
    if (
      entry === macosNames[1] &&
      sha256 !== manifest.platforms[MACOS_PLATFORM].updater?.signature
    ) {
      throw new Error("macOS update archive checksum does not match latest.json");
    }
    files.push({ name: entry, size: sizes.get(entry), sha256, path: path.join(directory, entry) });
  }
  return { manifest, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  await checkReleaseAssets({
    directory: path.join(root, "src-tauri", "target", "release-artifacts"),
    version,
    repository: process.env.GITHUB_REPOSITORY || RELEASE_REPOSITORY,
  });
  console.log("Release artifact names, version, repository and SHA-256 checks passed");
}
