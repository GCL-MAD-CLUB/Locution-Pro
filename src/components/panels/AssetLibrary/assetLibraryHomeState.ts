import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { usePersistedProjectPanelState } from "../../../application/media/projectPanelPersistence";
import {
  emptyAssetLibraryHome,
  normalizedAssetLibraryHome,
  type AssetLibraryHome,
} from "../../../core/editor/assetLibraryHome";
import { useProjectPort } from "../../../systems/ProjectSystem";

interface AssetLibraryHomeState {
  /** The project the home belongs to; null for a project that has not been saved yet. */
  projectId: string | null;
  home: AssetLibraryHome;
}

// Shared by every asset-library panel instance, as quick access is in a file manager.
const homeStore = createStore<AssetLibraryHomeState>()(() => ({
  projectId: null,
  home: emptyAssetLibraryHome(),
}));

/** Every instance persists the same snapshot under one id, beside the project. */
const persistenceId = "asset-library:home";

export function updateAssetLibraryHome(recipe: (home: AssetLibraryHome) => AssetLibraryHome) {
  homeStore.setState((state) => {
    const home = recipe(state.home);
    return home === state.home ? state : { home };
  });
}

function restoredHome(
  current: AssetLibraryHomeState,
  saved: AssetLibraryHome | null,
  projectId: string,
): AssetLibraryHomeState {
  // Another instance already restored this project, possibly before its first save landed.
  if (current.projectId === projectId) return current;
  if (saved) return { projectId, home: normalizedAssetLibraryHome(saved) };
  // A project saved for the first time keeps what it gathered while unsaved.
  return { projectId, home: current.projectId === null ? current.home : emptyAssetLibraryHome() };
}

/** The current project's home, restored when a project opens and saved as it changes. */
export function useAssetLibraryHome() {
  const { projectId } = useProjectPort(["projectId"], []);
  const state = useStore(homeStore);
  useEffect(() => {
    // A new, unsaved project starts with an empty home.
    if (projectId === null && homeStore.getState().projectId !== null) {
      homeStore.setState({ projectId: null, home: emptyAssetLibraryHome() });
    }
  }, [projectId]);
  usePersistedProjectPanelState<AssetLibraryHome>(
    state.projectId === projectId ? state.home : null,
    (saved, restoredProjectId) =>
      homeStore.setState((current) => restoredHome(current, saved, restoredProjectId)),
    true,
    persistenceId,
  );
  return state.home;
}
