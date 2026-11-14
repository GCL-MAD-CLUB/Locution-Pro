import { definePanel } from "../../common/DockLayout";
import { editTranscodeOutput } from "./transcodeEditor";
import { TranscodeEncodingPanel } from "./views/TranscodeEncodingPanel";
import { TranscodePresetBrowser } from "./views/TranscodePresetBrowser";
import { TranscodeQueue } from "./views/TranscodeQueue";
import { TranscodeWatchFolders } from "./views/TranscodeWatchFolders";

export const transcodeQueuePanelType = "transcode-queue";
export const transcodeWatchFoldersPanelType = "transcode-watch-folders";
export const transcodePresetsPanelType = "transcode-presets";
export const transcodeEncodingPanelType = "transcode-encoding";

export const transcodeQueuePanelDefinition = definePanel({
  type: transcodeQueuePanelType,
  Component: () => (
    <div className="transcode-panel">
      <TranscodeQueue onEditOutput={editTranscodeOutput} />
    </div>
  ),
  useTitle: () => "队列",
});

export const transcodeWatchFoldersPanelDefinition = definePanel({
  type: transcodeWatchFoldersPanelType,
  Component: () => (
    <div className="transcode-panel">
      <TranscodeWatchFolders />
    </div>
  ),
  useTitle: () => "监视文件夹",
});

export const transcodePresetsPanelDefinition = definePanel({
  type: transcodePresetsPanelType,
  Component: () => (
    <div className="transcode-panel">
      <TranscodePresetBrowser />
    </div>
  ),
  useTitle: () => "预设浏览器",
});

export const transcodeEncodingPanelDefinition = definePanel({
  type: transcodeEncodingPanelType,
  Component: () => (
    <div className="transcode-panel">
      <TranscodeEncodingPanel />
    </div>
  ),
  useTitle: () => "编码",
});
