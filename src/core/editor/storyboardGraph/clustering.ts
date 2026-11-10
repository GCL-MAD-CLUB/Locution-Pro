import type { Force } from "d3-force";
import type { StoryboardGraphEdge, StoryboardGraphForceNode } from "./graph";

// Weighted Louvain: local modularity gains followed by aggregation. Work on
// the computed semantic topology, independently of the front-end display cap.
// Sorted traversal and canonical labels make filtering/repeated builds stable.
export function clusterStoryboardGraph(
  nodeCount: number,
  edges: readonly StoryboardGraphEdge[],
  resolution = 1,
): number[] {
  const original: Map<number, number>[] = Array.from({ length: nodeCount }, () => new Map());
  for (const edge of [...edges].sort(
    (a, b) => a.source - b.source || a.target - b.target || a.similarity - b.similarity,
  )) {
    if (edge.source === edge.target || edge.similarity <= 0) continue;
    for (const [a, b] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ])
      original[a].set(b, (original[a].get(b) ?? 0) + edge.similarity);
  }
  let adjacency = original;
  let membership = Array.from({ length: nodeCount }, (_, i) => i);
  for (let level = 0; level < 20 && adjacency.length > 1; level++) {
    const degree = adjacency.map((row) => [...row.values()].reduce((a, b) => a + b, 0));
    const total = degree.reduce((a, b) => a + b, 0);
    if (!total) break;
    const labels = adjacency.map((_, i) => i);
    const totals = [...degree];
    const empty = new Set<number>();
    for (let pass = 0; pass < 30; pass++) {
      let moved = false;
      for (let i = 0; i < adjacency.length; i++) {
        if (!degree[i]) continue;
        const before = labels[i];
        const weights = new Map<number, number>();
        for (const [neighbor, weight] of adjacency[i]) {
          if (neighbor !== i)
            weights.set(labels[neighbor], (weights.get(labels[neighbor]) ?? 0) + weight);
        }
        totals[before] -= degree[i];
        if (totals[before] < 1e-10) empty.add(before);
        const score = (label: number) =>
          (weights.get(label) ?? 0) - (resolution * degree[i] * totals[label]) / total;
        let best = before;
        let gain = score(before);
        const vacant = empty.values().next().value;
        if (vacant !== undefined && gain < -1e-10) {
          best = vacant;
          gain = 0;
        }
        for (const label of [...weights.keys()].sort((a, b) => a - b)) {
          const candidate = score(label);
          if (candidate > gain + 1e-10) {
            best = label;
            gain = candidate;
          }
        }
        labels[i] = best;
        totals[best] += degree[i];
        empty.delete(best);
        moved ||= best !== before;
      }
      if (!moved) break;
    }
    const indices = new Map<number, number>();
    const compact = labels.map((label) => {
      if (!indices.has(label)) indices.set(label, indices.size);
      return indices.get(label)!;
    });
    membership = membership.map((label) => compact[label]);
    if (indices.size === adjacency.length) break;
    const next: Map<number, number>[] = Array.from({ length: indices.size }, () => new Map());
    adjacency.forEach((row, i) => {
      for (const [j, weight] of row) {
        const a = compact[i];
        const b = compact[j];
        // Internal edges become doubled self-loops, preserving weighted degree.
        next[a].set(b, (next[a].get(b) ?? 0) + weight);
      }
    });
    adjacency = next;
  }
  // Local moves can leave disconnected pieces in a community. Give each
  // connected piece its own boundary instead of enclosing unrelated islands.
  const result = Array<number>(nodeCount).fill(-1);
  let label = 0;
  for (let i = 0; i < nodeCount; i++) {
    if (result[i] !== -1) continue;
    result[i] = label;
    const queue = [i];
    for (let head = 0; head < queue.length; head++)
      for (const neighbor of original[queue[head]].keys())
        if (result[neighbor] === -1 && membership[neighbor] === membership[i]) {
          result[neighbor] = label;
          queue.push(neighbor);
        }
    label++;
  }
  return result;
}

// Recompute each community centroid in O(n) per tick, so a grabbed member
// elastically pulls its own group without pinning communities to fixed targets.
export function storyboardGraphClusterForce<Node extends StoryboardGraphForceNode>(
  strength: number,
): Force<Node, undefined> {
  let groups: Node[][] = [];
  const force: Force<Node, undefined> = (alpha) => {
    if (groups.length < 2) return;
    for (const members of groups) {
      let x = 0;
      let y = 0;
      for (const node of members) {
        x += node.x!;
        y += node.y!;
      }
      x /= members.length;
      y /= members.length;
      for (const node of members) {
        node.vx! += (x - node.x!) * strength * alpha;
        node.vy! += (y - node.y!) * strength * alpha;
      }
    }
  };
  force.initialize = (nodes) => {
    const byCluster = new Map<number, Node[]>();
    for (const node of nodes) {
      if (node.cluster === undefined) continue;
      const members = byCluster.get(node.cluster) ?? [];
      members.push(node);
      byCluster.set(node.cluster, members);
    }
    groups = [...byCluster.values()];
  };
  return force;
}
