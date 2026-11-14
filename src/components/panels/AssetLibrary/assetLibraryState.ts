import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createPanelState } from "../../../runtime/systems/PanelState";
import {
  sameAssetLibraryLocation,
  steppedAssetLibraryHistory,
  type AssetLibraryClipboard,
  type AssetLibraryPlace,
  type AssetLibrarySort,
} from "../../../core/editor/assetLibrary";
import {
  emptyAssetLibraryFilter,
  type AssetLibraryFilter,
} from "../../../core/editor/assetLibraryFilter";
import {
  noAssetLibraryGrouping,
  type AssetLibraryGrouping,
} from "../../../core/editor/assetLibraryGroup";
import {
  clampAssetLibraryColumnWidth,
  defaultAssetLibraryColumnWidths,
  defaultAssetLibraryVisibleColumns,
  type AssetLibraryColumnId,
  type AssetLibraryColumnScope,
  type AssetLibraryColumnWidths,
} from "./assetLibraryColumns";

export const assetLibraryPaneWidths = {
  navigation: { initial: 200, minimum: 140, maximum: 420 },
  details: { initial: 280, minimum: 220, maximum: 520 },
} as const;

export type AssetLibraryPane = keyof typeof assetLibraryPaneWidths;

export function clampAssetLibraryPaneWidth(pane: AssetLibraryPane, width: number) {
  const { minimum, maximum } = assetLibraryPaneWidths[pane];
  return Math.round(Math.min(maximum, Math.max(minimum, width)));
}

export const defaultAssetLibraryLocation: AssetLibraryPlace = {
  root: "subtitles",
  folderId: null,
};

interface AssetLibraryPanelState {
  location: AssetLibraryPlace;
  backStack: AssetLibraryPlace[];
  forwardStack: AssetLibraryPlace[];
  selectedKeys: ReadonlySet<string>;
  anchorKey: string | null;
  focusKey: string | null;
  renamingKey: string | null;
  query: string;
  size: number;
  sort: AssetLibrarySort;
  /** Narrows the listed materials by annotation; folders stay listed. */
  filter: AssetLibraryFilter;
  group: AssetLibraryGrouping;
  /** Groups folded away in the open place; navigating or regrouping opens them again. */
  collapsedGroups: ReadonlySet<string>;
  navigationVisible: boolean;
  detailsVisible: boolean;
  collapsedKeys: ReadonlySet<string>;
  paneWidths: Record<AssetLibraryPane, number>;
  collapsedSections: ReadonlySet<string>;
  itemCheckboxes: boolean;
  /** Hidden folders and entries are listed, faded, instead of left out. */
  showHidden: boolean;
  visibleColumns: Record<AssetLibraryColumnScope, ReadonlySet<AssetLibraryColumnId>>;
  columnWidths: Record<AssetLibraryColumnScope, AssetLibraryColumnWidths>;
  navigate: (location: AssetLibraryPlace) => void;
  replaceLocation: (location: AssetLibraryPlace) => void;
  /** Steps through history; a larger count jumps straight to an entry from the history menu. */
  goBack: (steps?: number) => void;
  goForward: (steps?: number) => void;
  select: (keys: Iterable<string>, focusKey?: string | null, anchorKey?: string | null) => void;
  setRenamingKey: (key: string | null) => void;
  setQuery: (query: string) => void;
  setSize: (size: number) => void;
  setSort: (sort: AssetLibrarySort) => void;
  setFilter: (filter: AssetLibraryFilter) => void;
  setGroup: (group: AssetLibraryGrouping) => void;
  toggleGroupCollapsed: (group: string) => void;
  setNavigationVisible: (visible: boolean) => void;
  setDetailsVisible: (visible: boolean) => void;
  toggleCollapsed: (key: string) => void;
  expandKeys: (keys: readonly string[]) => void;
  setPaneWidth: (pane: AssetLibraryPane, width: number) => void;
  toggleSection: (section: string) => void;
  setItemCheckboxes: (visible: boolean) => void;
  setShowHidden: (visible: boolean) => void;
  toggleColumn: (column: AssetLibraryColumnId) => void;
  setColumnWidth: (column: AssetLibraryColumnId, width: number) => void;
  resetColumnWidths: () => void;
}

