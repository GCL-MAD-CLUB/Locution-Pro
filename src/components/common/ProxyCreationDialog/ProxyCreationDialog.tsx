import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  canOfferRemux,
  defaultProxyPreset,
  type ProxyCreationOptions,
  type ProxyFrameSize,
  type ProxyLocation,
  type ProxyPreset,
  type ProxyWatermark,
} from "../../../application/media/proxyGeneration";
import { runProxyGenerationTask } from "../../../application/media/proxyGenerationTask";
import { runOperation } from "../../../errors";
import { mediaDisplayName, useProjectPort } from "../../../systems/ProjectSystem";
import { usePreferencesPort } from "../../../systems/PreferencesSystem";
import { isMacOSRuntime, isTauriRuntime } from "../../../platform/tauri/runtime";
import { ModalDialog } from "../ModalDialog";
import { SelectDropdown, selectDropdownItems, type SelectDropdownItem } from "../SelectDropdown";
import "./ProxyCreationDialog.css";

const frameSizeOptions: Array<[ProxyFrameSize, string]> = [
  ["full", "完整"],
  ["half", "二分之一"],
  ["quarter", "四分之一"],
  ["custom", "自定义"],
];

const remuxPresetOption: [ProxyPreset, string] = ["remux", "无损重封装 MOV（推荐，不重新编码）"];

const presetOptions: Array<[ProxyPreset, string]> = [
  ["h264_mp4", "H.264 MP4 代理"],
  ["h264_mp4_all_intra", "H.264 MP4 All-Intra 代理"],
  ["h264_quicktime", "H.264 QuickTime 代理"],
  ["vp8_webm", "VP8 WebM 代理"],
  ["vp9_webm", "VP9 WebM 代理"],
];

function labelForLocation(location: ProxyLocation, customLocation: string, cacheDir: string) {
  if (location === "source_proxy_folder") {
    return "在原始媒体旁边，代理文件夹中";
  }
  if (location === "custom") {
    return customLocation || "选择位置...";
  }
  return cacheDir || "首选项缓存路径";
}

