import type { installNative } from "./native";

declare global {
  interface Window {
    __nativeTest: ReturnType<typeof installNative>;
  }
}
