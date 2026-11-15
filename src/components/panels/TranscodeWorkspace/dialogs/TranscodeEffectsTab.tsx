import { open } from "@tauri-apps/plugin-dialog";
import { useState, type ReactNode } from "react";
import { ExportField, ExportSettingsGroup } from "../../ExportWorkspace";
import { runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import {
  effectAvailable,
  fileName,
  overlayPositionOptions,
  type TranscodeEffectKey,
  type TranscodeEffects,
  type TranscodeOptionItem,
  type TranscodeOverlayPosition,
  type TranscodeTextContent,
} from "../../../../systems/TranscodeSystem";
import { TranscodeDropdown, TranscodeNumberField } from "../controls/TranscodeFields";
import type { TranscodeTabProps } from "./transcodeSettingsTabs";

const toneMappingItems: TranscodeOptionItem[] = [
  { value: "hable", label: "Hable（电影感）" },
  { value: "mobius", label: "Mobius（保留细节）" },
  { value: "reinhard", label: "Reinhard" },
  { value: "clip", label: "裁切" },
  { value: "linear", label: "线性" },
];

const textContentItems: TranscodeOptionItem[] = [
  { value: "sourceName", label: "源文件名" },
  { value: "outputName", label: "输出文件名" },
  { value: "none", label: "无（仅前缀与后缀）" },
];

async function pickFile(title: string, extensions: string[]) {
  if (!isTauriRuntime()) return null;
  const outcome = await runOperation("transcode.prepare", () =>
    open({ multiple: false, title, filters: [{ name: title, extensions }] }),
  );
  return outcome.status === "success" && typeof outcome.value === "string" ? outcome.value : null;
}

function FileField({
  label,
  path,
  title,
  extensions,
  onChange,
}: {
  label: string;
  path: string;
  title: string;
  extensions: string[];
  onChange: (path: string) => void;
}) {
  return (
    <ExportField label={label}>
      <div className="export-output-location">
        <span className="export-output-path" title={path}>
          {path ? fileName(path) : "未选择"}
        </span>
        <button
          type="button"
          className="toolbar-button"
          onClick={() =>
            void pickFile(title, extensions).then((picked) => picked && onChange(picked))
          }
        >
          选择…
        </button>
      </div>
    </ExportField>
  );
}

function PercentField({
  label,
  value,
  min,
  max,
  onChange,
  unit = "%",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <ExportField label={label}>
      <div className="transcode-inline">
        <TranscodeNumberField
          ariaLabel={label}
          value={value}
          min={min}
          max={max}
          step={0.1}
          onChange={(next) => onChange(next ?? value)}
        />
        <span className="transcode-hint">{unit}</span>
      </div>
    </ExportField>
  );
}

function PositionField({
  value,
  onChange,
}: {
  value: TranscodeOverlayPosition;
  onChange: (value: TranscodeOverlayPosition) => void;
}) {
  return (
    <ExportField label="位置">
      <TranscodeDropdown
        ariaLabel="位置"
        value={value}
        items={overlayPositionOptions}
        onChange={(position) => onChange(position as TranscodeOverlayPosition)}
      />
    </ExportField>
  );
}

type EffectGroup = keyof TranscodeEffects;

export function TranscodeEffectsTab({ settings, capabilities, update }: TranscodeTabProps) {
  const [openGroup, setOpenGroup] = useState<EffectGroup | null>(null);
  const { effects } = settings;
  const videoEncoded = settings.exportVideo && settings.video.codec !== "copy";
  const audioEncoded = settings.exportAudio && settings.audio.codec !== "copy";

  function group(
    key: EffectGroup,
    title: string,
    available: boolean,
    reason: string,
    children: ReactNode,
  ) {
    const filterKey: TranscodeEffectKey = key;
    const installed = effectAvailable(capabilities, filterKey);
    if (!installed) return null;
    return (
      <ExportSettingsGroup
        key={key}
        title={title}
        open={openGroup === key}
        onToggle={() => setOpenGroup(openGroup === key ? null : key)}
        enabled={available && effects[key].enabled}
        switchDisabled={!available}
        onEnabledChange={(enabled) =>
          update((draft) => void (draft.effects[key].enabled = enabled))
        }
      >
        {available ? children : <p className="transcode-note">{reason}</p>}
      </ExportSettingsGroup>
    );
  }

  const needsVideo = "需要导出并重新编码视频。";
  const needsAudio = "需要导出并重新编码音频。";
  const set = <K extends EffectGroup>(key: K, patch: Partial<TranscodeEffects[K]>) =>
    update((draft) => void Object.assign(draft.effects[key], patch));

  return (
    <div className="transcode-tab transcode-effects">
      {group(
        "toneMapping",
        "色调映射（HDR 转 SDR）",
        videoEncoded,
        needsVideo,
        <ExportField label="算法">
          <TranscodeDropdown
            ariaLabel="色调映射算法"
            value={effects.toneMapping.algorithm}
            items={toneMappingItems}
            onChange={(algorithm) => set("toneMapping", { algorithm })}
          />
        </ExportField>,
      )}
      {group(
        "lut",
        "LUT",
        videoEncoded,
        needsVideo,
        <FileField
          label="已应用"
          path={effects.lut.path}
          title="选择 LUT"
          extensions={["cube", "3dl", "dat", "m3d", "csp"]}
          onChange={(path) => set("lut", { path })}
        />,
      )}
      {group(
        "imageOverlay",
        "图像叠加",
        videoEncoded,
        needsVideo,
        <>
          <FileField
            label="已应用"
            path={effects.imageOverlay.path}
            title="选择图像"
            extensions={["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"]}
            onChange={(path) => set("imageOverlay", { path })}
          />
          <PositionField
            value={effects.imageOverlay.position}
            onChange={(position) => set("imageOverlay", { position })}
          />
          <ExportField label="偏移 (X,Y)">
            <div className="transcode-inline">
              <TranscodeNumberField
                ariaLabel="水平偏移"
                value={effects.imageOverlay.offsetX}
                min={-10000}
                max={10000}
                onChange={(offsetX) => set("imageOverlay", { offsetX: offsetX ?? 0 })}
              />
              <TranscodeNumberField
                ariaLabel="垂直偏移"
                value={effects.imageOverlay.offsetY}
                min={-10000}
                max={10000}
                onChange={(offsetY) => set("imageOverlay", { offsetY: offsetY ?? 0 })}
              />
            </div>
          </ExportField>
          <PercentField
            label="大小"
            value={effects.imageOverlay.scalePercent}
            min={1}
            max={1000}
            onChange={(scalePercent) => set("imageOverlay", { scalePercent })}
          />
          <PercentField
            label="不透明度"
            value={effects.imageOverlay.opacityPercent}
            min={0}
            max={100}
            onChange={(opacityPercent) => set("imageOverlay", { opacityPercent })}
          />
        </>,
      )}
      {group(
        "textOverlay",
        "文本叠加",
        videoEncoded,
        needsVideo,
        <>
          <ExportField label="前缀">
            <input
              className="export-text-input"
              aria-label="文本前缀"
              value={effects.textOverlay.prefix}
              onChange={(event) => set("textOverlay", { prefix: event.currentTarget.value })}
            />
          </ExportField>
          <ExportField label="格式">
            <TranscodeDropdown
              ariaLabel="文本内容"
              value={effects.textOverlay.content}
              items={textContentItems}
              onChange={(content) =>
                set("textOverlay", { content: content as TranscodeTextContent })
              }
            />
          </ExportField>
          <ExportField label="后缀">
            <input
              className="export-text-input"
              aria-label="文本后缀"
              value={effects.textOverlay.suffix}
              onChange={(event) => set("textOverlay", { suffix: event.currentTarget.value })}
            />
          </ExportField>
          <PositionField
            value={effects.textOverlay.position}
            onChange={(position) => set("textOverlay", { position })}
          />
          <PercentField
            label="大小"
            value={effects.textOverlay.sizePercent}
            min={1}
            max={50}
            unit="% 画面高度"
            onChange={(sizePercent) => set("textOverlay", { sizePercent })}
          />
          <PercentField
            label="不透明度"
            value={effects.textOverlay.opacityPercent}
            min={0}
            max={100}
            onChange={(opacityPercent) => set("textOverlay", { opacityPercent })}
          />
        </>,
      )}
      {group(
        "timecodeOverlay",
        "时间码叠加",
        videoEncoded,
        needsVideo,
        <>
          <PositionField
            value={effects.timecodeOverlay.position}
            onChange={(position) => set("timecodeOverlay", { position })}
          />
          <PercentField
            label="大小"
            value={effects.timecodeOverlay.sizePercent}
            min={1}
            max={50}
            unit="% 画面高度"
            onChange={(sizePercent) => set("timecodeOverlay", { sizePercent })}
          />
          <PercentField
            label="不透明度"
            value={effects.timecodeOverlay.opacityPercent}
            min={0}
            max={100}
            onChange={(opacityPercent) => set("timecodeOverlay", { opacityPercent })}
          />
        </>,
      )}
      {group(
        "timeTuner",
        "时间调谐器",
        videoEncoded && (!settings.exportAudio || audioEncoded),
        "需要重新编码视频与音频。",
        <PercentField
          label="持续时间更改"
          value={effects.timeTuner.durationChangePercent}
          min={-10}
          max={10}
          onChange={(durationChangePercent) => set("timeTuner", { durationChangePercent })}
        />,
      )}
      {group(
        "videoLimiter",
        "视频限幅器",
        videoEncoded,
        needsVideo,
        <PercentField
          label="剪辑层级"
          value={effects.videoLimiter.clipLevelIre}
          min={100}
          max={109}
          unit="IRE"
          onChange={(clipLevelIre) => set("videoLimiter", { clipLevelIre })}
        />,
      )}
      {group(
        "loudness",
        "响度标准化 (EBU R128)",
        audioEncoded,
        needsAudio,
        <>
          <PercentField
            label="目标响度"
            value={effects.loudness.targetLufs}
            min={-70}
            max={-5}
            unit="LUFS"
            onChange={(targetLufs) => set("loudness", { targetLufs })}
          />
          <PercentField
            label="响度范围"
            value={effects.loudness.rangeLu}
            min={1}
            max={50}
            unit="LU"
            onChange={(rangeLu) => set("loudness", { rangeLu })}
          />
          <PercentField
            label="真实峰值"
            value={effects.loudness.truePeakDb}
            min={-9}
            max={0}
            unit="dBTP"
            onChange={(truePeakDb) => set("loudness", { truePeakDb })}
          />
        </>,
      )}
    </div>
  );
}
