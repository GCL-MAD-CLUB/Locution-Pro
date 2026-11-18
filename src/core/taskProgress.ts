export interface TaskProgressUpdate {
  label?: string;
  current?: number;
}

export type TaskProgressListenerCleanup = () => void | Promise<void>;

export type TaskProgressListener = (
  publishUpdate: (update: TaskProgressUpdate) => void,
) => void | TaskProgressListenerCleanup | Promise<void | TaskProgressListenerCleanup>;
