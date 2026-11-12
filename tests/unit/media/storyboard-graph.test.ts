import assert from "node:assert/strict";
import { test } from "node:test";
import * as d3Force from "d3-force";
import { clientError } from "../../../src/errors/model.ts";
import { defaultStoryboardGraphOptions } from "../../../src/core/editor/storyboardGraph/options.ts";
import * as graphOptions from "../../../src/core/editor/storyboardGraph/options.ts";
import * as clustering from "../../../src/core/editor/storyboardGraph/clustering.ts";
import { createModuleLoader } from "../support/module-loader.ts";
import { storyboardGraphNeighborhood } from "../../../src/core/editor/storyboardGraph/camera.ts";
import type { StoryboardGraphOptions } from "../../../src/core/editor/storyboardGraph/options.ts";
import type {
  StoryboardGraph,
  StoryboardGraphEdge,
  StoryboardGraphForceNode,
  StoryboardGraphVector,
} from "../../../src/core/editor/storyboardGraph/graph.ts";

type SimulationNode = StoryboardGraphForceNode & { x: number; y: number };

const load = createModuleLoader(import.meta.url);
const graphModule = load<typeof import("../../../src/core/editor/storyboardGraph/graph.ts")>(
  "../../../src/core/editor/storyboardGraph/graph.ts",
  {
    "d3-force": d3Force,
    "../../../errors/model": { clientError },
    "./options": graphOptions,
    "./clustering": clustering,
  },
);
const build = (
  shots: readonly StoryboardGraphVector[],
  options: Partial<StoryboardGraphOptions> = defaultStoryboardGraphOptions,
): StoryboardGraph =>
  structuredClone(
    graphModule.buildStoryboardGraph(shots, undefined, {
      ...defaultStoryboardGraphOptions,
      ...options,
    }),
  );
const sparse = (
  edges: readonly StoryboardGraphEdge[],
  count: number,
  options: Partial<StoryboardGraphOptions> = defaultStoryboardGraphOptions,
): StoryboardGraphEdge[] =>
  structuredClone(
    graphModule.sparsifyStoryboardGraphEdges(edges, count, {
      ...defaultStoryboardGraphOptions,
      ...options,
    }),
  );
const input = (id: string, vector: number[]): StoryboardGraphVector => ({
  id,
  vector,
  thumbnailFrame: Number(id) * 10,
});
const {
  nodeRadius: _,
  maxVisibleDegree: __,
  ...defaultGraphSettings
} = defaultStoryboardGraphOptions;
const connect = (
  edges: readonly StoryboardGraphEdge[],
  vectors: readonly (readonly number[])[],
  minIslandConnections: number = defaultStoryboardGraphOptions.minIslandConnections,
): StoryboardGraphEdge[] =>
  structuredClone(
    graphModule.connectStoryboardGraphEdges(edges, vectors, undefined, undefined, {
      minIslandConnections,
    }),
  );

test("semantic clustering shapes the worker layout and remains independent of display degree", () => {
  const shots = Array.from({ length: 24 }, (_, i) =>
    input(
      String(i).padStart(2, "0"),
      [0, 1, 2].map((axis) => (axis === Math.floor(i / 8) ? 1 : ((i % 8) + 1) * 0.002)),
    ),
  );
  const graph = build(shots);
  assert.deepEqual(
    graph.nodes.map((node) => node.cluster),
    Array.from({ length: 24 }, (_, i) => Math.floor(i / 8)),
  );
  const centers = [0, 1, 2].map((cluster) => {
    const members = graph.nodes.filter((node) => node.cluster === cluster);
    const x = members.reduce((sum, node) => sum + node.x, 0) / members.length;
    const y = members.reduce((sum, node) => sum + node.y, 0) / members.length;
    return { x, y, radius: Math.max(...members.map((node) => Math.hypot(node.x - x, node.y - y))) };
  });
  for (let a = 0; a < centers.length; a++)
    for (let b = a + 1; b < centers.length; b++)
      assert.ok(
        Math.hypot(centers[a].x - centers[b].x, centers[a].y - centers[b].y) >
          centers[a].radius + centers[b].radius,
        "semantic groups occupy distinct regions",
      );
  const limited = build(shots, { maxVisibleDegree: 2 });
  assert.deepEqual(
    limited.nodes.map((node) => node.cluster),
    graph.nodes.map((node) => node.cluster),
  );
  assert.deepEqual(limited.edges, graph.edges);
  assertConnected(graph.nodes, graph.edges);
});

