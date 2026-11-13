import { MACOS_PLATFORM, isReleaseVersion } from "./release-contract.js";

export async function initReleaseDownload(document, fetcher = fetch) {
  try {
    const response = await fetcher("/api/release", {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) return;
    const release = await response.json();
    if (!isReleaseVersion(release.version, { stable: true })) return;
    const platforms = release.platforms?.[MACOS_PLATFORM] ? "WINDOWS · MACOS" : "WINDOWS";
    document.querySelectorAll("[data-release-version]").forEach((label) => {
      label.textContent = `V${release.version} / ${platforms}`;
    });
  } catch {
    // The server download route independently resolves the release on click.
  }
}

const platformLabels = { windows: "Windows 版", macos: "macOS 版" };

// The only macOS build targets Apple silicon; phones and tablets keep the Windows default.
export function detectPlatform(navigator) {
  const platform = navigator?.userAgentData?.platform;
  if (platform) return platform === "macOS" ? "macos" : "windows";
  const agent = String(navigator?.userAgent ?? "");
  return /Macintosh|Mac OS X/u.test(agent) && !/iPhone|iPad|iPod/u.test(agent)
    ? "macos"
    : "windows";
}

export function initPlatformPicker(document, navigator = globalThis.navigator) {
  const pickers = [...document.querySelectorAll("[data-download-picker]")];
  const menus = pickers.map((picker) => picker.querySelector("details"));
  const select = (platform) => {
    for (const picker of pickers) {
      const option = picker.querySelector(`[data-platform="${platform}"]`);
      if (!option) continue;
      picker
        .querySelector("[data-download-link]")
        .setAttribute("href", option.getAttribute("href"));
      picker.querySelector("[data-download-label]").textContent = platformLabels[platform];
      picker.querySelectorAll("[data-platform-icon]").forEach((icon) => {
        icon.toggleAttribute("hidden", icon.dataset.platformIcon !== platform);
      });
      picker.querySelectorAll("[data-platform]").forEach((item) => {
        if (item === option) item.setAttribute("aria-current", "true");
        else item.removeAttribute("aria-current");
      });
    }
  };
  const close = () => menus.forEach((menu) => menu.removeAttribute("open"));
  select(detectPlatform(navigator));
  for (const picker of pickers) {
    // Without JavaScript each option stays a direct download link.
    picker.querySelectorAll("[data-platform]").forEach((option) => {
      option.addEventListener("click", (event) => {
        event.preventDefault();
        select(option.dataset.platform);
        close();
        picker.querySelector("[data-download-link]").focus();
      });
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}
