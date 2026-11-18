export function installHarnessNative<Args extends object>(
  invoke: (command: string, args: Args) => Promise<unknown>,
) {
  const host = window as Window & {
    __TAURI_INTERNALS__?: {
      convertFileSrc(path: string): string;
      transformCallback(): number;
      unregisterCallback(): void;
      invoke(command: string, args: Args): Promise<unknown>;
    };
  };
  const previous = host.__TAURI_INTERNALS__;
  host.__TAURI_INTERNALS__ = {
    convertFileSrc: (path) => path,
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke,
  };
  return () => {
    if (previous) host.__TAURI_INTERNALS__ = previous;
    else delete host.__TAURI_INTERNALS__;
  };
}