test("interactive forces tether a grabbed node, move its neighbors and cool after release", () => {
  const graph = build(Array.from({ length: 9 }, (_, i) => input(String(i), [1, i / 8, 0.2])));
  const snapshot = structuredClone(graph);
  const nodes: SimulationNode[] = graph.nodes.map((node) => ({ ...node }));
  const simulation = graphModule.createStoryboardGraphSimulation(nodes, graph.edges);
  try {
    const held = nodes[4];
    const original = { x: held.x, y: held.y };
    held.fx = held.x + 120;
    held.fy = held.y + 60;
    simulation.alpha(0.3).alphaTarget(0.25).tick(45);
    assert.equal(held.x, held.fx);
    assert.equal(held.y, held.fy);
    assert.ok(
      nodes.some(
        (node, i) =>
          i !== 4 && Math.hypot(node.x - graph.nodes[i].x, node.y - graph.nodes[i].y) > 2,
      ),
    );
    const release = { x: held.x, y: held.y };
    held.fx = null;
    held.fy = null;
    simulation.alphaTarget(0).tick(320);
    assert.ok(simulation.alpha() < simulation.alphaMin());
    assert.ok(Math.hypot(held.x - release.x, held.y - release.y) > 2);
    assert.ok(
      Math.hypot(held.x - original.x, held.y - original.y) > 1,
      "settles into a recomputed layout instead of snapping to the original coordinate",
    );
    assert.ok(nodes.every((node) => [node.x, node.y, node.vx, node.vy].every(Number.isFinite)));
    assert.deepEqual(graph, snapshot, "semantic graph and numeric edge indices remain immutable");
  } finally {
    simulation.stop();
  }
});

test("disabling clustering preserves semantic topology and restores ordinary force behavior", () => {
  const shots = Array.from({ length: 12 }, (_, i) =>
    input(String(i), [Math.cos(i / 3), Math.sin(i / 3), 0.1]),
  );
  const clustered = build(shots);
  const plain = build(shots, { clusterEnabled: false });
  assert.equal(plain.clusterEnabled, false);
  assert.ok(plain.nodes.every((node) => node.cluster === undefined));
  assert.deepEqual(plain.edges, clustered.edges);
  assert.deepEqual(
    plain.nodes.map((node) => node.radius),
    clustered.nodes.map((node) => node.radius),
  );
  const withLabels: SimulationNode[] = clustered.nodes.map((node) => ({ ...node }));
  const withoutLabels = withLabels.map(({ cluster, ...node }) => node);
  const a = graphModule.createStoryboardGraphSimulation(withLabels, plain.edges, plain);
  const b = graphModule.createStoryboardGraphSimulation(withoutLabels, plain.edges, plain);
  try {
    a.tick(100);
    b.tick(100);
    assert.deepEqual(
      withLabels.map(({ x, y }) => [x, y]),
      withoutLabels.map(({ x, y }) => [x, y]),
    );
  } finally {
    a.stop();
    b.stop();
  }
});

test("visible edge limits preserve minimum links and animation identity without mutating the computed graph", () => {
  const edges = [
    { source: 0, target: 1, similarity: 0.99, opacity: 0.8 },
    { source: 0, target: 2, similarity: 0.8 },
    { source: 0, target: 3, similarity: 0.7 },
    { source: 1, target: 2, similarity: 0.9 },
    { source: 1, target: 3, similarity: 0.6 },
    { source: 2, target: 3, similarity: 0.5 },
  ];
  const snapshot = structuredClone(edges);
  const settings = { ...defaultStoryboardGraphOptions, minDegree: 2 };
  for (const limit of [0, 1, 2]) {
    const visible = graphModule.storyboardGraphVisibleEdges(edges, 4, limit, settings);
    for (let i = 0; i < 4; i++)
      assert.ok(visible.filter((edge) => edge.source === i || edge.target === i).length >= 2);
    assert.equal(visible.length, 5);
    assertConnected([0, 1, 2, 3], visible);
    assert.ok(
      visible.every((edge) => edges.includes(edge)),
      "retain animation identity and opacity",
    );
    assert.deepEqual(
      new Set(graphModule.storyboardGraphVisibleEdges([...edges].reverse(), 4, limit, settings)),
      new Set(visible),
    );
  }
  assert.deepEqual(Array.from(graphModule.storyboardGraphVisibleEdges(edges, 4, 10)), edges);
  assert.deepEqual(edges, snapshot);
});

