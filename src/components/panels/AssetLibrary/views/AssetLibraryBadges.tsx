import { Star, Tags } from "lucide-react";
import type { CSSProperties } from "react";
import { assetLibraryEntryFlag } from "../../../../core/editor/assetLibrary";
import { annotationColors } from "../../../../runtime/theme";
import type { AssetLibraryColorLabel, AssetLibraryEntry } from "../../../../types";
// Thumbnail flags and keyword indicators reuse the storyboard thumbnail marks.
import "../../StoryboardPanel/StoryboardPanel.css";

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
function AssetLibraryFlagMark({ entry }: { entry: AssetLibraryEntry }) {
  const flag = assetLibraryEntryFlag(entry);
  return flag === "none" ? null : (
    <span
      className={`asset-library-flag-mark is-${flag}`}
      role="img"
      aria-label={assetLibraryFlagNames[flag]}
    />
  );
}

function AssetLibraryRatingMark({ className, rating }: { className: string; rating: number }) {
  return rating > 0 ? (
    <span className={className} role="img" aria-label={`${rating} 星`}>
      {Array.from({ length: rating }, (_, index) => (
        <Star key={index} aria-hidden="true" />
      ))}
    </span>
  ) : null;
}

/** The media bin's color label swatch, shown next to the flag and stars. */
function AssetLibraryColorMark({ colorLabel }: { colorLabel: AssetLibraryColorLabel | null }) {
  return colorLabel ? (
    <span
      className="media-bin-label-color asset-library-color-mark"
      role="img"
      aria-label={`${assetLibraryColorLabelNames[colorLabel]}色标`}
      style={{ background: annotationColors[colorLabel] }}
    />
  ) : null;
}

/** Read-only annotation summary for the list's label column. */
export function AssetLibraryMarks({ entry }: { entry: AssetLibraryEntry }) {
  const description = annotationDescription(entry);
  const { rating, color_label: colorLabel, custom_label: customLabel } = entry.annotation;
  return (
    <span className="asset-library-marks" title={description || undefined}>
      <AssetLibraryFlagMark entry={entry} />
      <AssetLibraryRatingMark className="asset-library-rating-mark" rating={rating} />
      <AssetLibraryColorMark colorLabel={colorLabel} />
      {customLabel && <span className="asset-library-custom-label">{customLabel}</span>}
    </span>
  );
}

/**
 * The metadata strip of storyboard graph previews: flag, rating, color label and a keyword
 * indicator in one framed strip at the thumbnail's top-left corner.
 */
export function AssetLibraryThumbnailMarks({ entry }: { entry: AssetLibraryEntry }) {
  const flag = assetLibraryEntryFlag(entry);
  const { rating, keywords, color_label: colorLabel } = entry.annotation;
  return (
    <span
      className="asset-library-thumbnail-metadata"
      title={annotationDescription(entry) || undefined}
    >
      {flag !== "none" && (
        <span
          className={`shot-thumbnail-flag is-${flag}`}
          role="img"
          aria-label={assetLibraryFlagNames[flag]}
        />
      )}
      <AssetLibraryRatingMark className="asset-library-thumbnail-rating" rating={rating} />
      <AssetLibraryColorMark colorLabel={colorLabel} />
      {entry.root === "storyboards" && keywords.length > 0 && (
        <span
          className="shot-thumbnail-keyword-indicator"
          role="img"
          aria-label={`${keywords.length} 个关键字`}
        >
          <Tags aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
