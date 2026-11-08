import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { clientError } from "../../../errors/model";
import {
  defaultStoryboardGraphOptions,
  storyboardGraphNodeRadius,
  storyboardGraphCollisionPadding,
  type StoryboardGraphOptions,
} from "./options";

export interface StoryboardGraphVector {
  id: string;
  vector: number[];
  thumbnailFrame: number;
}

export interface StoryboardGraphNode {
  id: string;
  x: number;
  y: number;
  thumbnailFrame: number;
  radius: number;
}

export interface StoryboardGraphEdge {
  source: number;
  target: number;
  similarity: number;
}

export interface StoryboardGraph {
  nodes: StoryboardGraphNode[];
  edges: StoryboardGraphEdge[];
  neighbors: number;
  minSimilarity: number;
  maxDegree: number;
}

// Apply the same sparse topology to rendering, hover neighbors and link forces.
// Reserve each node's best link even below the cutoff. Additional links obey
// the threshold and degree cap; mandatory best links take priority over the cap.
export function sparsifyStoryboardGraphEdges(
  edges: readonly StoryboardGraphEdge[],
  nodeCount: number,
  options: StoryboardGraphOptions = defaultStoryboardGraphOptions,
) {
  const { minSimilarity, maxDegree } = options;
  if (
    !Number.isFinite(minSimilarity) ||
    minSimilarity < 0 ||
    minSimilarity > 1 ||
    !Number.isInteger(maxDegree) ||
    maxDegree < 1
  ) {
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph sparsification options");
  }
  const candidates = [...edges].sort(
    (a, b) => b.similarity - a.similarity || a.source - b.source || a.target - b.target,
  );
  const degrees = new Uint32Array(nodeCount);
  const result: StoryboardGraphEdge[] = [];
  const strongest: (StoryboardGraphEdge | undefined)[] = Array(nodeCount);
  for (const edge of candidates) {
    strongest[edge.source] ??= edge;
    strongest[edge.target] ??= edge;
  }
  const retained = new Set<StoryboardGraphEdge>();
  const retain = (edge: StoryboardGraphEdge) => {
    if (retained.has(edge)) return;
    retained.add(edge);
    degrees[edge.source]++;
    degrees[edge.target]++;
    result.push(edge);
  };
  for (const edge of strongest) {
    if (edge) retain(edge);
  }
  for (const edge of candidates) {
    if (edge.similarity < minSimilarity || retained.has(edge)) continue;
    if (degrees[edge.source] >= maxDegree || degrees[edge.target] >= maxDegree) continue;
    retain(edge);
  }
  return result;
}

function unitVector(vector: readonly number[], dimensions: number) {
  if (vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph vector");
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || !norm)
    throw clientError("UNEXPECTED_ERROR", "Storyboard graph vector has no direction");
  return vector.map((value) => value / norm);
}

// Unit vectors: normalized cosine similarity = (1 + cos) / 2, distance = 1 - similarity.
export function normalizedCosineDistance(a: readonly number[], b: readonly number[]) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return (1 - Math.max(-1, Math.min(1, dot))) / 2;
}

// One triangular row per vector caches each unordered pair exactly once. The
// worker keeps this index across filters and deletions, including island repair.
export function indexStoryboardGraphSimilarities(input: readonly StoryboardGraphVector[]) {
  const dimensions = input[0]?.vector.length ?? 0;
  const vectors = input.map((shot) => unitVector(shot.vector, dimensions));
  const indices = new Map(input.map((shot, index) => [shot.id, index]));
  const rows = vectors.map((_, index) => new Float64Array(index).fill(NaN));
  let comparisons = 0;
  return {
    get comparisons() {
      return comparisons;
    },
    distance(a: string, b: string) {
      const first = indices.get(a);
      const second = indices.get(b);
      if (first === undefined || second === undefined)
        throw clientError("UNEXPECTED_ERROR", "Unknown storyboard graph vector");
      if (first === second) return 0;
      const row = Math.max(first, second);
      const column = Math.min(first, second);
      if (Number.isNaN(rows[row][column])) {
        rows[row][column] = normalizedCosineDistance(vectors[row], vectors[column]);
        comparisons++;
      }
      return rows[row][column];
    },
  };
}

