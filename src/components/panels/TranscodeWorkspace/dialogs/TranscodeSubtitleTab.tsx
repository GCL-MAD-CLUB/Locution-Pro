import { open } from "@tauri-apps/plugin-dialog";
import { ExportField } from "../../ExportWorkspace";
import { runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import {
  containerSupports,
  effectAvailable,
  fileName,
  findContainer,
  sidecarSubtitleFormats,
  subtitleEncoderOptions,
  type TranscodeOptionItem,
  type TranscodeSubtitleMode,
} from "../../../../systems/TranscodeSystem";
import { TranscodeDropdown } from "../controls/TranscodeFields";
import type { TranscodeTabProps } from "./transcodeSettingsTabs";

const subtitleFileExtensions = ["srt", "ass", "ssa", "vtt", "webvtt", "ttml", "sub", "sup"];

export function TranscodeSubtitleTab({
  settings,
  capabilities,
  sourceInfo,
  update,
}: TranscodeTabProps) {
  const { subtitles } = settings;
  const container = findContainer(settings.container);
  const inFile = containerSupports(settings.container, "subtitles");
  const subtitleFile = container?.kind === "subtitle";
  const encoders = subtitleEncoderOptions(capabilities, settings.container);
  const encoderNames = new Set(
    (capabilities?.subtitleEncoders ?? []).map((encoder) => encoder.name),
  );
  const sidecarFormats = sidecarSubtitleFormats.filter(
    (format) => !capabilities || encoderNames.has(format.codec),
  );

  const modeItems: TranscodeOptionItem[] = [];
  if (inFile) {
    modeItems.push({
      value: "convert",
      label: subtitleFile ? "转换为所选字幕格式" : "转换并封装到文件",
    });
    // Only Matroska keeps arbitrary source subtitle codecs unchanged.
    if (!subtitleFile && (!container || container.muxer === "matroska"))
      modeItems.push({ value: "copy", label: "复制字幕流到文件" });
  }
  if (settings.exportVideo && settings.video.codec !== "copy") {
    modeItems.push({ value: "burn", label: "将字幕录制到视频" });
  }
  if (!subtitleFile && sidecarFormats.length > 0) {
    modeItems.push({ value: "sidecar", label: "导出为独立字幕文件" });
  }

  const streamItems: TranscodeOptionItem[] = [
    {
      value: "",
      label: subtitles.mode === "burn" || subtitleFile ? "第一条字幕" : "全部字幕",
    },
    ...(sourceInfo?.subtitles ?? []).map((stream) => ({
      value: String(stream.index),
      label: [
        `第 ${stream.index + 1} 条`,
        stream.language ?? "",
        stream.title ?? "",
        stream.codec,
        stream.bitmap ? "位图" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  ];
  const usesExternal = subtitles.mode !== "sidecar";
  const burnTextUnavailable =
    subtitles.mode === "burn" && !effectAvailable(capabilities, "burnText");

  async function chooseExternal() {
    if (!isTauriRuntime()) return;
    const outcome = await runOperation("transcode.prepare", () =>
      open({
        multiple: false,
        title: "选择字幕文件",
        filters: [{ name: "字幕", extensions: subtitleFileExtensions }],
      }),
    );
    if (outcome.status === "success" && typeof outcome.value === "string") {
      const path = outcome.value;
      update((draft) => void (draft.subtitles.externalPath = path));
    }
  }

  if (modeItems.length === 0) {
    return (
      <div className="transcode-tab">
        <p className="transcode-note">当前格式不包含字幕，也没有可用的字幕导出方式。</p>
      </div>
    );
  }

  return (
    <div className="transcode-tab">
      <ExportField label="导出选项">
        <TranscodeDropdown
          ariaLabel="字幕导出选项"
          value={subtitles.mode}
          items={modeItems}
          fallbackLabel="请选择字幕导出方式"
          onChange={(mode) =>
            update((draft) => {
              draft.subtitles.mode = mode as TranscodeSubtitleMode;
              draft.exportSubtitles = true;
              if (mode === "convert") {
                const names = encoders.flatMap((item) => ("separator" in item ? [] : [item.value]));
                if (!names.includes(draft.subtitles.codec))
                  draft.subtitles.codec = names[0] ?? draft.subtitles.codec;
              }
              if (mode === "sidecar") {
                const format =
                  sidecarFormats.find(
                    (candidate) => candidate.extension === draft.subtitles.sidecarExtension,
                  ) ?? sidecarFormats[0];
                if (format) {
                  draft.subtitles.codec = format.codec;
                  draft.subtitles.sidecarExtension = format.extension;
                }
                draft.subtitles.externalPath = "";
              }
            })
          }
        />
      </ExportField>
      {subtitles.mode === "convert" && (
        <ExportField label="文件格式">
          <TranscodeDropdown
            ariaLabel="字幕格式"
            value={subtitles.codec}
            items={encoders}
            onChange={(codec) => update((draft) => void (draft.subtitles.codec = codec))}
          />
        </ExportField>
      )}
      {subtitles.mode === "sidecar" && (
        <ExportField label="文件格式">
          <TranscodeDropdown
            ariaLabel="独立字幕格式"
            value={subtitles.sidecarExtension}
            items={sidecarFormats.map((format) => ({
              value: format.extension,
              label: format.label,
            }))}
            onChange={(extension) =>
              update((draft) => {
                const format = sidecarFormats.find(
                  (candidate) => candidate.extension === extension,
                );
                if (!format) return;
                draft.subtitles.codec = format.codec;
                draft.subtitles.sidecarExtension = format.extension;
              })
            }
          />
        </ExportField>
      )}
      <ExportField label="字幕轨">
        <TranscodeDropdown
          ariaLabel="字幕轨"
          value={subtitles.stream === null ? "" : String(subtitles.stream)}
          disabled={usesExternal && Boolean(subtitles.externalPath)}
          items={streamItems}
          fallbackLabel={subtitles.stream === null ? undefined : `第 ${subtitles.stream + 1} 条`}
          onChange={(stream) =>
            update((draft) => void (draft.subtitles.stream = stream === "" ? null : Number(stream)))
          }
        />
      </ExportField>
      {usesExternal && (
        <ExportField label="外部字幕" stacked>
          <div className="export-output-location">
            <span className="export-output-path" title={subtitles.externalPath}>
              {subtitles.externalPath ? fileName(subtitles.externalPath) : "使用源内嵌字幕"}
            </span>
            <div className="transcode-inline">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => void chooseExternal()}
              >
                选择…
              </button>
              {subtitles.externalPath && (
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => update((draft) => void (draft.subtitles.externalPath = ""))}
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </ExportField>
      )}
      {sourceInfo && sourceInfo.subtitles.length === 0 && !subtitles.externalPath && (
        <p className="transcode-note">源不包含内嵌字幕；可选择外部字幕文件。</p>
      )}
      {burnTextUnavailable && (
        <p className="transcode-note is-warning">
          当前 FFmpeg 不含文本字幕渲染组件，只能录制位图字幕（如 PGS、DVD 字幕）。
        </p>
      )}
      {subtitles.mode === "sidecar" && (
        <p className="transcode-note">
          每条文本字幕会在输出文件旁生成一个独立文件，文件名带有字幕序号与语言。
        </p>
      )}
    </div>
  );
}
