import { X } from "lucide-react";
import type { ReactNode } from "react";
import { RenderLifetime } from "../../../runtime/lifetime/RenderLifetime";
import { useTaskProgressStatus } from "../../../systems/TaskSystem";
import "./TaskProgress.css";

const taskProgressSlots = 3;

export function TaskProgress({ children }: { children: ReactNode }) {
  const lifetime = new RenderLifetime();

  const { tasks } = useTaskProgressStatus(lifetime);

  if (tasks.length === 0) {
    return lifetime.render(children);
  }

  if (tasks.length === 1) {
    const task = tasks[0];
    const fillPercent = task.percent;
    const percent = Math.round(fillPercent);
    return lifetime.render(
      <div
        className="topbar-progress"
        title={`${task.label} ${task.state === "queued" ? "排队中" : task.total <= 0 ? "正在处理" : `${percent}%`}`}
      >
        <span>
          {task.label}
          {task.state === "queued" ? "（排队中）" : ""}
        </span>
        <div className="topbar-progress-row">
          <div
            className="topbar-progress-track"
            role="progressbar"
            aria-label={task.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={task.total > 0 ? percent : undefined}
          >
            <div
              className={`topbar-progress-fill${task.total <= 0 && task.state === "running" ? " is-indeterminate" : ""}`}
              style={
                task.total > 0 || task.state === "queued" ? { width: `${fillPercent}%` } : undefined
              }
            />
          </div>
          {task.cancellable && (
            <button
              type="button"
              className="topbar-progress-cancel"
              onClick={() => {
                // The failure is already reported. Swallowing it here keeps
                // the click from becoming an unhandled rejection; quit still
                // observes the same rejected promise and stays open.
                void task.cancel().catch(() => undefined);
              }}
              title="取消任务"
              aria-label="取消任务"
              disabled={task.isCancelling}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
      </div>,
    );
  }

  const running = tasks.filter((task) => task.state === "running");
  const queued = tasks.filter((task) => task.state === "queued");
  const visibleTasks = [...running, ...queued].slice(0, taskProgressSlots);

  return lifetime.render(
    <div className="topbar-progress topbar-progress-multi">
      <span>{`正在执行 ${running.length} 项操作${queued.length ? `，${queued.length} 项排队中` : ""}...`}</span>
      <div
        className="topbar-progress-stack"
        style={{ gridTemplateRows: `repeat(${visibleTasks.length}, minmax(0, 1fr))` }}
      >
        {visibleTasks.map((task) => {
          const fillPercent = task.percent;
          const percent = Math.round(fillPercent);
          return (
            <div
              key={task.id}
              className="topbar-progress-track"
              title={`${task.label} ${task.state === "queued" ? "排队中" : task.total <= 0 ? "正在处理" : `${percent}%`}`}
              role="progressbar"
              aria-label={task.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={task.total > 0 ? percent : undefined}
            >
              <div
                className={`topbar-progress-fill${task.total <= 0 && task.state === "running" ? " is-indeterminate" : ""}`}
                style={
                  task.total > 0 || task.state === "queued"
                    ? { width: `${fillPercent}%` }
                    : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </div>,
  );
}