// Each disconnected component chooses its highest-scoring link to any external
// node. Search all unit vectors: an outgoing link may be absent from the kNN
// candidates entirely. Repeat after merging components, adding no redundant
// bridges. Connectivity takes precedence over the threshold and degree cap.
export function connectStoryboardGraphEdges(
  edges: readonly StoryboardGraphEdge[],
  vectors: readonly (readonly number[])[],
  progress = (_: number) => {},
  distance = (source: number, target: number) =>
    normalizedCosineDistance(vectors[source], vectors[target]),
) {
  const result = [...edges];
  const parents = Uint32Array.from(vectors, (_, index) => index);
  let components = vectors.length;
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const merge = (edge: StoryboardGraphEdge) => {
    const a = root(edge.source);
    const b = root(edge.target);
    if (a === b) return false;
    parents[Math.max(a, b)] = Math.min(a, b);
    components--;
    return true;
  };
  for (const edge of edges) merge(edge);
  const initialComponents = components;
  const compare = (a: StoryboardGraphEdge, b: StoryboardGraphEdge) =>
    b.similarity - a.similarity || a.source - b.source || a.target - b.target;

  while (components > 1) {
    const labels = Array.from(vectors, (_, index) => root(index));
    const strongest: (StoryboardGraphEdge | undefined)[] = Array(vectors.length);
    for (let source = 0; source < vectors.length; source++) {
      for (let target = source + 1; target < vectors.length; target++) {
        if (labels[source] === labels[target]) continue;
        const edge = {
          source,
          target,
          similarity: 1 - distance(source, target),
        };
        for (const component of [labels[source], labels[target]]) {
          const best = strongest[component];
          if (!best || compare(edge, best) < 0) strongest[component] = edge;
        }
      }
    }
    const bridges = strongest.filter((edge): edge is StoryboardGraphEdge => Boolean(edge));
    bridges.sort(compare);
    for (const edge of bridges) {
      if (merge(edge)) result.push(edge);
    }
    progress((initialComponents - components) / (initialComponents - 1));
  }
  progress(1);
  return result;
}

// Exact kNN with O(nk) storage. Self is the first entry and is excluded from edges.
export function storyboardGraphNeighbors(
  vectors: number[][],
  k: number,
  progress = (_: number) => {},
  distanceAt = (source: number, target: number) =>
    normalizedCosineDistance(vectors[source], vectors[target]),
) {
  const indices: number[][] = [];
  const distances: number[][] = [];
  const count = Math.min(Math.max(0, Math.floor(k)), Math.max(0, vectors.length - 1));
  for (let i = 0; i < vectors.length; i++) {
    const nearest: { index: number; distance: number }[] = [];
    for (let j = 0; j < vectors.length; j++) {
      if (i === j || count === 0) continue;
      const distance = distanceAt(i, j);
      let position = nearest.length;
      while (position > 0 && nearest[position - 1].distance > distance) position--;
      if (position < count) {
        nearest.splice(position, 0, { index: j, distance });
        if (nearest.length > count) nearest.pop();
      }
    }
    indices.push([i, ...nearest.map((entry) => entry.index)]);
    distances.push([0, ...nearest.map((entry) => entry.distance)]);
    progress((i + 1) / vectors.length);
  }
  return { indices, distances };
}

