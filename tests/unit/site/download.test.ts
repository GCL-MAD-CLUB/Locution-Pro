import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  downloadRelease as downloadReleaseJs,
  handleRequest as handleRequestJs,
  readLatestRelease as readLatestReleaseJs,
} from "../../../site/_worker.js";
import { initReleaseDownload as initReleaseDownloadJs } from "../../../site/src/download.js";
import {
  CDN_BASE,
  GITHUB_BASE,
  MANIFEST_URLS,
  RELEASE_PLATFORM,
  fallbackRelease,
  validateRelease as validateReleaseJs,
} from "../../../site/src/release-contract.js";

type FetchTarget = string | URL | Request;
type Fetcher = (url: FetchTarget, init?: RequestInit) => Promise<Response>;

interface ReleasePlatform {
  signature: string;
  url: string;
  cdn_url: string;
}

interface ReleaseDocument {
  version: string;
  pub_date: string;
  platforms: Record<string, ReleasePlatform>;
}

interface ReleaseManifest {
  version: string;
  platforms: Record<string, { url: string }>;
}

interface VersionLabel {
  textContent: string | null;
}

interface VersionLabelDocument {
  querySelectorAll(selector: string): VersionLabel[];
}

interface WorkerAssets {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnvironment {
  ASSETS?: WorkerAssets;
}

type WorkerFetch = (
  request: Request,
  environment: WorkerEnvironment,
  context?: unknown,
) => Promise<Response>;

const readLatestRelease = readLatestReleaseJs as (fetcher?: Fetcher) => Promise<ReleaseManifest>;
const downloadRelease = downloadReleaseJs as (
  request: Request,
  release: ReleaseDocument,
  fetcher?: Fetcher,
) => Promise<Response>;
const handleRequest = handleRequestJs as (
  request: Request,
  environment: WorkerEnvironment,
  fetcher?: Fetcher,
) => Promise<Response>;
const initReleaseDownload = initReleaseDownloadJs as (
  document: VersionLabelDocument,
  fetcher?: Fetcher,
) => Promise<void>;
const validateRelease = validateReleaseJs as (document: ReleaseDocument) => ReleaseDocument;
const workerFetch = worker.fetch as WorkerFetch;

function release(): ReleaseDocument {
  return {
    version: "2.1.1",
    pub_date: "2026-10-05T16:40:45Z",
    platforms: {
      [RELEASE_PLATFORM]: {
        signature: "a".repeat(64),
        url: `${GITHUB_BASE}/download/v2.1.1/Locution.Pro_2.1.1_x64-setup.exe`,
        cdn_url: `${CDN_BASE}/Locution.Pro_2.1.1_x64-setup.exe`,
      },
    },
  };
}

function request(headers?: HeadersInit): Request {
  return new Request("https://locution.dpdns.org/api/download", { headers });
}

function binary(
  body: string | ReadableStream<Uint8Array> = "MZ installer",
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  return new Response(body, { ...init, headers });
}

function sentHeaders(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

test("CDN manifest takes priority and never fetches GitHub after success", async () => {
  const calls: FetchTarget[] = [];
  const manifest = await readLatestRelease(async (url) => {
    calls.push(url);
    return Response.json(release());
  });
  assert.deepEqual(calls, [MANIFEST_URLS[0]]);
  assert.equal(manifest.version, "2.1.1");
});

for (const failure of [
  "http",
  "network",
  "html",
  "invalid",
  "oversize",
  "prerelease",
  "wrong-platform",
]) {
  test(`invalid CDN manifest (${failure}) falls back to the GitHub manifest`, async () => {
    const calls: FetchTarget[] = [];
    const manifest = await readLatestRelease(async (url) => {
      calls.push(url);
      if (calls.length > 1) return Response.json(release());
      if (failure === "network") throw new Error("offline");
      if (failure === "http") return new Response(null, { status: 500 });
      if (failure === "html") return new Response("<html>login</html>");
      if (failure === "invalid") return Response.json({ version: "2.1.1" });
      if (failure === "oversize") return new Response(" ".repeat(65537));
      const document = release();
      if (failure === "prerelease") document.version = "2.1.1-rc.1";
      else document.platforms = { "windows-x86_64-nsis": document.platforms[RELEASE_PLATFORM] };
      return Response.json(document);
    });
    assert.deepEqual(calls, MANIFEST_URLS);
    assert.equal(manifest.version, "2.1.1");
  });
}

test("unavailable manifests use the fixed 0.4.1 GitHub URL", async () => {
  const manifest = await readLatestRelease(async () => new Response(null, { status: 404 }));
  assert.deepEqual(manifest, fallbackRelease());
  assert.equal(manifest.version, "0.4.1");
  assert.match(
    manifest.platforms[RELEASE_PLATFORM].url,
    /\/download\/v0\.4\.1\/Locution\.Pro_0\.4\.1_x64-setup\.exe$/u,
  );
});

test("a stalled CDN manifest times out and continues to GitHub", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: FetchTarget[] = [];
  const pending = readLatestRelease(async (url, init) => {
    calls.push(url);
    if (calls.length > 1) return Response.json(release());
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true }),
    );
  });
  t.mock.timers.tick(4001);
  assert.equal((await pending).version, "2.1.1");
  assert.deepEqual(calls, MANIFEST_URLS);
});

