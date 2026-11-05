export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True in the macOS desktop app, which uses the native menu bar and fonts. */
export function isMacOSRuntime() {
  return isTauriRuntime() && /\bMacintosh\b/u.test(navigator.userAgent);
}
