import assert from "node:assert/strict";
import { test } from "node:test";
import {
  constrainStoryboardGraphCamera,
  fitStoryboardGraphCamera,
  rescaleStoryboardGraphCamera,
  panStoryboardGraph,
  storyboardGraphCanvas,
  storyboardGraphOverviewCanvas,
  storyboardGraphOverviewPoint,
  storyboardGraphOverviewWorldPoint,
  storyboardGraphScreenPoint,
  storyboardGraphViewport,
  storyboardGraphWorldPoint,
  storyboardGraphZoomLimits,
  storyboardGraphNodeScale,
  zoomStoryboardGraphAt,
  indexStoryboardGraphNeighborhoods,
  storyboardGraphNeighborhood,
} from "../../../src/core/editor/storyboardGraph/camera.ts";

const size = { width: 800, height: 500 };
const nodes = [
  { id: "a", x: -1800, y: -800, radius: 5, thumbnailFrame: 0 },
  { id: "b", x: 1800, y: 800, radius: 4, thumbnailFrame: 10 },
];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("loading-to-layout resizing scales the camera with the canvas and preserves navigated framing", () => {
  const from = { x: -800, y: -450, width: 1600, height: 900 };
  const camera = { x: 200, y: -100, zoom: 0.8 };
  for (const scale of [0.6, 1, 1.4, 4]) {
    const to = { x: 100, y: -900, width: from.width * scale, height: from.height * scale };
    const next = rescaleStoryboardGraphCamera(camera, from, to);
    const before = storyboardGraphViewport(camera, size);
    const after = storyboardGraphViewport(next, size);
    close(after.width / to.width, before.width / from.width);
    close(after.height / to.height, before.height / from.height);
    close((next.x - to.x) / to.width, (camera.x - from.x) / from.width);
    close((next.y - to.y) / to.height, (camera.y - from.y) / from.height);
  }
  close(rescaleStoryboardGraphCamera(camera, from, { ...from, width: 10, height: 5.625 }).zoom, 2);
});
test("overview contains the retained viewport when a dragged layout shrinks or shifts", () => {
  const canvas = storyboardGraphCanvas([{ ...nodes[0], x: 0, y: 0 }]);
  const snapshot = { ...canvas };
  const camera = { x: -450, y: 210, zoom: 0.5 };
  const viewport = storyboardGraphViewport(camera, size);
  const overview = storyboardGraphOverviewCanvas(size, canvas, camera);
  close(overview.width / overview.height, 16 / 9);
  for (const rect of [canvas, viewport]) {
    assert.ok(rect.x >= overview.x - 1e-8);
    assert.ok(rect.y >= overview.y - 1e-8);
    assert.ok(rect.x + rect.width <= overview.x + overview.width + 1e-8);
    assert.ok(rect.y + rect.height <= overview.y + overview.height + 1e-8);
  }
  assert.deepEqual(
    canvas,
    snapshot,
    "the actual graph canvas remains its tight bounds plus padding",
  );
});

test("cached neighborhoods preserve undirected adjacency and isolated nodes", () => {
  const graph = {
    nodes: [...nodes, { id: "isolated", x: 0, y: 0, radius: 4, thumbnailFrame: 0 }],
    edges: [{ source: 0, target: 1, similarity: 0.95 }],
  };
  const indexed = indexStoryboardGraphNeighborhoods(graph);
  for (const node of graph.nodes)
    assert.deepEqual(indexed.get(node.id), storyboardGraphNeighborhood(graph, node.id));
  assert.deepEqual([...indexed.get("isolated")], ["isolated"]);
  assert.equal(indexed.get("missing"), undefined);
  assert.notEqual(indexed.get("a"), indexed.get("b"));
});
const closePoint = (a, b) => {
  close(a.x, b.x);
  close(a.y, b.y);
};
function contained(camera, display, canvas) {
  const viewport = storyboardGraphViewport(camera, display);
  const overview = storyboardGraphOverviewCanvas(display, canvas);
  const epsilon = 1e-8;
  assert.ok(viewport.x >= overview.x - epsilon);
  assert.ok(viewport.y >= overview.y - epsilon);
  assert.ok(viewport.x + viewport.width <= overview.x + overview.width + epsilon);
  assert.ok(viewport.y + viewport.height <= overview.y + overview.height + epsilon);
  for (const [position, extent] of [
    ["x", "width"],
    ["y", "height"],
  ]) {
    if (viewport[extent] > canvas[extent])
      close(camera[position], canvas[position] + canvas[extent] / 2);
    else {
      assert.ok(viewport[position] >= canvas[position] - epsilon);
      assert.ok(
        viewport[position] + viewport[extent] <= canvas[position] + canvas[extent] + epsilon,
      );
    }
  }
}

