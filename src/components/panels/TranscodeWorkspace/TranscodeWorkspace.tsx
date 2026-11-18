import { RenderLifetime } from "../../../runtime/lifetime/RenderLifetime";

import {
  DockLayout,
  PanelManagerProvider,
  PanelRegistryProvider,
  type PanelRegistry,
  type PanelManagerStore,
} from "../../common/DockLayout";
import { ensureTranscodeReady, useTranscodeQueueState } from "../../../systems/TranscodeSystem";
import { TranscodeSettingsDialog } from "./dialogs/TranscodeSettingsDialog";
import { useTranscodeEditor } from "./transcodeEditor";
import "./TranscodeWorkspace.css";

/**
 * The transcode page: dockable panels like the edit page, with its own
 * registry and layout, plus the settings dialog the queue opens.
 */
export function TranscodeWorkspace({
  registry,
  store,
}: {
  registry: PanelRegistry;
  store: PanelManagerStore;
}) {
  const lifetime = new RenderLifetime();

  const editing = useTranscodeEditor((state) => state.editing);
  const closeEditor = useTranscodeEditor((state) => state.close);
  // The saved layout arrives with the config; showing the default first
  // would flash a different arrangement.
  const configLoaded = useTranscodeQueueState((state) => state.configLoaded);

  lifetime.useAfterCommit(() => {
    void ensureTranscodeReady();
  }, []);

  return lifetime.render(
    <>
      {configLoaded ? (
        <PanelRegistryProvider registry={registry}>
          <PanelManagerProvider store={store}>
            <DockLayout />
          </PanelManagerProvider>
        </PanelRegistryProvider>
      ) : (
        <main className="workspace dock-workspace" aria-busy="true" />
      )}
      {editing && (
        <TranscodeSettingsDialog
          source={editing.source}
          output={editing.output}
          outputIds={editing.outputIds}
          onClose={closeEditor}
        />
      )}
    </>,
  );
}
