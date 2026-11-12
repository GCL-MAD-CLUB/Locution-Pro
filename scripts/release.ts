import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareReleaseManifest } from "./prepare-release-manifest.ts";
import { buildUpdateInstaller } from "./build-update-installer.ts";
import { isReleaseVersion } from "../site/src/release-contract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseArtifacts = join(root, "src-tauri", "target", "release-artifacts");
const localReleaseSecret = join(root, "src-tauri", ".locution-pro-project-build-secret-v1.local");
const legacyReleaseSecret = join(root, "src-tauri", ".linecut-project-build-secret-v1.local");
const prettierCli = join(root, "node_modules", "prettier", "bin", "prettier.cjs");
const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const args = process.argv.slice(2);
const [version] = args;

if (!version || args.length !== 1) {
  throw new Error("Usage: npm run release:build -- <semver>");
}

if (!isReleaseVersion(version)) {
  throw new Error(`Invalid semantic version: ${version}`);
}

if (
  !process.env.LOCUTION_PRO_PROJECT_BUILD_SECRET_V1 &&
  !process.env.LINECUT_PROJECT_BUILD_SECRET_V1 &&
  !existsSync(localReleaseSecret) &&
  !existsSync(legacyReleaseSecret)
) {
  throw new Error(
    "Official release key is missing. Set LOCUTION_PRO_PROJECT_BUILD_SECRET_V1 or restore src-tauri/.locution-pro-project-build-secret-v1.local.",
  );
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function write(path: string, contents: string): void {
  writeFileSync(path, contents, "utf8");
}

function replaceVersion(path: string, pattern: RegExp): void {
  const contents = read(path);
  if (!pattern.test(contents)) {
    throw new Error(`Could not find the package version in ${path}`);
  }
  write(path, contents.replace(pattern, `$1"${version}"`));
}

function updateJsonVersion(path: string): void {
  const document = JSON.parse(read(path)) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  document.version = version;
  if (document.packages?.[""]) {
    document.packages[""].version = version;
  }
  write(path, `${JSON.stringify(document, null, 2)}\n`);
}

function run(command: string, commandArgs: string[]): void {
  execFileSync(command, commandArgs, { cwd: root, stdio: "inherit" });
}

updateJsonVersion(join(root, "package.json"));
updateJsonVersion(join(root, "package-lock.json"));
replaceVersion(join(root, "src-tauri", "Cargo.toml"), /(^\[package\][\s\S]*?^version = )"[^"]+"/m);
replaceVersion(
  join(root, "src-tauri", "Cargo.lock"),
  /(^\[\[package\]\]\r?\nname = "locution-pro"\r?\nversion = )"[^"]+"/m,
);
updateJsonVersion(join(root, "src-tauri", "tauri.conf.json"));

run(process.execPath, [
  prettierCli,
  "--write",
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
]);
run("cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml"]);
run(process.execPath, [join(root, "scripts", "check-version-consistency.ts")]);
run(process.execPath, [join(root, "scripts", "prepare-ffmpeg-assets.ts")]);
run(process.execPath, [join(root, "scripts", "build-thumbnail-provider.ts")]);
run(process.execPath, [tauriCli, "build", "--", "--locked"]);

const bundleDirectory = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const bundledInstaller = join(bundleDirectory, `Locution Pro_${version}_x64-setup.exe`);
if (!existsSync(bundledInstaller)) {
  throw new Error(`Build completed without the expected installer: ${bundledInstaller}`);
}

await prepareReleaseManifest({
  version,
  installer: bundledInstaller,
  updater: await buildUpdateInstaller(root),
  outputDirectory: releaseArtifacts,
});
console.log(
  `Release installers, ${version.includes("-") ? "" : "latest.json and "}SHA256SUMS.txt created in ${releaseArtifacts}`,
);
