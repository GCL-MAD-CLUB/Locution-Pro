import type { AssetLibraryColorLabel, AssetLibraryEntry } from "../../types";
import {
  assetLibraryColorLabels,
  assetLibraryEntryFlag,
  type AssetLibraryFlag,
} from "./assetLibrary";

export type AssetLibraryEditFilter = "edited" | "unedited";
export type AssetLibraryColorFilter = AssetLibraryColorLabel | "custom" | "none";
export type AssetLibraryRatingComparator = "gte" | "lte" | "eq";

/**
 * The storyboard and subtitle panels' filters applied to materials: each group matches when
 * empty or when it includes the entry's value, and a rating of 0 matches every entry.
 */
export interface AssetLibraryFilter {
  flags: readonly AssetLibraryFlag[];
  edits: readonly AssetLibraryEditFilter[];
  rating: number;
  ratingComparator: AssetLibraryRatingComparator;
  colors: readonly AssetLibraryColorFilter[];
}

export const assetLibraryFilterFlags: readonly AssetLibraryFlag[] = [
  "retained",
  "none",
  "excluded",
];
export const assetLibraryFilterEdits: readonly AssetLibraryEditFilter[] = ["edited", "unedited"];
export const assetLibraryFilterColors: readonly AssetLibraryColorFilter[] = [
  ...assetLibraryColorLabels,
  "custom",
  "none",
];
export const assetLibraryRatingComparators: readonly AssetLibraryRatingComparator[] = [
  "gte",
  "lte",
  "eq",
];

export const emptyAssetLibraryFilter: AssetLibraryFilter = {
  flags: [],
  edits: [],
  rating: 0,
  ratingComparator: "gte",
  colors: [],
};

export function assetLibraryFilterActive(filter: AssetLibraryFilter) {
  return (
    filter.flags.length > 0 ||
    filter.edits.length > 0 ||
    filter.rating > 0 ||
    filter.colors.length > 0
  );
}

/** Edited as the source panels count it; only storyboards carry titles and keywords. */
export function assetLibraryEntryIsEdited(entry: AssetLibraryEntry) {
  const annotation = entry.annotation;
  return Boolean(
    annotation.rating > 0 ||
    annotation.retained ||
    annotation.excluded ||
    annotation.color_label ||
    annotation.custom_label?.trim() ||
    (entry.root === "storyboards" && (annotation.title?.trim() || annotation.keywords.length)),
  );
}

/** As in the source panels, a custom label stands in for the color label. */
export function assetLibraryEntryColorFilter(entry: AssetLibraryEntry): AssetLibraryColorFilter {
  if (entry.annotation.custom_label?.trim()) return "custom";
  return entry.annotation.color_label ?? "none";
}

function ratingMatches(rating: number, filter: AssetLibraryFilter) {
  if (filter.rating === 0) return true;
  if (filter.ratingComparator === "gte") return rating >= filter.rating;
  if (filter.ratingComparator === "lte") return rating <= filter.rating;
  return rating === filter.rating;
}

function groupMatches<T>(values: readonly T[], value: T) {
  return values.length === 0 || values.includes(value);
}

export function assetLibraryEntryMatchesFilter(
  entry: AssetLibraryEntry,
  filter: AssetLibraryFilter,
) {
  return (
    groupMatches(filter.flags, assetLibraryEntryFlag(entry)) &&
    groupMatches(filter.edits, assetLibraryEntryIsEdited(entry) ? "edited" : "unedited") &&
    groupMatches(filter.colors, assetLibraryEntryColorFilter(entry)) &&
    ratingMatches(entry.annotation.rating, filter)
  );
}

/** Adds or removes one value, keeping the group in its listed order. */
export function toggledAssetLibraryFilterValue<T>(
  values: readonly T[],
  value: T,
  order: readonly T[],
): T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : order.filter((current) => current === value || values.includes(current));
}

/** Picking the current rating again clears it, as clicking a lit star does in the panels. */
export function toggledAssetLibraryFilterRating(filter: AssetLibraryFilter, rating: number) {
  return { ...filter, rating: filter.rating === rating ? 0 : rating };
}
