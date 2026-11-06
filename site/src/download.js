import { isReleaseVersion } from "./release-contract.js";

export async function initReleaseDownload(document, fetcher = fetch) {
  try {
    const response = await fetcher("/api/release", {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) return;
    const release = await response.json();
    if (!isReleaseVersion(release.version, { stable: true })) return;
    document.querySelectorAll("[data-release-version]").forEach((label) => {
      label.textContent = `V${release.version} / WINDOWS`;
    });
  } catch {
    // The server download route independently resolves the release on click.
  }
}
