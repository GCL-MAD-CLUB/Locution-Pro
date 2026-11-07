import assert from "node:assert/strict";
import { test } from "node:test";
import * as d3Force from "d3-force";
import { clientError } from "../../../src/errors/model.ts";
import { defaultStoryboardGraphOptions } from "../../../src/core/editor/storyboardGraph/options.ts";
import * as graphOptions from "../../../src/core/editor/storyboardGraph/options.ts";
import { createModuleLoader } from "../support/module-loader.ts";
import { storyboardGraphNeighborhood } from "../../../src/core/editor/storyboardGraph/camera.ts";

const graphModule = createModuleLoader(import.meta.url)(
  "../../../src/core/editor/storyboardGraph/graph.ts",
  {
    "d3-force": d3Force,
    "../../../errors/model": { clientError },
    "./options": graphOptions,
  },
);
const build = (shots, options = defaultStoryboardGraphOptions) =>
  structuredClone(graphModule.buildStoryboardGraph(shots, undefined, options));
const sparse = (edges, count, options = defaultStoryboardGraphOptions) =>
  structuredClone(graphModule.sparsifyStoryboardGraphEdges(edges, count, options));
const input = (id, vector) => ({ id, vector, thumbnailFrame: Number(id) * 10 });
const connect = (edges, vectors) =>
  structuredClone(graphModule.connectStoryboardGraphEdges(edges, vectors));

