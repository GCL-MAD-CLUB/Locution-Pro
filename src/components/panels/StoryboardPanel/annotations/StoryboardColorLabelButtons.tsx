import { annotationColors } from "../../../../runtime/theme";
import type { CSSProperties } from "react";
import type {
  StoryboardShotColorLabel,
  StoryboardShotColorLabelFilter,
} from "../storyboardPanelState";

export const storyboardShotColorLabels: Array<readonly [StoryboardShotColorLabel, string]> = [
  ["red", "红色"],
  ["yellow", "黄色"],
  ["green", "绿色"],
  ["blue", "蓝色"],
  ["purple", "紫色"],
];

export const storyboardShotColorLabelValues: Record<StoryboardShotColorLabel, string> =
  annotationColors;

export const storyboardShotColorFilterLabels: Array<
  readonly [StoryboardShotColorLabelFilter, string]
> = [...storyboardShotColorLabels, ["custom", "自定义"], ["none", "无"]];

const storyboardShotColorFilterValues: Record<StoryboardShotColorLabelFilter, string> =
  annotationColors;

interface StoryboardColorLabelButtonsProps {
  activeValues: readonly StoryboardShotColorLabelFilter[];
  ariaLabel: string;
  buttonLabel: (
    colorLabel: StoryboardShotColorLabelFilter,
    label: string,
    active: boolean,
  ) => string;
  className?: string;
  disabled?: boolean;
  includeNone?: boolean;
  onSelect: (colorLabel: StoryboardShotColorLabelFilter) => void;
}

export function StoryboardColorLabelButtons({
  activeValues,
  ariaLabel,
  buttonLabel,
  className = "",
  disabled = false,
  includeNone = false,
  onSelect,
}: StoryboardColorLabelButtonsProps) {
  const options = includeNone ? storyboardShotColorFilterLabels : storyboardShotColorLabels;

  return (
    <div
      className={["storyboard-color-label-buttons", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      {options.map(([colorLabel, label]) => {
        const active = activeValues.includes(colorLabel);
        const controlLabel = buttonLabel(colorLabel, label, active);
        return (
          <button
            key={colorLabel}
            type="button"
            className={active ? "active" : ""}
            style={
              {
                "--storyboard-color-label-color": storyboardShotColorFilterValues[colorLabel],
              } as CSSProperties
            }
            onClick={() => onSelect(colorLabel)}
            disabled={disabled}
            title={controlLabel}
            aria-label={controlLabel}
            aria-pressed={active}
          />
        );
      })}
    </div>
  );
}
