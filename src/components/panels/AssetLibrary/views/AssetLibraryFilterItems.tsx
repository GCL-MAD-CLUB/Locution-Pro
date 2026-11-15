import { useState } from "react";
import {
  assetLibraryFilterActive,
  assetLibraryFilterColors,
  assetLibraryFilterEdits,
  assetLibraryFilterFlags,
  assetLibraryRatingComparators,
  toggledAssetLibraryFilterRating,
  toggledAssetLibraryFilterValue,
  type AssetLibraryColorFilter,
  type AssetLibraryEditFilter,
  type AssetLibraryFilter,
  type AssetLibraryRatingComparator,
} from "../../../../core/editor/assetLibraryFilter";
import { PopupMenuItem, PopupMenuSeparator, PopupMenuSubmenu } from "../../../common/PopupMenu";
import { assetLibraryColorLabelNames, assetLibraryFlagNames } from "./AssetLibraryBadges";

type FilterSubmenu = "flag" | "edit" | "rating" | "color" | null;

const editLabels: Record<AssetLibraryEditFilter, string> = {
  edited: "已编辑",
  unedited: "未编辑",
};

const comparatorLabels: Record<AssetLibraryRatingComparator, string> = {
  gte: "星级大于等于",
  lte: "星级小于等于",
  eq: "星级等于",
};

const ratings = [1, 2, 3, 4, 5] as const;

function colorLabel(color: AssetLibraryColorFilter) {
  if (color === "custom") return "自定义";
  return color === "none" ? "无色标" : assetLibraryColorLabelNames[color];
}

/**
 * The storyboard and subtitle filter bar as menu groups. Choices toggle without closing the
 * menu so several can be combined; a group with any choice shows checked.
 */
export function AssetLibraryFilterItems({
  filter,
  onChange,
  onClear,
}: {
  filter: AssetLibraryFilter;
  onChange: (filter: AssetLibraryFilter) => void;
  onClear: () => void;
}) {
  const [submenu, setSubmenu] = useState<FilterSubmenu>(null);
  const toggle = (name: Exclude<FilterSubmenu, null>) => (open: boolean) =>
    setSubmenu(open ? name : null);
  return (
    <>
      <PopupMenuSubmenu
        label="旗标"
        checked={filter.flags.length > 0}
        open={submenu === "flag"}
        onOpenChange={toggle("flag")}
      >
        {assetLibraryFilterFlags.map((flag) => (
          <PopupMenuItem
            key={flag}
            checked={filter.flags.includes(flag)}
            onSelect={() =>
              onChange({
                ...filter,
                flags: toggledAssetLibraryFilterValue(filter.flags, flag, assetLibraryFilterFlags),
              })
            }
          >
            {assetLibraryFlagNames[flag]}
          </PopupMenuItem>
        ))}
      </PopupMenuSubmenu>
      <PopupMenuSubmenu
        label="编辑"
        checked={filter.edits.length > 0}
        open={submenu === "edit"}
        onOpenChange={toggle("edit")}
      >
        {assetLibraryFilterEdits.map((edit) => (
          <PopupMenuItem
            key={edit}
            checked={filter.edits.includes(edit)}
            onSelect={() =>
              onChange({
                ...filter,
                edits: toggledAssetLibraryFilterValue(filter.edits, edit, assetLibraryFilterEdits),
              })
            }
          >
            {editLabels[edit]}
          </PopupMenuItem>
        ))}
      </PopupMenuSubmenu>
      <PopupMenuSubmenu
        label="星级"
        checked={filter.rating > 0}
        open={submenu === "rating"}
        onOpenChange={toggle("rating")}
      >
        {assetLibraryRatingComparators.map((comparator) => (
          <PopupMenuItem
            key={comparator}
            checked={filter.ratingComparator === comparator}
            indicator="dot"
            onSelect={() => onChange({ ...filter, ratingComparator: comparator })}
          >
            {comparatorLabels[comparator]}
          </PopupMenuItem>
        ))}
        <PopupMenuSeparator />
        {ratings.map((rating) => (
          <PopupMenuItem
            key={rating}
            checked={filter.rating === rating}
            indicator="dot"
            onSelect={() => onChange(toggledAssetLibraryFilterRating(filter, rating))}
          >
            {`${rating} 星`}
          </PopupMenuItem>
        ))}
      </PopupMenuSubmenu>
      <PopupMenuSubmenu
        label="色标"
        checked={filter.colors.length > 0}
        open={submenu === "color"}
        onOpenChange={toggle("color")}
      >
        {assetLibraryFilterColors.map((color) => (
          <PopupMenuItem
            key={color}
            checked={filter.colors.includes(color)}
            onSelect={() =>
              onChange({
                ...filter,
                colors: toggledAssetLibraryFilterValue(
                  filter.colors,
                  color,
                  assetLibraryFilterColors,
                ),
              })
            }
          >
            {colorLabel(color)}
          </PopupMenuItem>
        ))}
      </PopupMenuSubmenu>
      {assetLibraryFilterActive(filter) && (
        <>
          <PopupMenuSeparator />
          <PopupMenuItem onSelect={onClear}>清除筛选</PopupMenuItem>
        </>
      )}
    </>
  );
}
