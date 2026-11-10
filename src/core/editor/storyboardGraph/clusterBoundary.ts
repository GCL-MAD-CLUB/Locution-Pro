import type { StoryboardGraphNode } from "./graph";

type Point = Pick<StoryboardGraphNode, "x" | "y">;

function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((p, i) => !i || p.x !== sorted[i - 1].x || p.y !== sorted[i - 1].y);
  if (unique.length < 3) return unique;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (input: Point[]) => {
    const result: Point[] = [];
    for (const point of input) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop();
      result.push(point);
    }
    return result;
  };
  return [...half(unique).slice(0, -1), ...half([...unique].reverse()).slice(0, -1)];
}

// Minkowski sum of the node-center hull and a disk: padded, rounded outlines
// contain every member's full radius, including singleton/collinear groups.
export function storyboardGraphClusterBoundaries(
  nodes: readonly StoryboardGraphNode[],
  padding: number,
) {
  const groups = new Map<number, StoryboardGraphNode[]>();
  for (const node of nodes) {
    if (node.cluster === undefined) continue;
    const members = groups.get(node.cluster) ?? [];
    members.push(node);
    groups.set(node.cluster, members);
  }
  return [...groups].map(([cluster, members]) => {
    const hull = convexHull(members);
    const radius = members.reduce((r, node) => Math.max(r, node.radius), 0) + padding;
    const arc = `A${radius},${radius} 0 0 1 `;
    if (hull.length === 1) {
      const { x, y } = hull[0];
      return { cluster, d: `M${x - radius},${y}${arc}${x + radius},${y}${arc}${x - radius},${y}Z` };
    }
    const normals = hull.map((a, i) => {
      const b = hull[(i + 1) % hull.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: ((b.y - a.y) / length) * radius, y: ((a.x - b.x) / length) * radius };
    });
    const start = normals.at(-1)!;
    let d = `M${hull[0].x + start.x},${hull[0].y + start.y}`;
    hull.forEach((point, i) => {
      const normal = normals[i];
      const next = hull[(i + 1) % hull.length];
      d += `${arc}${point.x + normal.x},${point.y + normal.y}L${next.x + normal.x},${next.y + normal.y}`;
    });
    return { cluster, d: `${d}Z` };
  });
}