export function ProxyCreationDialog() {
  const { preferences } = usePreferencesPort(["preferences"], []);
  const {
    activeVideoId,
    mediaItems,
    project,
    proxyDialogOpen: isProxyDialogOpen,
    proxyDialogClosed,
    proxyGenerated,
    messagePublished: setMessage,
  } = useProjectPort(
    ["activeVideoId", "mediaItems", "project", "proxyDialogOpen"],
    ["proxyDialogClosed", "proxyGenerated", "messagePublished"],
  );
  const cacheDir = preferences.cache_dir;
  const [frameSize, setFrameSize] = useState<ProxyFrameSize>("full");
  const [customWidth, setCustomWidth] = useState(1280);
  const [customHeight, setCustomHeight] = useState(720);
  const [preset, setPreset] = useState<ProxyPreset>(() =>
    defaultProxyPreset(project, isMacOSRuntime()),
  );
  const [watermark, setWatermark] = useState<ProxyWatermark>("none");
  const [location, setLocation] = useState<ProxyLocation>("source_proxy_folder");
  const [customLocation, setCustomLocation] = useState("");
  const projectDisplayName = mediaDisplayName(project, mediaItems, activeVideoId);
  const remuxOffered = canOfferRemux(project, isMacOSRuntime());
  const isRemux = preset === "remux";

  useEffect(() => {
    if (isProxyDialogOpen) {
      setPreset(defaultProxyPreset(project, isMacOSRuntime()));
    }
    // Reset only when the dialog opens; edits while open belong to the user.
  }, [isProxyDialogOpen]);

  async function chooseCustomLocation(previousLocation: ProxyLocation) {
    const outcome = await runOperation("proxy.generate", () =>
      openDialog({
        directory: true,
        multiple: false,
      }),
    );
    if (outcome.status !== "success") {
      setLocation(previousLocation);
      return;
    }
    const path = Array.isArray(outcome.value) ? outcome.value[0] : outcome.value;
    if (path) {
      setCustomLocation(path);
      setLocation("custom");
    } else {
      setLocation(previousLocation);
    }
  }

  function changeLocation(value: string) {
    if (value === "choose") {
      void chooseCustomLocation(location);
      return;
    }
    setLocation(value as ProxyLocation);
  }

  const locationOptions: Array<SelectDropdownItem<string>> = [
    {
      type: "option",
      value: "source_proxy_folder",
      label: "在原始媒体旁边，代理文件夹中",
    },
    ...(customLocation
      ? [
          {
            type: "option" as const,
            value: "custom",
            label: customLocation,
          },
        ]
      : []),
    {
      type: "option",
      value: "choose",
      label: "选择位置...",
    },
    {
      type: "separator",
    },
    {
      type: "option",
      value: "preferences_cache",
      label: cacheDir || "首选项缓存路径",
    },
  ];

  async function generatePreview(options: ProxyCreationOptions) {
    if (!project) {
      return;
    }
    if (!isTauriRuntime()) {
      setMessage("此功能仅在桌面版可用。");
      return;
    }

    const outcome = await runProxyGenerationTask({
      assetId: project.asset.id,
      displayName: projectDisplayName,
      options,
    });
    if (outcome.status === "success") {
      proxyGenerated(outcome.proxyPath, project.asset.id);
      setMessage(
        options.preset === "remux" ? "已无损重封装，预览保持原画质。" : "已生成预览代理。",
      );
    } else if (outcome.status === "cancelled") {
      setMessage("已取消代理生成。");
    }
  }

  function closeProxyDialog() {
    proxyDialogClosed();
  }

  function confirm() {
    closeProxyDialog();
    void generatePreview({
      frameSize,
      customWidth,
      customHeight,
      preset,
      watermark,
      location,
      customLocation,
    });
  }

  if (!isProxyDialogOpen) {
    return null;
  }

  return (
    <ModalDialog
      title="创建代理"
      bodyClassName="proxy-dialog-body"
      onCancel={closeProxyDialog}
      onConfirm={confirm}
    >
      <div className="proxy-dialog-field proxy-dialog-frame-size">
        <span>帧大小：</span>
        <div className="proxy-dialog-frame-size-controls">
          <ProxySelectControl
            value={frameSize}
            items={selectDropdownItems(frameSizeOptions)}
            onChange={(value) => setFrameSize(value as ProxyFrameSize)}
            disabled={isRemux}
          />
          <div className="proxy-dialog-size-inputs">
            <label>
              宽
              <input
                type="number"
                min={2}
                step={2}
                value={customWidth}
                onChange={(event) => setCustomWidth(Number(event.currentTarget.value))}
                disabled={isRemux || frameSize !== "custom"}
              />
            </label>
            <label>
              高
              <input
                type="number"
                min={2}
                step={2}
                value={customHeight}
                onChange={(event) => setCustomHeight(Number(event.currentTarget.value))}
                disabled={isRemux || frameSize !== "custom"}
              />
            </label>
          </div>
        </div>
      </div>
      <ProxySelect
        label="预设"
        value={preset}
        options={remuxOffered ? [remuxPresetOption, ...presetOptions] : presetOptions}
        onChange={(value) => setPreset(value as ProxyPreset)}
      />
      <ProxySelect
        label="水印"
        value={watermark}
        options={[["none", "无"]]}
        onChange={(value) => setWatermark(value as ProxyWatermark)}
      />
      <div className="proxy-dialog-field">
        <span>位置：</span>
        <ProxySelectControl
          value={location}
          selectedLabel={labelForLocation(location, customLocation, cacheDir)}
          items={locationOptions}
          onChange={changeLocation}
        />
      </div>
    </ModalDialog>
  );
}

interface ProxySelectProps {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}

function ProxySelect({ label, value, options, onChange }: ProxySelectProps) {
  return (
    <div className="proxy-dialog-field">
      <span>{label}：</span>
      <ProxySelectControl value={value} items={selectDropdownItems(options)} onChange={onChange} />
    </div>
  );
}

interface ProxySelectControlProps<T extends string = string> {
  value: string;
  disabled?: boolean;
  selectedLabel?: string;
  items: Array<SelectDropdownItem<T>>;
  onChange: (value: T) => void;
}

function ProxySelectControl<T extends string>({
  value,
  disabled,
  selectedLabel,
  items,
  onChange,
}: ProxySelectControlProps<T>) {
  return (
    <SelectDropdown
      className="proxy-dialog-select"
      menuClassName="proxy-dialog-select-menu"
      value={value as T}
      disabled={disabled}
      selectedLabel={selectedLabel}
      items={items}
      onChange={onChange}
    />
  );
}