function seededRandom() {
  let seed = 42;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StoryboardGraphForceNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

interface ForceEdge<Node extends StoryboardGraphForceNode> extends SimulationLinkDatum<Node> {
  similarity: number;
}

// Worker layouts and interactive dragging use identical forces. D3 mutates only
// private node/link copies, never the graph or its cached semantic similarities.
export function createStoryboardGraphSimulation<Node extends StoryboardGraphForceNode>(
  nodes: Node[],
  edges: readonly StoryboardGraphEdge[],
) {
  const degrees = nodes.map(() => 0);
  for (const edge of edges) {
    degrees[edge.source]++;
    degrees[edge.target]++;
  }
  const links: ForceEdge<Node>[] = edges.map((edge) => ({ ...edge }));
  return forceSimulation(nodes)
    .stop()
    .randomSource(seededRandom())
    .velocityDecay(0.4)
    .force(
      "link",
      forceLink<Node, ForceEdge<Node>>(links)
        .distance((edge) => 30 + (1 - edge.similarity) * 90)
        .strength((edge) => {
          const source = edge.source as Node;
          const target = edge.target as Node;
          const degree = Math.max(1, Math.min(degrees[source.index!], degrees[target.index!]));
          return (0.15 + 0.85 * edge.similarity ** 2) / degree;
        }),
    )
    .force("charge", forceManyBody<Node>().strength(-120).distanceMin(12))
    .force(
      "collision",
      forceCollide<Node>((node) => node.radius + storyboardGraphCollisionPadding).iterations(3),
    )
    .force("center", forceCenter(0, 0))
    .force("x", forceX<Node>(0).strength(0.015))
    .force("y", forceY<Node>(0).strength(0.015));
}

function forceDirectedPositions(
  shots: readonly StoryboardGraphVector[],
  edges: readonly StoryboardGraphEdge[],
  degrees: readonly number[],
  progress: (fraction: number) => void,
  previous: readonly StoryboardGraphNode[] = [],
) {
  if (shots.length <= 1) return shots.map(() => [0, 0]);
  const positions = new Map(previous.map((node) => [node.id, node]));
  const nodes: StoryboardGraphForceNode[] = shots.map((shot, i) => ({
    id: shot.id,
    radius: storyboardGraphNodeRadius(degrees[i]),
    x: positions.get(shot.id)?.x,
    y: positions.get(shot.id)?.y,
  }));
  const simulation = createStoryboardGraphSimulation(nodes, edges);
  try {
    const ticks = Math.ceil(
      Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()),
    );
    // A stopped simulation is advanced explicitly inside the graph worker.
    // Cooling to alphaMin yields a deterministic layout without a live timer.
    for (let tick = 0; tick < ticks; tick++) {
      simulation.tick();
      if (tick % 10 === 0) progress((tick + 1) / ticks);
    }
    return nodes.map((node) => [node.x!, node.y!]);
  } finally {
    simulation.stop();
  }
}

export function buildStoryboardGraph(
  input: readonly StoryboardGraphVector[],
  progress = (_phase: "neighbors" | "layout", _fraction: number) => {},
  options: StoryboardGraphOptions = defaultStoryboardGraphOptions,
  reuse: {
    similarities?: ReturnType<typeof indexStoryboardGraphSimilarities>;
    positions?: readonly StoryboardGraphNode[];
  } = {},
): StoryboardGraph {
  // Panel sorting and search must not alter the random initialization or node identities.
  const shots = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) {
    throw clientError("UNEXPECTED_ERROR", "Duplicate storyboard graph IDs");
  }
  const dimensions = shots[0]?.vector.length ?? 0;
  const vectors = shots.map((shot) => unitVector(shot.vector, dimensions));
  const neighbors = Math.min(15, Math.max(0, shots.length - 1));
  const distance = reuse.similarities
    ? (source: number, target: number) =>
        reuse.similarities!.distance(shots[source].id, shots[target].id)
    : (source: number, target: number) =>
        normalizedCosineDistance(vectors[source], vectors[target]);
  const { indices, distances } = storyboardGraphNeighbors(
    vectors,
    neighbors,
    (fraction) => progress("neighbors", fraction * 0.85),
    distance,
  );
  const edges: StoryboardGraphEdge[] = [];
  const seen = new Set<string>();
  indices.forEach((row, i) => {
    row.slice(1).forEach((j, slot) => {
      const source = Math.min(i, j);
      const target = Math.max(i, j);
      const key = `${source}:${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source, target, similarity: 1 - distances[i][slot + 1] });
    });
  });
  const sparseEdges = connectStoryboardGraphEdges(
    sparsifyStoryboardGraphEdges(edges, shots.length, options),
    vectors,
    (fraction) => progress("neighbors", 0.85 + fraction * 0.15),
    distance,
  );
  const degrees = shots.map(() => 0);
  for (const edge of sparseEdges) {
    degrees[edge.source]++;
    degrees[edge.target]++;
  }
  const positions = forceDirectedPositions(
    shots,
    sparseEdges,
    degrees,
    (fraction) => progress("layout", fraction),
    reuse.positions,
  );
  if (positions.some((position) => position.length !== 2 || !position.every(Number.isFinite))) {
    throw clientError("UNEXPECTED_ERROR", "Non-finite storyboard graph layout");
  }
  progress("layout", 1);
  return {
    nodes: shots.map((shot, i) => ({
      id: shot.id,
      thumbnailFrame: shot.thumbnailFrame,
      radius: storyboardGraphNodeRadius(degrees[i]),
      x: positions[i][0],
      y: positions[i][1],
    })),
    edges: sparseEdges,
    neighbors,
    minSimilarity: options.minSimilarity,
    maxDegree: options.maxDegree,
  };
}