test("16:9 canvas includes full node discs and navigation margins for degenerate layouts", () => {
  for (const points of [
    [],
    nodes,
    [nodes[0]],
    nodes.map((n) => ({ ...n, x: 0 })),
    nodes.map((n) => ({ ...n, y: 0 })),
  ]) {
    const canvas = storyboardGraphCanvas(points);
    close(canvas.width / canvas.height, 16 / 9);
    if (points.length) {
      const width =
        Math.max(...points.map((n) => n.x + n.radius)) -
        Math.min(...points.map((n) => n.x - n.radius));
      const height =
        Math.max(...points.map((n) => n.y + n.radius)) -
        Math.min(...points.map((n) => n.y - n.radius));
      close(canvas.height, Math.max(height, (width * 9) / 16) * 1.2);
    }
    assert.ok(canvas.width > 0 && canvas.height > 0);
    for (const node of points) {
      assert.ok(node.x - node.radius > canvas.x);
      assert.ok(node.y - node.radius > canvas.y);
      assert.ok(node.x + node.radius < canvas.x + canvas.width);
      assert.ok(node.y + node.radius < canvas.y + canvas.height);
    }
  }
});

test("initial camera fits node discs and centers a single node without changing world coordinates", () => {
  const before = structuredClone(nodes);
  const camera = fitStoryboardGraphCamera(nodes, size);
  for (const node of nodes) {
    const point = storyboardGraphScreenPoint(node, camera, size);
    assert.ok(point.x - node.radius * camera.zoom >= 0);
    assert.ok(point.x + node.radius * camera.zoom <= size.width);
    assert.ok(point.y - node.radius * camera.zoom >= 0);
    assert.ok(point.y + node.radius * camera.zoom <= size.height);
  }
  const single = fitStoryboardGraphCamera([nodes[0]], size);
  closePoint(storyboardGraphScreenPoint(nodes[0], single, size), { x: 400, y: 250 });
  assert.deepEqual(nodes, before);
});

test("wheel zoom preserves the world position beneath an off-center cursor", () => {
  const canvas = storyboardGraphCanvas(nodes);
  let camera = fitStoryboardGraphCamera(nodes, size, canvas);
  const cursor = { x: 293.25, y: 175.75 };
  const anchor = storyboardGraphWorldPoint(cursor, camera, size);
  for (const factor of [1.5, 1.2, 0.9]) {
    camera = zoomStoryboardGraphAt(camera, cursor, factor, size, canvas);
    closePoint(storyboardGraphWorldPoint(cursor, camera, size), anchor);
    closePoint(storyboardGraphScreenPoint(anchor, camera, size), cursor);
    contained(camera, size, canvas);
  }
});

test("camera bounds keep navigation on the graph and the viewport inside the overview after pan, zoom and resize", () => {
  const canvas = storyboardGraphCanvas(nodes);
  for (const display of [
    size,
    { width: 1500, height: 150 },
    { width: 150, height: 1200 },
    { width: 1, height: 1 },
  ]) {
    const limits = storyboardGraphZoomLimits(display, canvas);
    let camera = fitStoryboardGraphCamera(nodes, display, canvas);
    assert.ok(Number.isFinite(camera.zoom));
    for (const factor of [1e20, 1e-20]) {
      camera = zoomStoryboardGraphAt(camera, { x: 0, y: 0 }, factor, display, canvas);
      close(camera.zoom, factor > 1 ? limits.max : limits.min);
      for (const delta of [-1e9, 1e9]) {
        camera = panStoryboardGraph(camera, delta, -delta, display, canvas);
        contained(camera, display, canvas);
      }
    }
    contained(constrainStoryboardGraphCamera(camera, size, canvas), size, canvas);
  }
});

