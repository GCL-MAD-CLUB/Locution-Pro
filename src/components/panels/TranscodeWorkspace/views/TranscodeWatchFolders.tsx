import { FolderPlus, ScanSearch, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  allTranscodePresets,
  availablePresets,
  resolvePresetSettings,
  scanTranscodeWatchFolders,
  startTranscodeQueue,
  transcodeQueueStore,
  useTranscodeQueueState,
  type TranscodeOptionItem,
} from "../../../../systems/TranscodeSystem";
import {
  chooseTranscodeFolder,
  TranscodeDestinationField,
} from "../controls/TranscodeDestinationField";
import { TranscodeCheck, TranscodeDropdown } from "../controls/TranscodeFields";

export function TranscodeWatchFolders() {
  const folders = useTranscodeQueueState((state) => state.watchFolders);
  const auto = useTranscodeQueueState((state) => state.autoEncodeWatchFolders);
  const capabilities = useTranscodeQueueState((state) => state.capabilities);
  const userPresets = useTranscodeQueueState((state) => state.userPresets);
  const [scanning, setScanning] = useState(false);
  const store = transcodeQueueStore.getState;
  const presets = availablePresets(allTranscodePresets({ userPresets }), capabilities);
  const presetItems: TranscodeOptionItem[] = presets.map((preset) => ({
    value: preset.id,
    label: `${preset.group} · ${preset.name}`,
  }));

  return (
    <div className="transcode-watch">
      <div className="transcode-panel-toolbar">
        <button
          type="button"
          className="transcode-icon-button"
          title="添加监视文件夹"
          aria-label="添加监视文件夹"
          onClick={() =>
            void chooseTranscodeFolder("添加监视文件夹").then((path) => {
              if (path) store().addWatchFolder(path);
            })
          }
        >
          <FolderPlus />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="立即扫描"
          aria-label="立即扫描"
          disabled={folders.length === 0 || scanning}
          onClick={() => {
            setScanning(true);
            void scanTranscodeWatchFolders({ settle: false })
              .then((queued) => {
                if (queued > 0 && auto) void startTranscodeQueue();
              })
              .finally(() => setScanning(false));
          }}
        >
          <ScanSearch />
        </button>
        <span className="transcode-toolbar-spacer" />
        <TranscodeCheck
          label="自动对监视文件夹编码"
          checked={auto}
          onChange={(checked) => store().setAutoEncodeWatchFolders(checked)}
        />
      </div>
      <div className="transcode-watch-list">
        {folders.length === 0 && (
          <p className="transcode-empty">
            添加监视文件夹后，放入其中的媒体文件会按所选预设自动加入队列；勾选“自动对监视文件夹编码”后会立即开始编码。
          </p>
        )}
        {folders.map((folder) => (
          <section key={folder.id} className="transcode-watch-folder">
            <header>
              <span className="transcode-watch-path" title={folder.path}>
                {folder.path}
              </span>
              <button
                type="button"
                className="transcode-icon-button"
                title="移除监视文件夹"
                aria-label="移除监视文件夹"
                onClick={() => store().removeWatchFolder(folder.id)}
              >
                <Trash2 />
              </button>
            </header>
            <div className="transcode-watch-fields">
              <span>预设</span>
              <TranscodeDropdown
                ariaLabel="监视文件夹预设"
                value={folder.presetId ?? ""}
                items={presetItems}
                fallbackLabel={folder.presetName}
                onChange={(presetId) => {
                  const preset = presets.find((candidate) => candidate.id === presetId);
                  const settings = preset ? resolvePresetSettings(preset, capabilities) : null;
                  if (preset && settings)
                    store().updateWatchFolder(folder.id, {
                      presetId,
                      presetName: preset.name,
                      settings,
                    });
                }}
              />
              <span>输出位置</span>
              <TranscodeDestinationField
                destination={folder.destination}
                onChange={(destination) => store().updateWatchFolder(folder.id, { destination })}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
