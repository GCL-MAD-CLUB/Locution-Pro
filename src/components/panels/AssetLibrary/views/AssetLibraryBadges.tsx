import { Star } from "lucide-react";
import type { SVGProps } from "react";
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

export function AssetLibraryFolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 40" fill="none" aria-hidden="true" {...props}>
      <path fill="var(--color-media-folder-icon)" d="M4 8a3 3 0 0 1 3-3h12l4 4H4z" />
      <path
        fill="var(--color-media-folder-icon)"
        d="M4 11h37a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"
      />
    </svg>
  );
}

export function AssetLibraryFlag({ flag }: { flag: ReturnType<typeof assetLibraryEntryFlag> }) {
  return <span className={`asset-library-flag is-${flag}`} aria-hidden="true" />;
}

/** Compact, read-only annotation summary shown on rows and cards. */
export function AssetLibraryBadges({ entry }: { entry: AssetLibraryEntry }) {
  const flag = assetLibraryEntryFlag(entry);
  const { rating, color_label: colorLabel, keywords, custom_label: customLabel } = entry.annotation;
  const description = [
    flag !== "none" ? assetLibraryFlagNames[flag] : "",
    rating > 0 ? `${rating} 星` : "",
    colorLabel ? `${assetLibraryColorLabelNames[colorLabel]}色标` : "",
    customLabel ? `标签：${customLabel}` : "",
    keywords.length ? `关键字：${keywords.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("，");
  return (
    <span className="asset-library-badges" title={description || undefined}>
      {colorLabel && (
        <span
          className="asset-library-color-dot"
          style={{ background: annotationColors[colorLabel] }}
          aria-label={`${assetLibraryColorLabelNames[colorLabel]}色标`}
        />
      )}
      {flag !== "none" && <AssetLibraryFlag flag={flag} />}
      {rating > 0 && (
        <span className="asset-library-rating" aria-label={`${rating} 星`}>
          <Star aria-hidden="true" />
          {rating}
        </span>
      )}
      {keywords.length > 0 && (
        <span className="asset-library-keyword-count" aria-label={`${keywords.length} 个关键字`}>
          #{keywords.length}
        </span>
      )}
    </span>
  );
}
