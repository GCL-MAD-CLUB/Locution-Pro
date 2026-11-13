import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createPanelState } from "../../../runtime/systems/PanelState";
import type {
  AssetLibraryClipboard,
  AssetLibraryLocation,
  AssetLibrarySort,
} from "../../../core/editor/assetLibrary";

export const assetLibraryPaneWidths = {
  navigation: { initial: 200, minimum: 140, maximum: 420 },
  details: { initial: 280, minimum: 220, maximum: 520 },
} as const;

export type AssetLibraryPane = keyof typeof assetLibraryPaneWidths;

export function clampAssetLibraryPaneWidth(pane: AssetLibraryPane, width: number) {
  const { minimum, maximum } = assetLibraryPaneWidths[pane];
  return Math.round(Math.min(maximum, Math.max(minimum, width)));
}

export const defaultAssetLibraryLocation: AssetLibraryLocation = {
  root: "subtitles",
  folderId: null,
};

function sameLocation(left: AssetLibraryLocation, right: AssetLibraryLocation) {
  return left.root === right.root && left.folderId === right.folderId;
}

interface AssetLibraryPanelState {
  location: AssetLibraryLocation;
  backStack: AssetLibraryLocation[];
  forwardStack: AssetLibraryLocation[];
  selectedKeys: ReadonlySet<string>;
  anchorKey: string | null;
  focusKey: string | null;
  renamingKey: string | null;
  query: string;
  size: number;
  sort: AssetLibrarySort;
  navigationVisible: boolean;
  detailsVisible: boolean;
  collapsedKeys: ReadonlySet<string>;
  paneWidths: Record<AssetLibraryPane, number>;
  collapsedSections: ReadonlySet<string>;
  navigate: (location: AssetLibraryLocation) => void;
  replaceLocation: (location: AssetLibraryLocation) => void;
  goBack: () => void;
  goForward: () => void;
  select: (keys: Iterable<string>, focusKey?: string | null, anchorKey?: string | null) => void;
  setRenamingKey: (key: string | null) => void;
  setQuery: (query: string) => void;
  setSize: (size: number) => void;
  setSort: (sort: AssetLibrarySort) => void;
  setNavigationVisible: (visible: boolean) => void;
  setDetailsVisible: (visible: boolean) => void;
  toggleCollapsed: (key: string) => void;
  setPaneWidth: (pane: AssetLibraryPane, width: number) => void;
  toggleSection: (section: string) => void;
}

function toggled(keys: ReadonlySet<string>, key: string) {
  const next = new Set(keys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

const historyLimit = 50;

export const useAssetLibraryState = createPanelState<AssetLibraryPanelState>(() => (set) => ({
  location: defaultAssetLibraryLocation,
  backStack: [],
  forwardStack: [],
  selectedKeys: new Set<string>(),
  anchorKey: null,
  focusKey: null,
  renamingKey: null,
  query: "",
  size: 12,
  sort: { key: "name", direction: "ascending" },
  navigationVisible: true,
  detailsVisible: true,
  collapsedKeys: new Set<string>(),
  paneWidths: {
    navigation: assetLibraryPaneWidths.navigation.initial,
    details: assetLibraryPaneWidths.details.initial,
  },
  collapsedSections: new Set<string>(),
  navigate: (location) =>
    set((state) =>
      sameLocation(state.location, location)
        ? { query: "" }
        : {
            location,
            backStack: [...state.backStack, state.location].slice(-historyLimit),
            forwardStack: [],
            selectedKeys: new Set<string>(),
            anchorKey: null,
            focusKey: null,
            renamingKey: null,
            query: "",
          },
    ),
  replaceLocation: (location) =>
    set((state) => (sameLocation(state.location, location) ? state : { location })),
  goBack: () =>
    set((state) => {
      const previous = state.backStack.at(-1);
      if (!previous) return state;
      return {
        location: previous,
        backStack: state.backStack.slice(0, -1),
        forwardStack: [state.location, ...state.forwardStack].slice(0, historyLimit),
        selectedKeys: new Set<string>(),
        anchorKey: null,
        focusKey: null,
        renamingKey: null,
        query: "",
      };
    }),
  goForward: () =>
    set((state) => {
      const next = state.forwardStack[0];
      if (!next) return state;
      return {
        location: next,
        backStack: [...state.backStack, state.location].slice(-historyLimit),
        forwardStack: state.forwardStack.slice(1),
        selectedKeys: new Set<string>(),
        anchorKey: null,
        focusKey: null,
        renamingKey: null,
        query: "",
      };
    }),
  select: (keys, focusKey, anchorKey) =>
    set((state) => {
      const selectedKeys = new Set(keys);
      const nextFocus = focusKey === undefined ? state.focusKey : focusKey;
      return {
        selectedKeys,
        focusKey: nextFocus,
        anchorKey: anchorKey === undefined ? (nextFocus ?? state.anchorKey) : anchorKey,
      };
    }),
  setRenamingKey: (renamingKey) => set({ renamingKey }),
  setQuery: (query) => set({ query }),
  setSize: (size) => set({ size: Math.min(100, Math.max(0, Math.round(size))) }),
  setSort: (sort) => set({ sort }),
  setNavigationVisible: (navigationVisible) => set({ navigationVisible }),
  setDetailsVisible: (detailsVisible) => set({ detailsVisible }),
  toggleCollapsed: (key) => set((state) => ({ collapsedKeys: toggled(state.collapsedKeys, key) })),
  setPaneWidth: (pane, width) =>
    set((state) => ({
      paneWidths: { ...state.paneWidths, [pane]: clampAssetLibraryPaneWidth(pane, width) },
    })),
  toggleSection: (section) =>
    set((state) => ({ collapsedSections: toggled(state.collapsedSections, section) })),
}));

interface AssetLibraryClipboardState {
  clipboard: AssetLibraryClipboard | null;
  cut: boolean;
}

// Shared by every asset-library panel instance, like a file manager's clipboard.
const assetLibraryClipboardStore = createStore<AssetLibraryClipboardState>()(() => ({
  clipboard: null,
  cut: false,
}));

export function useAssetLibraryClipboard() {
  return useStore(assetLibraryClipboardStore);
}

export function setAssetLibraryClipboard(clipboard: AssetLibraryClipboard | null, cut = false) {
  assetLibraryClipboardStore.setState({ clipboard, cut });
}

export function readAssetLibraryClipboard() {
  return assetLibraryClipboardStore.getState();
}
