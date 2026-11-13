import { definePanel } from "../../common/DockLayout";
import { AssetLibrary } from "./AssetLibrary";

export const assetLibraryPanelType = "asset-library";

export const assetLibraryPanelDefinition = definePanel({
  type: assetLibraryPanelType,
  Component: AssetLibrary,
  useTitle: () => "素材库",
});
