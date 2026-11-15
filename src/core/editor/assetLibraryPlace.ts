import type { ProjectAssetLibraryState } from "../../types";
import {
  assetLibraryLocationFromPath,
  assetLibraryPathText,
  assetLibraryProjectLabel,
  assetLibraryProjectPlace,
  assetLibraryRootLabels,
  assetLibraryRoots,
  assetLibraryHomePlace,
  isAssetLibraryLocation,
  normalizedAssetLibraryName,
  type AssetLibraryPlace,
} from "./assetLibrary";
import { assetLibraryHomeLabel } from "./assetLibraryHome";

const pathSeparator = "\\";

/** Address-bar text that starts at the project, such as `此项目\字幕\访谈`. */
export function assetLibraryPlacePathText(
  library: ProjectAssetLibraryState,
  place: AssetLibraryPlace,
) {
  if (place.root === "home") return assetLibraryHomeLabel;
  return isAssetLibraryLocation(place)
    ? [assetLibraryProjectLabel, assetLibraryPathText(library, place)].join(pathSeparator)
    : assetLibraryProjectLabel;
}

/**
 * Resolves typed address-bar text that may start at the project. "此项目" alone is the
 * project; from the project or the home, a path must start with a library name. "主文件夹"
 * alone is the home.
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
  if (segments.length === 1 && segments[0] === assetLibraryHomeLabel) return assetLibraryHomePlace;
  const fromProject =
    segments[0]?.toLocaleLowerCase() === assetLibraryProjectLabel.toLocaleLowerCase();
  const rest = fromProject ? segments.slice(1) : segments;
  if (fromProject && rest.length === 0) return assetLibraryProjectPlace;
  if (rest.length === 0) return null;
  const startsAtLibrary = assetLibraryRoots.some(
    (root) => assetLibraryRootLabels[root].toLocaleLowerCase() === rest[0]!.toLocaleLowerCase(),
  );
  const inLibrary = isAssetLibraryLocation(current);
  if ((fromProject || !inLibrary) && !startsAtLibrary) return null;
  return assetLibraryLocationFromPath(
    library,
    rest.join(pathSeparator),
    inLibrary ? current : { root: assetLibraryRoots[0], folderId: null },
  );
}
