import type {
  TranscodeCapabilities,
  TranscodeSettings,
  TranscodeSourceInfo,
} from "../../../../systems/TranscodeSystem";

/** Shared contract of the export-settings tabs. */
export interface TranscodeTabProps {
  settings: TranscodeSettings;
  capabilities: TranscodeCapabilities | null;
  sourceInfo: TranscodeSourceInfo | null;
  /** Applies a change to a private copy of the settings. */
  update: (recipe: (draft: TranscodeSettings) => void) => void;
}
