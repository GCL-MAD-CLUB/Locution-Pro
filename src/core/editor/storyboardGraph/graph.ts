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
import { defaultStoryboardGraphOptions, type StoryboardGraphOptions } from "./options";
import { clusterStoryboardGraph, storyboardGraphClusterForce } from "./clustering";

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
  cluster?: number;
}

export interface StoryboardGraphEdge {
  source: number;
  target: number;
  similarity: number;
}

export interface StoryboardGraph extends Omit<
  StoryboardGraphOptions,
  "nodeRadius" | "maxVisibleDegree"
> {
  nodes: StoryboardGraphNode[];
  edges: StoryboardGraphEdge[];
  neighbors: number;
}

export interface StoryboardGraphWorkerOptions extends Omit<
  StoryboardGraphOptions,
  "nodeRadius" | "maxVisibleDegree"
> {
  nodeRadii: number[];
}

// Functions cannot cross the worker boundary. Evaluate the caller's radius
// rule for every possible view degree, preserving custom closures without eval.
export function serializeStoryboardGraphOptions(
  options: StoryboardGraphOptions,
  nodeCount: number,
): StoryboardGraphWorkerOptions {
  const { nodeRadius, maxVisibleDegree: _, ...settings } = options;
  return {
    ...settings,
    nodeRadii: Array.from({ length: Math.max(1, nodeCount) }, (_, view_degree) =>
      nodeRadius(view_degree),
    ),
  };
}

export function deserializeStoryboardGraphOptions(
  options: StoryboardGraphWorkerOptions,
): StoryboardGraphOptions {
  const { nodeRadii, ...settings } = options;
  return {
    ...settings,
    maxVisibleDegree: defaultStoryboardGraphOptions.maxVisibleDegree,
    nodeRadius: (view_degree) => nodeRadii[view_degree],
  };
}

