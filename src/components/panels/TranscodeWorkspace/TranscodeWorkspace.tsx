import { useEffect, useState } from "react";
import {
  PanelHost,
  PanelManagerProvider,
  type PanelManagerInitialState,
} from "../../common/DockLayout";
import { mediaBinPanelType } from "../MediaBin";
import { useProjectPort } from "../../../systems/ProjectSystem";
import {
  ensureTranscodeReady,
  parentDirectory,
  transcodeQueueStore,
  type TranscodeOutput,
  type TranscodeSource,
} from "../../../systems/TranscodeSystem";
import { TranscodeSettingsDialog } from "./dialogs/TranscodeSettingsDialog";
import { TranscodeEncodingPanel } from "./views/TranscodeEncodingPanel";
import { TranscodePresetBrowser } from "./views/TranscodePresetBrowser";
import { TranscodeQueue } from "./views/TranscodeQueue";
import { TranscodeWatchFolders } from "./views/TranscodeWatchFolders";
import "./TranscodeWorkspace.css";

/** The project media bin, reused as the transcode page's media browser. */
const transcodeMediaPanelState: PanelManagerInitialState = {
  instances: [{ id: "transcode-media", type: mediaBinPanelType, params: { rootFolderId: null } }],
  layout: {
    root: { type: "area", areaId: "transcode-media-area" },
    areas: {
      "transcode-media-area": { tabs: ["transcode-media"], activePanelId: "transcode-media" },
    },
  },
  focusedPanelId: "transcode-media",
};

function TranscodeMediaZone() {
  return (
    <PanelManagerProvider initialState={transcodeMediaPanelState}>
      <div className="export-zone-content transcode-media-content">
        <PanelHost instanceId="transcode-media" active />
      </div>
    </PanelManagerProvider>
  );
}

export function TranscodeWorkspace() {
  const { projectFilePath } = useProjectPort(["projectFilePath"], []);
  const [tab, setTab] = useState<"queue" | "watch">("queue");
  const [editing, setEditing] = useState<{
    source: TranscodeSource;
    output: TranscodeOutput;
  } | null>(null);
  const [editingIds, setEditingIds] = useState<string[]>([]);

  useEffect(() => {
    void ensureTranscodeReady();
  }, []);

  useEffect(() => {
    transcodeQueueStore
      .getState()
      .setProjectDirectory(projectFilePath ? parentDirectory(projectFilePath) : "");
  }, [projectFilePath]);

  function editOutput(source: TranscodeSource, output: TranscodeOutput) {
    const state = transcodeQueueStore.getState();
    const selected = new Set(state.selectedIds);
    // Editing a selected output edits every selected, not-yet-running output.
    const ids = selected.has(output.id)
      ? state.sources.flatMap((item) =>
          item.outputs
            .filter((candidate) => selected.has(candidate.id) && candidate.status !== "encoding")
            .map((candidate) => candidate.id),
        )
      : [output.id];
    setEditingIds(ids);
    setEditing({ source, output });
  }

  return (
    <section className="transcode-workspace" aria-label="转码工作区">
      <div className="transcode-workspace-main">
        <section className="export-zone transcode-zone-media">
          <header className="export-zone-header">
            <span className="export-preview-heading">媒体箱</span>
          </header>
          <TranscodeMediaZone />
        </section>
        <section className="export-zone transcode-zone-queue">
          <header className="export-zone-header transcode-zone-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "queue"}
              className={tab === "queue" ? "active" : ""}
              onClick={() => setTab("queue")}
            >
              队列
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "watch"}
              className={tab === "watch" ? "active" : ""}
              onClick={() => setTab("watch")}
            >
              监视文件夹
            </button>
          </header>
          <div className="export-zone-content" role="tabpanel">
            {tab === "queue" ? (
              <TranscodeQueue onEditOutput={editOutput} />
            ) : (
              <TranscodeWatchFolders />
            )}
          </div>
        </section>
        <section className="export-zone transcode-zone-presets">
          <header className="export-zone-header">
            <span className="export-preview-heading">预设浏览器</span>
          </header>
          <div className="export-zone-content">
            <TranscodePresetBrowser />
          </div>
        </section>
        <section className="export-zone transcode-zone-encoding">
          <header className="export-zone-header">
            <span className="export-preview-heading">编码</span>
          </header>
          <div className="export-zone-content">
            <TranscodeEncodingPanel />
          </div>
        </section>
      </div>
      {editing && (
        <TranscodeSettingsDialog
          source={editing.source}
          output={editing.output}
          outputIds={editingIds}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
