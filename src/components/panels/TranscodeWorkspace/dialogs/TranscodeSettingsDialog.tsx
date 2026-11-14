import { useMemo, useState } from "react";
import { ModalDialog } from "../../../common/ModalDialog";
import { ExportField } from "../../ExportWorkspace";
import {
  allTranscodePresets,
  applyContainer,
  availablePresets,
  cloneTranscodeSettings,
  containerOptions,
  containerSupports,
  estimatedOutputBytes,
  formatBytes,
  formatTimecode,
  outputSummary,
  parseTimecode,
  resolveOutputDirectory,
  resolvePresetSettings,
  sourceSummary,
  transcodeQueueStore,
  useTranscodeQueueState,
  type TranscodeDestination,
  type TranscodeOptionItem,
  type TranscodeOutput,
  type TranscodeSettings,
  type TranscodeSource,
} from "../../../../systems/TranscodeSystem";
import { TranscodeDestinationField } from "../controls/TranscodeDestinationField";
import { TranscodeCheck, TranscodeDropdown } from "../controls/TranscodeFields";
import { TranscodeAudioTab } from "./TranscodeAudioTab";
import { TranscodeEffectsTab } from "./TranscodeEffectsTab";
import { TranscodeMuxerTab } from "./TranscodeMuxerTab";
import { TranscodePreview } from "./TranscodePreview";
import { TranscodeSubtitleTab } from "./TranscodeSubtitleTab";
import { TranscodeVideoTab } from "./TranscodeVideoTab";

type TabId = "effects" | "video" | "audio" | "muxer" | "subtitles";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "effects", label: "效果" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "muxer", label: "多路复用器" },
  { id: "subtitles", label: "字幕" },
];

const customPresetValue = "__custom__";

interface TranscodeSettingsDialogProps {
  source: TranscodeSource;
  output: TranscodeOutput;
  /** Other selected outputs receive the same settings and destination. */
  outputIds: string[];
  onClose: () => void;
}

