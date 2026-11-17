import type { RenderLifetime } from "../../../runtime/lifetime/RenderLifetime";
import { definePanel } from "../../common/DockLayout";
import { StoryboardPanel } from "./StoryboardPanel";
import {
  usePanelMediaSourceSelection,
  usePanelMediaWorkspaceMenu,
} from "../../../application/media/panelMediaSources";
import { mediaPanelTitle } from "../../../core/editor/panelSourceSelection";

export const storyboardPanelType = "storyboard";

export const storyboardPanelDefinition = definePanel({
  type: storyboardPanelType,
  Component: StoryboardPanel,
  useMenuItems: (_params: unknown, lifetime: RenderLifetime) =>
    usePanelMediaWorkspaceMenu(lifetime, "storyboard"),
  useTitle: (_params: unknown, lifetime: RenderLifetime) => {
    const { selectedSources } = usePanelMediaSourceSelection(lifetime);
    return mediaPanelTitle("storyboard", selectedSources);
  },
});
