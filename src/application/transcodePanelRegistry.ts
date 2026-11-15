import {
  PanelRegistry,
  createPanelManagerStore,
  dockAreaIds,
  type DockLayoutNode,
  type PanelManagerInitialState,
} from "../components/common/DockLayout";
import { mediaBinPanelDefinition, mediaBinPanelType } from "../components/panels/MediaBin";
import {
  transcodeEncodingPanelDefinition,
  transcodeEncodingPanelType,
  transcodePresetsPanelDefinition,
  transcodePresetsPanelType,
  transcodeQueuePanelDefinition,
  transcodeQueuePanelType,
  transcodeWatchFoldersPanelDefinition,
  transcodeWatchFoldersPanelType,
} from "../components/panels/TranscodeWorkspace/panelDefinitions";
import { ensureTranscodeReady, transcodeQueueStore } from "../systems/TranscodeSystem";

/** Panels of the transcode page; the media bin is the project's own. */
export const transcodePanelRegistry = new PanelRegistry([
  mediaBinPanelDefinition,
  transcodeQueuePanelDefinition,
  transcodeWatchFoldersPanelDefinition,
  transcodePresetsPanelDefinition,
  transcodeEncodingPanelDefinition,
]);

/** Ids of the panels the transcode page opens by default, in window-menu order. */
export const transcodePanels = [
  { id: "transcode-media", type: mediaBinPanelType, label: "媒体箱", areaId: "transcodeLeftTop" },
  {
    id: "transcode-queue",
    type: transcodeQueuePanelType,
    label: "队列",
    areaId: "transcodeRightTop",
  },
  {
    id: "transcode-watch-folders",
    type: transcodeWatchFoldersPanelType,
    label: "监视文件夹",
    areaId: "transcodeRightTop",
  },
  {
    id: "transcode-presets",
    type: transcodePresetsPanelType,
    label: "预设浏览器",
    areaId: "transcodeLeftBottom",
  },
  {
    id: "transcode-encoding",
    type: transcodeEncodingPanelType,
    label: "编码",
    areaId: "transcodeRightBottom",
  },
] as const;

export type TranscodePanelId = (typeof transcodePanels)[number]["id"];

function panelParams(type: string) {
  return type === mediaBinPanelType ? { rootFolderId: null } : {};
}

export const initialTranscodePanelState: PanelManagerInitialState = {
  instances: transcodePanels.map(({ id, type }) => ({ id, type, params: panelParams(type) })),
  layout: {
    root: {
      type: "split",
      id: "transcode-columns",
      axis: "x",
      ratio: 0.4,
      first: {
        type: "split",
        id: "transcode-left-rows",
        axis: "y",
        ratio: 0.55,
        first: { type: "area", areaId: "transcodeLeftTop" },
        second: { type: "area", areaId: "transcodeLeftBottom" },
      },
      second: {
        type: "split",
        id: "transcode-right-rows",
        axis: "y",
        ratio: 0.55,
        first: { type: "area", areaId: "transcodeRightTop" },
        second: { type: "area", areaId: "transcodeRightBottom" },
      },
    },
    areas: {
      transcodeLeftTop: { tabs: ["transcode-media"], activePanelId: "transcode-media" },
      transcodeLeftBottom: { tabs: ["transcode-presets"], activePanelId: "transcode-presets" },
      transcodeRightTop: {
        tabs: ["transcode-queue", "transcode-watch-folders"],
        activePanelId: "transcode-queue",
      },
      transcodeRightBottom: { tabs: ["transcode-encoding"], activePanelId: "transcode-encoding" },
    },
  },
  focusedPanelId: "transcode-queue",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLayoutNode(value: unknown): value is DockLayoutNode {
  if (!isRecord(value)) return false;
  if (value.type === "area") return typeof value.areaId === "string";
  return (
    value.type === "split" &&
    typeof value.id === "string" &&
    (value.axis === "x" || value.axis === "y") &&
    typeof value.ratio === "number" &&
    isLayoutNode(value.first) &&
    isLayoutNode(value.second)
  );
}

/**
 * A saved layout made usable: panels this build does not know are dropped,
 * and anything malformed falls back to the default layout.
 */
export function restoreTranscodePanelState(saved: unknown): PanelManagerInitialState {
  if (!isRecord(saved) || !Array.isArray(saved.instances) || !isRecord(saved.layout)) {
    return initialTranscodePanelState;
  }
  const { root, areas } = saved.layout;
  if (!isLayoutNode(root) || !isRecord(areas)) return initialTranscodePanelState;
  const instances = saved.instances.filter(
    (instance): instance is PanelManagerInitialState["instances"][number] =>
      isRecord(instance) &&
      typeof instance.id === "string" &&
      typeof instance.type === "string" &&
      Boolean(transcodePanelRegistry.get(instance.type)),
  );
  if (instances.length === 0) return initialTranscodePanelState;
  const ids = new Set(instances.map((instance) => instance.id));
  const restoredAreas = Object.fromEntries(
    dockAreaIds(root).map((areaId) => {
      const area = areas[areaId];
      const tabs = (isRecord(area) && Array.isArray(area.tabs) ? area.tabs : []).filter(
        (tab): tab is string => typeof tab === "string" && ids.has(tab),
      );
      const active = isRecord(area) ? area.activePanelId : null;
      return [
        areaId,
        {
          tabs,
          activePanelId:
            typeof active === "string" && tabs.includes(active) ? active : (tabs[0] ?? null),
        },
      ];
    }),
  );
  const focused = saved.focusedPanelId;
  return {
    instances,
    layout: { root, areas: restoredAreas },
    focusedPanelId: typeof focused === "string" && ids.has(focused) ? focused : instances[0].id,
  };
}

/**
 * The transcode page's panels live outside React so the layout survives
 * switching pages and the window menu can open panels from anywhere.
 */
export const transcodePanelStore = createPanelManagerStore(
  initialTranscodePanelState,
  initialTranscodePanelState,
);

let layoutRestored = false;

/** Applies the saved layout once the transcode config has loaded. */
function restoreSavedLayout() {
  const { configLoaded, panelLayout } = transcodeQueueStore.getState();
  if (layoutRestored || !configLoaded) return;
  layoutRestored = true;
  const restored = restoreTranscodePanelState(panelLayout);
  transcodePanelStore.setState({
    instances: Object.fromEntries(restored.instances.map((instance) => [instance.id, instance])),
    layout: restored.layout,
    focusedPanelId: restored.focusedPanelId,
  });
}

restoreSavedLayout();
transcodeQueueStore.subscribe(restoreSavedLayout);
// Layout changes are saved with the rest of the transcode config.
transcodePanelStore.subscribe((state, previous) => {
  if (!layoutRestored) return;
  if (
    state.instances === previous.instances &&
    state.layout === previous.layout &&
    state.focusedPanelId === previous.focusedPanelId
  )
    return;
  transcodeQueueStore.getState().setPanelLayout({
    instances: Object.values(state.instances),
    layout: state.layout,
    focusedPanelId: state.focusedPanelId,
  });
});

/**
 * Opens one of the transcode page's panels, or brings it to the front. It
 * waits for the saved layout first, so restoring it cannot undo the request.
 */
export function showTranscodePanel(id: TranscodePanelId) {
  const panel = transcodePanels.find((candidate) => candidate.id === id);
  if (!panel) return;
  void ensureTranscodeReady().then(() => {
    transcodePanelStore.getState().openPanel({
      id: panel.id,
      type: panel.type,
      params: panelParams(panel.type),
      placement: { areaId: panel.areaId },
    });
  });
}