function toggled<T>(keys: ReadonlySet<T>, key: T) {
  const next = new Set(keys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

const historyLimit = 50;

const clearedNavigationState = {
  selectedKeys: new Set<string>() as ReadonlySet<string>,
  anchorKey: null,
  focusKey: null,
  renamingKey: null,
  query: "",
  collapsedGroups: new Set<string>() as ReadonlySet<string>,
};

function stepHistory(state: AssetLibraryPanelState, steps: number) {
  const next = steppedAssetLibraryHistory(state, steps, historyLimit);
  return next ? { ...next, ...clearedNavigationState } : state;
}

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
  filter: emptyAssetLibraryFilter,
  group: noAssetLibraryGrouping,
  collapsedGroups: new Set<string>(),
  navigationVisible: true,
  detailsVisible: true,
  collapsedKeys: new Set<string>(),
  paneWidths: {
    navigation: assetLibraryPaneWidths.navigation.initial,
    details: assetLibraryPaneWidths.details.initial,
  },
  collapsedSections: new Set<string>(),
  itemCheckboxes: false,
  showHidden: false,
  visibleColumns: {
    project: defaultAssetLibraryVisibleColumns,
    subtitles: defaultAssetLibraryVisibleColumns,
    storyboards: defaultAssetLibraryVisibleColumns,
  },
  columnWidths: {
    project: defaultAssetLibraryColumnWidths,
    subtitles: defaultAssetLibraryColumnWidths,
    storyboards: defaultAssetLibraryColumnWidths,
  },
  navigate: (location) =>
    set((state) =>
      sameAssetLibraryLocation(state.location, location)
        ? { query: "" }
        : {
            location,
            backStack: [...state.backStack, state.location].slice(-historyLimit),
            forwardStack: [],
            ...clearedNavigationState,
          },
    ),
  replaceLocation: (location) =>
    set((state) => (sameAssetLibraryLocation(state.location, location) ? state : { location })),
  goBack: (steps = 1) => set((state) => stepHistory(state, -steps)),
  goForward: (steps = 1) => set((state) => stepHistory(state, steps)),
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
  setFilter: (filter) => set({ filter }),
  setGroup: (group) => set({ group, collapsedGroups: new Set() }),
  toggleGroupCollapsed: (group) =>
    set((state) => ({ collapsedGroups: toggled(state.collapsedGroups, group) })),
  setNavigationVisible: (navigationVisible) => set({ navigationVisible }),
  setDetailsVisible: (detailsVisible) => set({ detailsVisible }),
  toggleCollapsed: (key) => set((state) => ({ collapsedKeys: toggled(state.collapsedKeys, key) })),
  expandKeys: (keys) =>
    set((state) => {
      if (!keys.some((key) => state.collapsedKeys.has(key))) return state;
      const collapsedKeys = new Set(state.collapsedKeys);
      keys.forEach((key) => collapsedKeys.delete(key));
      return { collapsedKeys };
    }),
  setPaneWidth: (pane, width) =>
    set((state) => ({
      paneWidths: { ...state.paneWidths, [pane]: clampAssetLibraryPaneWidth(pane, width) },
    })),
  toggleSection: (section) =>
    set((state) => ({ collapsedSections: toggled(state.collapsedSections, section) })),
  setItemCheckboxes: (itemCheckboxes) => set({ itemCheckboxes }),
  setShowHidden: (showHidden) => set({ showHidden }),
  toggleColumn: (column) =>
    set((state) => ({
      visibleColumns: {
        ...state.visibleColumns,
        [state.location.root]: toggled(state.visibleColumns[state.location.root], column),
      },
    })),
  setColumnWidth: (column, width) =>
    set((state) => ({
      columnWidths: {
        ...state.columnWidths,
        [state.location.root]: {
          ...state.columnWidths[state.location.root],
          [column]: clampAssetLibraryColumnWidth(column, width),
        },
      },
    })),
  resetColumnWidths: () =>
    set((state) => ({
      columnWidths: {
        ...state.columnWidths,
        [state.location.root]: defaultAssetLibraryColumnWidths,
      },
    })),
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
