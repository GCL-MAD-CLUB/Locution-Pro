import type { RenderLifetime } from "../../../runtime/lifetime/RenderLifetime";
import { definePanel } from "../../common/DockLayout";
import { SubtitlePanel } from "./SubtitlePanel";
import {
  usePanelMediaSourceSelection,
  usePanelMediaWorkspaceMenu,
} from "../../../application/media/panelMediaSources";
import { mediaPanelTitle } from "../../../core/editor/panelSourceSelection";

export const subtitlePanelType = "subtitles";

export const subtitlePanelDefinition = definePanel({
  type: subtitlePanelType,
  Component: SubtitlePanel,
  useMenuItems: (_params: unknown, lifetime: RenderLifetime) =>
    usePanelMediaWorkspaceMenu(lifetime, "subtitles"),
  useTitle: (_params: unknown, lifetime: RenderLifetime) => {
    const { selectedSources } = usePanelMediaSourceSelection(lifetime);
    return mediaPanelTitle("subtitles", selectedSources);
  },
});