test("manifest validation rejects unrelated hosts, credentials, paths and version mismatches", () => {
  for (const url of [
    "https://evil.example/installer.exe",
    `${GITHUB_BASE}/latest/download/setup.exe`,
    `${GITHUB_BASE}/download/v2.1.0/Locution.Pro_2.1.0_x64-setup.exe`,
  ]) {
    const document = release();
    document.platforms[RELEASE_PLATFORM].url = url;
    assert.throws(() => validateRelease(document), /GitHub/u);
  }
  const document = release();
  document.platforms[RELEASE_PLATFORM].cdn_url = "https://user:pass@openlist.frameneo.com/file.exe";
  assert.throws(() => validateRelease(document), /CDN/u);
  document.platforms[RELEASE_PLATFORM].cdn_url = "";
  assert.equal(validateRelease(document).platforms[RELEASE_PLATFORM].cdn_url, "");
});

test("CDN probe redirects the browser without forwarding the installer", async () => {
  const calls: FetchTarget[] = [];
  const response = await downloadRelease(request(), release(), async (url, init) => {
    calls.push(url);
    assert.equal(sentHeaders(init).get("Range"), "bytes=0-1");
    return binary("MZ", { status: 206 });
  });
  assert.deepEqual(calls, [release().platforms[RELEASE_PLATFORM].cdn_url]);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), release().platforms[RELEASE_PLATFORM].cdn_url);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.body, null);
});

for (const failure of [
  "http",
  "network",
  "html",
  "mislabelled-html",
  "partial-html",
  "empty",
  "truncated",
  "stream",
]) {
  test(`CDN probe failure (${failure}) redirects to the same release on GitHub`, async () => {
    const calls: FetchTarget[] = [];
    const response = await downloadRelease(request(), release(), async (url) => {
      calls.push(url);
      if (calls.length > 1) return binary();
      if (failure === "http") return new Response(null, { status: 404 });
      if (failure === "network") throw new Error("offline");
      if (failure === "html")
        return new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } });
      if (failure === "empty") return binary("");
      if (failure === "truncated") return binary("M");
      if (failure === "mislabelled-html") return binary("<html>error</html>");
      if (failure === "partial-html") return binary("<html>error</html>", { status: 206 });
      return binary(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.error(new Error("connection lost"));
          },
        }),
      );
    });
    assert.deepEqual(calls, [
      release().platforms[RELEASE_PLATFORM].cdn_url,
      release().platforms[RELEASE_PLATFORM].url,
    ]);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), release().platforms[RELEASE_PLATFORM].url);
    assert.equal(response.body, null);
  });
}

test("empty CDN URL redirects to GitHub; two failed sources return 502", async () => {
  const document = release();
  document.platforms[RELEASE_PLATFORM].cdn_url = "";
  const response = await downloadRelease(request(), document, async (url) => {
    assert.equal(url, document.platforms[RELEASE_PLATFORM].url);
    return binary();
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), document.platforms[RELEASE_PLATFORM].url);
  const failed = await downloadRelease(
    request(),
    release(),
    async () => new Response(null, { status: 503 }),
  );
  assert.equal(failed.status, 502);
});

