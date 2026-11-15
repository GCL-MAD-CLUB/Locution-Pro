import { open, save } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, Download, Plus, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { invokeCommand, runOperation } from "../../../../errors";
import { isTauriRuntime } from "../../../../platform/tauri/runtime";
import {
  allTranscodePresets,
  containerLabel,
  defaultTranscodeSettings,
  normalizeTranscodeSettings,
  parsePresetFile,
  presetFileExtension,
  resolvePresetSettings,
  selectedOutputIds,
  serializePresetFile,
  transcodeQueueStore,
  useTranscodeQueueState,
  videoEncoderLabel,
  type TranscodePreset,
} from "../../../../systems/TranscodeSystem";

function presetSize(preset: TranscodePreset) {
  const { video } = preset.settings;
  if (!preset.settings.exportVideo) return "—";
  if (video.width && video.height) return `${video.width}x${video.height}`;
  if (video.height) return `${video.height}p`;
  return "基于源";
}

function presetRate(preset: TranscodePreset) {
  const { video, audio, exportVideo } = preset.settings;
  if (!exportVideo) return audio.bitrateKbps ? `${audio.bitrateKbps} kbps` : "—";
  if (video.rateControl === "quality") return `质量 ${video.quality}`;
  if (video.rateControl === "auto" || video.codec === "copy") return "—";
  return `${(video.bitrateKbps / 1000).toFixed(1)} Mbps`;
}

export function TranscodePresetBrowser() {
  const capabilities = useTranscodeQueueState((state) => state.capabilities);
  const userPresets = useTranscodeQueueState((state) => state.userPresets);
  const sources = useTranscodeQueueState((state) => state.sources);
  const selectedIds = useTranscodeQueueState((state) => state.selectedIds);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const byGroup = new Map<string, Array<{ preset: TranscodePreset; usable: boolean }>>();
    // User presets are listed first, like the "用户预设及组" group.
    const presets = [
      ...userPresets.map((preset) => ({ ...preset, group: "用户预设及组" })),
      ...allTranscodePresets({ userPresets: [] }),
    ];
    for (const preset of presets) {
      const text = `${preset.group} ${preset.name} ${containerLabel(preset.settings.container)}`;
      if (search && !text.toLocaleLowerCase().includes(search)) continue;
      const list = byGroup.get(preset.group) ?? [];
      list.push({ preset, usable: resolvePresetSettings(preset, capabilities) !== null });
      byGroup.set(preset.group, list);
    }
    return [...byGroup.entries()];
  }, [capabilities, query, userPresets]);

  const targetOutputs = selectedOutputIds(sources, selectedIds);
  const selectedPreset = groups
    .flatMap(([, list]) => list)
    .find((entry) => entry.preset.id === selected);

  function apply(preset: TranscodePreset) {
    if (targetOutputs.length === 0) return;
    transcodeQueueStore.getState().applyPreset(targetOutputs, preset);
  }

  async function importPreset() {
    if (!isTauriRuntime()) return;
    const picked = await runOperation("transcode.prepare", () =>
      open({
        multiple: true,
        title: "导入预设",
        filters: [{ name: "Locution Pro 转码预设", extensions: [presetFileExtension] }],
      }),
    );
    if (picked.status !== "success" || !picked.value) return;
    const paths = Array.isArray(picked.value) ? picked.value : [picked.value];
    for (const path of paths) {
      const body = await runOperation("transcode.prepare", () =>
        invokeCommand<string>("read_transcode_preset", { path }),
      );
      if (body.status !== "success") continue;
      const parsed = parsePresetFile(body.value);
      if (parsed) {
        transcodeQueueStore
          .getState()
          .saveUserPreset(parsed.name, normalizeTranscodeSettings(parsed.settings), parsed.comment);
      }
    }
  }

  async function exportPreset(preset: TranscodePreset) {
    if (!isTauriRuntime()) return;
    const picked = await runOperation("transcode.prepare", () =>
      save({
        title: "导出预设",
        defaultPath: `${preset.name.replace(/[\\/:*?"<>|]/gu, "_")}.${presetFileExtension}`,
        filters: [{ name: "Locution Pro 转码预设", extensions: [presetFileExtension] }],
      }),
    );
    if (picked.status !== "success" || !picked.value) return;
    const path = picked.value;
    await runOperation("transcode.prepare", () =>
      invokeCommand("write_transcode_preset", { path, body: serializePresetFile(preset) }),
    );
  }

  return (
    <div className="transcode-presets">
      <div className="transcode-panel-toolbar">
        <button
          type="button"
          className="transcode-icon-button"
          title="新建预设"
          aria-label="新建预设"
          onClick={() => {
            const preset = transcodeQueueStore
              .getState()
              .saveUserPreset("新建预设", defaultTranscodeSettings());
            setSelected(preset.id);
          }}
        >
          <Plus />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="删除预设"
          aria-label="删除预设"
          disabled={!selectedPreset || selectedPreset.preset.system}
          onClick={() => {
            if (selectedPreset && !selectedPreset.preset.system) {
              transcodeQueueStore.getState().deleteUserPreset(selectedPreset.preset.id);
              setSelected(null);
            }
          }}
        >
          <Trash2 />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="导入预设"
          aria-label="导入预设"
          onClick={() => void importPreset()}
        >
          <Download />
        </button>
        <button
          type="button"
          className="transcode-icon-button"
          title="导出预设"
          aria-label="导出预设"
          disabled={!selectedPreset}
          onClick={() => selectedPreset && void exportPreset(selectedPreset.preset)}
        >
          <Upload />
        </button>
        <label className="transcode-search">
          <Search />
          <input
            aria-label="搜索预设"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="toolbar-button"
          disabled={!selectedPreset?.usable || targetOutputs.length === 0}
          title={targetOutputs.length === 0 ? "先在队列中选择输出" : "应用到所选输出"}
          onClick={() => selectedPreset && apply(selectedPreset.preset)}
        >
          应用预设
        </button>
      </div>
      <div className="transcode-preset-table" role="tree" aria-label="预设">
        <div className="transcode-preset-row is-heading" aria-hidden="true">
          <span>预设名称</span>
          <span>格式</span>
          <span>编码器</span>
          <span>帧大小</span>
          <span>目标速率</span>
        </div>
        {groups.map(([group, list]) => {
          const isCollapsed = collapsed.has(group);
          return (
            <div key={group} role="group" aria-label={group}>
              <button
                type="button"
                className="transcode-preset-group"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next;
                  })
                }
              >
                {isCollapsed ? <ChevronRight /> : <ChevronDown />}
                {group}
              </button>
              {!isCollapsed &&
                list.map(({ preset, usable }) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="treeitem"
                    aria-selected={selected === preset.id}
                    className={`transcode-preset-row ${selected === preset.id ? "selected" : ""} ${usable ? "" : "is-unavailable"}`}
                    title={
                      usable ? "双击应用到所选输出" : "当前 FFmpeg 不支持此预设所需的格式或编码器"
                    }
                    draggable={usable}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/x-locution-pro-transcode-preset",
                        preset.id,
                      );
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setSelected(preset.id)}
                    onDoubleClick={() => usable && apply(preset)}
                  >
                    <span>{preset.name}</span>
                    <span>{containerLabel(preset.settings.container)}</span>
                    <span>
                      {preset.settings.exportVideo
                        ? videoEncoderLabel(preset.settings.video.codec)
                        : "仅音频/字幕"}
                    </span>
                    <span>{presetSize(preset)}</span>
                    <span>{presetRate(preset)}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
