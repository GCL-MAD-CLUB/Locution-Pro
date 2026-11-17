import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import { runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import { useProjectPort } from "../../../../systems/ProjectSystem";
import {
  destinationLabel,
  mediaBinFolderOutline,
  type TranscodeBinFolder,
  type TranscodeDestination,
} from "../../../../systems/TranscodeSystem";
import { SelectDropdown, type SelectDropdownItem } from "../../../common/SelectDropdown";
import { MediaBinFolderIcon } from "../../MediaBin/views/MediaBinFolderIcon";

const binValuePrefix = "bin:";
const folderValuePrefix = "dir:";
const chooseFolderValue = "choose";

export async function chooseTranscodeFolder(title: string, current?: string) {
  if (!isTauriRuntime()) return null;
  const outcome = await runOperation("transcode.prepare", () =>
    open({ directory: true, multiple: false, title, defaultPath: current || undefined }),
  );
  return outcome.status === "success" && typeof outcome.value === "string" ? outcome.value : null;
}

function destinationValue(destination: TranscodeDestination | null) {
  if (!destination) return "";
  return destination.kind === "mediaBin"
    ? `${binValuePrefix}${destination.folderId ?? ""}`
    : `${folderValuePrefix}${destination.directory}`;
}

/** The media bin outline first, then the current disk folder and a folder picker. */
function destinationItems(
  folders: readonly TranscodeBinFolder[],
  destination: TranscodeDestination | null,
): Array<SelectDropdownItem<string>> {
  const items: Array<SelectDropdownItem<string>> = [
    { type: "option", value: binValuePrefix, label: "媒体箱" },
    ...mediaBinFolderOutline(folders).map(({ folder }): SelectDropdownItem<string> => ({
      type: "option",
      value: `${binValuePrefix}${folder.id}`,
      label: folder.name,
    })),
    { type: "separator" },
  ];
  if (destination?.kind === "folder" && destination.directory) {
    items.push({
      type: "option",
      value: destinationValue(destination),
      label: destination.directory,
    });
  }
  items.push({ type: "option", value: chooseFolderValue, label: "选择文件夹…" });
  return items;
}

interface TranscodeDestinationFieldProps {
  destination: TranscodeDestination | null;
  disabled?: boolean;
  /** "link" renders the trigger as a queue-row link instead of a form dropdown. */
  variant?: "field" | "link";
  /** Text of the link trigger; defaults to the destination label. */
  linkLabel?: string;
  onChange: (destination: TranscodeDestination) => void;
}

/** The required output location: a media bin folder or a folder on disk. */
export function TranscodeDestinationField({
  destination,
  disabled = false,
  variant = "field",
  linkLabel,
  onChange,
}: TranscodeDestinationFieldProps) {
  const { mediaFolders } = useProjectPort(["mediaFolders"], []);
  const depths = new Map(
    mediaBinFolderOutline(mediaFolders).map(({ folder, depth }) => [folder.id, depth + 1]),
  );
  const label = destinationLabel(destination, mediaFolders);
  const missing = !destination || (destination.kind === "folder" && !destination.directory.trim());

  async function select(value: string) {
    if (value === chooseFolderValue) {
      const directory = await chooseTranscodeFolder(
        "选择输出文件夹",
        destination?.kind === "folder" ? destination.directory : undefined,
      );
      if (directory) onChange({ kind: "folder", directory });
    } else if (value.startsWith(binValuePrefix)) {
      onChange({ kind: "mediaBin", folderId: value.slice(binValuePrefix.length) || null });
    } else if (value.startsWith(folderValuePrefix)) {
      onChange({ kind: "folder", directory: value.slice(folderValuePrefix.length) });
    }
  }

  return (
    <SelectDropdown
      className={`transcode-destination is-${variant} ${variant === "field" ? "export-select" : ""} ${missing ? "is-missing" : ""}`}
      menuClassName="transcode-dropdown-menu transcode-destination-menu"
      menuMinWidth={200}
      menuWidth="content"
      ariaLabel="输出位置"
      disabled={disabled}
      title={linkLabel ?? label}
      value={destinationValue(destination)}
      selectedLabel={label}
      items={destinationItems(mediaFolders, destination)}
      trigger={
        variant === "link" ? (
          <span className="transcode-destination-link-label">{linkLabel ?? label}</span>
        ) : (
          <>
            <span>{label}</span>
            <ChevronDown size={18} />
          </>
        )
      }
      renderOptionLabel={(item) =>
        item.value.startsWith(binValuePrefix) ? (
          <span
            className="transcode-destination-bin-option"
            style={
              {
                "--transcode-destination-depth": depths.get(
                  item.value.slice(binValuePrefix.length),
                ),
              } as CSSProperties
            }
          >
            <MediaBinFolderIcon aria-hidden="true" />
            {item.label}
          </span>
        ) : (
          item.label
        )
      }
      onChange={(value) => void select(value)}
    />
  );
}
