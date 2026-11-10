import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forceCenter } from "d3-force";
import {
  createStoryboardGraphAmbient,
  remapStoryboardGraphEdges,
  type StoryboardGraphAmbient,
  type StoryboardGraphVisualEdge,
} from "../../../../core/editor/storyboardGraph/ambient";
import {
  createStoryboardGraphSimulation,
  type StoryboardGraph,
  type StoryboardGraphNode,
  type StoryboardGraphForceNode,
} from "../../../../core/editor/storyboardGraph/graph";

const emptyNodes: StoryboardGraph["nodes"] = [];

// Topology changes immediately; positions, radii, hit targets, links and the
// overview move together. Preserve velocity when another filter interrupts.
export function useStoryboardGraphMotion(
  graph: StoryboardGraph | undefined,
  active: boolean,
  pendingNodes: StoryboardGraph["nodes"] = emptyNodes,
  layoutGraph: StoryboardGraph | undefined = graph,
) {
  const pending = !graph && pendingNodes.length > 0;
  const target = graph?.nodes ?? pendingNodes;
  const ambient = useRef<StoryboardGraphAmbient | null>(null);
  const [painted, setPainted] = useState(() => {
    if (!pending) return target;
    ambient.current = createStoryboardGraphAmbient(target);
    return ambient.current.nodes.map((node) => ({ ...node }));
  });
  const [visual, setVisual] = useState<{
    owner: StoryboardGraph["nodes"];
    edges: StoryboardGraphVisualEdge[];
  } | null>(null);
  const [collapsing, setCollapsing] = useState(false);
  const [layoutProgress, setLayoutProgress] = useState(pending ? 0 : 1);
  const motion = useRef(
    new Map<string, { x: number; y: number; radius: number; vx: number; vy: number; vr: number }>(),
  );
  const initialized = useRef(false);
  const previousLayout = useRef(layoutGraph);
  const springFrame = useRef(0);
  const ambientTick = useRef<FrameRequestCallback | null>(null);
  type LiveNode = StoryboardGraphNode & StoryboardGraphForceNode;
  const live = useRef<ReturnType<typeof createStoryboardGraphSimulation<LiveNode>> | null>(null);
  const dragged = useRef<LiveNode | null>(null);
  const paintedRef = useRef(painted);
  const publish = useCallback((next: StoryboardGraph["nodes"]) => {
    paintedRef.current = next;
    setPainted(next);
  }, []);
  const stopLive = useCallback(() => {
    live.current?.stop();
    live.current = null;
    dragged.current = null;
  }, []);
  useLayoutEffect(() => {
    const radiusOnly = previousLayout.current === layoutGraph;
    previousLayout.current = layoutGraph;
    stopLive();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (pending) {
      const existing = ambient.current;
      const sameNodes =
        existing &&
        existing.nodes.length === target.length &&
        target.every((node, i) => node.id === existing.nodes[i].id);
      const world = sameNodes
        ? existing
        : createStoryboardGraphAmbient(target, Math.random, existing ?? undefined);
      world.nodes.forEach((node, i) => {
        node.thumbnailFrame = target[i].thumbnailFrame;
      });
      ambient.current = world;
      initialized.current = true;
      setCollapsing(false);
      setLayoutProgress(0);
      let previous = performance.now();
      const draw = () => {
        for (const node of world.nodes)
          motion.current.set(node.id, { ...node, vx: node.vx * 60, vy: node.vy * 60, vr: 0 });
        publish(world.nodes.map((node) => ({ ...node })));
        setVisual({ owner: target, edges: world.edges });
      };
      draw();
      const tick = (now: number) => {
        world.step((now - previous) / 1000);
        previous = now;
        draw();
        springFrame.current = requestAnimationFrame(tick);
      };
      ambientTick.current = tick;
      if (active && !reduced) springFrame.current = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(springFrame.current);
        ambientTick.current = null;
      };
    }
    // A display-degree change updates size without pulling a dragged layout
    // back to the worker's old coordinates or reheating its force simulation.
    const destination =
      initialized.current && radiusOnly
        ? target.map((node) => {
            const current = motion.current.get(node.id);
            if (!current) return node;
            current.vx = 0;
            current.vy = 0;
            return { ...node, x: current.x, y: current.y };
          })
        : target;
    const provisional = ambient.current;
    ambient.current = null;
    const collapse = Boolean(provisional && target.length && !reduced);
    setCollapsing(collapse);
    setLayoutProgress(collapse ? 0 : 1);
    const sourceEdges = provisional
      ? remapStoryboardGraphEdges(provisional.edges, provisional.nodes, target)
      : [];
    const transitionEdges = new Map<string, StoryboardGraphVisualEdge>();
    const edgeKey = (edge: StoryboardGraphVisualEdge) =>
      `${Math.min(edge.source, edge.target)}:${Math.max(edge.source, edge.target)}`;
    for (const edge of sourceEdges) transitionEdges.set(edgeKey(edge), edge);
    const finalEdges = new Map((graph?.edges ?? []).map((edge) => [edgeKey(edge), edge]));
    for (const [key, edge] of finalEdges)
      if (!transitionEdges.has(key)) transitionEdges.set(key, { ...edge, opacity: 0 });
    if (!collapse) setVisual(null);
    const immediate = !initialized.current || reduced;
    if (target.length) initialized.current = true;
    for (const node of destination) {
      if (immediate || !motion.current.has(node.id))
        motion.current.set(node.id, { ...node, vx: 0, vy: 0, vr: 0 });
    }
    if (immediate || !target.length) {
      publish(destination);
      return;
    }
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      const elapsed = Math.min(1 / 30, Math.max(0, (now - previous) / 1000));
      previous = now;
      const steps = Math.max(1, Math.ceil(elapsed * 120));
      const dt = elapsed / steps;
      let settled = !collapse || now - started >= 600;
      if (collapse) {
        const blend = 1 - (1 - Math.min(1, (now - started) / 600)) ** 3;
        setLayoutProgress(blend);
        setVisual(
          blend === 1
            ? null
            : {
                owner: target,
                edges: [...transitionEdges].map(([key, edge]) => ({
                  ...edge,
                  similarity: finalEdges.get(key)?.similarity ?? edge.similarity,
                  opacity: (edge.opacity ?? 1) * (1 - blend) + (finalEdges.has(key) ? blend : 0),
                })),
              },
        );
      }
      const next = destination.map((node) => {
        const current = motion.current.get(node.id)!;
        for (let step = 0; step < steps; step++) {
          current.vx += ((node.x - current.x) * 180 - current.vx * 20) * dt;
          current.vy += ((node.y - current.y) * 180 - current.vy * 20) * dt;
          current.vr += ((node.radius - current.radius) * 180 - current.vr * 20) * dt;
          current.x += current.vx * dt;
          current.y += current.vy * dt;
          current.radius += current.vr * dt;
        }
        if (
          now - started < (collapse ? 1800 : 1400) &&
          (Math.hypot(node.x - current.x, node.y - current.y, node.radius - current.radius) >
            0.02 ||
            Math.hypot(current.vx, current.vy, current.vr) > 0.1)
        )
          settled = false;
        return { ...node, x: current.x, y: current.y, radius: current.radius };
      });
      if (settled) {
        setLayoutProgress(1);
        setCollapsing(false);
        setVisual(null);
        for (const node of destination)
          motion.current.set(node.id, { ...node, vx: 0, vy: 0, vr: 0 });
        publish(destination);
      } else {
        publish(next);
        springFrame.current = requestAnimationFrame(tick);
      }
    };
    // Paint the retained positions before the first animation frame.
    publish(
      destination.map((node) => {
        const current = motion.current.get(node.id)!;
        return { ...node, x: current.x, y: current.y, radius: current.radius };
      }),
    );
    springFrame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(springFrame.current);
      stopLive();
    };
  }, [target, graph?.edges, pending, publish, stopLive, layoutGraph]);

  useEffect(() => {
    if (!pending) return;
    cancelAnimationFrame(springFrame.current);
    if (
      active &&
      ambientTick.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      springFrame.current = requestAnimationFrame(ambientTick.current);
    return () => {
      if (ambientTick.current) cancelAnimationFrame(springFrame.current);
    };
  }, [pending, active]);

  const beginDrag = useCallback(
    (id: string) => {
      cancelAnimationFrame(springFrame.current);
      setVisual(null);
      setCollapsing(false);
      setLayoutProgress(1);
      if (!live.current && graph) {
        const nodes: LiveNode[] = paintedRef.current.map((node) => ({
          ...node,
          vx: (motion.current.get(node.id)?.vx ?? 0) / 60,
          vy: (motion.current.get(node.id)?.vy ?? 0) / 60,
        }));
        const simulation = createStoryboardGraphSimulation(nodes, graph.edges, graph)
          .alphaDecay(0.035)
          // Full-strength centering translates instantly, especially for one
          // node. Ease recentering too, so releasing never jumps the layout.
          .force("center", forceCenter(0, 0).strength(0.035));
        simulation.on("tick", () => {
          const next = nodes.map(
            ({ id, x, y, radius, cluster, thumbnailFrame, vx = 0, vy = 0 }) => {
              // Spring velocities use seconds; D3 velocities use simulation ticks.
              motion.current.set(id, { x, y, radius, vx: vx * 60, vy: vy * 60, vr: 0 });
              return { id, x, y, radius, cluster, thumbnailFrame };
            },
          );
          publish(next);
        });
        live.current = simulation;
      }
      const simulation = live.current;
      const node = simulation?.nodes().find((node) => node.id === id);
      if (!simulation || !node) return;
      dragged.current = node;
      node.fx = node.x;
      node.fy = node.y;
      simulation.alpha(Math.max(0.3, simulation.alpha())).alphaTarget(0.25).restart();
    },
    [graph, publish],
  );

  const moveDrag = useCallback((point: { x: number; y: number }) => {
    const node = dragged.current;
    if (!node) return;
    node.fx = point.x;
    node.fy = point.y;
  }, []);

  const endDrag = useCallback(() => {
    const node = dragged.current;
    const simulation = live.current;
    if (!node || !simulation) return;
    node.fx = null;
    node.fy = null;
    dragged.current = null;
    simulation.alphaTarget(0).alpha(Math.max(0.3, simulation.alpha())).restart();
  }, []);

  useEffect(() => {
    if (!active) {
      endDrag();
      live.current?.stop();
    }
    return () => {
      live.current?.stop();
    };
  }, [active, endDrag]);

  const nodes = useMemo(() => {
    if (painted === target) return target;
    const byId = new Map(painted.map((node) => [node.id, node]));
    return target.map((node) => {
      const previous = byId.get(node.id);
      return previous ? { ...node, x: previous.x, y: previous.y, radius: previous.radius } : node;
    });
  }, [target, painted]);
  const edges = useMemo<StoryboardGraphVisualEdge[]>(
    () =>
      visual
        ? visual.owner === target
          ? visual.edges
          : remapStoryboardGraphEdges(visual.edges, visual.owner, target)
        : (graph?.edges ?? []),
    [visual, target, graph?.edges],
  );
  return {
    nodes,
    edges,
    phase: pending ? "ambient" : collapsing || ambient.current ? "collapse" : "ready",
    layoutProgress,
    beginDrag,
    moveDrag,
    endDrag,
  };
}
