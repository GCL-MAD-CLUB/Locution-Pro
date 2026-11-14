import type { AssetLibrarySortKey } from "../../../core/editor/assetLibrary";
import type { AssetLibraryRoot } from "../../../types";

/** Resizable columns; the color marker and trailing filler stay fixed. */
export type AssetLibraryColumnId =
  | "name"
  | "location"
  | "source"
  | "marks"
  | "subtitle"
  | "keywords"
  | "inPoint"
  | "duration"
  | "created"
  | "hidden";

export interface AssetLibraryColumn {
  id: AssetLibraryColumnId;
  label: string;
  sortKey: AssetLibrarySortKey | null;
  width: number;
  minimum: number;
  maximum: number;
}

export const assetLibraryColumns: readonly AssetLibraryColumn[] = [
  { id: "name", label: "名称", sortKey: "name", width: 240, minimum: 80, maximum: 1200 },
  { id: "location", label: "位置", sortKey: null, width: 160, minimum: 48, maximum: 480 },
  { id: "source", label: "来源", sortKey: null, width: 200, minimum: 60, maximum: 480 },
  { id: "marks", label: "标签", sortKey: "rating", width: 112, minimum: 40, maximum: 320 },
  { id: "subtitle", label: "字幕", sortKey: null, width: 300, minimum: 60, maximum: 1200 },
  { id: "keywords", label: "关键字", sortKey: null, width: 136, minimum: 48, maximum: 420 },
  { id: "inPoint", label: "媒体入点", sortKey: "start", width: 112, minimum: 48, maximum: 200 },
  {
    id: "duration",
    label: "媒体持续时间",
    sortKey: "duration",
    width: 112,
    minimum: 48,
    maximum: 200,
  },
  {
    id: "created",
    label: "项目添加时间",
    sortKey: "created",
    width: 136,
    minimum: 60,
    maximum: 240,
  },
  { id: "hidden", label: "隐藏", sortKey: null, width: 48, minimum: 40, maximum: 80 },
];

/** A library, or the project, which mixes both libraries and so shows every column. */
export type AssetLibraryColumnScope = AssetLibraryRoot | "project";

/** Each library defines its own fields and order. Only the table mechanics are shared. */
const libraryColumnIds: Record<AssetLibraryColumnScope, readonly AssetLibraryColumnId[]> = {
  project: [
    "name",
    "location",
    "subtitle",
    "source",
    "marks",
    "keywords",
    "inPoint",
    "duration",
    "created",
    "hidden",
  ],
  subtitles: [
    "name",
    "location",
    "subtitle",
    "source",
    "marks",
    "inPoint",
    "duration",
    "created",
    "hidden",
  ],
  storyboards: [
    "name",
    "location",
    "source",
    "marks",
    "keywords",
    "inPoint",
    "duration",
    "created",
    "hidden",
  ],
};

export function assetLibraryColumnsForRoot(root: AssetLibraryColumnScope) {
  return libraryColumnIds[root].map((id) =>
    assetLibraryColumns.find((column) => column.id === id)!,
  );
}

export function assetLibraryToggleableColumns(root: AssetLibraryColumnScope) {
  return assetLibraryColumnsForRoot(root).filter(
    (column) => column.id !== "name" && column.id !== "location",
  );
}

export const defaultAssetLibraryVisibleColumns: ReadonlySet<AssetLibraryColumnId> = new Set([
  "source",
  "subtitle",
  "inPoint",
  "duration",
  "keywords",
  "marks",
  "created",
  "hidden",
]);

export type AssetLibraryColumnWidths = Record<AssetLibraryColumnId, number>;

export const defaultAssetLibraryColumnWidths = Object.fromEntries(
  assetLibraryColumns.map((column) => [column.id, column.width]),
) as AssetLibraryColumnWidths;

export function clampAssetLibraryColumnWidth(id: AssetLibraryColumnId, width: number) {
  const column = assetLibraryColumns.find((candidate) => candidate.id === id)!;
  return Math.round(Math.min(column.maximum, Math.max(column.minimum, width)));
}