export function TranscodeSettingsDialog({
  source,
  output,
  outputIds,
  onClose,
}: TranscodeSettingsDialogProps) {
  const capabilities = useTranscodeQueueState((state) => state.capabilities);
  const userPresets = useTranscodeQueueState((state) => state.userPresets);
  const projectDirectory = useTranscodeQueueState((state) => state.projectDirectory);
  const [settings, setSettings] = useState<TranscodeSettings>(() =>
    cloneTranscodeSettings(output.settings),
  );
  const [presetId, setPresetId] = useState<string | null>(output.presetId);
  const [presetName, setPresetName] = useState(output.presetName);
  const [destination, setDestination] = useState<TranscodeDestination | null>(output.destination);
  const [outputName, setOutputName] = useState(output.outputName);
  const [tab, setTab] = useState<TabId>("video");
  const [savingPreset, setSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [rangeDraft, setRangeDraft] = useState({
    start: formatTimecode(output.settings.rangeStartUs),
    end: formatTimecode(output.settings.rangeEndUs),
  });

  const presets = useMemo(
    () => availablePresets(allTranscodePresets({ userPresets }), capabilities),
    [capabilities, userPresets],
  );
  const presetItems: TranscodeOptionItem[] = useMemo(() => {
    const items: TranscodeOptionItem[] = [{ value: customPresetValue, label: "自定义" }];
    let group = "";
    for (const preset of presets) {
      if (preset.group !== group) {
        items.push({ separator: true });
        group = preset.group;
      }
      items.push({ value: preset.id, label: `${preset.group} · ${preset.name}` });
    }
    return items;
  }, [presets]);

  function update(recipe: (draft: TranscodeSettings) => void) {
    setSettings((current) => {
      const draft = cloneTranscodeSettings(current);
      recipe(draft);
      return draft;
    });
    setPresetId(null);
    setPresetName("自定义");
  }

  function changeContainer(muxer: string) {
    const extension = capabilities?.muxers.find((entry) => entry.name === muxer)?.name;
    setSettings((current) => applyContainer(current, muxer, capabilities, extension, source.info));
    setPresetId(null);
    setPresetName("自定义");
  }

  function choosePreset(id: string) {
    const preset = presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    const resolved = resolvePresetSettings(preset, capabilities);
    if (!resolved) return;
    // Keep the trim range: it belongs to this source, not to the preset.
    resolved.rangeStartUs = settings.rangeStartUs;
    resolved.rangeEndUs = settings.rangeEndUs;
    setSettings(resolved);
    setPresetId(preset.id);
    setPresetName(preset.name);
  }

  function commitRange(next: { start: string; end: string }) {
    const start = parseTimecode(next.start);
    const end = parseTimecode(next.end);
    setSettings((current) => ({
      ...current,
      rangeStartUs: start && start > 0 ? start : null,
      rangeEndUs: end && end > (start ?? 0) ? end : null,
    }));
  }

  function changeRangeFromTimeline(startUs: number | null, endUs: number | null) {
    setSettings((current) => ({ ...current, rangeStartUs: startUs, rangeEndUs: endUs }));
    setRangeDraft({ start: formatTimecode(startUs), end: formatTimecode(endUs) });
  }

  function savePreset() {
    const name = newPresetName.trim();
    if (!name) return;
    const preset = transcodeQueueStore
      .getState()
      .saveUserPreset(
        name,
        { ...settings, rangeStartUs: null, rangeEndUs: null },
        settings.comment,
      );
    setPresetId(preset.id);
    setPresetName(preset.name);
    setSavingPreset(false);
    setNewPresetName("");
  }

  const nothingExported =
    !settings.exportVideo && !settings.exportAudio && !settings.exportSubtitles;
  const destinationMissing =
    !destination || (destination.kind === "folder" && !destination.directory.trim());
  const canConfirm = !nothingExported && !destinationMissing && Boolean(outputName.trim());

  function confirm() {
    if (!canConfirm || !destination) return;
    const store = transcodeQueueStore.getState();
    const ids = outputIds.includes(output.id) ? outputIds : [output.id, ...outputIds];
    for (const id of ids) {
      store.updateOutput(id, {
        settings: cloneTranscodeSettings(settings),
        presetId,
        presetName,
        destination: { ...destination },
        ...(id === output.id ? { outputName: outputName.trim() } : {}),
        status: "ready",
        progress: 0,
        outputPath: null,
        failure: null,
      });
    }
    onClose();
  }

  const estimated = estimatedOutputBytes(settings, source.info);
  const mediaBinDirectory = resolveOutputDirectory(
    { kind: "mediaBin" },
    source.path,
    projectDirectory,
  );
  const tabProps = { settings, capabilities, sourceInfo: source.info, update };

  return (
    <ModalDialog
      title="导出设置"
      className="modal-dialog-large transcode-settings-dialog"
      bodyClassName="transcode-settings-body"
      focusTrap
      confirmDisabled={!canConfirm}
      onCancel={onClose}
      onConfirm={confirm}
    >
      <div className="transcode-settings-layout export-settings-panel">
        <div className="transcode-settings-left">
          <TranscodePreview
            source={source}
            settings={settings}
            outputName={outputName}
            onRangeChange={changeRangeFromTimeline}
          />
          <section className="transcode-settings-main">
            <ExportField label="格式">
              <TranscodeDropdown
                ariaLabel="格式"
                value={settings.container}
                items={containerOptions(capabilities)}
                onChange={changeContainer}
              />
            </ExportField>
            <ExportField label="预设">
              <div className="transcode-inline transcode-preset-row">
                <TranscodeDropdown
                  ariaLabel="预设"
                  value={presetId ?? customPresetValue}
                  items={presetItems}
                  fallbackLabel={presetName}
                  onChange={(id) => id !== customPresetValue && choosePreset(id)}
                />
                <button
                  type="button"
                  className="toolbar-button"
                  title="保存为预设"
                  onClick={() => {
                    setSavingPreset(true);
                    setNewPresetName(presetId ? `${presetName} 副本` : "");
                  }}
                >
                  保存预设…
                </button>
              </div>
            </ExportField>
            {savingPreset && (
              <ExportField label="预设名称">
                <div className="transcode-inline">
                  <input
                    className="export-text-input"
                    aria-label="新预设名称"
                    autoFocus
                    value={newPresetName}
                    onChange={(event) => setNewPresetName(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") savePreset();
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setSavingPreset(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="accent-button"
                    disabled={!newPresetName.trim()}
                    onClick={savePreset}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => setSavingPreset(false)}
                  >
                    取消
                  </button>
                </div>
              </ExportField>
            )}
            <ExportField label="注释">
              <input
                className="export-text-input"
                aria-label="注释"
                value={settings.comment}
                onChange={(event) => {
                  const comment = event.currentTarget.value;
                  setSettings((current) => ({ ...current, comment }));
                }}
              />
            </ExportField>
            <ExportField label="输出名称">
              <div className="transcode-inline">
                <input
                  className="export-text-input"
                  aria-label="输出名称"
                  value={outputName}
                  onChange={(event) => setOutputName(event.currentTarget.value)}
                />
                <span className="transcode-hint">.{settings.extension}</span>
              </div>
            </ExportField>
            <ExportField label="输出位置" stacked>
              <TranscodeDestinationField
                destination={destination}
                mediaBinDirectory={mediaBinDirectory}
                onChange={setDestination}
              />
            </ExportField>
            <div className="export-settings-checks transcode-stream-checks">
              <TranscodeCheck
                label="导出视频"
                checked={settings.exportVideo}
                disabled={!containerSupports(settings.container, "video")}
                onChange={(exportVideo) =>
                  update((draft) => void (draft.exportVideo = exportVideo))
                }
              />
              <TranscodeCheck
                label="导出音频"
                checked={settings.exportAudio}
                disabled={!containerSupports(settings.container, "audio")}
                onChange={(exportAudio) =>
                  update((draft) => void (draft.exportAudio = exportAudio))
                }
              />
              <TranscodeCheck
                label="导出字幕"
                checked={settings.exportSubtitles}
                onChange={(exportSubtitles) =>
                  update((draft) => void (draft.exportSubtitles = exportSubtitles))
                }
              />
            </div>
            {nothingExported && (
              <p className="transcode-required-note">请至少导出视频、音频或字幕之一。</p>
            )}

            <h3 className="export-settings-subheading">摘要</h3>
            <dl className="transcode-summary">
              <dt>输出</dt>
              <dd>
                {outputSummary(settings, source.info).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </dd>
              <dt>源</dt>
              <dd>
                {source.infoStatus === "pending" ? (
                  <span>正在读取媒体信息…</span>
                ) : source.infoStatus === "failed" ? (
                  <span>无法读取媒体信息</span>
                ) : (
                  sourceSummary(source.info).map((line) => <span key={line}>{line}</span>)
                )}
              </dd>
            </dl>

            <h3 className="export-settings-subheading">源范围</h3>
            <ExportField label="入点">
              <input
                className="export-text-input"
                aria-label="入点"
                placeholder="00:00:00"
                value={rangeDraft.start}
                onChange={(event) =>
                  setRangeDraft({ ...rangeDraft, start: event.currentTarget.value })
                }
                onBlur={() => commitRange(rangeDraft)}
              />
            </ExportField>
            <ExportField label="出点">
              <input
                className="export-text-input"
                aria-label="出点"
                placeholder="整个剪辑"
                value={rangeDraft.end}
                onChange={(event) =>
                  setRangeDraft({ ...rangeDraft, end: event.currentTarget.value })
                }
                onBlur={() => commitRange(rangeDraft)}
              />
            </ExportField>
            <p className="transcode-note">
              估计文件大小：{estimated === null ? "取决于画面内容" : formatBytes(estimated)}
            </p>
          </section>
        </div>

        <section className="transcode-settings-tabs">
          <div className="transcode-tab-strip" role="tablist" aria-label="导出设置分类">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="transcode-tab-body" role="tabpanel">
            {tab === "effects" && <TranscodeEffectsTab {...tabProps} />}
            {tab === "video" &&
              (settings.exportVideo ? (
                <TranscodeVideoTab {...tabProps} />
              ) : (
                <p className="transcode-note">未导出视频。</p>
              ))}
            {tab === "audio" &&
              (settings.exportAudio ? (
                <TranscodeAudioTab {...tabProps} />
              ) : (
                <p className="transcode-note">未导出音频。</p>
              ))}
            {tab === "muxer" && (
              <TranscodeMuxerTab {...tabProps} onContainerChange={changeContainer} />
            )}
            {tab === "subtitles" &&
              (settings.exportSubtitles ? (
                <TranscodeSubtitleTab {...tabProps} />
              ) : (
                <p className="transcode-note">未导出字幕。</p>
              ))}
          </div>
        </section>
      </div>
    </ModalDialog>
  );
}