test("display sparsification repairs islands with existing strongest bridges despite its lower degree cap", () => {
  const internal = [
    [0, 1],
    [0, 2],
    [1, 2],
    [3, 4],
    [3, 5],
    [4, 5],
  ].map(([source, target]) => ({ source, target, similarity: 1 }));
  const bridges = [
    { source: 2, target: 3, similarity: 0.3 },
    { source: 1, target: 3, similarity: 0.2 },
    { source: 0, target: 4, similarity: 0.1 },
  ];
  const edges = [...internal, ...bridges];
  for (const minimum of [1, 2, 3]) {
    const visible = graphModule.storyboardGraphVisibleEdges(edges, 6, 2, {
      minDegree: 2,
      minIslandConnections: minimum,
    });
    assert.deepEqual(
      Array.from(visible).filter((edge) => bridges.includes(edge)),
      bridges.slice(0, minimum),
    );
    assertConnected([0, 1, 2, 3, 4, 5], visible);
    assert.ok(visible.every((edge) => edges.includes(edge)));
  }
  assert.deepEqual(
    Array.from(
      graphModule.storyboardGraphVisibleEdges(internal, 6, 2, {
        ...defaultStoryboardGraphOptions,
        minDegree: 2,
      }),
    ),
    internal,
    "disconnected provisional edge pools never invent a new force link or loop indefinitely",
  );
});

test("supplementary display links obey the cap when minimum degree and connectivity already hold", () => {
  const edges: StoryboardGraphEdge[] = [];
  for (let source = 0; source < 20; source++) {
    for (let target = source + 1; target < 20; target++) {
      edges.push({
        source,
        target,
        similarity: target === source + 1 || (source === 0 && target === 19) ? 1 : 0.9,
      });
    }
  }
  for (const limit of [2, 3, 8]) {
    const visible = graphModule.storyboardGraphVisibleEdges(edges, 20, limit);
    for (let i = 0; i < 20; i++) {
      const degree = visible.filter((edge) => edge.source === i || edge.target === i).length;
      assert.ok(degree >= 2 && degree <= limit);
    }
    assertConnected(Array<number>(20), visible);
    assert.ok(visible.length < edges.length);
  }
});

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
function assertConnected(nodes: readonly unknown[], edges: readonly StoryboardGraphEdge[]): void {
  if (!nodes.length) return;
  const visited = new Set<number>([0]);
  const pending: number[] = [0];
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

test("island repair reserves the two strongest distinct external links even after the first merges the islands", () => {
  const vectors = [0, 0.3, 1, 1.2].map((angle) => [Math.cos(angle), Math.sin(angle)]);
  const edges = [
    { source: 0, target: 1, similarity: 0.98 },
    { source: 2, target: 3, similarity: 0.99 },
  ];
  const before = structuredClone({ edges, vectors });
  const repaired = connect(edges, vectors, 2);
  assert.deepEqual(repaired.slice(0, 2), edges);
  assert.equal(repaired.length, 4);
  assert.deepEqual(repaired[2], {
    source: 1,
    target: 2,
    similarity: 1 - graphModule.normalizedCosineDistance(vectors[1], vectors[2]),
  });
  assert.deepEqual(repaired[3], {
    source: 1,
    target: 3,
    similarity: 1 - graphModule.normalizedCosineDistance(vectors[1], vectors[3]),
  });
  assert.equal(
    new Set(repaired.map((edge) => `${edge.source}:${edge.target}`)).size,
    repaired.length,
  );
  assertConnected(vectors, repaired);
  assert.deepEqual({ edges, vectors }, before);
});

test("island connection count is configurable and one bridge preserves minimal connectivity repair", () => {
  const vectors = [0, 0.01, 0.1, 0.11, 2, 2.01, 2.1, 2.11].map((angle) => [
    Math.cos(angle),
    Math.sin(angle),
  ]);
  const edges = [0, 2, 4, 6].map((source) => ({ source, target: source + 1, similarity: 1 }));
  const repaired = connect(edges, vectors, 1);
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
    connect([...edges].reverse(), vectors, 1).slice(edges.length),
    repaired.slice(edges.length),
  );
});

