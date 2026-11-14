import { ExportField } from "../../ExportWorkspace";
import { applyContainer, containerOptions } from "../../../../systems/TranscodeSystem";
import { TranscodeCheck, TranscodeDropdown } from "../controls/TranscodeFields";
import type { TranscodeTabProps } from "./transcodeSettingsTabs";

const fastStartMuxers = ["mp4", "mov", "ipod", "m4v", "3gp", "3g2", "psp", "f4v"];

interface TranscodeMuxerTabProps extends TranscodeTabProps {
  onContainerChange: (muxer: string) => void;
}

export function TranscodeMuxerTab({
  settings,
  capabilities,
  update,
  onContainerChange,
}: TranscodeMuxerTabProps) {
  return (
    <div className="transcode-tab">
      <h3 className="export-settings-subheading">基本设置</h3>
      <ExportField label="多路复用器">
        <TranscodeDropdown
          ariaLabel="多路复用器"
          value={settings.container}
          items={containerOptions(capabilities)}
          onChange={onContainerChange}
        />
      </ExportField>
      <ExportField label="扩展名">
        <input
          className="export-text-input"
          aria-label="文件扩展名"
          value={settings.extension}
          spellCheck={false}
          onChange={(event) => {
            const extension = event.currentTarget.value
              .replace(/[^\w.+-]/gu, "")
              .replace(/^\.+/u, "");
            update((draft) => void (draft.extension = extension));
          }}
          onBlur={() => {
            if (!settings.extension)
              update((draft) => {
                draft.extension = applyContainer(draft, draft.container, capabilities).extension;
              });
          }}
        />
      </ExportField>
      {fastStartMuxers.includes(settings.container) && (
        <div className="transcode-check-row">
          <TranscodeCheck
            label="快速启动（将索引移到文件开头，便于在线播放）"
            checked={settings.fastStart}
            onChange={(checked) => update((draft) => void (draft.fastStart = checked))}
          />
        </div>
      )}
    </div>
  );
}
