import { Hand, MousePointer2 } from "lucide-react";
import type {
  StoryboardGraphSelectionMode,
  StoryboardGraphTool,
} from "../../../../core/editor/storyboardGraph/selection";

const modes = [
  ["replace", "替换选择"],
  ["add", "添加到选择"],
  ["subtract", "从选择中减去"],
  ["intersect", "与选择交集"],
] as const;

function SelectionIcon({ mode }: { mode: StoryboardGraphSelectionMode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="storyboard-graph-selection-icon">
      {mode === "replace" ? (
        <rect x="4" y="4" width="16" height="16" />
      ) : mode === "add" ? (
        <path d="M3 3h13v5h5v13H8v-5H3Z" />
      ) : mode === "subtract" ? (
        <>
          <path d="M3 3h13v5H8v8H3Z" />
          <rect x="9" y="9" width="12" height="12" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="13" height="13" />
          <rect x="8" y="8" width="13" height="13" />
          <path className="is-intersection" d="M8 8h8v8H8Z" />
        </>
      )}
    </svg>
  );
}

export function StoryboardGraphTools({
  tool,
  mode,
  sprayActive = false,
  onToolChange,
  onModeChange,
}: {
  tool: StoryboardGraphTool;
  mode: StoryboardGraphSelectionMode;
  sprayActive?: boolean;
  onToolChange: (tool: StoryboardGraphTool) => void;
  onModeChange: (mode: StoryboardGraphSelectionMode) => void;
}) {
  return (
    <div
      className="storyboard-graph-tools"
      role="toolbar"
      aria-label="图谱工具"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="指针工具"
        title="指针：选择节点"
        aria-pressed={tool === "pointer" && !sprayActive}
        onClick={() => onToolChange("pointer")}
      >
        <MousePointer2 aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="手型工具"
        title="手型：平移画布"
        aria-pressed={tool === "hand"}
        onClick={() => onToolChange("hand")}
      >
        <Hand aria-hidden="true" />
      </button>
      {tool === "pointer" && !sprayActive && (
        <div
          className="storyboard-graph-selection-modes"
          role="radiogroup"
          aria-label="图谱选择模式"
        >
          {modes.map(([value, label], index) => (
            <button
              type="button"
              key={value}
              role="radio"
              aria-label={label}
              title={label}
              aria-checked={mode === value}
              tabIndex={mode === value ? 0 : -1}
              onClick={() => onModeChange(value)}
              onKeyDown={(event) => {
                const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
                  ? 1
                  : ["ArrowLeft", "ArrowUp"].includes(event.key)
                    ? -1
                    : 0;
                if (!direction) return;
                event.preventDefault();
                const next = (index + direction + modes.length) % modes.length;
                onModeChange(modes[next][0]);
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
              }}
            >
              <SelectionIcon mode={value} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
