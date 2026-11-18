import type { SearchSnapshot } from "./search-panel";

declare global {
  interface Window {
    searchSnapshot: SearchSnapshot;
    leakedKeys: string[];
  }
}
