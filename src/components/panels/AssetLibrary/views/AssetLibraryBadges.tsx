import { Star, Tags } from "lucide-react";
import type { CSSProperties } from "react";
import { assetLibraryEntryFlag } from "../../../../core/editor/assetLibrary";
import { annotationColors } from "../../../../runtime/theme";
import type { AssetLibraryColorLabel, AssetLibraryEntry } from "../../../../types";

export const assetLibraryColorLabelNames: Record<AssetLibraryColorLabel, string> = {
  red: "红色",
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  purple: "紫色",
};

export const assetLibraryFlagNames = {
  retained: "留用旗标",
  none: "无旗标",
  excluded: "排除旗标",
} as const;

export function assetLibraryColorStyle(colorLabel: AssetLibraryColorLabel | null) {
  return colorLabel
    ? ({ "--asset-color-label": annotationColors[colorLabel] } as CSSProperties)
    : undefined;
}

function annotationDescription(entry: AssetLibraryEntry) {
  const flag = assetLibraryEntryFlag(entry);
  const { rating, color_label: colorLabel, keywords, custom_label: customLabel } = entry.annotation;
  return [
    flag !== "none" ? assetLibraryFlagNames[flag] : "",
    rating > 0 ? `${rating} 星` : "",
    colorLabel ? `${assetLibraryColorLabelNames[colorLabel]}色标` : "",
    customLabel ? `标签：${customLabel}` : "",
    entry.root === "storyboards" && keywords.length ? `关键字：${keywords.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("，");
}

/** The pole-and-banner flag drawn on storyboard thumbnails, read-only. */
export function AssetLibraryFlagMark({ entry }: { entry: AssetLibraryEntry }) {
  const flag = assetLibraryEntryFlag(entry);
  return flag === "none" ? null : (
    <span
      className={`asset-library-flag-mark is-${flag}`}
      role="img"
      aria-label={assetLibraryFlagNames[flag]}
    />
  );
}

export function AssetLibraryRatingMark({ rating }: { rating: number }) {
  return rating > 0 ? (
    <span className="asset-library-rating-mark" role="img" aria-label={`${rating} 星`}>
      {Array.from({ length: rating }, (_, index) => (
        <Star key={index} aria-hidden="true" />
      ))}
    </span>
  ) : null;
}

/** Compact, read-only annotation summary shown on list rows and icon tiles. */
export function AssetLibraryMarks({
  entry,
  showFlag = true,
  list = false,
}: {
  entry: AssetLibraryEntry;
  showFlag?: boolean;
  list?: boolean;
}) {
  const description = annotationDescription(entry);
  const { rating, keywords, custom_label: customLabel } = entry.annotation;
  return (
    <span
      className={`asset-library-marks${list ? " is-list" : ""}`}
      title={description || undefined}
    >
      {showFlag && <AssetLibraryFlagMark entry={entry} />}
      <AssetLibraryRatingMark rating={rating} />
      {(customLabel || (list && entry.annotation.color_label)) && (
        <span className="asset-library-custom-label">
          {customLabel || assetLibraryColorLabelNames[entry.annotation.color_label!]}
        </span>
      )}
      {!list && entry.root === "storyboards" && keywords.length > 0 && (
        <span
          className="asset-library-keyword-mark"
          role="img"
          aria-label={`${keywords.length} 个关键字`}
        >
          <Tags aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