test("two outgoing links are reserved for each island and again for newly merged islands", () => {
  const vectors = [0, 0.01, 0.1, 0.11, 2, 2.01, 2.1, 2.11].map((angle) => [
    Math.cos(angle),
    Math.sin(angle),
  ]);
  const edges = [0, 2, 4, 6].map((source) => ({ source, target: source + 1, similarity: 1 }));
  const repaired = connect(edges, vectors, 2);
  assertConnected(vectors, repaired);
  const bridges = repaired.slice(edges.length);
  for (const island of [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ]) {
    assert.ok(
      bridges.filter((edge) => island.includes(edge.source) !== island.includes(edge.target))
        .length >= 2,
    );
  }
  assert.equal(
    new Set(repaired.map((edge) => `${edge.source}:${edge.target}`)).size,
    repaired.length,
  );
  assert.deepEqual(connect([...edges].reverse(), vectors, 2).slice(edges.length), bridges);
  const pairVectors = vectors.slice(0, 4);
  for (const minimum of [1, 2, 3, 10]) {
    assert.equal(connect(edges.slice(0, 2), pairVectors, minimum).length - 2, Math.min(minimum, 4));
  }
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
    2,
  );
  assertConnected([0, 1, 2], withoutEdges);
  assert.deepEqual(withoutEdges, [
    { source: 0, target: 1, similarity: 1 },
    { source: 0, target: 2, similarity: 1 },
    { source: 1, target: 2, similarity: 1 },
  ]);
  assert.deepEqual(
    connect(
      [],
      [
        [1, 0],
        [-1, 0],
      ],
    ),
    [{ source: 0, target: 1, similarity: 0 }],
    "two singleton islands have only one distinct possible link",
  );
});

test("complete graph bridges disconnected kNN islands even below threshold and beyond the degree cap", () => {
  const shots = Array.from({ length: 32 }, (_, i) =>
    input(String(i).padStart(2, "0"), i < 16 ? [1, 0] : [-1, 0]),
  );
  const original = structuredClone(shots);
  const options = { minSimilarity: 1, maxDegree: 1, minDegree: 2, minIslandConnections: 2 };
  const graph = build(shots, options);
  const crossIslandEdges = graph.edges.filter((edge) => edge.source < 16 !== edge.target < 16);
  assert.deepEqual(crossIslandEdges, [
    { source: 0, target: 16, similarity: 0 },
    { source: 0, target: 17, similarity: 0 },
  ]);
  assertConnected(graph.nodes, graph.edges);
  assert.equal(graph.edges.length, 60);
  assert.deepEqual(build([...shots].reverse(), options), graph);
  assert.deepEqual(shots, original);
  for (let i = 0; i < graph.nodes.length; i++) {
    const degree = graph.edges.filter((edge) => edge.source === i || edge.target === i).length;
    assert.equal(graph.nodes[i].radius, defaultStoryboardGraphOptions.nodeRadius(degree));
    assert.ok(Number.isFinite(graph.nodes[i].x) && Number.isFinite(graph.nodes[i].y));
  }
});

test("the configured radius rule supplies finite node geometry and a larger collision disc", () => {
  const radius = defaultStoryboardGraphOptions.nodeRadius;
  for (let degree = 0; degree <= 100; degree++) {
    assert.ok(Number.isFinite(radius(degree)) && radius(degree) > 0);
    assert.ok(radius(degree) + defaultStoryboardGraphOptions.collisionPadding > radius(degree));
  }
  const graph = build(Array.from({ length: 20 }, (_, i) => input(String(i), [1, 0])));
  const visible = graphModule.storyboardGraphVisibleEdges(
    graph.edges,
    graph.nodes.length,
    defaultStoryboardGraphOptions.maxVisibleDegree,
    graph,
  );
  for (let i = 0; i < graph.nodes.length; i++) {
    const view_degree = visible.filter((edge) => edge.source === i || edge.target === i).length;
    assert.equal(graph.nodes[i].radius, radius(view_degree));
  }
});

