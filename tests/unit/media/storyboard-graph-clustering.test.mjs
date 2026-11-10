import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clusterStoryboardGraph,
  storyboardGraphClusterForce,
} from "../../../src/core/editor/storyboardGraph/clustering.ts";
import { storyboardGraphClusterBoundaries } from "../../../src/core/editor/storyboardGraph/clusterBoundary.ts";

function communities(sizes) {
  const edges = [];
  let start = 0;
  for (const size of sizes) {
    for (let a = start; a < start + size; a++)
      for (let b = a + 1; b < start + size; b++)
        edges.push({ source: a, target: b, similarity: 0.99 });
    if (start) edges.push({ source: start - 1, target: start, similarity: 0.6 });
    start += size;
  }
  return edges;
}

test("weighted Louvain separates semantic communities despite mandatory island bridges", () => {
  const edges = communities([6, 6, 6]);
  const before = structuredClone(edges);
  const labels = clusterStoryboardGraph(18, edges);
  assert.deepEqual(labels, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(clusterStoryboardGraph(18, [...edges].reverse()), labels);
  assert.deepEqual(edges, before);
  assert.deepEqual(clusterStoryboardGraph(6, communities([6])), Array(6).fill(0));
});

test("clustering handles empty/singleton/disconnected graphs and ignores zero-weight bridges", () => {
  assert.deepEqual(clusterStoryboardGraph(0, []), []);
  assert.deepEqual(clusterStoryboardGraph(1, []), [0]);
  assert.deepEqual(clusterStoryboardGraph(4, []), [0, 1, 2, 3]);
  assert.deepEqual(
    clusterStoryboardGraph(4, [
      { source: 0, target: 1, similarity: 1 },
      { source: 1, target: 2, similarity: 0 },
      { source: 2, target: 3, similarity: 1 },
    ]),
    [0, 0, 1, 1],
  );
  assert.equal(new Set(clusterStoryboardGraph(6, communities([6]), 3)).size, 6);
});

test("cluster force attracts members to their moving centroid without translating groups", () => {
  const nodes = [
    { id: "a", x: -100, y: 0, vx: 0, vy: 0, radius: 6, cluster: 0 },
    { id: "b", x: 0, y: 0, vx: 0, vy: 0, radius: 6, cluster: 0 },
    { id: "c", x: 100, y: 40, vx: 0, vy: 0, radius: 6, cluster: 1 },
    { id: "d", x: 200, y: 60, vx: 0, vy: 0, radius: 6, cluster: 1 },
  ];
  const force = storyboardGraphClusterForce(0.1);
  force.initialize(nodes, Math.random);
  force(1);
  assert.equal(nodes[0].vx, 5);
  assert.equal(nodes[1].vx, -5);
  assert.equal(nodes[2].vx + nodes[3].vx, 0);
  assert.equal(nodes[2].vy + nodes[3].vy, 0);
  nodes[0].x = -200;
  force(0.5);
  assert.equal(nodes[0].vx, 10, "centroid follows the dragged node");
});

test("cluster boundaries enclose singleton, repeated, collinear and polygonal members without invalid paths", () => {
  const nodes = [
    { id: "a", x: 0, y: 0, radius: 6, cluster: 0 },
    { id: "b", x: 0, y: 0, radius: 10, cluster: 0 },
    { id: "c", x: 100, y: 0, radius: 6, cluster: 1 },
    { id: "d", x: 200, y: 0, radius: 6, cluster: 1 },
    { id: "e", x: 150, y: 0, radius: 6, cluster: 1 },
    { id: "f", x: 0, y: 100, radius: 6, cluster: 2 },
    { id: "g", x: 100, y: 100, radius: 6, cluster: 2 },
    { id: "h", x: 50, y: 200, radius: 6, cluster: 2 },
  ];
  const boundaries = storyboardGraphClusterBoundaries(nodes, 18);
  assert.deepEqual(
    boundaries.map(({ cluster }) => cluster),
    [0, 1, 2],
  );
  assert.match(boundaries[0].d, /^M-28,0A28,28/);
  assert.equal(boundaries[1].d.match(/A/g).length, 2, "a collinear cluster uses a capsule");
  assert.equal(
    boundaries[2].d.match(/A/g).length,
    3,
    "a triangular cluster has three rounded corners",
  );
  for (const { d } of boundaries) {
    assert.ok(d.endsWith("Z"));
    assert.doesNotMatch(d, /NaN|Infinity|undefined/);
  }
  assert.deepEqual(
    storyboardGraphClusterBoundaries(
      nodes.map(({ cluster, ...node }) => node),
      18,
    ),
    [],
  );
  const moved = nodes.map((node) => ({ ...node, x: node.x + 30, y: node.y + 20 }));
  assert.notEqual(storyboardGraphClusterBoundaries(moved, 18)[1].d, boundaries[1].d);
});
