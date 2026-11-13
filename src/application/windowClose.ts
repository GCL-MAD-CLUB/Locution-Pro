import { normalizeError } from "../errors/runtime";

/** How long a quit waits for task cancellation and incomplete-output cleanup.
 * The frontend asks the backend to stop each running task. `cancel_task` and
 * the destroy fallback `cancel_all_tasks` both go through `claim_cancellation`,
 * which sets the cancel flag, kills FFmpeg, and deletes that task's paths.
 * The request resolves after that cleanup. A later cancel waits for the same
 * in-flight request, so quit does not destroy the window while it is running.
 * A hung task must not block quit forever: after this wait the window is
 * destroyed even if cancellation has not settled. Sixty seconds covers process
 * teardown and deletion of in-progress export files. Destroying the window
 * only claims tasks that have not been claimed yet. Work already taken by an
 * in-flight `cancel_task` is not cleaned up again.
 */
export const CLOSE_TASK_CLEANUP_TIMEOUT_MS = 60_000;

export type WindowCloseAction = "block-install" | "ignore-reentry" | "confirm-dirty" | "close";

/** Every action still prevents the platform close. Only a later `destroy` exits. */
export function windowCloseAction(state: {
  updateInstalling: boolean;
  closing: boolean;
  projectDirty: boolean;
}): WindowCloseAction {
  if (state.updateInstalling) return "block-install";
  if (state.closing) return "ignore-reentry";
  if (state.projectDirty) return "confirm-dirty";
  return "close";
}

/**
 * Waits until `cancelTasks` finishes, then destroys the window.
 * If cancellation does not settle within `timeoutMs`, the window is destroyed
 * anyway so quit cannot wait forever. A rejection from `cancelTasks` is
 * rethrown and the window stays open.
 */
export async function finishWindowClose(
  cancelTasks: () => Promise<void>,
  destroyWindow: () => Promise<void>,
  timeoutMs = CLOSE_TASK_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed: unknown;
  let settled = false;
  const cleanup = cancelTasks()
    .then(() => {
      settled = true;
    })
    .catch((error: unknown) => {
      failed = error;
      settled = true;
    });
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([cleanup, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (settled && failed !== undefined) {
    throw normalizeError(failed);
  }
  await destroyWindow();
}