test("filters and deletion reconnect visible nodes without repeating cached pair comparisons", () => {
  const shots = Array.from({ length: 12 }, (_, index) =>
    input(String(index), [Math.cos(index / 3), Math.sin(index / 3), 0.2]),
  );
  const similarities = graphModule.indexStoryboardGraphSimilarities(shots);
  const full = graphModule.buildStoryboardGraph(shots, undefined, undefined, { similarities });
  assert.equal(similarities.comparisons, (shots.length * (shots.length - 1)) / 2);
  const comparisons = similarities.comparisons;
  for (const ids of [["0", "3", "6", "9"], ["0", "9"], ["0"], [], shots.map((shot) => shot.id)]) {
    const visible = shots.filter((shot) => ids.includes(shot.id));
    const graph = graphModule.buildStoryboardGraph(visible, undefined, undefined, { similarities });
    assert.deepEqual(structuredClone(graph), build(visible));
    assertConnected(graph.nodes, graph.edges);
    assert.equal(
      similarities.comparisons,
      comparisons,
      "all surviving pairs reuse their exact cached distance",
    );
    const warm = graphModule.buildStoryboardGraph(visible, undefined, undefined, {
      similarities,
      positions: full.nodes,
    });
    assertConnected(warm.nodes, warm.edges);
    assert.ok(warm.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
    assert.equal(similarities.comparisons, comparisons);
  }
});
function assertConnected(nodes, edges) {
  if (!nodes.length) return;
  const visited = new Set([0]);
  const pending = [0];
  while (pending.length) {
    const current = pending.pop();
    for (const edge of edges) {
      const next =
        edge.source === current ? edge.target : edge.target === current ? edge.source : -1;
      if (next >= 0 && !visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  assert.equal(visited.size, nodes.length, "all nodes belong to one connected component");
}

test("island repair selects the strongest external link across every point in the component", () => {
  const vectors = [0, 0.3, 1, 1.2].map((angle) => [Math.cos(angle), Math.sin(angle)]);
  const edges = [
    { source: 0, target: 1, similarity: 0.98 },
    { source: 2, target: 3, similarity: 0.99 },
  ];
  const before = structuredClone({ edges, vectors });
  const repaired = connect(edges, vectors);
  assert.deepEqual(repaired.slice(0, 2), edges);
  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired[2], {
    source: 1,
    target: 2,
    similarity: 1 - graphModule.normalizedCosineDistance(vectors[1], vectors[2]),
  });
  assertConnected(vectors, repaired);
  assert.deepEqual({ edges, vectors }, before);
});

test("repair repeats after islands merge and only adds the bridges needed for connectivity", () => {
  const vectors = [0, 0.01, 0.1, 0.11, 2, 2.01, 2.1, 2.11].map((angle) => [
    Math.cos(angle),
    Math.sin(angle),
  ]);
  const edges = [0, 2, 4, 6].map((source) => ({ source, target: source + 1, similarity: 1 }));
  const repaired = connect(edges, vectors);
  assertConnected(vectors, repaired);
  assert.equal(repaired.length - edges.length, 3);
  const bridges = repaired
    .slice(edges.length)
    .map((edge) => [edge.source, edge.target])
    .sort((a, b) => a[0] - b[0]);
  assert.deepEqual(bridges, [
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
  assert.deepEqual(
    connect([...edges].reverse(), vectors).slice(edges.length),
    repaired.slice(edges.length),
  );
});

test("island repair leaves connected, empty and single-node graphs unchanged", () => {
  assert.deepEqual(connect([], []), []);
  assert.deepEqual(connect([], [[1, 0]]), []);
  const edges = [
    { source: 0, target: 1, similarity: 1 },
    { source: 1, target: 2, similarity: 0 },
  ];
  assert.deepEqual(
    connect(edges, [
      [1, 0],
      [1, 0],
      [-1, 0],
    ]),
    edges,
  );
  const withoutEdges = connect(
    [],
    [
      [1, 0],
      [1, 0],
      [1, 0],
    ],
  );
  assertConnected([0, 1, 2], withoutEdges);
  assert.deepEqual(withoutEdges, [
    { source: 0, target: 1, similarity: 1 },
    { source: 0, target: 2, similarity: 1 },
  ]);
});

test("complete graph bridges disconnected kNN islands even below threshold and beyond the degree cap", () => {
  const shots = Array.from({ length: 32 }, (_, i) =>
    input(String(i).padStart(2, "0"), i < 16 ? [1, 0] : [-1, 0]),
  );
  const original = structuredClone(shots);
  const options = { minSimilarity: 1, maxDegree: 1 };
  const graph = build(shots, options);
  const crossIslandEdges = graph.edges.filter((edge) => edge.source < 16 !== edge.target < 16);
  assert.deepEqual(crossIslandEdges, [{ source: 0, target: 16, similarity: 0 }]);
  assertConnected(graph.nodes, graph.edges);
  assert.equal(graph.edges.length, 31);
  assert.deepEqual(build([...shots].reverse(), options), graph);
  assert.deepEqual(shots, original);
  for (let i = 0; i < graph.nodes.length; i++) {
    const degree = graph.edges.filter((edge) => edge.source === i || edge.target === i).length;
    assert.equal(graph.nodes[i].radius, graphOptions.storyboardGraphNodeRadius(degree));
    assert.ok(Number.isFinite(graph.nodes[i].x) && Number.isFinite(graph.nodes[i].y));
  }
});

test("low-degree nodes share a radius; higher degrees grow the node and its collision disc", () => {
  const radius = graphOptions.storyboardGraphNodeRadius;
  for (const degree of [0, 1, 2, 3]) assert.equal(radius(degree), radius(0));
  const increment = radius(6) - radius(5);
  assert.ok(increment > 0);
  for (let degree = 6; degree <= 100; degree++) {
    assert.ok(radius(degree) > radius(degree - 1));
    assert.ok(radius(degree) + graphOptions.storyboardGraphCollisionPadding > radius(degree));
  }
  const graph = build(Array.from({ length: 20 }, (_, i) => input(String(i), [1, 0])));
  for (let i = 0; i < graph.nodes.length; i++) {
    const degree = graph.edges.filter((edge) => edge.source === i || edge.target === i).length;
    assert.equal(graph.nodes[i].radius, radius(degree));
  }
});

test("normalized cosine distance covers identical, perpendicular and opposite unit vectors", () => {
  const distance = graphModule.normalizedCosineDistance;
  assert.equal(distance([1, 0], [1, 0]), 0);
  assert.equal(distance([1, 0], [0, 1]), 0.5);
  assert.equal(distance([1, 0], [-1, 0]), 1);
  assert.equal(distance([1 + Number.EPSILON, 0], [1, 0]), 0);
});

test("kNN is ranked in semantic space and excludes self from the neighbor count", () => {
  const result = structuredClone(
    graphModule.storyboardGraphNeighbors(
      [
        [1, 0],
        [0.8, 0.6],
        [0, 1],
        [-1, 0],
      ],
      2,
    ),
  );
  assert.deepEqual(result.indices[0], [0, 1, 2]);
  assert.deepEqual(result.distances[0], [0, 0.09999999999999998, 0.5]);
  assert.deepEqual(result.indices[3], [3, 2, 1]);
  assert.equal(new Set(result.indices[0]).size, 3);
});

test("zero, one and two shots produce valid force layouts", () => {
  assert.deepEqual(build([]), {
    nodes: [],
    edges: [],
    neighbors: 0,
    ...defaultStoryboardGraphOptions,
  });
  assert.deepEqual(build([input("0", [3, 0])]), {
    nodes: [
      { id: "0", thumbnailFrame: 0, radius: graphOptions.storyboardGraphNodeRadius(0), x: 0, y: 0 },
    ],
    edges: [],
    neighbors: 0,
    ...defaultStoryboardGraphOptions,
  });
  const graph = build([input("1", [0, 4]), input("0", [3, 0])]);
  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.deepEqual(graph.edges, [{ source: 0, target: 1, similarity: 0.5 }]);
});

test("real D3-force produces deterministic finite positions and keeps public edges numeric", () => {
  const shots = Array.from({ length: 20 }, (_, i) =>
    input(String(i), [Math.cos(i / 5), Math.sin(i / 5), 0.2]),
  );
  const graph = build(shots);
  assert.deepEqual(build([...shots].reverse()), graph);
  assert.equal(graph.neighbors, 15);
  assert.equal(graph.nodes.length, shots.length);
  const edgeKeys = graph.edges.map((edge) => `${edge.source}:${edge.target}`);
  assert.equal(new Set(edgeKeys).size, edgeKeys.length);
  assert.ok(
    graph.edges.every(
      (edge) => edge.source < edge.target && edge.similarity >= 0 && edge.similarity <= 1,
    ),
  );
  for (const node of graph.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.equal(node.thumbnailFrame, Number(node.id) * 10);
  }
  assert.ok(new Set(graph.nodes.map((node) => `${node.x}:${node.y}`)).size > 1);
});

test("three shots and repeated semantic vectors remain separated by the force simulation", () => {
  for (const count of [3, 4, 16]) {
    const graph = build(Array.from({ length: count }, (_, i) => input(String(i), [1, 0])));
    assert.equal(graph.nodes.length, count);
    assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
    for (let i = 0; i < graph.nodes.length; i++) {
      for (let j = i + 1; j < graph.nodes.length; j++) {
        const a = graph.nodes[i];
        const b = graph.nodes[j];
        assert.ok(
          Math.hypot(a.x - b.x, a.y - b.y) >=
            a.radius + b.radius + graphOptions.storyboardGraphCollisionPadding * 2 - 0.1,
          "collision force separates duplicate vectors",
        );
      }
    }
  }
});

test("stronger semantic links pull nodes closer without mutating input vectors", () => {
  const near = [input("0", [1, 0]), input("1", [1, 0])];
  const far = [input("0", [1, 0]), input("1", [-1, 0])];
  const original = structuredClone([near, far]);
  const separation = (graph) =>
    Math.hypot(graph.nodes[0].x - graph.nodes[1].x, graph.nodes[0].y - graph.nodes[1].y);
  assert.ok(separation(build(near)) < separation(build(far)));
  assert.deepEqual([near, far], original);
});

test("force layout progress reaches completion and neighbors exclude self from k", () => {
  const progress = [];
  const graph = graphModule.buildStoryboardGraph(
    Array.from({ length: 4 }, (_, i) => input(String(i), [Math.cos(i), Math.sin(i)])),
    (phase, fraction) => progress.push([phase, fraction]),
    { minSimilarity: 0, maxDegree: 15 },
  );
  assert.equal(graph.neighbors, 3);
  assert.equal(graph.edges.length, 6);
  assert.deepEqual(progress.at(-1), ["layout", 1]);
  for (const phase of ["neighbors", "layout"]) {
    const fractions = progress.filter(([name]) => name === phase).map(([, fraction]) => fraction);
    assert.ok(fractions.length > 0);
    assert.ok(
      fractions.every(
        (fraction, i) => fraction > 0 && fraction <= 1 && (i === 0 || fraction >= fractions[i - 1]),
      ),
    );
  }
});

test("hover neighborhood includes both directions and leaves unrelated nodes out", () => {
  const graph = {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, x: 0, y: 0, thumbnailFrame: 0 })),
    edges: [
      { source: 0, target: 1, similarity: 0.8 },
      { source: 1, target: 2, similarity: 0.9 },
    ],
    neighbors: 1,
  };
  assert.deepEqual([...storyboardGraphNeighborhood(graph, "b")].sort(), ["a", "b", "c"]);
  assert.deepEqual([...storyboardGraphNeighborhood(graph, "d")], ["d"]);
  assert.equal(storyboardGraphNeighborhood(graph, "missing").size, 0);
});

test("sparsification drops weak supplementary links and includes the exact cutoff", () => {
  const edges = [
    { source: 0, target: 1, similarity: 1 },
    { source: 2, target: 3, similarity: 1 },
    { source: 0, target: 2, similarity: 0.8 },
    { source: 1, target: 3, similarity: 0.799999 },
  ];
  const before = structuredClone(edges);
  const result = sparse(edges, 4, { minSimilarity: 0.8, maxDegree: 15 });
  assert.equal(result.length, 3);
  assert.ok(result.some((edge) => edge.similarity === 0.8));
  assert.ok(result.every((edge) => edge.similarity >= 0.8));
  assert.deepEqual(edges, before);
});

test("each shot retains its highest-scoring link even below threshold", () => {
  const edges = [
    { source: 0, target: 1, similarity: 0.7 },
    { source: 0, target: 2, similarity: 0.6 },
    { source: 1, target: 2, similarity: 0.5 },
    { source: 2, target: 3, similarity: 0.65 },
    { source: 1, target: 3, similarity: 0.4 },
  ];
  const result = sparse(edges, 4, { minSimilarity: 1, maxDegree: 15 });
  for (let i = 0; i < 4; i++) {
    const best = Math.max(
      ...edges
        .filter((edge) => edge.source === i || edge.target === i)
        .map((edge) => edge.similarity),
    );
    assert.ok(
      result.some((edge) => (edge.source === i || edge.target === i) && edge.similarity === best),
    );
  }
  assert.ok(result.every((edge) => edge.similarity >= 0.65));
  assert.deepEqual(sparse([...edges].reverse(), 4, { minSimilarity: 1, maxDegree: 15 }), result);
});

test("supplementary links obey the 15-link degree cap in both directions", () => {
  const count = 20;
  const edges = [];
  for (let source = 0; source < count; source++) {
    for (let target = source + 1; target < count; target++) {
      edges.push({
        source,
        target,
        similarity: source % 2 === 0 && target === source + 1 ? 1 : 0.9,
      });
    }
  }
  const result = sparse(edges, count, { minSimilarity: 0.8, maxDegree: 15 });
  const degrees = Array(count).fill(0);
  for (const edge of result) {
    degrees[edge.source]++;
    degrees[edge.target]++;
  }
  assert.ok(degrees.every((degree) => degree >= 1 && degree <= 15));
  assert.ok(result.length < edges.length);
  assert.equal(new Set(result.map((edge) => `${edge.source}:${edge.target}`)).size, result.length);
});

test("mandatory best links take precedence over the cap for a shared nearest neighbor", () => {
  const edges = Array.from({ length: 17 }, (_, i) => ({
    source: 0,
    target: i + 1,
    similarity: 0.7 - i * 0.01,
  }));
  assert.equal(sparse(edges, 18).length, 17);
});

test("raising the threshold keeps all shots and their best links in the simulated graph", () => {
  const shots = Array.from({ length: 20 }, (_, i) =>
    input(String(i), [Math.cos(i / 5), Math.sin(i / 5), 0.2]),
  );
  const loose = build(shots, { minSimilarity: 0, maxDegree: 15 });
  const strict = build(shots, { minSimilarity: 1, maxDegree: 15 });
  assert.equal(strict.nodes.length, shots.length);
  assert.ok(strict.edges.length < loose.edges.length);
  for (let i = 0; i < strict.nodes.length; i++) {
    assert.ok(strict.edges.some((edge) => edge.source === i || edge.target === i));
  }
  assert.ok(strict.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.notDeepEqual(
    strict.nodes.map(({ x, y }) => [x, y]),
    loose.nodes.map(({ x, y }) => [x, y]),
  );
});

test("invalid sparsification settings are rejected", () => {
  for (const options of [
    { minSimilarity: NaN, maxDegree: 15 },
    { minSimilarity: -0.1, maxDegree: 15 },
    { minSimilarity: 1.1, maxDegree: 15 },
    { minSimilarity: 0.8, maxDegree: 0 },
    { minSimilarity: 0.8, maxDegree: 1.5 },
    { minSimilarity: 0.8, maxDegree: Infinity },
  ])
    assert.throws(() => sparse([], 0, options));
});

test("invalid and mismatched vectors and duplicate shot IDs fail instead of producing misleading dots", () => {
  for (const shots of [
    [input("0", [])],
    [input("0", [0, 0])],
    [input("0", [NaN, 1])],
    [input("0", [Infinity, 1])],
    [input("0", [1, 0]), input("1", [1])],
    [input("0", [1, 0]), input("0", [0, 1])],
  ])
    assert.throws(() => build(shots));
});
