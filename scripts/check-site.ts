import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK_VERSION } from "../site/src/release-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "index.html",
  "404.html",
  "_headers",
  "_redirects",
  "robots.txt",
  "_worker.js",
  "_routes.json",
];
const apiRoutes = new Set(["/api/release", "/api/download"]);

interface SiteRoutes {
  version?: number;
  include?: string[];
  exclude?: string[];
}

// Only these public trees and entry points belong in the deployment.
export async function siteFiles(siteRoot: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relativePath: string): Promise<void> {
    const metadata = await lstat(path.join(siteRoot, relativePath));
    if (metadata.isSymbolicLink())
      throw new Error(`${relativePath}: symbolic links are not allowed`);
    if (metadata.isDirectory()) {
      for (const entry of (await readdir(path.join(siteRoot, relativePath))).sort()) {
        await visit(`${relativePath}/${entry}`);
      }
    } else if (metadata.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`${relativePath}: expected a regular file`);
    }
  }
  for (const entry of [...requiredFiles, "src", "assets"]) await visit(entry);
  return files;
}

export async function checkSite(siteRoot: string): Promise<string[]> {
  const errors: string[] = [];
  let files: string[];
  try {
    files = await siteFiles(siteRoot);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const published = new Set(files);
  try {
    const routes = JSON.parse(
      await readFile(path.join(siteRoot, "_routes.json"), "utf8"),
    ) as SiteRoutes;
    if (
      routes.version !== 1 ||
      !Array.isArray(routes.include) ||
      routes.include.length !== apiRoutes.size ||
      routes.include.some((route) => !apiRoutes.has(route)) ||
      new Set(routes.include).size !== apiRoutes.size ||
      !Array.isArray(routes.exclude) ||
      routes.exclude.length
    ) {
      errors.push("_routes.json: only the release and download API routes may invoke the Worker");
    }
  } catch {
    errors.push("_routes.json: invalid routing JSON");
  }
  const documents = new Map<string, string>();
  const ids = new Map<string, Set<string>>();
  for (const file of files.filter((name) => /\.(?:html|css|js|svg)$/u.test(name))) {
    const source = await readFile(path.join(siteRoot, file), "utf8");
    documents.set(file, source);
    if (!file.endsWith(".html")) continue;
    const documentIds = new Set<string>();
    for (const [, id] of source.matchAll(/\bid="([^"]+)"/gu)) {
      if (documentIds.has(id)) errors.push(`${file}: duplicate id: ${id}`);
      documentIds.add(id);
    }
    ids.set(file, documentIds);
  }

  const fallbackLabel = documents
    .get("index.html")
    ?.match(/data-release-version>\s*V([^<]+)\/ WINDOWS/u)?.[1]
    ?.trim();
  if (fallbackLabel !== FALLBACK_VERSION)
    errors.push("index.html: fallback release version does not match the download contract");

  function assertReference(file: string, reference: string): void {
    if (apiRoutes.has(reference)) return;
    if (/^(?:https?:|mailto:|tel:|data:|\/\/)/iu.test(reference)) return;
    if (/^[\w+.-]+:/u.test(reference) || reference.includes("\\")) {
      errors.push(`${file}: unsupported reference: ${reference}`);
      return;
    }
    let target: string;
    let fragment: string;
    try {
      const [pathname, hash] = reference.split("#");
      target = decodeURIComponent(pathname.split("?")[0]);
      fragment = hash ? decodeURIComponent(hash) : "";
    } catch {
      errors.push(`${file}: invalid URL encoding: ${reference}`);
      return;
    }
    let resolved = path.join(siteRoot, file);
    if (target) {
      resolved = target.startsWith("/")
        ? path.resolve(siteRoot, `.${target}`)
        : path.resolve(siteRoot, path.dirname(file), target);
    }
    const relative = path.relative(siteRoot, resolved).split(path.sep).join("/");
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
      errors.push(`${file}: local reference escapes site/: ${reference}`);
      return;
    }
    const destination = relative === "" ? "index.html" : relative;
    if (!published.has(destination)) {
      errors.push(`${file}: referenced public file does not exist: ${reference}`);
    } else if (fragment && ids.has(destination) && !ids.get(destination)?.has(fragment)) {
      errors.push(`${file}: fragment does not exist: ${reference}`);
    }
  }

  for (const [file, source] of documents) {
    if (/\.(?:html|svg)$/u.test(file)) {
      for (const [, reference] of source.matchAll(/\b(?:href|src)="([^"]+)"/gu)) {
        assertReference(file, reference);
      }
    }
    if (file.endsWith(".html")) {
      for (const [, reference] of source.matchAll(/property="og:image"\s+content="([^"]+)"/gu)) {
        assertReference(file, reference);
      }
      for (const [, references] of source.matchAll(
        /\baria-(?:labelledby|describedby)="([^"]+)"/gu,
      )) {
        for (const id of references.split(/\s+/u)) assertReference(file, `#${id}`);
      }
    }
    if (file.endsWith(".css")) {
      for (const [, reference] of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gu)) {
        assertReference(file, reference);
      }
    }
    if (file === "src/main.js") {
      for (const [, image] of source.matchAll(/\bimage:\s*"([^"]+)"/gu)) {
        assertReference("index.html", `./assets/${image}`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await checkSite(path.resolve(root, process.argv[2] ?? "site"));
  if (errors.length > 0) {
    console.error(`Site check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Site HTML, CSS, demo assets, anchors and deployment files check passed.");
  }
}
