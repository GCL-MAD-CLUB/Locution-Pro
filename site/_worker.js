import {
  GITHUB_BASE,
  MACOS_PLATFORM,
  MANIFEST_URLS,
  RELEASE_PLATFORM,
  fallbackRelease,
  validateRelease,
} from "./src/release-contract.js";

const MANIFEST_TIMEOUT = 4000;
const DOWNLOAD_TIMEOUT = 12000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
// Each installer is recognised by its first two bytes. Tauri builds zlib-compressed
// (UDZO) disk images, whose data fork opens with a zlib stream header.
const installerHeaders = {
  [RELEASE_PLATFORM]: (first, second) => first === 0x4d && second === 0x5a,
  [MACOS_PLATFORM]: (first, second) => first === 0x78 && ((first << 8) | second) % 31 === 0,
};
const platformQueries = { windows: RELEASE_PLATFORM, macos: MACOS_PLATFORM };

export async function readLatestRelease(fetcher = fetch) {
  for (const url of MANIFEST_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "Locution-Pro-Downloads" },
        cache: "no-store",
      });
      if (!response.ok || !response.body) throw new Error("Manifest unavailable");
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_MANIFEST_BYTES) throw new Error("Manifest too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return validateRelease(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      controller.abort();
    } finally {
      clearTimeout(timer);
    }
  }
  return fallbackRelease();
}

export async function downloadRelease(request, release, fetcher = fetch) {
  const query = new URL(request.url).searchParams.get("platform") ?? "windows";
  if (!Object.hasOwn(platformQueries, query)) {
    return new Response("不支持的下载平台。", {
      status: 400,
      headers: { ...responseHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const key = platformQueries[query];
  const platform = release.platforms[key];
  // The fixed legacy fallback and Windows-only manifests carry no macOS installer.
  if (!platform) {
    return new Response(null, {
      status: 302,
      headers: { ...responseHeaders, Location: `${GITHUB_BASE}/latest` },
    });
  }
  for (const url of [platform.cdn_url, platform.url].filter(Boolean)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
    let upstream;
    let reader;
    try {
      const headers = new Headers({
        "User-Agent": "Locution-Pro-Downloads",
        "Accept-Encoding": "identity",
        Range: "bytes=0-1",
      });
      upstream = await fetcher(url, { headers, signal: controller.signal, cache: "no-store" });
      if (
        ![200, 206].includes(upstream.status) ||
        !upstream.body ||
        /(?:text\/|json|xml)/iu.test(upstream.headers.get("Content-Type") || "")
      ) {
        throw new Error("Installer unavailable");
      }
      reader = upstream.body.getReader();
      const prefix = new Uint8Array(2);
      let prefixLength = 0;
      while (prefixLength < prefix.length) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Empty or truncated installer");
        const bytes = chunk.value.subarray(0, prefix.length - prefixLength);
        prefix.set(bytes, prefixLength);
        prefixLength += bytes.byteLength;
      }
      if (!installerHeaders[key](prefix[0], prefix[1])) {
        throw new Error("Unexpected installer format");
      }
      // Probe only the installer header; the browser downloads directly from the chosen source.
      return new Response(null, { status: 302, headers: { ...responseHeaders, Location: url } });
    } catch {
      controller.abort();
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
      else await upstream?.body?.cancel().catch(() => {});
    }
  }
  return new Response("下载源暂时不可用，请稍后重试。", {
    status: 502,
    headers: { ...responseHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function handleRequest(request, env, fetcher = fetch) {
  const path = new URL(request.url).pathname;
  if (path !== "/api/release" && path !== "/api/download") return env.ASSETS.fetch(request);
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...responseHeaders, Allow: "GET, HEAD" } });
  }
  const release = await readLatestRelease(fetcher);
  const response =
    path === "/api/release"
      ? Response.json(release, { headers: responseHeaders })
      : await downloadRelease(request, release, fetcher);
  if (request.method !== "HEAD") return response;
  await response.body?.cancel();
  return new Response(null, { status: response.status, headers: response.headers });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