test("custom radius closures survive worker serialization and collision padding reaches layout and live dragging", () => {
  const baseRadius = 9;
  const settings: StoryboardGraphOptions = {
    ...defaultStoryboardGraphOptions,
    nodeRadius: (degree) => baseRadius + degree * 0.3,
    collisionPadding: 7,
  };
  const shots = Array.from({ length: 9 }, (_, i) => input(String(i), [1, i / 9]));
  const serialized = structuredClone(
    graphModule.serializeStoryboardGraphOptions(settings, shots.length),
  );
  assert.equal("nodeRadius" in serialized, false);
  assert.equal("maxVisibleDegree" in serialized, false);
  assert.deepEqual(
    structuredClone(
      graphModule.serializeStoryboardGraphOptions(
        { ...settings, maxVisibleDegree: 0 },
        shots.length,
      ),
    ),
    serialized,
    "display changes neither invalidate the worker layout nor enter its payload",
  );
  const restored = graphModule.deserializeStoryboardGraphOptions(serialized);
  const graph = build(shots, restored);
  assert.deepEqual(graph, build(shots, settings));
  assert.deepEqual(graph.edges, build(shots, { ...settings, maxVisibleDegree: 0 }).edges);
  assert.equal(graph.collisionPadding, 7);
  assert.equal("nodeRadius" in graph, false, "worker results remain structured-cloneable");
  const visible = graphModule.storyboardGraphVisibleEdges(
    graph.edges,
    graph.nodes.length,
    settings.maxVisibleDegree,
    graph,
  );
  for (let i = 0; i < graph.nodes.length; i++) {
    const view_degree = visible.filter((edge) => edge.source === i || edge.target === i).length;
    assert.equal(graph.nodes[i].radius, settings.nodeRadius(view_degree));
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const a = graph.nodes[i];
      const b = graph.nodes[j];
      assert.ok(
        Math.hypot(a.x - b.x, a.y - b.y) >=
          a.radius + b.radius + settings.collisionPadding * 2 - 0.1,
      );
    }
  }
  const nodes = graph.nodes.slice(0, 2).map((node, i) => ({ ...node, x: i, y: 0 }));
  const simulation = graphModule
    .createStoryboardGraphSimulation(nodes, [], graph)
    .force("charge", null)
    .force("x", null)
    .force("y", null);
  try {
    simulation.tick(320);
    assert.ok(
      Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y) >=
        nodes[0].radius + nodes[1].radius + settings.collisionPadding * 2 - 0.1,
    );
  } finally {
    simulation.stop();
  }
  assert.equal(graphModule.serializeStoryboardGraphOptions(settings, 0).nodeRadii[0], baseRadius);
});

test("nodeRadius receives the final visible degree including mandatory links and island repair", () => {
  const received: number[] = [];
  const settings: StoryboardGraphOptions = {
    ...defaultStoryboardGraphOptions,
    minSimilarity: 0,
    maxDegree: 18,
    maxVisibleDegree: 3,
    nodeRadius: (view_degree) => {
      received.push(view_degree);
      return 5 + view_degree * 0.2;
    },
  };
  const graph = build(
    Array.from({ length: 12 }, (_, i) => input(String(i), [1, 0])),
    settings,
  );
  const visible = graphModule.storyboardGraphVisibleEdges(
    graph.edges,
    graph.nodes.length,
    settings.maxVisibleDegree,
    graph,
  );
  const viewDegrees = graph.nodes.map(
    (_, i) => visible.filter((edge) => edge.source === i || edge.target === i).length,
  );
  assert.deepEqual(received, viewDegrees);
  assert.ok(
    viewDegrees.some(
      (degree, i) =>
        degree < graph.edges.filter((edge) => edge.source === i || edge.target === i).length,
    ),
  );
  assert.deepEqual(
    graph.nodes.map((node) => node.radius),
    viewDegrees.map((degree) => 5 + degree * 0.2),
  );
});

test("invalid radius functions and nonpositive collision padding are rejected", () => {
  for (const radius of [-1, 0, NaN, Infinity]) {
    assert.throws(() => build([input("0", [1, 0])], { nodeRadius: () => radius }));
  }
  for (const collisionPadding of [-1, 0, NaN, Infinity]) {
    assert.throws(() => build([input("0", [1, 0]), input("1", [0, 1])], { collisionPadding }));
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
    ...defaultGraphSettings,
  });
  assert.deepEqual(build([input("0", [3, 0])]), {
    nodes: [
      {
        id: "0",
        thumbnailFrame: 0,
        radius: defaultStoryboardGraphOptions.nodeRadius(0),
        cluster: 0,
        x: 0,
        y: 0,
      },
    ],
    edges: [],
    neighbors: 0,
    ...defaultGraphSettings,
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
            a.radius + b.radius + defaultStoryboardGraphOptions.collisionPadding * 2 - 0.1,
          "collision force separates duplicate vectors",
        );
      }
    }
  }
});

