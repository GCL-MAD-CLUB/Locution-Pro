import {
  withAssetLibraryColorLabel,
  withAssetLibraryFlag,
  withAssetLibraryRating,
  withAssetLibraryRatingDelta,
  type AssetLibraryFlag,
} from "../../../core/editor/assetLibrary";
import type { AnnotationShortcutAction } from "../../common/utils/annotationShortcuts";
import type { AssetLibraryColorLabel, AssetLibraryEntry } from "../../../types";
import type { assetLibraryCommands } from "./assetLibraryCommands";

/** Flag, rating and color-label edits of the selected materials, each one history step. */
export function assetLibraryAnnotationActions(
  commands: ReturnType<typeof assetLibraryCommands>,
  entryIds: readonly string[],
) {
  const update = (label: string, recipe: (entry: AssetLibraryEntry) => AssetLibraryEntry) => {
    if (entryIds.length > 0) commands.updateEntries(label, entryIds, recipe);
  };
  const setFlag = (flag: AssetLibraryFlag) =>
    update("设置旗标", (entry) => withAssetLibraryFlag(entry, flag));
  const setRating = (rating: number) =>
    update("设置星级", (entry) => withAssetLibraryRating(entry, rating));
  const setColorLabel = (colorLabel: AssetLibraryColorLabel | null) =>
    update("设置色标", (entry) => withAssetLibraryColorLabel(entry, colorLabel));
  return {
    setFlag,
    setRating,
    setColorLabel,
    /** Applies a flag, rating or color-label keyboard shortcut. */
    applyShortcut(action: AnnotationShortcutAction) {
      if (action.kind === "flag") setFlag(action.value);
      else if (action.kind === "rating") setRating(action.value);
      else if (action.kind === "colorLabel") setColorLabel(action.value);
      else update("调整星级", (entry) => withAssetLibraryRatingDelta(entry, action.value));
    },
  };
}
