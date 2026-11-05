import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, normalizeSiteUrl } from "../../../scripts/build-site.mjs";
import { checkSite } from "../../../scripts/check-site.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "locution-site-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert(path.basename(root).startsWith("locution-site-"));
    await rm(root, { recursive: true, force: true });
  });
  await cp(new URL("../../../site/", import.meta.url), path.join(root, "site"), {
    recursive: true,
  });
  return root;
}

test("site package excludes maintenance files and preserves the desktop build", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "dist", "site"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.html"), "desktop app");
  await writeFile(path.join(root, "dist", "site", "obsolete.html"), "old release");
  await writeFile(path.join(root, "site", ".env"), "not public");
  const output = await buildSite({ root, siteUrl: "https://locution.dpdns.org" });
  assert.deepEqual(await checkSite(output), []);
  assert.equal(await readFile(path.join(root, "dist", "index.html"), "utf8"), "desktop app");
  for (const file of ["README.md", "brand-spec.md", ".env", "obsolete.html"]) {
    await assert.rejects(readFile(path.join(output, file)), { code: "ENOENT" });
  }
  assert.match(
    await readFile(path.join(output, "assets", "FONT-LICENSE.txt"), "utf8"),
    /license/iu,
  );
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /rel="canonical" href="https:\/\/locution\.dpdns\.org\/"/u);
  assert.match(html, /property="og:image" content="https:\/\/locution\.dpdns\.org\/assets\//u);
  assert.match(
    await readFile(path.join(output, "robots.txt"), "utf8"),
    /Sitemap: https:\/\/locution\.dpdns\.org\/sitemap\.xml/u,
  );
  assert.match(
    await readFile(path.join(output, "sitemap.xml"), "utf8"),
    /<loc>https:\/\/locution\.dpdns\.org\/<\/loc>/u,
  );
});

test("rebuilding without an origin removes old canonical URLs and sitemap", async (t) => {
  const root = await fixture(t);
  await buildSite({ root, siteUrl: "https://old.example.com" });
  const output = await buildSite({ root, siteUrl: "" });
  await assert.rejects(readFile(path.join(output, "sitemap.xml")), { code: "ENOENT" });
  assert.doesNotMatch(
    await readFile(path.join(output, "index.html"), "utf8"),
    /rel="canonical"|old\.example/u,
  );
  assert.doesNotMatch(await readFile(path.join(output, "robots.txt"), "utf8"), /Sitemap:/u);
});

test("failed validation preserves the last good package", async (t) => {
  const root = await fixture(t);
  const output = await buildSite({ root, siteUrl: "https://example.com" });
  const lastGoodHtml = await readFile(path.join(output, "index.html"), "utf8");
  await rm(path.join(root, "site", "assets", "official-shot-city.webp"));
  await assert.rejects(buildSite({ root }), /official-shot-city\.webp/u);
  assert.equal(await readFile(path.join(output, "index.html"), "utf8"), lastGoodHtml);
});

test("site checker catches missing anchors, CSS fonts, demo images and unpublished documents", async (t) => {
  const root = await fixture(t);
  const site = path.join(root, "site");
  await writeFile(
    path.join(site, "src", "style.css"),
    '@font-face { src: url("../assets/missing.woff2"); }',
  );
  await writeFile(path.join(site, "src", "main.js"), 'const examples = { image: "missing.webp" };');
  const index = path.join(site, "index.html");
  await writeFile(
    index,
    `${await readFile(index, "utf8")}<a href="#missing">Missing</a><a href="README.md">Private</a>`,
  );
  const errors = (await checkSite(site)).join("\n");
  for (const reference of ["missing.woff2", "missing.webp", "#missing", "README.md"]) {
    assert(errors.includes(reference), errors);
  }
});

test("site checker rejects escaped paths, invalid encoding and unsafe URL schemes", async (t) => {
  const root = await fixture(t);
  const site = path.join(root, "site");
  const index = path.join(site, "index.html");
  await writeFile(
    index,
    `${await readFile(index, "utf8")}<a href="../outside.html">A</a><a href="%2e%2e/outside.html">B</a><a href="%zz">C</a><a href="javascript:alert(1)">D</a>`,
  );
  const errors = (await checkSite(site)).join("\n");
  assert.match(errors, /escapes site\//u);
  assert.match(errors, /invalid URL encoding/u);
  assert.match(errors, /unsupported reference/u);
});

test("site checker rejects duplicate IDs and missing accessibility targets", async (t) => {
  const root = await fixture(t);
  const site = path.join(root, "site");
  const index = path.join(site, "index.html");
  await writeFile(
    index,
    `${await readFile(index, "utf8")}<div id="features" aria-labelledby="missing-label"></div>`,
  );
  const errors = (await checkSite(site)).join("\n");
  assert.match(errors, /duplicate id: features/u);
  assert.match(errors, /missing-label/u);
});

test("site checker requires the real Cloudflare 404 entry point", async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, "site", "404.html"));
  assert.match((await checkSite(path.join(root, "site"))).join("\n"), /404\.html/u);
});

test("site origins are normalized and reject non-origin URLs", () => {
  assert.equal(normalizeSiteUrl(" https://Example.com/ "), "https://example.com");
  assert.equal(normalizeSiteUrl(""), null);
  for (const value of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/docs",
    "https://example.com/?query=1",
    "https://example.com/#anchor",
    "invalid",
  ]) {
    assert.throws(() => normalizeSiteUrl(value));
  }
});

test("every former guide page has a permanent redirect to the new help domain", async () => {
  const rules = (await readFile(new URL("../../../site/_redirects", import.meta.url), "utf8"))
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.split(/\s+/u));
  const pages = await readdir(new URL("../../../docs/user-guide/", import.meta.url), {
    recursive: true,
  });
  for (const file of pages) {
    const relative = file.split(path.sep).join("/");
    if (!relative.endsWith(".md") || relative.startsWith(".") || !relative.includes("/")) continue;
    const [directory] = relative.split("/");
    const rule = rules.find(([source]) => source === `/${directory}/*`);
    assert(rule, `Missing legacy guide redirect for ${relative}`);
    assert.equal(rule[1], `https://helpx.locution.dpdns.org/${directory}/:splat`);
    assert.equal(rule[2], "301");
  }
});
