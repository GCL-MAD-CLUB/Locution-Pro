import { useEffect, useState } from "react";
import { ExportField } from "../../ExportWorkspace";
import {
  effectAvailable,
  frameRateOptions,
  loadTranscodeCodecDetails,
  pixelFormatOptions,
  rateControlOptions,
  retargetVideoCodec,
  videoEncoderOptions,
  videoEncoderTraits,
  type TranscodeOptionItem,
  type TranscodeRateControl,
  type TranscodeScaling,
} from "../../../../systems/TranscodeSystem";
import {
  TranscodeCheck,
  TranscodeDropdown,
  TranscodeNumberField,
} from "../controls/TranscodeFields";
import type { TranscodeTabProps } from "./transcodeSettingsTabs";

const scalingItems: TranscodeOptionItem[] = [
  { value: "fit", label: "缩放以适合（保持宽高比，补黑边）" },
  { value: "fill", label: "缩放以填充（保持宽高比，裁切）" },
  { value: "stretch", label: "拉伸以填充" },
];

const automatic: TranscodeOptionItem = { value: "", label: "自动" };

export function TranscodeVideoTab({
  settings,
  capabilities,
  sourceInfo,
  update,
}: TranscodeTabProps) {
  const { video } = settings;
  const copy = video.codec === "copy";
  const traits = videoEncoderTraits(video.codec);
  const [pixelFormats, setPixelFormats] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setPixelFormats([]);
    void loadTranscodeCodecDetails("encoder", video.codec).then((details) => {
      if (live) setPixelFormats(details?.pixelFormats ?? []);
    });
    return () => {
      live = false;
    };
  }, [video.codec]);

  const source = sourceInfo?.video[0];
  const matchWidth = video.width === null;
  const matchHeight = video.height === null;
  const bitrateMode =
    video.rateControl === "vbr" || video.rateControl === "cbr" || video.rateControl === "twoPass";

  return (
    <div className="transcode-tab">
      <h3 className="export-settings-subheading">基本视频设置</h3>
      <ExportField label="编码器">
        <TranscodeDropdown
          ariaLabel="视频编码器"
          value={video.codec}
          items={videoEncoderOptions(capabilities, settings.container)}
          onChange={(codec) =>
            update((draft) => {
              draft.video = retargetVideoCodec(draft.video, codec);
            })
          }
        />
      </ExportField>
      {copy ? (
        <p className="transcode-note">
          流复制直接保留源视频流，速度最快且不损失画质；缩放、效果与录制字幕需要重新编码。
        </p>
      ) : (
        <>
          <ExportField label="宽度">
            <div className="transcode-inline">
              <TranscodeNumberField
                ariaLabel="宽度"
                value={video.width}
                min={2}
                max={16384}
                disabled={matchWidth}
                placeholder={source?.width ? String(source.width) : "匹配源"}
                onChange={(width) => update((draft) => void (draft.video.width = width))}
              />
              <TranscodeCheck
                label="匹配源"
                checked={matchWidth}
                onChange={(checked) =>
                  update((draft) => {
                    draft.video.width = checked ? null : (source?.width ?? 1920);
                  })
                }
              />
            </div>
          </ExportField>
          <ExportField label="高度">
            <div className="transcode-inline">
              <TranscodeNumberField
                ariaLabel="高度"
                value={video.height}
                min={2}
                max={16384}
                disabled={matchHeight}
                placeholder={source?.height ? String(source.height) : "匹配源"}
                onChange={(height) => update((draft) => void (draft.video.height = height))}
              />
              <TranscodeCheck
                label="匹配源"
                checked={matchHeight}
                onChange={(checked) =>
                  update((draft) => {
                    draft.video.height = checked ? null : (source?.height ?? 1080);
                  })
                }
              />
            </div>
          </ExportField>
          {!matchWidth && !matchHeight && (
            <ExportField label="源缩放">
              <TranscodeDropdown
                ariaLabel="源缩放"
                value={video.scaling}
                items={scalingItems}
                onChange={(scaling) =>
                  update((draft) => void (draft.video.scaling = scaling as TranscodeScaling))
                }
              />
            </ExportField>
          )}
          <ExportField label="帧速率">
            <TranscodeDropdown
              ariaLabel="帧速率"
              value={video.frameRate ?? ""}
              items={frameRateOptions}
              onChange={(rate) => update((draft) => void (draft.video.frameRate = rate || null))}
            />
          </ExportField>
          <ExportField label="像素格式">
            <TranscodeDropdown
              ariaLabel="像素格式"
              value={video.pixelFormat ?? ""}
              items={pixelFormatOptions(pixelFormats)}
              onChange={(format) =>
                update((draft) => void (draft.video.pixelFormat = format || null))
              }
            />
          </ExportField>
          {effectAvailable(capabilities, "deinterlace") && (
            <div className="transcode-check-row">
              <TranscodeCheck
                label="去隔行（将隔行扫描源转为逐行）"
                checked={video.deinterlace}
                onChange={(checked) => update((draft) => void (draft.video.deinterlace = checked))}
              />
            </div>
          )}

          {(traits.speedPresets.length > 0 ||
            traits.profiles.length > 0 ||
            traits.levels.length > 0) && <h3 className="export-settings-subheading">编码设置</h3>}
          {traits.speedPresets.length > 0 && (
            <ExportField label="性能">
              <TranscodeDropdown
                ariaLabel="编码速度"
                value={video.speedPreset ?? ""}
                items={[automatic, ...traits.speedPresets]}
                onChange={(preset) =>
                  update((draft) => void (draft.video.speedPreset = preset || null))
                }
              />
            </ExportField>
          )}
          {traits.profiles.length > 0 && (
            <ExportField label="配置文件">
              <TranscodeDropdown
                ariaLabel="配置文件"
                value={video.profile ?? ""}
                items={[automatic, ...traits.profiles]}
                onChange={(profile) =>
                  update((draft) => void (draft.video.profile = profile || null))
                }
              />
            </ExportField>
          )}
          {traits.levels.length > 0 && (
            <ExportField label="级别">
              <TranscodeDropdown
                ariaLabel="级别"
                value={video.level ?? ""}
                items={[
                  automatic,
                  ...traits.levels.map((level) => ({ value: level, label: level })),
                ]}
                onChange={(level) => update((draft) => void (draft.video.level = level || null))}
              />
            </ExportField>
          )}

          <h3 className="export-settings-subheading">比特率设置</h3>
          <ExportField label="比特率编码">
            <TranscodeDropdown
              ariaLabel="比特率编码"
              value={video.rateControl}
              items={rateControlOptions(video.codec)}
              onChange={(mode) =>
                update((draft) => {
                  draft.video.rateControl = mode as TranscodeRateControl;
                })
              }
            />
          </ExportField>
          {video.rateControl === "quality" && traits.quality && (
            <ExportField label={traits.quality.label}>
              <div className="transcode-inline">
                <TranscodeNumberField
                  ariaLabel={traits.quality.label}
                  value={video.quality}
                  min={traits.quality.min}
                  max={traits.quality.max}
                  onChange={(quality) =>
                    update((draft) => {
                      draft.video.quality =
                        quality ?? traits.quality?.fallback ?? draft.video.quality;
                    })
                  }
                />
                <span className="transcode-hint">
                  {traits.quality.min}–{traits.quality.max}
                  {traits.quality.label.includes("越高") ? "" : "，数值越小质量越高"}
                </span>
              </div>
            </ExportField>
          )}
          {bitrateMode && (
            <>
              <ExportField label="目标比特率">
                <div className="transcode-inline">
                  <TranscodeNumberField
                    ariaLabel="目标比特率"
                    value={video.bitrateKbps}
                    min={50}
                    max={2_000_000}
                    onChange={(bitrate) =>
                      update((draft) => void (draft.video.bitrateKbps = bitrate ?? 10000))
                    }
                  />
                  <span className="transcode-hint">kbps</span>
                </div>
              </ExportField>
              {video.rateControl !== "cbr" && (
                <ExportField label="最大比特率">
                  <div className="transcode-inline">
                    <TranscodeNumberField
                      ariaLabel="最大比特率"
                      value={video.maxBitrateKbps || null}
                      min={50}
                      max={2_000_000}
                      placeholder="由编码器决定"
                      onChange={(bitrate) =>
                        update((draft) => void (draft.video.maxBitrateKbps = bitrate ?? 0))
                      }
                    />
                    <span className="transcode-hint">kbps</span>
                  </div>
                </ExportField>
              )}
            </>
          )}

          <h3 className="export-settings-subheading">高级设置</h3>
          <ExportField label="关键帧间隔">
            <div className="transcode-inline">
              <TranscodeNumberField
                ariaLabel="关键帧间隔"
                value={video.keyframeInterval}
                min={1}
                max={10000}
                placeholder="由编码器决定"
                onChange={(interval) =>
                  update((draft) => void (draft.video.keyframeInterval = interval))
                }
              />
              <span className="transcode-hint">帧</span>
            </div>
          </ExportField>
          <div className="transcode-check-row">
            <TranscodeCheck
              label="使用硬件解码源视频"
              checked={settings.hardwareDecode}
              onChange={(checked) => update((draft) => void (draft.hardwareDecode = checked))}
            />
          </div>
        </>
      )}
      <ExportField label="附加参数" stacked>
        <input
          className="export-text-input"
          aria-label="附加 FFmpeg 参数"
          value={settings.extraArgs}
          placeholder="可选，例如 -tune film"
          spellCheck={false}
          onChange={(event) => {
            const value = event.currentTarget.value;
            update((draft) => void (draft.extraArgs = value));
          }}
        />
      </ExportField>
    </div>
  );
}
