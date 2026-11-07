import type { StoryboardGraph, StoryboardGraphNode } from "./storyboardGraph";

export function storyboardGraphNeighborhood(graph: StoryboardGraph, id: string) {
  const index = graph.nodes.findIndex((node) => node.id === id);
  const neighbors = new Set<string>();
  if (index < 0) return neighbors;
  neighbors.add(id);
  for (const edge of graph.edges) {
    if (edge.source === index) neighbors.add(graph.nodes[edge.target].id);
    if (edge.target === index) neighbors.add(graph.nodes[edge.source].id);
  }
  return neighbors;
}

// Preserve aspect ratio and reserve room above the dots for thumbnail previews.
// Kept separate so the UI does not load the worker's force simulation.
export function fitStoryboardGraph(
  nodes: readonly StoryboardGraphNode[],
  width: number,
  height: number,
) {
  if (!nodes.length) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const top = Math.min(180, height * 0.55);
  const availableWidth = Math.max(1, width - 64);
  const availableHeight = Math.max(1, height - top - 32);
  const scale = Math.min(
    availableWidth / Math.max(1, maxX - minX),
    availableHeight / Math.max(1, maxY - minY),
  );
  return nodes.map((node) => ({
    ...node,
    x: width / 2 + (node.x - (minX + maxX) / 2) * scale,
    y: top + availableHeight / 2 + (node.y - (minY + maxY) / 2) * scale,
  }));
}
