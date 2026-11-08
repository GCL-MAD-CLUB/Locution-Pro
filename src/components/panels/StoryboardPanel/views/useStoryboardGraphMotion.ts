import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forceCenter } from "d3-force";
import {
  createStoryboardGraphSimulation,
  type StoryboardGraph,
  type StoryboardGraphNode,
  type StoryboardGraphForceNode,
} from "../../../../core/editor/storyboardGraph/graph";

const emptyNodes: StoryboardGraph["nodes"] = [];

// Topology changes immediately; positions, radii, hit targets, links and the
// overview move together. Preserve velocity when another filter interrupts.
export function useStoryboardGraphMotion(graph: StoryboardGraph | undefined, active: boolean) {
  const target = graph?.nodes ?? emptyNodes;
  const [painted, setPainted] = useState(target);
  const motion = useRef(
    new Map<string, { x: number; y: number; radius: number; vx: number; vy: number; vr: number }>(),
  );
  const initialized = useRef(false);
  const springFrame = useRef(0);
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
    stopLive();
    const immediate =
      !initialized.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (target.length) initialized.current = true;
    for (const node of target) {
      if (immediate || !motion.current.has(node.id))
        motion.current.set(node.id, { ...node, vx: 0, vy: 0, vr: 0 });
    }
    if (immediate || !target.length) {
      publish(target);
      return;
    }
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      const elapsed = Math.min(1 / 30, Math.max(0, (now - previous) / 1000));
      previous = now;
      const steps = Math.max(1, Math.ceil(elapsed * 120));
      const dt = elapsed / steps;
      let settled = true;
      const next = target.map((node) => {
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
          now - started < 1400 &&
          (Math.hypot(node.x - current.x, node.y - current.y, node.radius - current.radius) >
            0.02 ||
            Math.hypot(current.vx, current.vy, current.vr) > 0.1)
        )
          settled = false;
        return { ...node, x: current.x, y: current.y, radius: current.radius };
      });
      if (settled) {
        for (const node of target) motion.current.set(node.id, { ...node, vx: 0, vy: 0, vr: 0 });
        publish(target);
      } else {
        publish(next);
        springFrame.current = requestAnimationFrame(tick);
      }
    };
    // Paint the retained positions before the first animation frame.
    publish(
      target.map((node) => {
        const current = motion.current.get(node.id)!;
        return { ...node, x: current.x, y: current.y, radius: current.radius };
      }),
    );
    springFrame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(springFrame.current);
      stopLive();
    };
  }, [target, graph?.edges, publish, stopLive]);

  const beginDrag = useCallback(
    (id: string) => {
      cancelAnimationFrame(springFrame.current);
      if (!live.current && graph) {
        const nodes: LiveNode[] = paintedRef.current.map((node) => ({
          ...node,
          vx: (motion.current.get(node.id)?.vx ?? 0) / 60,
          vy: (motion.current.get(node.id)?.vy ?? 0) / 60,
        }));
        const simulation = createStoryboardGraphSimulation(nodes, graph.edges)
          .alphaDecay(0.035)
          // Full-strength centering translates instantly, especially for one
          // node. Ease recentering too, so releasing never jumps the layout.
          .force("center", forceCenter(0, 0).strength(0.035));
        simulation.on("tick", () => {
          const next = nodes.map(({ id, x, y, radius, thumbnailFrame, vx = 0, vy = 0 }) => {
            // Spring velocities use seconds; D3 velocities use simulation ticks.
            motion.current.set(id, { x, y, radius, vx: vx * 60, vy: vy * 60, vr: 0 });
            return { id, x, y, radius, thumbnailFrame };
          });
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
  return { nodes, beginDrag, moveDrag, endDrag };
}