test("maximum displayed node size is independent of graph bounds and panel dimensions", () => {
  const diameters = [];
  const relativeLimits = [];
  for (const spread of [0.01, 1, 100]) {
    const points = nodes.map((node) => ({ ...node, x: node.x * spread, y: node.y * spread }));
    const canvas = storyboardGraphCanvas(points);
    const before = structuredClone(canvas);
    for (const display of [size, { width: 1600, height: 900 }, { width: 420, height: 650 }]) {
      const limits = storyboardGraphZoomLimits(display, canvas);
      assert.ok(limits.min <= limits.max);
      const initial = fitStoryboardGraphCamera(points, display, canvas);
      const camera = zoomStoryboardGraphAt(
        initial,
        { x: display.width / 2, y: display.height / 2 },
        1e12,
        display,
        canvas,
      );
      close(camera.zoom, limits.max);
      close(limits.max, 2);
      diameters.push(points[0].radius * 2 * storyboardGraphNodeScale(camera.zoom));
      relativeLimits.push(limits.max / limits.min);
      contained(camera, display, canvas);
      const overview = storyboardGraphOverviewCanvas(display, canvas);
      close(overview.width / overview.height, 16 / 9);
      const viewport = storyboardGraphViewport(camera, display);
      close(
        ((viewport.width / overview.width) * 160) / ((viewport.height / overview.height) * 90),
        display.width / display.height,
      );
    }
    assert.deepEqual(canvas, before, "pixel limits do not expand the graph canvas");
  }
  diameters.forEach((diameter) => close(diameter, diameters[0]));
  assert.ok(
    new Set(relativeLimits).size > 1,
    "the allowed factor from fitted size varies with the actual graph",
  );
});

test("node scale follows zoom only up to 0.8 while positions continue to magnify to 2", () => {
  for (const zoom of [0.2, 0.4, 0.6, 0.8]) close(storyboardGraphNodeScale(zoom), zoom);
  for (const zoom of [0.8, 1, 1.5, 2]) close(storyboardGraphNodeScale(zoom), 0.8);
  const canvas = storyboardGraphCanvas(nodes);
  const camera = constrainStoryboardGraphCamera({ x: 0, y: 0, zoom: 20 }, size, canvas);
  close(camera.zoom, 2);
  const a = storyboardGraphScreenPoint({ x: 0, y: 0 }, camera, size);
  const b = storyboardGraphScreenPoint({ x: 1, y: 0 }, camera, size);
  close(b.x - a.x, 2);
});

test("panning follows screen distance at the current zoom", () => {
  const canvas = storyboardGraphCanvas(nodes);
  const initial = fitStoryboardGraphCamera(nodes, size, canvas);
  const camera = zoomStoryboardGraphAt(initial, { x: 400, y: 250 }, 2, size, canvas);
  const moved = panStoryboardGraph(camera, 35, -18, size, canvas);
  const before = storyboardGraphScreenPoint(nodes[0], camera, size);
  const after = storyboardGraphScreenPoint(nodes[0], moved, size);
  close(after.x - before.x, 35);
  close(after.y - before.y, -18);
});

test("overview coordinates round trip and viewport frame preserves the display aspect ratio", () => {
  const canvas = storyboardGraphCanvas(nodes);
  const initial = fitStoryboardGraphCamera(nodes, size, canvas);
  const camera = zoomStoryboardGraphAt(initial, { x: 400, y: 250 }, 2, size, canvas);
  for (const point of [
    ...nodes,
    { x: canvas.x, y: canvas.y },
    { x: canvas.x + canvas.width, y: canvas.y + canvas.height },
  ]) {
    closePoint(
      storyboardGraphOverviewWorldPoint(storyboardGraphOverviewPoint(point, canvas), canvas),
      point,
    );
  }
  const viewport = storyboardGraphViewport(camera, size);
  const frameWidth = (viewport.width / canvas.width) * 160;
  const frameHeight = (viewport.height / canvas.height) * 90;
  close(frameWidth / frameHeight, size.width / size.height);
  // Clicking the overview converts directly to the new world-space camera center.
  const clicked = storyboardGraphOverviewWorldPoint({ x: 90, y: 50 }, canvas);
  const moved = constrainStoryboardGraphCamera({ ...camera, ...clicked }, size, canvas);
  closePoint(moved, clicked);
  contained(moved, size, canvas);
});
