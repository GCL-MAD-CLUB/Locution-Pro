import { createElement, type ReactNode } from "react";

export function renderStoryboardKeywordLabel(label: string): ReactNode {
  if (!label.includes("<")) {
    return label;
  }
  const parts = label.split("<");
  return parts.map((part, index) => {
    const path = parts.slice(0, index + 1).join("<");
    return createElement(
      "span",
      { key: path },
      part,
      index < parts.length - 1
        ? createElement("span", { key: "sep", className: "storyboard-keyword-separator" }, " < ")
        : null,
    );
  });
}
