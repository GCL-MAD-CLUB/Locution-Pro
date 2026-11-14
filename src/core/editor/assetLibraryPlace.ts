import type { ProjectAssetLibraryState } from "../../types";
import {
  assetLibraryLocationFromPath,
  assetLibraryPathText,
  assetLibraryProjectLabel,
  assetLibraryProjectPlace,
  assetLibraryRootLabels,
  assetLibraryRoots,
  isAssetLibraryProjectPlace,
  normalizedAssetLibraryName,
  type AssetLibraryPlace,
} from "./assetLibrary";

const pathSeparator = "\\";

/** Address-bar text that starts at the project, such as `此项目\字幕\访谈`. */
export function assetLibraryPlacePathText(
  library: ProjectAssetLibraryState,
  place: AssetLibraryPlace,
) {
  return isAssetLibraryProjectPlace(place)
    ? assetLibraryProjectLabel
    : [assetLibraryProjectLabel, assetLibraryPathText(library, place)].join(pathSeparator);
}

/**
 * Resolves typed address-bar text that may start at the project. "此项目" alone is the
 * project; from the project, a path must start with a library name.
 */
export function assetLibraryPlaceFromPath(
  library: ProjectAssetLibraryState,
  text: string,
  current: AssetLibraryPlace,
): AssetLibraryPlace | null {
  const segments = text
    .split(/[\\/]+/)
    .map((segment) => normalizedAssetLibraryName(segment))
    .filter(Boolean);
  const fromProject =
    segments[0]?.toLocaleLowerCase() === assetLibraryProjectLabel.toLocaleLowerCase();
  const rest = fromProject ? segments.slice(1) : segments;
  if (fromProject && rest.length === 0) return assetLibraryProjectPlace;
  if (rest.length === 0) return null;
  const startsAtLibrary = assetLibraryRoots.some(
    (root) => assetLibraryRootLabels[root].toLocaleLowerCase() === rest[0]!.toLocaleLowerCase(),
  );
  if ((fromProject || isAssetLibraryProjectPlace(current)) && !startsAtLibrary) return null;
  return assetLibraryLocationFromPath(
    library,
    rest.join(pathSeparator),
    isAssetLibraryProjectPlace(current) ? { root: assetLibraryRoots[0], folderId: null } : current,
  );
}
