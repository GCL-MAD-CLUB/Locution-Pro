import type { StoryboardGraphEdge, StoryboardGraphNode } from "./graph";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationLinkDatum,
} from "d3-force";
import {
  defaultStoryboardGraphOptions,
  storyboardGraphNodeRadius,
  storyboardGraphCollisionPadding,
} from "./options";

export interface StoryboardGraphVisualEdge extends StoryboardGraphEdge {
  opacity?: number;
}

interface Particle extends StoryboardGraphNode {
  vx: number;
  vy: number;
}

export interface StoryboardGraphAmbient {
  width: number;
  height: number;
  nodes: Particle[];
  edges: StoryboardGraphVisualEdge[];
  step: (seconds: number) => void;
}

// This provisional network uses geometry only; semantic indexing stays off the
// animation thread. A spatial hash keeps neighborhood work local for large sets.
export function createStoryboardGraphAmbient(
  input: readonly StoryboardGraphNode[],
  random = Math.random,
  previous?: StoryboardGraphAmbient,
): StoryboardGraphAmbient {
  const width = previous?.width ?? Math.max(720, Math.sqrt(input.length) * 100);
  const height = (width * 9) / 16;
  const reach = Math.max(100, (width / Math.sqrt(Math.max(1, input.length))) * 1.2);
  const retained = new Map(previous?.nodes.map((node) => [node.id, node]));
  const phases = input.map(() => random() * Math.PI * 2);
  const nodes: Particle[] = input.map((node) => {
    const old = retained.get(node.id);
    const angle = random() * Math.PI * 2;
    const radius = Math.pow(random(), 0.8) * width * 0.4;
    return {
      ...node,
      x: old?.x ?? Math.cos(angle) * radius,
      y: old?.y ?? (Math.sin(angle) * radius * 9) / 16,
      radius: old?.radius ?? storyboardGraphNodeRadius(0),
      vx: old?.vx ?? (random() - 0.5) * 0.8,
      vy: old?.vy ?? (random() - 0.5) * 0.8,
    };
  });
  const links = new Map<string, StoryboardGraphVisualEdge>();
  const linkForce = forceLink<Particle, SimulationLinkDatum<Particle>>()
    .distance(reach * 0.55)
    .strength(0.025);
  const collision = forceCollide<Particle>(
    (node) => node.radius + storyboardGraphCollisionPadding,
  ).iterations(3);
  let time = 0;
  let ticks = 0;
  let topology = "";
  const simulation = forceSimulation(nodes)
    .stop()
    .randomSource(random)
    .alpha(0.3)
    .alphaDecay(0)
    .velocityDecay(0.22)
    .force("link", linkForce)
    .force(
      "charge",
      forceManyBody<Particle>()
        .strength(-90)
        .distanceMin(12)
        .distanceMax(reach * 2),
    )
    .force("gravity", forceRadial<Particle>(0, 0, 0).strength(0.018))
    .force("collision", collision)
    .force("wander", (alpha: number) => {
      nodes.forEach((node, i) => {
        node.vx += (Math.sin(time * 1.3 + phases[i]) * 0.8 + (random() - 0.5) * 0.3) * alpha;
        node.vy += (Math.cos(time * 1.1 + phases[i]) * 0.8 + (random() - 0.5) * 0.3) * alpha;
      });
    });
  const world = { width, height, nodes, edges: [] as StoryboardGraphVisualEdge[], step };
  function step(seconds: number) {
    const dt = Math.min(0.05, Math.max(0, seconds));
    time += dt;
    ticks += dt * 60;
    const count = Math.floor(ticks);
    if (count) {
      simulation.tick(count);
      ticks -= count;
    }
    for (const node of nodes) {
      for (const [axis, velocity, extent] of [
        ["x", "vx", width],
        ["y", "vy", height],
      ] as const) {
        const limit = extent / 2 - node.radius - 12;
        if (Math.abs(node[axis]) > limit) {
          node[axis] = Math.sign(node[axis]) * limit;
          node[velocity] = -node[velocity];
        }
      }
    }
    const cells = new Map<string, number[]>();
    const degrees = nodes.map(() => 0);
    const active = new Set<string>();
    nodes.forEach((node, index) => {
      const cellX = Math.floor(node.x / reach);
      const cellY = Math.floor(node.y / reach);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of cells.get(`${cellX + dx}:${cellY + dy}`) ?? []) {
            const neighbor = nodes[other];
            const distance = Math.hypot(node.x - neighbor.x, node.y - neighbor.y);
            if (
              distance > reach ||
              degrees[index] >= defaultStoryboardGraphOptions.maxDegree ||
              degrees[other] >= defaultStoryboardGraphOptions.maxDegree
            )
              continue;
            const key = `${other}:${index}`;
            active.add(key);
            degrees[index]++;
            degrees[other]++;
            if (!links.has(key))
              links.set(key, { source: other, target: index, similarity: 1, opacity: 0 });
          }
        }
      const key = `${cellX}:${cellY}`;
      const bucket = cells.get(key) ?? [];
      bucket.push(index);
      cells.set(key, bucket);
    });
    const blend = 1 - Math.exp(-dt / 0.18);
    for (const [key, edge] of links) {
      edge.opacity =
        (edge.opacity ?? 0) + ((active.has(key) ? 1 : 0) - (edge.opacity ?? 0)) * blend;
      if (!active.has(key) && edge.opacity < 0.005) links.delete(key);
    }
    nodes.forEach((node, i) => {
      node.radius += (storyboardGraphNodeRadius(degrees[i]) - node.radius) * blend;
    });
    collision.radius((node) => node.radius + storyboardGraphCollisionPadding);
    const nextTopology = [...active].join(";");
    if (nextTopology !== topology) {
      topology = nextTopology;
      linkForce.links(
        [...active].map((key) => {
          const [source, target] = key.split(":").map(Number);
          return { source, target };
        }),
      );
    }
    world.edges = [...links.values()].map((edge) => ({ ...edge }));
  }
  step(1 / 60);
  return world;
}

export function remapStoryboardGraphEdges(
  edges: readonly StoryboardGraphVisualEdge[],
  from: readonly StoryboardGraphNode[],
  to: readonly StoryboardGraphNode[],
) {
  const indices = new Map(to.map((node, index) => [node.id, index]));
  return edges.flatMap((edge) => {
    const source = indices.get(from[edge.source].id);
    const target = indices.get(from[edge.target].id);
    return source === undefined || target === undefined ? [] : [{ ...edge, source, target }];
  });
}
