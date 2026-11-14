import { ExportField } from "../../ExportWorkspace";
import {
  audioBitrateOptions,
  audioEncoderOptions,
  audioEncoderUsesBitrate,
  channelOptions,
  findContainer,
  sampleRateOptions,
  type TranscodeAudioTracks,
  type TranscodeOptionItem,
} from "../../../../systems/TranscodeSystem";
import { TranscodeDropdown } from "../controls/TranscodeFields";
import type { TranscodeTabProps } from "./transcodeSettingsTabs";

const trackItems: TranscodeOptionItem[] = [
  { value: "all", label: "全部音轨" },
  { value: "first", label: "仅第一条音轨" },
];

export function TranscodeAudioTab({
  settings,
  capabilities,
  sourceInfo,
  update,
}: TranscodeTabProps) {
  const { audio } = settings;
  const copy = audio.codec === "copy";
  const singleTrack = findContainer(settings.container)?.kind === "audio";
  const bitrateItems = audioBitrateOptions.some(
    (option) => option.value === String(audio.bitrateKbps),
  )
    ? audioBitrateOptions
    : [
        ...audioBitrateOptions,
        ...(audio.bitrateKbps
          ? [{ value: String(audio.bitrateKbps), label: `${audio.bitrateKbps} kbps` }]
          : []),
      ];

  return (
    <div className="transcode-tab">
      <div className="transcode-tab-actions">
        <button
          type="button"
          className="toolbar-button"
          disabled={copy}
          onClick={() =>
            update((draft) => {
              draft.audio.sampleRate = null;
              draft.audio.channels = null;
            })
          }
        >
          匹配源
        </button>
      </div>
      <h3 className="export-settings-subheading">基本音频设置</h3>
      <ExportField label="编码器">
        <TranscodeDropdown
          ariaLabel="音频编码器"
          value={audio.codec}
          items={audioEncoderOptions(capabilities, settings.container)}
          onChange={(codec) =>
            update((draft) => {
              draft.audio.codec = codec;
              if (!audioEncoderUsesBitrate(codec)) draft.audio.bitrateKbps = null;
              else if (!draft.audio.bitrateKbps) draft.audio.bitrateKbps = 320;
            })
          }
        />
      </ExportField>
      {copy ? (
        <p className="transcode-note">流复制直接保留源音频流；响度标准化等效果需要重新编码。</p>
      ) : (
        <>
          <ExportField label="采样速率">
            <TranscodeDropdown
              ariaLabel="采样速率"
              value={audio.sampleRate ? String(audio.sampleRate) : ""}
              items={sampleRateOptions}
              onChange={(rate) =>
                update((draft) => void (draft.audio.sampleRate = rate ? Number(rate) : null))
              }
            />
          </ExportField>
          <ExportField label="通道">
            <TranscodeDropdown
              ariaLabel="通道"
              value={audio.channels ? String(audio.channels) : ""}
              items={channelOptions}
              onChange={(channels) =>
                update((draft) => void (draft.audio.channels = channels ? Number(channels) : null))
              }
            />
          </ExportField>
          {audioEncoderUsesBitrate(audio.codec) && (
            <>
              <h3 className="export-settings-subheading">比特率设置</h3>
              <ExportField label="比特率">
                <TranscodeDropdown
                  ariaLabel="音频比特率"
                  value={String(audio.bitrateKbps ?? 320)}
                  items={bitrateItems}
                  onChange={(bitrate) =>
                    update((draft) => void (draft.audio.bitrateKbps = Number(bitrate)))
                  }
                />
              </ExportField>
            </>
          )}
        </>
      )}
      <ExportField label="音轨">
        <TranscodeDropdown
          ariaLabel="音轨"
          value={singleTrack ? "first" : audio.tracks}
          disabled={singleTrack}
          items={trackItems}
          onChange={(tracks) =>
            update((draft) => void (draft.audio.tracks = tracks as TranscodeAudioTracks))
          }
        />
      </ExportField>
      {sourceInfo && sourceInfo.audio.length > 1 && (
        <p className="transcode-note">源包含 {sourceInfo.audio.length} 条音轨。</p>
      )}
    </div>
  );
}
