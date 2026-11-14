import type { SVGProps } from "react";
import type { AssetLibraryRoot } from "../../../../types";

// Flat glyphs drawn on the media bin folder icon's grid: the same 165 × 142 view box, the
// same 84 × 64 footprint and fill, so they size and read like the folders beside them.

const fill = "var(--color-media-folder-icon)";

function Glyph({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 165 142" fill="none" aria-hidden="true" {...props}>
      <path fill={fill} fillRule="evenodd" d={d} />
    </svg>
  );
}

/** A clapperboard for the project, as a drive icon stands for "此电脑". */
export function AssetLibraryProjectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
      d={[
        "M44 38h76a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z",
        "M58 38h11l-9 16H49z M80 38h11l-9 16H71z M102 38h11l-9 16H93z",
        "M40 58h84v38a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z",
      ].join(" ")}
    />
  );
}

/** A caption card with two lines of text cut out. */
export function AssetLibrarySubtitlesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
      d={[
        "M46 38h72a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V44a6 6 0 0 1 6-6z",
        "M52 68h36v8H52z M94 68h18v8H94z M52 82h20v8H52z M78 82h34v8H78z",
      ].join(" ")}
    />
  );
}

/** A film strip with sprocket holes and one frame cut out. */
export function AssetLibraryStoryboardsIcon(props: SVGProps<SVGSVGElement>) {
  const holes = [46, 59, 72, 85, 98, 111]
    .flatMap((x) => [`M${x} 43h7v8h-7z`, `M${x} 89h7v8h-7z`])
    .join(" ");
  return (
    <Glyph
      {...props}
      d={[
        "M46 38h72a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V44a6 6 0 0 1 6-6z",
        holes,
        "M49 57h66a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H49a3 3 0 0 1-3-3V60a3 3 0 0 1 3-3z",
      ].join(" ")}
    />
  );
}

export const assetLibraryRootIcons: Record<AssetLibraryRoot, typeof AssetLibrarySubtitlesIcon> = {
  subtitles: AssetLibrarySubtitlesIcon,
  storyboards: AssetLibraryStoryboardsIcon,
};
