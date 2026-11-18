import { MACOS_PLATFORM, isReleaseVersion } from "./release-contract.ts";

interface VersionLabels {
  querySelectorAll(selector: string): {
    forEach(callback: (label: { textContent: string | null }) => void): void;
  };
}

export async function initReleaseDownload(document: VersionLabels, fetcher = fetch) {
  try {
    const response = await fetcher("/api/release", {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) return;
    const release = (await response.json()) as {
      version?: unknown;
      platforms?: Partial<Record<typeof MACOS_PLATFORM, unknown>>;
    } | null;
    if (!release || !isReleaseVersion(release.version, { stable: true })) return;
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
type Platform = keyof typeof platformLabels;
interface PlatformNavigator {
  userAgent?: string;
  userAgentData?: { platform?: string };
}

export function detectPlatform(navigator?: PlatformNavigator): Platform {
  const platform = navigator?.userAgentData?.platform;
  if (platform) return platform === "macOS" ? "macos" : "windows";
  const agent = String(navigator?.userAgent ?? "");
  return /Macintosh|Mac OS X/u.test(agent) && !/iPhone|iPad|iPod/u.test(agent)
    ? "macos"
    : "windows";
}

export function initPlatformPicker(
  document: Document,
  navigator: PlatformNavigator = globalThis.navigator,
) {
  const pickers = [...document.querySelectorAll("[data-download-picker]")];
  const menus = pickers
    .map((picker) => picker.querySelector("details"))
    .filter((menu) => menu !== null);
  const select = (platform: Platform) => {
    for (const picker of pickers) {
      const option = picker.querySelector(`[data-platform="${platform}"]`);
      const href = option?.getAttribute("href");
      if (!href) continue;
      picker.querySelector("[data-download-link]")?.setAttribute("href", href);
      const label = picker.querySelector("[data-download-label]");
      if (label) label.textContent = platformLabels[platform];
      picker.querySelectorAll<HTMLElement | SVGElement>("[data-platform-icon]").forEach((icon) => {
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
    picker.querySelectorAll<HTMLElement>("[data-platform]").forEach((option) => {
      option.addEventListener("click", (event) => {
        event.preventDefault();
        const platform = option.dataset.platform;
        if (platform === "windows" || platform === "macos") select(platform);
        close();
        picker.querySelector<HTMLElement>("[data-download-link]")?.focus();
      });
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus)
      if (!(event.target instanceof Node) || !menu.contains(event.target))
        menu.removeAttribute("open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}
