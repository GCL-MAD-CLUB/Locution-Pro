import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { macosInstallerName, macosUpdaterName } from "../site/src/release-contract.js";
import { bundleInUpdate, reusableRoots } from "./prepare-installer-manifest.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface RunOptions {
  cwd: string;
  stdio: "inherit";
  env?: NodeJS.ProcessEnv;
}

export type RunCommand = (file: string, args: string[], options: RunOptions) => unknown;

export async function buildUpdateInstaller(
  repository = root,
  run: RunCommand = execFileSync,
): Promise<string> {
  const { version } = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as {
    version: string;
  };
  const tauri = join(repository, "src-tauri");
  const directory = join(tauri, "target/installer");
  await mkdir(directory, { recursive: true });
  const installer = join(tauri, `target/release/bundle/nsis/Locution Pro_${version}_x64-setup.exe`);
  // Bundle the same compiled application twice, preserving the full installer.
  const full = join(directory, `Locution Pro_${version}_x64-setup.exe`);
  await copyFile(installer, full);
  const template = join(directory, "update-installer.nsi");
  await writeFile(
    template,
    `!define LOCUTION_UPDATE_ONLY\n${await readFile(join(tauri, "windows/installer.nsi"), "utf8")}`,
  );
  const config = join(directory, "update-bundle.json");
  await writeFile(
    config,
    JSON.stringify({
      build: { beforeBundleCommand: null },
      bundle: { windows: { nsis: { template } } },
    }),
  );
  try {
    run(
      process.execPath,
      [
        join(repository, "node_modules/@tauri-apps/cli/tauri.js"),
        "bundle",
        "--ci",
        "--bundles",
        "nsis",
        "--config",
        config,
      ],
      { cwd: repository, stdio: "inherit" },
    );
    const update = join(directory, `Locution Pro_${version}_x64-update.exe`);
    await copyFile(installer, update);
    return update;
  } finally {
    const restored = `${installer}.restore`;
    await copyFile(full, restored);
    await rename(restored, installer);
  }
}

// Same limit as the desktop downloader (MAX_INSTALLER in backend/update.rs).
const maxUpdateBytes = 256 * 1024 * 1024;

function macosGroup(path: string): string {
  const parts = path.split("/");
  if (parts[1] === "MacOS" && ["ffmpeg", "ffprobe"].includes(parts[2])) return "ffmpeg";
  if (parts[1] === "Resources" && reusableRoots.includes(parts[2])) return parts[2];
  return "core";
}

async function bundleFiles(directory: string, base: string = directory): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await bundleFiles(path, base)));
    else if (entry.isFile()) files.push(relative(base, path).split(sep).join("/"));
    else throw new Error(`Unsupported bundle entry: ${path}`);
  }
  return files;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// The macOS update archive holds the application bundle without the files the
// Windows update installer also reuses, plus update-reuse.json listing their
// size and SHA-256. The desktop clones them from the installed bundle and
// verifies the assembled bundle against its code signature.
export async function buildMacosUpdate(
  repository = root,
  run: RunCommand = execFileSync,
): Promise<string> {
  const { version } = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as {
    version: string;
  };
  const bundle = join(repository, "src-tauri/target/release/bundle");
  const macos = join(bundle, "macos");
  const app = join(macos, "Locution Pro.app");
  const output = join(repository, "src-tauri/target/release-artifacts-macos");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const included: string[] = [];
  const reused: Array<{ path: string; size: number; sha256: string }> = [];
  for (const path of (await bundleFiles(app)).sort()) {
    if (bundleInUpdate(path, macosGroup(path))) {
      included.push(`Locution Pro.app/${path}`);
    } else {
      const file = join(app, path);
      reused.push({ path, size: (await lstat(file)).size, sha256: await sha256(file) });
    }
  }
  const reuse = join(macos, "update-reuse.json");
  const list = join(macos, "update-files.txt");
  const archive = join(output, macosUpdaterName(version));
  await writeFile(reuse, `${JSON.stringify({ version, files: reused }, null, 2)}\n`);
  await writeFile(list, `${[...included, "update-reuse.json"].join("\n")}\n`);
  try {
    // COPYFILE_DISABLE keeps AppleDouble files out of the archive.
    run("/usr/bin/tar", ["-czf", archive, "-C", macos, "-T", list], {
      cwd: repository,
      stdio: "inherit",
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
  } finally {
    await rm(reuse, { force: true });
    await rm(list, { force: true });
  }
  if ((await stat(archive)).size > maxUpdateBytes) {
    throw new Error("The macOS update archive exceeds the desktop download limit");
  }
  await copyFile(
    join(bundle, "dmg", `Locution Pro_${version}_aarch64.dmg`),
    join(output, macosInstallerName(version)),
  );
  return archive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform === "darwin") {
    console.log(`Prepared macOS update archive: ${await buildMacosUpdate()}`);
  } else {
    console.log(`Prepared update-only installer: ${await buildUpdateInstaller()}`);
  }
}
