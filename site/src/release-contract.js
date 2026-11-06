export const RELEASE_REPOSITORY = "GCL-MAD-CLUB/Locution-Pro";
export const RELEASE_PLATFORM = "windows-x86_64";
export const MACOS_PLATFORM = "darwin-aarch64";
export const CDN_BASE = "https://openlist.frameneo.com/sd/YRrdPxj2";
export const GITHUB_BASE = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const MANIFEST_URLS = [
  `${CDN_BASE}/latest.json`,
  `${GITHUB_BASE}/latest/download/latest.json`,
];
export const FALLBACK_VERSION = "0.4.1";

export function isReleaseRepository(repository) {
  return typeof repository === "string" && /^[\w-]+\/[\w-][\w.-]*$/u.test(repository);
}

export function isReleaseVersion(version, { stable = false } = {}) {
  if (typeof version !== "string") return false;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      version,
    );
  return Boolean(
    match && (!stable || !match[4]) && !match[4]?.split(".").some((part) => /^0\d+$/u.test(part)),
  );
}

export function installerName(version) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  return `Locution.Pro_${version}_x64-setup.exe`;
}

export function updaterName(version) {
  return installerName(version).replace("-setup.exe", "-update.exe");
}

export function macosInstallerName(version) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  return `Locution.Pro_${version}_aarch64.dmg`;
}

export function macosUpdaterName(version) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  return `Locution.Pro_${version}_aarch64-update.tar.gz`;
}

const platformNames = {
  [RELEASE_PLATFORM]: [installerName, updaterName],
  [MACOS_PLATFORM]: [macosInstallerName, macosUpdaterName],
};

function validatePlatform(platform, version, repository, [full, update]) {
  const name = full(version);
  if (
    !platform ||
    !/^[a-f0-9]{64}$/iu.test(platform.signature) ||
    platform.url !== `https://github.com/${repository}/releases/download/v${version}/${name}`
  ) {
    throw new Error("Invalid platform installer metadata");
  }
  if (platform.cdn_url && platform.cdn_url !== `${CDN_BASE}/${name}`) {
    throw new Error("Invalid CDN installer URL");
  }
  let updater;
  if (platform.updater !== undefined) {
    const candidate = platform.updater;
    const name = update(version);
    if (
      !candidate ||
      !/^[a-f0-9]{64}$/iu.test(candidate.signature) ||
      candidate.url !== `https://github.com/${repository}/releases/download/v${version}/${name}` ||
      (candidate.cdn_url && candidate.cdn_url !== `${CDN_BASE}/${name}`)
    ) {
      throw new Error("Invalid update-only installer metadata");
    }
    updater = {
      signature: candidate.signature.toLowerCase(),
      url: candidate.url,
      cdn_url: candidate.cdn_url || "",
    };
  }
  return {
    signature: platform.signature.toLowerCase(),
    url: platform.url,
    cdn_url: platform.cdn_url || "",
    ...(updater ? { updater } : {}),
  };
}

export function fallbackRelease() {
  // A fixed legacy download locator, not an auto-update manifest with a digest.
  const name = installerName(FALLBACK_VERSION);
  return {
    version: FALLBACK_VERSION,
    platforms: {
      [RELEASE_PLATFORM]: {
        url: `${GITHUB_BASE}/download/v${FALLBACK_VERSION}/${name}`,
      },
    },
  };
}

// Restrict the download gateway to this product's immutable installer URLs.
export function validateRelease(
  document,
  { stable = true, repository: expectedRepository = RELEASE_REPOSITORY } = {},
) {
  if (!document || !isReleaseVersion(document.version, { stable })) {
    throw new Error(stable ? "Expected a stable release version" : "Invalid release version");
  }
  if (typeof document.pub_date !== "string" || !Number.isFinite(Date.parse(document.pub_date))) {
    throw new Error("Invalid release publication date");
  }
  const platform = document.platforms?.[RELEASE_PLATFORM];
  const name = installerName(document.version);
  if (!platform || !/^[a-f0-9]{64}$/iu.test(platform.signature)) {
    throw new Error("Missing installer SHA-256");
  }
  const repository =
    typeof platform.url === "string"
      ? /^https:\/\/github\.com\/([\w-]+\/[\w-][\w.-]*)\/releases\/download\//u.exec(
          platform.url,
        )?.[1]
      : null;
  if (
    !repository ||
    repository !== expectedRepository ||
    platform.url !==
      `https://github.com/${repository}/releases/download/v${document.version}/${name}`
  ) {
    throw new Error("Invalid GitHub installer URL");
  }
  const platforms = {
    [RELEASE_PLATFORM]: validatePlatform(
      platform,
      document.version,
      repository,
      platformNames[RELEASE_PLATFORM],
    ),
  };
  // macOS is optional so that Windows-only manifests stay valid.
  if (document.platforms[MACOS_PLATFORM] !== undefined) {
    platforms[MACOS_PLATFORM] = validatePlatform(
      document.platforms[MACOS_PLATFORM],
      document.version,
      repository,
      platformNames[MACOS_PLATFORM],
    );
  }
  return { version: document.version, pub_date: document.pub_date, platforms };
}
