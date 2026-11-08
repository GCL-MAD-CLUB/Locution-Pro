import assert from "node:assert/strict";
import { test } from "node:test";
import * as d3 from "d3-force";
import * as options from "../../../src/core/editor/storyboardGraph/options.ts";
import { createModuleLoader } from "../support/module-loader.ts";

const { createStoryboardGraphAmbient: create, remapStoryboardGraphEdges: remap } =
  createModuleLoader(import.meta.url)("../../../src/core/editor/storyboardGraph/ambient.ts", {
    "d3-force": d3,
    "./options": options,
  });
const input = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i),
    x: 0,
    y: 0,
    radius: 6,
    thumbnailFrame: i,
  }));
function random() {
  let seed = 42;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const advance = (world, count) => {
  for (let i = 0; i < count; i++) world.step(1 / 60);
};

test("random force preview keeps evolving with finite bounded nodes and attracts them toward the center", () => {
  const shots = input(24);
  const snapshot = structuredClone(shots);
  const world = create(shots, random());
  const initial = world.nodes.map((node) => [node.x, node.y]);
  advance(world, 180);
  assert.ok(
    world.nodes.some((node, i) => Math.hypot(node.x - initial[i][0], node.y - initial[i][1]) > 2),
  );
  assert.ok(
    world.nodes.every((node) =>
      [node.x, node.y, node.radius, node.vx, node.vy].every(Number.isFinite),
    ),
  );
  assert.ok(
    world.nodes.every(
      (node) => Math.abs(node.x) <= world.width / 2 && Math.abs(node.y) <= world.height / 2,
    ),
  );
  assert.deepEqual(shots, snapshot);
  const single = create(input(1), random());
  Object.assign(single.nodes[0], { x: 240, y: 0, vx: 0, vy: 0 });
  advance(single, 90);
  assert.ok(
    Math.hypot(single.nodes[0].x, single.nodes[0].y) < 190,
    "centripetal force prevents particles lingering across the whole canvas",
  );
});

test("nearby force nodes fade their links in and ease radii using the shared degree rule", () => {
  const world = create(input(9), random());
  world.nodes.forEach((node, i) =>
    Object.assign(node, { fx: ((i % 3) - 1) * 40, fy: (Math.floor(i / 3) - 1) * 40 }),
  );
  world.step(1 / 60);
  const expected = options.storyboardGraphNodeRadius(8);
  assert.ok(world.nodes.every((node) => node.radius < expected));
  assert.ok(world.edges.some((edge) => edge.opacity > 0 && edge.opacity < 1));
  advance(world, 120);
  assert.equal(world.edges.length, 36);
  assert.ok(world.nodes.every((node) => Math.abs(node.radius - expected) < 0.001));
  assert.ok(
    world.edges.every(
      (edge) =>
        edge.opacity > 0.99 && typeof edge.source === "number" && typeof edge.target === "number",
    ),
  );
});

test("distant nodes lose provisional links with a fade and reappear when close again", () => {
  const world = create(input(2), random());
  Object.assign(world.nodes[0], { fx: -330, fy: 0 });
  Object.assign(world.nodes[1], { fx: 330, fy: 0 });
  advance(world, 120);
  assert.equal(world.edges.length, 0);
  world.nodes[0].fx = -20;
  world.nodes[1].fx = 20;
  world.step(1 / 60);
  assert.equal(world.edges.length, 1);
  assert.ok(world.edges[0].opacity > 0 && world.edges[0].opacity < 1);
  advance(world, 60);
  const visible = world.edges[0].opacity;
  world.nodes[0].fx = -330;
  world.nodes[1].fx = 330;
  world.step(1 / 60);
  assert.ok(world.edges[0].opacity > 0 && world.edges[0].opacity < visible);
});

test("collapse remaps provisional link identities when final semantic ordering changes", () => {
  const nodes = input(3);
  const edges = [
    { source: 0, target: 2, similarity: 1, opacity: 0.6 },
    { source: 0, target: 1, similarity: 1, opacity: 0.4 },
  ];
  const mapped = remap(edges, nodes, [nodes[2], nodes[0]]);
  assert.deepEqual(structuredClone(mapped), [
    { source: 1, target: 0, similarity: 1, opacity: 0.6 },
  ]);
  assert.equal(create([], random()).nodes.length, 0);
});