// Apply the same sparse topology to rendering, hover neighbors and link forces.
// Reserve each node's best minDegree links even below the cutoff. Additional
// links obey the threshold and cap; mandatory links take priority over the cap.
export function sparsifyStoryboardGraphEdges<Edge extends StoryboardGraphEdge>(
  edges: readonly Edge[],
  nodeCount: number,
  options: StoryboardGraphOptions = defaultStoryboardGraphOptions,
) {
  const { minSimilarity, maxDegree, minDegree } = options;
  if (
    !Number.isFinite(minSimilarity) ||
    minSimilarity < 0 ||
    minSimilarity > 1 ||
    !Number.isInteger(maxDegree) ||
    maxDegree < 1 ||
    !Number.isInteger(minDegree) ||
    minDegree < 1
  ) {
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph sparsification options");
  }
  const candidates = [...edges].sort(
    (a, b) => b.similarity - a.similarity || a.source - b.source || a.target - b.target,
  );
  const degrees = new Uint32Array(nodeCount);
  const result: Edge[] = [];
  const strongest: Edge[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of candidates) {
    for (const index of [edge.source, edge.target]) {
      if (strongest[index].length < minDegree) strongest[index].push(edge);
    }
  }
  const retained = new Set<Edge>();
  const retain = (edge: Edge) => {
    if (retained.has(edge)) return;
    retained.add(edge);
    degrees[edge.source]++;
    degrees[edge.target]++;
    result.push(edge);
  };
  for (const links of strongest) {
    for (const edge of links) retain(edge);
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

// Each disconnected component reserves its best minIslandConnections distinct
// outgoing links, including when another bridge merges it during the same round.
// Search all vectors, since kNN candidates may contain no external links. Repeat
// after merging; connectivity takes precedence over the threshold and degree cap.
export function connectStoryboardGraphEdges(
  edges: readonly StoryboardGraphEdge[],
  vectors: readonly (readonly number[])[],
  progress = (_: number) => {},
  distance = (source: number, target: number) =>
    normalizedCosineDistance(vectors[source], vectors[target]),
  options: Pick<StoryboardGraphOptions, "minIslandConnections"> = defaultStoryboardGraphOptions,
) {
  return connectStoryboardGraphComponents(
    edges,
    vectors.length,
    options.minIslandConnections,
    (labels, consider) => {
      for (let source = 0; source < vectors.length; source++) {
        for (let target = source + 1; target < vectors.length; target++) {
          if (labels[source] === labels[target]) continue;
          consider({ source, target, similarity: 1 - distance(source, target) });
        }
      }
    },
    progress,
  );
}

function connectStoryboardGraphComponents<Edge extends StoryboardGraphEdge>(
  edges: readonly Edge[],
  nodeCount: number,
  minIslandConnections: number,
  visitCandidates: (labels: number[], consider: (edge: Edge) => void) => void,
  progress = (_: number) => {},
) {
  if (!Number.isInteger(minIslandConnections) || minIslandConnections < 1)
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph island connection count");
  const result = [...edges];
  const parents = Uint32Array.from({ length: nodeCount }, (_, index) => index);
  let components = nodeCount;
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
    const labels = Array.from({ length: nodeCount }, (_, index) => root(index));
    const strongest: Edge[][] = Array.from({ length: nodeCount }, () => []);
    visitCandidates(labels, (edge) => {
      if (labels[edge.source] === labels[edge.target]) return;
      for (const component of [labels[edge.source], labels[edge.target]]) {
        const best = strongest[component];
        let position = best.length;
        while (position > 0 && compare(edge, best[position - 1]) < 0) position--;
        if (position < minIslandConnections) {
          best.splice(position, 0, edge);
          if (best.length > minIslandConnections) best.pop();
        }
      }
    });
    const bridges = [...new Set(strongest.flat())];
    // A provisional/front-end candidate pool may have no connecting edge.
    if (!bridges.length) break;
    bridges.sort(compare);
    for (const edge of bridges) {
      merge(edge);
      result.push(edge);
    }
    progress((initialComponents - components) / (initialComponents - 1));
  }
  progress(1);
  return result;
}

// Front-end sparsification reuses existing edges only. Mandatory node links
// and island bridges override the display cap without touching force topology.
export function storyboardGraphVisibleEdges<Edge extends StoryboardGraphEdge>(
  edges: readonly Edge[],
  nodeCount: number,
  maxVisibleDegree: number,
  options: Pick<
    StoryboardGraphOptions,
    "minDegree" | "minIslandConnections"
  > = defaultStoryboardGraphOptions,
): Edge[] {
  if (maxVisibleDegree >= nodeCount - 1) return [...edges];
  const sparse = sparsifyStoryboardGraphEdges(edges, nodeCount, {
    ...defaultStoryboardGraphOptions,
    ...options,
    minSimilarity: 0,
    maxDegree: Math.max(1, Math.floor(maxVisibleDegree)),
  });
  return connectStoryboardGraphComponents(
    sparse,
    nodeCount,
    options.minIslandConnections,
    (_labels, consider) => edges.forEach(consider),
  );
}

export function storyboardGraphNodeRadii(
  nodeCount: number,
  visibleEdges: readonly StoryboardGraphEdge[],
  nodeRadius: StoryboardGraphOptions["nodeRadius"] = defaultStoryboardGraphOptions.nodeRadius,
) {
  const viewDegrees = new Uint32Array(nodeCount);
  for (const edge of visibleEdges) {
    viewDegrees[edge.source]++;
    viewDegrees[edge.target]++;
  }
  const radii = Array.from(viewDegrees, (view_degree) => nodeRadius(view_degree));
  if (radii.some((radius) => !Number.isFinite(radius) || radius <= 0))
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph node radius");
  return radii;
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
  cluster?: number;
}

interface ForceEdge<Node extends StoryboardGraphForceNode> extends SimulationLinkDatum<Node> {
  similarity: number;
}

// Worker layouts and interactive dragging use identical forces. D3 mutates only
// private node/link copies, never the graph or its cached semantic similarities.
export function createStoryboardGraphSimulation<Node extends StoryboardGraphForceNode>(
  nodes: Node[],
  edges: readonly StoryboardGraphEdge[],
  options: Pick<StoryboardGraphOptions, "collisionPadding"> &
    Partial<
      Pick<StoryboardGraphOptions, "clusterStrength" | "clusterEnabled">
    > = defaultStoryboardGraphOptions,
) {
  if (!Number.isFinite(options.collisionPadding) || options.collisionPadding <= 0)
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph collision padding");
  const degrees = nodes.map(() => 0);
  for (const edge of edges) {
    degrees[edge.source]++;
    degrees[edge.target]++;
  }
  const links: ForceEdge<Node>[] = edges.map((edge) => ({ ...edge }));
  const clustered = options.clusterEnabled ?? defaultStoryboardGraphOptions.clusterEnabled;
  const sameCluster = (edge: ForceEdge<Node>) => {
    const source = edge.source as Node;
    const target = edge.target as Node;
    return (
      !clustered ||
      source.cluster === undefined ||
      target.cluster === undefined ||
      source.cluster === target.cluster
    );
  };
  return forceSimulation(nodes)
    .stop()
    .randomSource(seededRandom())
    .velocityDecay(0.4)
    .force(
      "link",
      forceLink<Node, ForceEdge<Node>>(links)
        .distance((edge) => (30 + (1 - edge.similarity) * 90) * (sameCluster(edge) ? 1 : 2.2))
        .strength((edge) => {
          const source = edge.source as Node;
          const target = edge.target as Node;
          const degree = Math.max(1, Math.min(degrees[source.index!], degrees[target.index!]));
          return ((0.15 + 0.85 * edge.similarity ** 2) / degree) * (sameCluster(edge) ? 1 : 0.3);
        }),
    )
    .force("charge", forceManyBody<Node>().strength(-120).distanceMin(12))
    .force(
      "cluster",
      storyboardGraphClusterForce<Node>(
        clustered ? (options.clusterStrength ?? defaultStoryboardGraphOptions.clusterStrength) : 0,
      ),
    )
    .force(
      "collision",
      forceCollide<Node>((node) => node.radius + options.collisionPadding).iterations(3),
    )
    .force("center", forceCenter(0, 0))
    .force("x", forceX<Node>(0).strength(0.015))
    .force("y", forceY<Node>(0).strength(0.015));
}

function forceDirectedPositions(
  shots: readonly StoryboardGraphVector[],
  edges: readonly StoryboardGraphEdge[],
  radii: readonly number[],
  clusters: readonly (number | undefined)[],
  progress: (fraction: number) => void,
  options: StoryboardGraphOptions,
  previous: readonly StoryboardGraphNode[] = [],
) {
  if (shots.length <= 1) return shots.map(() => [0, 0]);
  const positions = new Map(previous.map((node) => [node.id, node]));
  const nodes: StoryboardGraphForceNode[] = shots.map((shot, i) => ({
    id: shot.id,
    radius: radii[i],
    cluster: clusters[i],
    x: positions.get(shot.id)?.x,
    y: positions.get(shot.id)?.y,
  }));
  const simulation = createStoryboardGraphSimulation(nodes, edges, options);
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
  const neighbors = Math.min(Math.max(15, options.minDegree), Math.max(0, shots.length - 1));
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
    options,
  );
  const radii = storyboardGraphNodeRadii(
    shots.length,
    storyboardGraphVisibleEdges(sparseEdges, shots.length, options.maxVisibleDegree, options),
    options.nodeRadius,
  );
  if (
    !Number.isFinite(options.clusterResolution) ||
    options.clusterResolution <= 0 ||
    !Number.isFinite(options.clusterStrength) ||
    options.clusterStrength < 0 ||
    !Number.isFinite(options.clusterPadding) ||
    options.clusterPadding < 0
  )
    throw clientError("UNEXPECTED_ERROR", "Invalid storyboard graph clustering options");
  const clusters = options.clusterEnabled
    ? clusterStoryboardGraph(shots.length, sparseEdges, options.clusterResolution)
    : Array<undefined>(shots.length).fill(undefined);
  const positions = forceDirectedPositions(
    shots,
    sparseEdges,
    radii,
    clusters,
    (fraction) => progress("layout", fraction),
    options,
    reuse.positions,
  );
  if (positions.some((position) => position.length !== 2 || !position.every(Number.isFinite))) {
    throw clientError("UNEXPECTED_ERROR", "Non-finite storyboard graph layout");
  }
  progress("layout", 1);
  const { nodeRadius: _, maxVisibleDegree: __, ...settings } = options;
  return {
    nodes: shots.map((shot, i) => ({
      id: shot.id,
      thumbnailFrame: shot.thumbnailFrame,
      radius: radii[i],
      cluster: clusters[i],
      x: positions[i][0],
      y: positions[i][1],
    })),
    edges: sparseEdges,
    neighbors,
    ...settings,
  };
}
