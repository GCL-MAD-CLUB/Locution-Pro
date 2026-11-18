import { asyncScheduler } from "rxjs";
import { clientError } from "../errors/model";

/** A scheduled resource belongs to its caller. Cancel it on replacement or disposal. */
export interface ScheduledTask {
  readonly pending: boolean;
  cancel(): void;
}

function taskHandle(action: { readonly closed: boolean; unsubscribe(): void }): ScheduledTask {
  return {
    get pending() {
      return !action.closed;
    },
    cancel: () => action.unsubscribe(),
  };
}

/** Runs in a later task, including for a zero delay; never acquires during render. */
export function scheduleAfter(callback: () => void, delayMs: number): ScheduledTask {
  return taskHandle(
    asyncScheduler.schedule(function () {
      this.unsubscribe();
      callback();
    }, delayMs),
  );
}

/** First tick follows the period. The owner must cancel the recurring resource. */
export function repeatEvery(callback: () => void, periodMs: number): ScheduledTask {
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw clientError("UNEXPECTED_ERROR", "A recurring task needs a positive, finite period");
  }
  return taskHandle(
    asyncScheduler.schedule(function () {
      callback();
      if (!this.closed) this.schedule(undefined, periodMs);
    }, periodMs),
  );
}

export function cancelTask(task: ScheduledTask | null | undefined): void {
  task?.cancel();
}

/** A finite async operation owns the wait; cancellation releases its scheduled work. */
export function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      task.cancel();
      reject(signal?.reason);
    };
    const task = scheduleAfter(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