test("minimum degree expands the kNN candidate count and clamps to available distinct neighbors", () => {
  const shots = Array.from({ length: 20 }, (_, i) => input(String(i), [Math.cos(i), Math.sin(i)]));
  for (const minimum of [2, 17, 30]) {
    const graph = build(shots, { minSimilarity: 1, maxDegree: 1, minDegree: minimum });
    for (let i = 0; i < shots.length; i++) {
      assert.ok(
        graph.edges.filter((edge) => edge.source === i || edge.target === i).length >=
          Math.min(minimum, shots.length - 1),
      );
    }
    assert.equal(graph.minDegree, minimum);
    assert.equal(graph.minIslandConnections, defaultStoryboardGraphOptions.minIslandConnections);
  }
});

test("stronger semantic links pull nodes closer without mutating input vectors", () => {
  const near = [input("0", [1, 0]), input("1", [1, 0])];
  const far = [input("0", [1, 0]), input("1", [-1, 0])];
  const original = structuredClone([near, far]);
  const separation = (graph: StoryboardGraph) =>
    Math.hypot(graph.nodes[0].x - graph.nodes[1].x, graph.nodes[0].y - graph.nodes[1].y);
  assert.ok(separation(build(near)) < separation(build(far)));
  assert.deepEqual([near, far], original);
});

test("force layout progress reaches completion and neighbors exclude self from k", () => {
  const progress: ["neighbors" | "layout", number][] = [];
  const graph = graphModule.buildStoryboardGraph(
    Array.from({ length: 4 }, (_, i) => input(String(i), [Math.cos(i), Math.sin(i)])),
    (phase, fraction) => progress.push([phase, fraction]),
    { ...defaultStoryboardGraphOptions, minSimilarity: 0, maxDegree: 15 },
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
  } as StoryboardGraph;
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
  const result = sparse(edges, 4, { minSimilarity: 0.8, maxDegree: 15, minDegree: 1 });
  assert.equal(result.length, 3);
  assert.ok(result.some((edge) => edge.similarity === 0.8));
  assert.ok(result.every((edge) => edge.similarity >= 0.8));
  assert.deepEqual(edges, before);
});

test("each shot retains its two highest-scoring links even below threshold and beyond the cap", () => {
  const edges = [
    { source: 0, target: 1, similarity: 0.7 },
    { source: 0, target: 2, similarity: 0.6 },
    { source: 1, target: 2, similarity: 0.5 },
    { source: 2, target: 3, similarity: 0.65 },
    { source: 1, target: 3, similarity: 0.4 },
  ];
  const result = sparse(edges, 4, { minSimilarity: 1, maxDegree: 1, minDegree: 2 });
  for (let i = 0; i < 4; i++) {
    const best = edges
      .filter((edge) => edge.source === i || edge.target === i)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 2);
    for (const edge of best)
      assert.ok(result.some((link) => link.source === edge.source && link.target === edge.target));
  }
  assert.equal(result.length, 5);
  assert.deepEqual(
    sparse([...edges].reverse(), 4, { minSimilarity: 1, maxDegree: 1, minDegree: 2 }),
    result,
  );
  assert.equal(sparse(edges, 4, { minSimilarity: 1, minDegree: 1 }).length, 2);
  assert.equal(sparse(edges, 4, { minSimilarity: 1, minDegree: 3 }).length, edges.length);
});

test("supplementary links obey the 15-link degree cap in both directions", () => {
  const count = 20;
  const edges: StoryboardGraphEdge[] = [];
  for (let source = 0; source < count; source++) {
    for (let target = source + 1; target < count; target++) {
      edges.push({
        source,
        target,
        similarity: target === source + 1 || (source === 0 && target === count - 1) ? 1 : 0.9,
      });
    }
  }
  const result = sparse(edges, count, { minSimilarity: 0.8, maxDegree: 15 });
  const degrees = Array<number>(count).fill(0);
  for (const edge of result) {
    degrees[edge.source]++;
    degrees[edge.target]++;
  }
  assert.ok(degrees.every((degree) => degree >= 2 && degree <= 15));
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
  const strict = build(shots, { minSimilarity: 1, maxDegree: 15, minDegree: 2 });
  assert.equal(strict.nodes.length, shots.length);
  assert.ok(strict.edges.length < loose.edges.length);
  for (let i = 0; i < strict.nodes.length; i++) {
    assert.ok(strict.edges.filter((edge) => edge.source === i || edge.target === i).length >= 2);
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
    { minDegree: 0 },
    { minDegree: 1.5 },
    { minDegree: Infinity },
  ])
    assert.throws(() => sparse([], 0, options));
  for (const count of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => connect([], [], count));
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
