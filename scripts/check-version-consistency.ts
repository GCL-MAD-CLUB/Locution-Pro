import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isReleaseVersion } from "../site/src/release-contract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PackageManifest {
  version: string;
}

interface LockfileManifest {
  version?: string;
  packages?: Record<string, { version?: string }>;
}

interface TauriManifest {
  version: string;
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function matchVersion(path: string, pattern: RegExp): string {
  const match = read(path).match(pattern);
  if (!match) {
    throw new Error(`Could not find a version in ${path}`);
  }
  return match[1];
}

const packageJson = readJson<PackageManifest>("package.json");
if (!isReleaseVersion(packageJson.version)) throw new Error("Invalid release semantic version");
const lockfile = readJson<LockfileManifest>("package-lock.json");
const versions = new Map<string, string | undefined>([
  ["package.json", packageJson.version],
  ["package-lock.json", lockfile.version],
  ["package-lock.json root package", lockfile.packages?.[""]?.version],
  [
    "src-tauri/Cargo.toml",
    matchVersion("src-tauri/Cargo.toml", /^\[package\][\s\S]*?^version = "([^"]+)"/m),
  ],
  [
    "src-tauri/Cargo.lock",
    matchVersion(
      "src-tauri/Cargo.lock",
      /^\[\[package\]\]\r?\nname = "locution-pro"\r?\nversion = "([^"]+)"/m,
    ),
  ],
  ["src-tauri/tauri.conf.json", readJson<TauriManifest>("src-tauri/tauri.conf.json").version],
]);

const mismatches = [...versions].filter(([, version]) => version !== packageJson.version);
if (mismatches.length > 0) {
  const details = [...versions].map(([path, version]) => `- ${path}: ${version}`).join("\n");
  throw new Error(`Release versions are inconsistent:\n${details}`);
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  const tag = process.env.GITHUB_REF_NAME ?? "";
  const tagVersion = tag.startsWith("v") ? tag.slice(1) : tag;
  if (tagVersion !== packageJson.version) {
    throw new Error(`Release tag ${tag} does not match manifest version ${packageJson.version}`);
  }
}

console.log(`All release manifests use version ${packageJson.version}`);
