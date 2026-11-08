import type { StoryboardGraphNode } from "./graph";
import type { StoryboardGraphRect } from "./camera";

export type StoryboardGraphTool = "pointer" | "hand";
export type StoryboardGraphSelectionMode = "replace" | "add" | "subtract" | "intersect";

// The caller projects the node's radius using camera zoom. Hover then scales
// that screen radius and gap; the ring remains one screen pixel wide.
export function storyboardGraphSelectionRing(screenRadius: number, hoverScale = 1) {
  const displayedRadius = screenRadius * hoverScale;
  const gap = Math.max(1, displayedRadius / 4);
  const strokeWidth = 1;
  return { radius: displayedRadius + gap + strokeWidth / 2, gap, strokeWidth };
}

export function applyStoryboardGraphSelection(
  current: ReadonlySet<string>,
  hits: ReadonlySet<string>,
  mode: StoryboardGraphSelectionMode,
): Set<string> {
  if (mode === "replace") return new Set(hits);
  if (mode === "add") return new Set([...current, ...hits]);
  return new Set([...current].filter((id) => (mode === "subtract" ? !hits.has(id) : hits.has(id))));
}

export function storyboardGraphSelectionRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): StoryboardGraphRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

// Hit testing uses node centers in world coordinates, independent of DOM scale.
export function storyboardGraphMarqueeHitIds(
  nodes: readonly StoryboardGraphNode[],
  rect: StoryboardGraphRect,
): Set<string> {
  return new Set(
    nodes
      .filter(
        (node) =>
          node.x >= rect.x &&
          node.x <= rect.x + rect.width &&
          node.y >= rect.y &&
          node.y <= rect.y + rect.height,
      )
      .map((node) => node.id),
  );
}
