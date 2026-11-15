import { create } from "zustand";
import {
  transcodeQueueStore,
  type TranscodeOutput,
  type TranscodeSource,
} from "../../../systems/TranscodeSystem";

interface TranscodeEditorState {
  /** The output whose settings dialog is open, with every output it edits. */
  editing: { source: TranscodeSource; output: TranscodeOutput; outputIds: string[] } | null;
  close: () => void;
}

/**
 * Which output the settings dialog edits. The dialog belongs to the page,
 * not to a panel, so it stays open when the queue panel is moved or closed.
 */
export const useTranscodeEditor = create<TranscodeEditorState>()((set) => ({
  editing: null,
  close: () => set({ editing: null }),
}));

/** Opens the settings dialog; a selected output edits every selected, idle output. */
export function editTranscodeOutput(source: TranscodeSource, output: TranscodeOutput) {
  const state = transcodeQueueStore.getState();
  const selected = new Set(state.selectedIds);
  const outputIds = selected.has(output.id)
    ? state.sources.flatMap((item) =>
        item.outputs
          .filter((candidate) => selected.has(candidate.id) && candidate.status !== "encoding")
          .map((candidate) => candidate.id),
      )
    : [output.id];
  useTranscodeEditor.setState({ editing: { source, output, outputIds } });
}
