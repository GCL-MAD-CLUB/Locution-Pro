import { invokeCommand } from "../../errors";
import {
  cancelFfmpegTask,
  createFfmpegTaskId,
  listenToFfmpegTaskProgress,
} from "../../platform/tauri/ffmpegProgress";
import { createTaskProgress } from "../../systems/TaskSystem";
import type { ProxyResult } from "../../types";
import type { ProxyCreationOptions } from "./proxyGeneration";

export type ProxyGenerationOutcome =
  { status: "success"; proxyPath: string } | { status: "cancelled" } | { status: "failed" };

interface RunProxyGenerationTaskOptions {
  assetId: string;
  displayName: string;
  options: ProxyCreationOptions;
  label?: string;
}

/** Runs `generate_proxy` behind a cancellable task; failures are reported by the task. */
export async function runProxyGenerationTask({
  assetId,
  displayName,
  options,
  label,
}: RunProxyGenerationTaskOptions): Promise<ProxyGenerationOutcome> {
  const taskId = createFfmpegTaskId("proxy");
  let cancelled = false;
  const task = await createTaskProgress({
    operation: "proxy.generate",
    label: label ?? `生成代理 ${displayName}`,
    current: 0,
    total: 1,
    listener: listenToFfmpegTaskProgress(taskId),
    on_cancel: async () => {
      cancelled = true;
      await cancelFfmpegTask(taskId);
    },
  });
  if (task.cancelled) {
    task.remove();
    return { status: "cancelled" };
  }
  try {
    const result = await invokeCommand<ProxyResult>("generate_proxy", {
      assetId,
      options,
      taskId,
    });
    task.update({ current: 1 });
    task.remove();
    return { status: "success", proxyPath: result.proxy_path };
  } catch (error) {
    if (cancelled) {
      task.remove();
      return { status: "cancelled" };
    }
    task.fail(error, { displayName, resourceKind: "proxy" });
    return { status: "failed" };
  }
}