test("download probes ignore client ranges and credentials", async () => {
  const etag = `"sha256-${"a".repeat(64)}"`;
  for (const ifRange of [etag, '"older-release"']) {
    const response = await downloadRelease(
      request({
        Range: "bytes=4-",
        "If-Range": ifRange,
        Cookie: "secret",
        Authorization: "secret",
      }),
      release(),
      async (_url, init) => {
        assert.equal(sentHeaders(init).get("Range"), "bytes=0-1");
        assert.equal(sentHeaders(init).get("If-Range"), null);
        assert.equal(sentHeaders(init).get("Cookie"), null);
        assert.equal(sentHeaders(init).get("Authorization"), null);
        return binary();
      },
    );
    assert.equal(response.headers.get("ETag"), null);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), release().platforms[RELEASE_PLATFORM].cdn_url);
  }
});

test("the successful probe cancels its upstream without reading the remaining installer", async () => {
  let reads = 0;
  let cancelled = false;
  const response = await downloadRelease(request(), release(), async () =>
    binary(
      new ReadableStream<Uint8Array>(
        {
          pull(stream) {
            reads++;
            assert.equal(reads, 1, "the worker must not read the installer body");
            stream.enqueue(new Uint8Array([0x4d, 0x5a]));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    ),
  );
  assert.equal(response.status, 302);
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
});

test("a stalled CDN probe times out and redirects to GitHub", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: FetchTarget[] = [];
  const pending = downloadRelease(request(), release(), async (url, init) => {
    calls.push(url);
    if (calls.length > 1) return binary();
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true }),
    );
  });
  t.mock.timers.tick(12001);
  const response = await pending;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), release().platforms[RELEASE_PLATFORM].url);
  assert.deepEqual(calls, [
    release().platforms[RELEASE_PLATFORM].cdn_url,
    release().platforms[RELEASE_PLATFORM].url,
  ]);
});

test("HEAD download requests expose the direct location without an installer body", async () => {
  const response = await handleRequest(
    new Request("https://site/api/download", { method: "HEAD" }),
    {},
    async (url) => (String(url).endsWith("latest.json") ? Response.json(release()) : binary()),
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), release().platforms[RELEASE_PLATFORM].cdn_url);
  assert.equal(response.body, null);
});

test("API serves release JSON, rejects mutation methods and keeps static assets on Pages", async () => {
  const fetcher = async () => Response.json(release());
  const response = await handleRequest(new Request("https://site/api/release"), {}, fetcher);
  assert.equal((await response.json()).version, "2.1.1");
  const head = await handleRequest(
    new Request("https://site/api/release", { method: "HEAD" }),
    {},
    fetcher,
  );
  assert.equal(await head.text(), "");
  const denied = await handleRequest(
    new Request("https://site/api/download", { method: "POST" }),
    {},
    () => assert.fail(),
  );
  assert.equal(denied.status, 405);
  const response404 = await workerFetch(
    new Request("https://site/missing"),
    { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } },
    {},
  );
  assert.equal(response404.status, 404);
});

test("unavailable manifests download 0.4.1 from GitHub without the retired CDN file", async () => {
  const calls: FetchTarget[] = [];
  const response = await handleRequest(request(), {}, async (url) => {
    calls.push(url);
    if (String(url).endsWith("latest.json")) return new Response(null, { status: 404 });
    assert.equal(url, `${GITHUB_BASE}/download/v0.4.1/Locution.Pro_0.4.1_x64-setup.exe`);
    return binary();
  });
  assert.deepEqual(calls, [...MANIFEST_URLS, fallbackRelease().platforms[RELEASE_PLATFORM].url]);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), fallbackRelease().platforms[RELEASE_PLATFORM].url);
  assert.equal(response.body, null);
});

test("website version label follows the manifest and preserves 0.4.1 when offline", async () => {
  const label = { textContent: "V0.4.1 / WINDOWS" };
  const document = { querySelectorAll: () => [label] };
  await initReleaseDownload(document, async () => {
    throw new Error("offline");
  });
  assert.equal(label.textContent, "V0.4.1 / WINDOWS");
  await initReleaseDownload(document, async () => Response.json(release()));
  assert.equal(label.textContent, "V2.1.1 / WINDOWS");
});
