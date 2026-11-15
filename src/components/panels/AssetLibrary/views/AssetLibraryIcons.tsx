import type { SVGProps } from "react";
import type { AssetLibraryRoot } from "../../../../types";
import { Captions, Film } from "lucide-react";
import { OfflineFileIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import type { AssetLibraryNode } from "../model/nodes";

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

/** A house with its door cut out, for the home. */
export function AssetLibraryHomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
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

// The media bin folder, with its library's motif cut out of the body so a folder shows
// what it holds.
const folderTab = "M40 44v-2a4 4 0 0 1 4-4h24l6 6z";

const folderBody = "M40 48h78a6 6 0 0 1 6 6v42a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V48z";

/** A folder with two lines of caption text along its foot. */
export function AssetLibrarySubtitlesFolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph
      {...props}
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
  return <Glyph {...props} d={[folderTab, folderBody, holes].join(" ")} />;
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
  const Icon = subtitle ? Captions : Film;
  return (
    <span className={`media-bin-kind-icon ${subtitle ? "subtitle" : "video"}`}>
      <Icon aria-hidden="true" />
    </span>
  );
}
