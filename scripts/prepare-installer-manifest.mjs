import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reusableRoots = ["transnetv2", "semantic-search", "storyboard-semantic"];

export async function prepareInstallerManifest(
  root = repository,
  target = "x86_64-pc-windows-msvc",
) {
  const tauri = join(root, "src-tauri");
  const config = JSON.parse(await readFile(join(tauri, "tauri.conf.json"), "utf8"));
  const files = [];
  const destinations = new Set();
  async function add(source, destination, group) {
    const path = destination.replaceAll("/", "\\");
    if (
      win32.isAbsolute(path) ||
      path.split("\\").some((part) => !part || part === "." || part === "..") ||
      /[\x00-\x1f<>:"|?*\[\]=]/u.test(path) ||
      path
        .split("\\")
        .some(
          (part) =>
            /[. ]$/u.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part),
        )
    )
      throw new Error(`Unsafe installer destination: ${destination}`);
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink()) throw new Error(`Linked bundle input: ${source}`);
    if (metadata.isDirectory()) {
      for (const child of (await readdir(source)).sort()) {
        await add(join(source, child), `${path}\\${child}`, group);
      }
      return;
    }
    if (!metadata.isFile()) throw new Error(`Unsupported bundle input: ${source}`);
    const key = path.toLowerCase();
    if (destinations.has(key)) throw new Error(`Duplicate installer destination: ${path}`);
    destinations.add(key);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    files.push({ path, size: metadata.size, sha256: hash.digest("hex"), group });
  }
  if (Array.isArray(config.bundle.resources)) {
    throw new Error("Installer hashing requires explicit resource destination mappings");
  }
  for (const [source, destination] of Object.entries(config.bundle.resources)) {
    const prefix = destination.replaceAll("/", "\\").split("\\")[0].toLowerCase();
    const group = reusableRoots.includes(prefix) ? prefix : "core";
    await add(resolve(tauri, source), destination, group);
  }
  for (const binary of config.bundle.externalBin) {
    const name = win32.basename(binary.replaceAll("/", "\\"));
    if (!["ffmpeg", "ffprobe"].includes(name)) {
      throw new Error(`Assign a cleanup policy before bundling ${binary}`);
    }
    await add(resolve(tauri, `${binary}-${target}.exe`), `${name}.exe`, "ffmpeg");
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const output = join(tauri, "target", "installer", "payload-manifest.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = await prepareInstallerManifest(repository, process.env.TAURI_ENV_TARGET_TRIPLE);
  console.log(`Prepared installer SHA-256 manifest: ${output}`);
}
