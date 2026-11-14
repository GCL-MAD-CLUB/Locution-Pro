import { open } from "@tauri-apps/plugin-dialog";
import { runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import {
  encoderBinName,
  type TranscodeDestination,
  type TranscodeOptionItem,
} from "../../../../systems/TranscodeSystem";
import { TranscodeDropdown } from "./TranscodeFields";

const destinationItems: TranscodeOptionItem[] = [
  { value: "folder", label: "文件夹（文件管理器 / Finder）" },
  { value: "mediaBin", label: `项目媒体箱中的 ${encoderBinName} 文件夹` },
];

export async function chooseTranscodeFolder(title: string, current?: string) {
  if (!isTauriRuntime()) return null;
  const outcome = await runOperation("transcode.prepare", () =>
    open({ directory: true, multiple: false, title, defaultPath: current || undefined }),
  );
  return outcome.status === "success" && typeof outcome.value === "string" ? outcome.value : null;
}

interface TranscodeDestinationFieldProps {
  destination: TranscodeDestination | null;
  disabled?: boolean;
  /** Resolved folder shown for the media-bin choice. */
  mediaBinDirectory?: string | null;
  onChange: (destination: TranscodeDestination) => void;
}

/** The required output-location choice: a folder on disk or the project's encoder bin. */
export function TranscodeDestinationField({
  destination,
  disabled = false,
  mediaBinDirectory,
  onChange,
}: TranscodeDestinationFieldProps) {
  async function chooseFolder() {
    const directory = await chooseTranscodeFolder(
      "选择输出文件夹",
      destination?.kind === "folder" ? destination.directory : undefined,
    );
    if (directory) onChange({ kind: "folder", directory });
  }

  const missing = !destination || (destination.kind === "folder" && !destination.directory.trim());
  return (
    <div className="transcode-destination">
      <div className="export-output-location">
        <TranscodeDropdown
          ariaLabel="输出位置"
          className={missing ? "is-required" : ""}
          disabled={disabled}
          value={destination?.kind ?? ""}
          fallbackLabel="请选择输出位置（必填）"
          items={destinationItems}
          onChange={(kind) => {
            if (kind === "mediaBin") {
              onChange({ kind: "mediaBin" });
            } else if (destination?.kind === "folder" && destination.directory) {
              onChange(destination);
            } else {
              void chooseFolder();
            }
          }}
        />
        <button
          type="button"
          className="toolbar-button"
          disabled={disabled || destination?.kind === "mediaBin"}
          onClick={() => void chooseFolder()}
        >
          选择…
        </button>
      </div>
      {destination?.kind === "folder" && destination.directory && (
        <p className="transcode-destination-path" title={destination.directory}>
          {destination.directory}
        </p>
      )}
      {destination?.kind === "mediaBin" && (
        <p className="transcode-destination-path" title={mediaBinDirectory ?? ""}>
          完成后自动放入项目媒体箱的 {encoderBinName} 文件夹
          {mediaBinDirectory ? `，文件写入 ${mediaBinDirectory}` : ""}
        </p>
      )}
      {missing && <p className="transcode-required-note">必须选择输出位置后才能开始编码。</p>}
    </div>
  );
}
