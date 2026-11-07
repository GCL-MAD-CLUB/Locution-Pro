import type { StoryboardGraph, StoryboardGraphNode } from "./graph";

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

// Cache once per graph so hover never scans every edge. Include each node itself.
export function indexStoryboardGraphNeighborhoods(graph: StoryboardGraph) {
  const result = new Map(graph.nodes.map((node) => [node.id, new Set([node.id])]));
  for (const edge of graph.edges) {
    const source = graph.nodes[edge.source].id;
    const target = graph.nodes[edge.target].id;
    result.get(source)!.add(target);
    result.get(target)!.add(source);
  }
  return result;
}

export interface StoryboardGraphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StoryboardGraphSize {
  width: number;
  height: number;
}

export interface StoryboardGraphCamera {
  x: number;
  y: number;
  zoom: number;
}

function nodeBounds(nodes: readonly StoryboardGraphNode[]): StoryboardGraphRect {
  if (!nodes.length) return { x: -32, y: -32, width: 64, height: 64 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

// The overview and navigable canvas always share a 16:9 world rectangle.
export function storyboardGraphCanvas(nodes: readonly StoryboardGraphNode[]): StoryboardGraphRect {
  const content = nodeBounds(nodes);
  const height = Math.max(content.height, (content.width * 9) / 16) * 1.2;
  const width = (height * 16) / 9;
  return {
    x: content.x + content.width / 2 - width / 2,
    y: content.y + content.height / 2 - height / 2,
    width,
    height,
  };
}

export function storyboardGraphZoomLimits(size: StoryboardGraphSize, canvas: StoryboardGraphRect) {
  const cover = Math.max(
    Math.max(1, size.width) / canvas.width,
    Math.max(1, size.height) / canvas.height,
  );
  // Keep the original zoom-out framing; allow positions to magnify further
  // while node geometry uses its own lower pixel-scale cap.
  return { min: Math.min(cover, 1), max: 2 };
}

export function storyboardGraphNodeScale(zoom: number) {
  return Math.min(zoom, 0.8);
}

// A small graph may reach the pixel cap before filling the display. Include
// that display's surrounding space in the overview so the viewport rectangle
// stays visible and correctly proportioned. The graph canvas itself is unchanged.
export function storyboardGraphOverviewCanvas(
  size: StoryboardGraphSize,
  canvas: StoryboardGraphRect,
): StoryboardGraphRect {
  const { min } = storyboardGraphZoomLimits(size, canvas);
  const height = Math.max(
    canvas.height,
    Math.max(1, size.height) / min,
    ((Math.max(1, size.width) / min) * 9) / 16,
  );
  const width = (height * 16) / 9;
  return {
    x: canvas.x + (canvas.width - width) / 2,
    y: canvas.y + (canvas.height - height) / 2,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function constrainStoryboardGraphCamera(
  camera: StoryboardGraphCamera,
  size: StoryboardGraphSize,
  canvas: StoryboardGraphRect,
): StoryboardGraphCamera {
  const limits = storyboardGraphZoomLimits(size, canvas);
  const zoom = clamp(camera.zoom, limits.min, limits.max);
  const halfWidth = Math.min(canvas.width / 2, Math.max(1, size.width) / zoom / 2);
  const halfHeight = Math.min(canvas.height / 2, Math.max(1, size.height) / zoom / 2);
  return {
    x: clamp(camera.x, canvas.x + halfWidth, canvas.x + canvas.width - halfWidth),
    y: clamp(camera.y, canvas.y + halfHeight, canvas.y + canvas.height - halfHeight),
    zoom,
  };
}

export function fitStoryboardGraphCamera(
  nodes: readonly StoryboardGraphNode[],
  size: StoryboardGraphSize,
  canvas = storyboardGraphCanvas(nodes),
): StoryboardGraphCamera {
  const content = nodeBounds(nodes);
  return constrainStoryboardGraphCamera(
    {
      x: content.x + content.width / 2,
      y: content.y + content.height / 2,
      zoom: Math.min(
        1,
        Math.max(1, size.width - 96) / Math.max(64, content.width),
        Math.max(1, size.height - 96) / Math.max(64, content.height),
      ),
    },
    size,
    canvas,
  );
}

export function storyboardGraphViewport(
  camera: StoryboardGraphCamera,
  size: StoryboardGraphSize,
): StoryboardGraphRect {
  const width = Math.max(1, size.width) / camera.zoom;
  const height = Math.max(1, size.height) / camera.zoom;
  return { x: camera.x - width / 2, y: camera.y - height / 2, width, height };
}

export function storyboardGraphScreenPoint(
  point: { x: number; y: number },
  camera: StoryboardGraphCamera,
  size: StoryboardGraphSize,
) {
  return {
    x: size.width / 2 + (point.x - camera.x) * camera.zoom,
    y: size.height / 2 + (point.y - camera.y) * camera.zoom,
  };
}

export function storyboardGraphWorldPoint(
  point: { x: number; y: number },
  camera: StoryboardGraphCamera,
  size: StoryboardGraphSize,
) {
  return {
    x: camera.x + (point.x - size.width / 2) / camera.zoom,
    y: camera.y + (point.y - size.height / 2) / camera.zoom,
  };
}

export function zoomStoryboardGraphAt(
  camera: StoryboardGraphCamera,
  point: { x: number; y: number },
  factor: number,
  size: StoryboardGraphSize,
  canvas: StoryboardGraphRect,
) {
  const limits = storyboardGraphZoomLimits(size, canvas);
  const zoom = clamp(camera.zoom * factor, limits.min, limits.max);
  const world = storyboardGraphWorldPoint(point, camera, size);
  return constrainStoryboardGraphCamera(
    {
      x: world.x - (point.x - size.width / 2) / zoom,
      y: world.y - (point.y - size.height / 2) / zoom,
      zoom,
    },
    size,
    canvas,
  );
}

export function panStoryboardGraph(
  camera: StoryboardGraphCamera,
  dx: number,
  dy: number,
  size: StoryboardGraphSize,
  canvas: StoryboardGraphRect,
) {
  return constrainStoryboardGraphCamera(
    { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom },
    size,
    canvas,
  );
}

export function storyboardGraphOverviewPoint(
  point: { x: number; y: number },
  canvas: StoryboardGraphRect,
) {
  return {
    x: ((point.x - canvas.x) / canvas.width) * 160,
    y: ((point.y - canvas.y) / canvas.height) * 90,
  };
}

export function storyboardGraphOverviewWorldPoint(
  point: { x: number; y: number },
  canvas: StoryboardGraphRect,
) {
  return {
    x: canvas.x + (point.x / 160) * canvas.width,
    y: canvas.y + (point.y / 90) * canvas.height,
  };
}
