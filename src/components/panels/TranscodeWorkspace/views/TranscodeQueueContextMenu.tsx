import { createPortal } from "react-dom";
import { invokeCommand, runOperation } from "../../../../errors";
import { publishEvent } from "../../../../runtime/events/react";
import type { SystemIdentity } from "../../../../runtime/systems/identity";
import {
  fileName,
  transcodeQueueStore,
  type TranscodeOutput,
  type TranscodeSource,
} from "../../../../systems/TranscodeSystem";
import {
  PopupMenu,
  PopupMenuItem,
  PopupMenuSeparator,
  useCloseOnOutsidePointer,
} from "../../../common/PopupMenu";

export interface TranscodeQueueMenuTarget {
  x: number;
  y: number;
}

interface TranscodeQueueContextMenuProps {
  target: TranscodeQueueMenuTarget;
  identity: SystemIdentity;
  /** The output Enter and 编辑导出设置 open: the focused one, else the first selected. */
  editable: { source: TranscodeSource; output: TranscodeOutput } | null;
  /** The source 添加输出 adds to. */
  sourceId: string | null;
  selectedOutputs: readonly TranscodeOutput[];
  hasSelection: boolean;
  doneCount: number;
  onEditOutput: (source: TranscodeSource, output: TranscodeOutput) => void;
  onClose: () => void;
}

/** Right-click and menu-key actions on the selected queue rows. */
export function TranscodeQueueContextMenu({
  target,
  identity,
  editable,
  sourceId,
  selectedOutputs,
  hasSelection,
  doneCount,
  onEditOutput,
  onClose,
}: TranscodeQueueContextMenuProps) {
  const store = transcodeQueueStore.getState;
  useCloseOnOutsidePointer(true, onClose, { ignorePopupMenuTargets: true });
  const finished = selectedOutputs.filter(
    (output): output is TranscodeOutput & { outputPath: string } =>
      output.status === "done" && Boolean(output.outputPath),
  );
  const inMediaBin = finished.filter((output) => output.destination?.kind === "mediaBin");
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return createPortal(
    <PopupMenu
      className="transcode-queue-context-menu"
      ariaLabel="队列操作"
      contextMenuAnchor={target}
      style={{ position: "fixed", left: target.x, top: target.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <PopupMenuItem
        shortcut="Enter"
        disabled={!editable || editable.output.status === "encoding"}
        onSelect={run(() => editable && onEditOutput(editable.source, editable.output))}
      >
        导出设置…
      </PopupMenuItem>
      <PopupMenuItem
        disabled={!sourceId}
        onSelect={run(() => sourceId && store().addOutput(sourceId))}
      >
        添加输出
      </PopupMenuItem>
      <PopupMenuItem disabled={!hasSelection} onSelect={run(() => store().duplicateSelected())}>
        重复
      </PopupMenuItem>
      <PopupMenuItem
        disabled={selectedOutputs.every(
          (output) => output.status === "ready" || output.status === "encoding",
        )}
        onSelect={run(() => store().resetSelected())}
      >
        重置状态
      </PopupMenuItem>
      <PopupMenuItem
        shortcut="Delete"
        disabled={!hasSelection}
        onSelect={run(() => store().removeSelected())}
      >
        从队列中移除
      </PopupMenuItem>
      <PopupMenuSeparator />
      <PopupMenuItem
        disabled={inMediaBin.length === 0}
        onSelect={run(
          () =>
            void publishEvent(
              "media.reveal.requested",
              { paths: inMediaBin.map((output) => output.outputPath) },
              identity,
            ),
        )}
      >
        在媒体箱中显示
      </PopupMenuItem>
      <PopupMenuItem
        disabled={finished.length === 0}
        onSelect={run(() => {
          const path = finished[0]?.outputPath;
          if (!path) return;
          void runOperation(
            "transcode.reveal",
            () => invokeCommand("reveal_in_file_manager", { path }),
            { displayName: fileName(path), resourceKind: "media" },
          );
        })}
      >
        在资源管理器中显示
      </PopupMenuItem>
      <PopupMenuSeparator />
      <PopupMenuItem disabled={doneCount === 0} onSelect={run(() => store().clearFinished())}>
        清除已完成
      </PopupMenuItem>
    </PopupMenu>,
    document.body,
  );
}
