import { invokeCommand } from "../../errors/runtime";
import { isTauriRuntime } from "./runtime";

const supportedProtocols = new Set(["http:", "https:"]);

/**
 * Returns the normalized URL when it is a web link the native opener accepts,
 * or null for anything else (including relative and malformed URLs).
 */
export function resolveExternalUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return supportedProtocols.has(url.protocol) ? url.href : null;
}

/**
 * Opens a web link in the system browser. The application webview must never
 * navigate to the target itself, so native builds hand the URL to the backend.
 */
export async function openExternalUrl(value: string): Promise<void> {
  const url = resolveExternalUrl(value);
  if (url === null) return;
  if (isTauriRuntime()) {
    await invokeCommand("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
