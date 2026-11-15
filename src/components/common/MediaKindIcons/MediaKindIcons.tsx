import type { SVGProps } from "react";

// The asset library's flat media glyphs, drawn on the media bin folder icon's 165 × 142 grid
// in an 84 × 64 footprint. The view box crops that footprint to the share of a 24-unit box a
// lucide icon fills (20 / 24), so the glyphs drop into any slot sized for lucide icons.

export const subtitleGlyphPath = [
  "M46 38h72a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V44a6 6 0 0 1 6-6z",
  "M52 68h36v8H52z M94 68h18v8H94z M52 82h20v8H52z M78 82h34v8H78z",
].join(" ");

export const videoGlyphPath = [
  "M46 38h72a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V44a6 6 0 0 1 6-6z",
  [46, 59, 72, 85, 98, 111].flatMap((x) => [`M${x} 43h7v8h-7z`, `M${x} 89h7v8h-7z`]).join(" "),
  "M49 57h66a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H49a3 3 0 0 1-3-3V60a3 3 0 0 1 3-3z",
].join(" ");

export const audioGlyphPath = [
  "M46 38h72a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V44a6 6 0 0 1 6-6z",
  [
    [51, 64, 76],
    [62, 56, 84],
    [73, 48, 92],
    [84, 60, 80],
    [95, 52, 88],
    [106, 64, 76],
  ]
    .map(([x, top, bottom]) => `M${x} ${top}h7v${bottom - top}h-7z`)
    .join(" "),
].join(" ");

const lucideViewBox = "31.6 19.6 100.8 100.8";

type MediaGlyphProps = SVGProps<SVGSVGElement> & { size?: number | string };

function MediaGlyph({ d, size = 24, ...props }: MediaGlyphProps & { d: string }) {
  return (
    <svg
      viewBox={lucideViewBox}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path fill="currentColor" fillRule="evenodd" d={d} />
    </svg>
  );
}

/** A film strip with sprocket holes and one frame cut out. */
export function VideoGlyph(props: MediaGlyphProps) {
  return <MediaGlyph {...props} d={videoGlyphPath} />;
}

/** A card with waveform bars cut out. */
export function AudioGlyph(props: MediaGlyphProps) {
  return <MediaGlyph {...props} d={audioGlyphPath} />;
}

/** A caption card with two lines of text cut out. */
export function SubtitleGlyph(props: MediaGlyphProps) {
  return <MediaGlyph {...props} d={subtitleGlyphPath} />;
}
