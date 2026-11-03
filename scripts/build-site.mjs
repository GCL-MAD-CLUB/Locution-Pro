import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSite, siteFiles } from "./check-site.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizeSiteUrl(value) {
  if (!value?.trim()) return null;
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("SITE_URL must be an HTTPS origin, for example https://www.example.com");
  }
  return url.origin;
}

export async function buildSite({
  root = repositoryRoot,
  siteUrl = process.env.SITE_URL || "https://locution.dpdns.org",
} = {}) {
  const origin = normalizeSiteUrl(siteUrl);
  const source = path.join(root, "site");
  const errors = await checkSite(source);
  if (errors.length) throw new Error(`Site check failed:\n${errors.join("\n")}`);

  const output = path.resolve(root, "dist", "site");
  const staging = path.resolve(root, "dist", "site-staging");
  // Never clean the desktop app's dist/ or another checkout's output.
  for (const directory of [output, staging]) {
    if (path.dirname(directory) !== path.resolve(root, "dist")) {
      throw new Error(`Refusing to replace unexpected output directory: ${directory}`);
    }
  }
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const file of await siteFiles(source)) {
      const target = path.join(staging, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(source, file), target);
    }
    if (origin) {
      const indexPath = path.join(staging, "index.html");
      const html = (await readFile(indexPath, "utf8"))
        .replace(
          'content="./assets/locution-app-workspace-light.webp"',
          `content="${origin}/assets/locution-app-workspace-light.webp"`,
        )
        .replace(
          "  </head>",
          `    <link rel="canonical" href="${origin}/" />\n    <meta property="og:url" content="${origin}/" />\n  </head>`,
        );
      await writeFile(indexPath, html);
      await writeFile(
        path.join(staging, "robots.txt"),
        `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
      );
      await writeFile(
        path.join(staging, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`,
      );
    }
    const outputErrors = await checkSite(staging);
    if (outputErrors.length)
      throw new Error(`Built site check failed:\n${outputErrors.join("\n")}`);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Site ready: ${await buildSite()}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
