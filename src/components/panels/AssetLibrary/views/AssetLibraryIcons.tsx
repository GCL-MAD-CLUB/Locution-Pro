import type { SVGProps } from "react";
import type { AssetLibraryRoot } from "../../../../types";
import {
  SubtitleGlyph,
  subtitleGlyphPath,
  VideoGlyph,
  videoGlyphPath,
  OfflineFileIcon,
} from "../../../common/MediaKindIcons";
import type { AssetLibraryNode } from "../model/nodes";

// Flat glyphs drawn on the media bin folder icon's grid: the same 165 × 142 view box and
// 84 × 64 footprint, so they size like the folders beside them. Each place has its own
// tone; a library's folders take a muted, greyed version of the library's colour.

const glyphTones = {
  home: "var(--color-asset-library-home-icon)",
  project: "var(--color-asset-library-project-icon)",
  subtitles: "var(--color-asset-library-subtitles-icon)",
  storyboards: "var(--color-asset-library-storyboards-icon)",
  "subtitles-folder": "var(--color-asset-library-subtitles-folder-icon)",
  "storyboards-folder": "var(--color-asset-library-storyboards-folder-icon)",
} as const;

type GlyphTone = keyof typeof glyphTones;

function Glyph({ d, tone, ...props }: SVGProps<SVGSVGElement> & { d: string; tone: GlyphTone }) {
  return (
    <svg viewBox="0 0 165 142" fill="none" aria-hidden="true" {...props}>
      <path fill={glyphTones[tone]} fillRule="evenodd" d={d} />
    </svg>
  );
}

/** A house with its door cut out, for the home. */
export function AssetLibraryHomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
      tone="home"
      d={[
        "M82 34a6 6 0 0 1 4 1.6l36 31.4a6 6 0 0 1 2 4.5V96a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V71.5a6 6 0 0 1 2-4.5l36-31.4A6 6 0 0 1 82 34z",
        "M74 102V80a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v22z",
      ].join(" ")}
    />
  );
}

/** A clapperboard for the project, as a drive icon stands for "此电脑". */
export function AssetLibraryProjectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
      tone="project"
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
  return <Glyph {...props} tone="subtitles" d={subtitleGlyphPath} />;
}

/** A film strip with sprocket holes and one frame cut out. */
export function AssetLibraryStoryboardsIcon(props: SVGProps<SVGSVGElement>) {
  return <Glyph {...props} tone="storyboards" d={videoGlyphPath} />;
}

export const assetLibraryRootIcons: Record<AssetLibraryRoot, typeof AssetLibrarySubtitlesIcon> = {
  subtitles: AssetLibrarySubtitlesIcon,
  storyboards: AssetLibraryStoryboardsIcon,
};

// The media bin folder, with its library's motif cut out of the body so a folder shows
// what it holds.
const folderTab = "M40 44v-2a4 4 0 0 1 4-4h24l6 6z";

const folderBody = "M40 48h78a6 6 0 0 1 6 6v42a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V48z";

/** A folder with two lines of caption text along its foot. */
export function AssetLibrarySubtitlesFolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
      tone="subtitles-folder"
      d={[
        folderTab,
        folderBody,
        "M52 74h36v8H52z M94 74h18v8H94z M52 87h20v8H52z M78 87h34v8H78z",
      ].join(" ")}
    />
  );
}

/** A folder with film sprocket holes along its top and foot. */
export function AssetLibraryStoryboardsFolderIcon(props: SVGProps<SVGSVGElement>) {
  const holes = [48, 60, 72, 84, 96, 108]
    .flatMap((x) => [`M${x} 54h8v8h-8z`, `M${x} 88h8v8h-8z`])
    .join(" ");
  return (
    <Glyph {...props} tone="storyboards-folder" d={[folderTab, folderBody, holes].join(" ")} />
  );
}

export const assetLibraryFolderIcons: Record<
  AssetLibraryRoot,
  typeof AssetLibrarySubtitlesFolderIcon
> = {
  subtitles: AssetLibrarySubtitlesFolderIcon,
  storyboards: AssetLibraryStoryboardsFolderIcon,
};

/** The media bin's kind glyphs, drawn in one fixed-size box so every row lines up. */
export function AssetLibraryKindIcon({ node }: { node: AssetLibraryNode }) {
  if (node.kind === "library") {
    const Icon = assetLibraryRootIcons[node.root];
    return (
      <span className="media-bin-kind-icon folder">
        <Icon />
      </span>
    );
  }
  if (node.kind === "folder") {
    const Icon = assetLibraryFolderIcons[node.folder.root];
    return (
      <span className="media-bin-kind-icon folder">
        <Icon />
      </span>
    );
  }
  if (!node.media) {
    return (
      <span className="media-bin-kind-icon">
        <OfflineFileIcon
          className="media-bin-offline-icon"
          role="img"
          aria-hidden={false}
          aria-label="媒体离线"
        />
      </span>
    );
  }
  const subtitle = node.entry.root === "subtitles";
  const Icon = subtitle ? SubtitleGlyph : VideoGlyph;
  return (
    <span className={`media-bin-kind-icon ${subtitle ? "subtitle" : "video"}`}>
      <Icon />
    </span>
  );
}
