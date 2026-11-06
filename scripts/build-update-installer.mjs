import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildUpdateInstaller(repository = root, run = execFileSync) {
  const { version } = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Prepared update-only installer: ${await buildUpdateInstaller()}`);
}
