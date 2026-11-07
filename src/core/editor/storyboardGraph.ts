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
import { clientError } from "../../errors/model";
import {
  defaultStoryboardGraphOptions,
  storyboardGraphNodeRadius,
  storyboardGraphCollisionPadding,
  type StoryboardGraphOptions,
} from "./storyboardGraphOptions";

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

// Each disconnected component chooses its highest-scoring link to any external
// node. Search all unit vectors: an outgoing link may be absent from the kNN
// candidates entirely. Repeat after merging components, adding no redundant
// bridges. Connectivity takes precedence over the threshold and degree cap.
export function connectStoryboardGraphEdges(
  edges: readonly StoryboardGraphEdge[],
  vectors: readonly (readonly number[])[],
  progress = (_: number) => {},
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
          similarity: 1 - normalizedCosineDistance(vectors[source], vectors[target]),
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
) {
  const indices: number[][] = [];
  const distances: number[][] = [];
  const count = Math.min(Math.max(0, Math.floor(k)), Math.max(0, vectors.length - 1));
  for (let i = 0; i < vectors.length; i++) {
    const nearest: { index: number; distance: number }[] = [];
    for (let j = 0; j < vectors.length; j++) {
      if (i === j || count === 0) continue;
      const distance = normalizedCosineDistance(vectors[i], vectors[j]);
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

interface ForceNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

interface ForceEdge extends SimulationLinkDatum<ForceNode> {
  similarity: number;
}

function forceDirectedPositions(
  shots: readonly StoryboardGraphVector[],
  edges: readonly StoryboardGraphEdge[],
  degrees: readonly number[],
  progress: (fraction: number) => void,
) {
  if (shots.length <= 1) return shots.map(() => [0, 0]);
  const nodes: ForceNode[] = shots.map((shot, i) => ({
    id: shot.id,
    radius: storyboardGraphNodeRadius(degrees[i]),
  }));
  // D3 replaces link indices with node references. Keep those mutations private
  // to this simulation so the public graph retains serializable numeric edges.
  const links: ForceEdge[] = edges.map((edge) => ({ ...edge }));
  const strength = (edge: ForceEdge) => {
    const source = edge.source as ForceNode;
    const target = edge.target as ForceNode;
    const degree = Math.max(1, Math.min(degrees[source.index!], degrees[target.index!]));
    return (0.15 + 0.85 * edge.similarity ** 2) / degree;
  };
  const simulation = forceSimulation(nodes).stop().randomSource(seededRandom());
  try {
    simulation
      .velocityDecay(0.4)
      .force(
        "link",
        forceLink<ForceNode, ForceEdge>(links)
          .distance((edge) => 30 + (1 - edge.similarity) * 90)
          .strength(strength),
      )
      .force("charge", forceManyBody<ForceNode>().strength(-120).distanceMin(12))
      .force(
        "collision",
        forceCollide<ForceNode>((node) => node.radius + storyboardGraphCollisionPadding).iterations(
          3,
        ),
      )
      .force("center", forceCenter(0, 0))
      .force("x", forceX<ForceNode>(0).strength(0.015))
      .force("y", forceY<ForceNode>(0).strength(0.015));
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
): StoryboardGraph {
  // Panel sorting and search must not alter the random initialization or node identities.
  const shots = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) {
    throw clientError("UNEXPECTED_ERROR", "Duplicate storyboard graph IDs");
  }
  const dimensions = shots[0]?.vector.length ?? 0;
  const vectors = shots.map((shot) => unitVector(shot.vector, dimensions));
  const neighbors = Math.min(15, Math.max(0, shots.length - 1));
  const { indices, distances } = storyboardGraphNeighbors(vectors, neighbors, (fraction) =>
    progress("neighbors", fraction * 0.85),
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
  );
  const degrees = shots.map(() => 0);
  for (const edge of sparseEdges) {
    degrees[edge.source]++;
    degrees[edge.target]++;
  }
  const positions = forceDirectedPositions(shots, sparseEdges, degrees, (fraction) =>
    progress("layout", fraction),
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
