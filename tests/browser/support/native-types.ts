import type {
  ExportRangeExtension,
  MediaDocument,
  Preferences,
  ProjectWorkspace,
} from "../../../src/types";
import type { TranscodeSettings } from "../../../src/systems/TranscodeSystem/transcodeTypes";
import type { ImportBrowserConfig } from "../../../src/components/panels/ImportWorkspace/browser/importBrowserConfig";
import type { ImportSettings } from "../../../src/core/editor/import/importBrowserModel";

/** Fields consumed by the native fixture; commands read only their own payload. */
export interface NativeArguments {
  assetId: string;
  clips: Array<{ id: string; outputName: string; startUs: number; endUs: number }>;
  config: unknown;
  directory: string;
  extensions: string[];
  job: { outputDir: string; outputName: string; settings: TranscodeSettings };
  mediaSources: Record<string, MediaDocument>;
  name: string;
  options: {
    directory?: boolean;
    outputDir: string;
    existingFileMode: string;
    rangeExtension?: ExportRangeExtension;
  };
  patch: Partial<ImportBrowserConfig>;
  path: string;
  paths: string[];
  preferences: Preferences;
  projectId: string;
  request: { settings: TranscodeSettings; timeUs: number; encoded: boolean };
  timeUs: number;
  widths: number[];
  workspace: ProjectWorkspace;
  incident: { source: string };
  url: string;
}

export interface NativeCall {
  command: string;
  args: NativeArguments;
}

export type NativeImportConfig = Omit<Partial<ImportBrowserConfig>, "settings"> & {
  settings: Partial<ImportSettings>;
};
