import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { StoryboardGraphCanvas } from "../../../../src/components/panels/StoryboardPanel/views/StoryboardGraphCanvas.tsx";
import { StoryboardGraphView } from "../../../../src/components/panels/StoryboardPanel/views/StoryboardGraphView.tsx";
import { useStoryboardSemanticSearch } from "../../../../src/application/media/storyboardSemanticSearch.ts";
import { TaskProgress } from "../../../../src/systems/TaskSystem";
import "../../../../src/styles.css";
import "../../../../src/components/panels/StoryboardPanel/StoryboardPanel.css";

const shots = Array.from({ length: 9 }, (_, index) => ({
  id: String(index),
  sequence: index + 1,
  start_frame: index * 24,
  end_frame: (index + 1) * 24,
  start_us: index * 1_000_000,
  end_us: (index + 1) * 1_000_000,
}));
const graph = {
  nodes: shots.map((shot, index) => ({
    id: shot.id,
    x: ((index % 3) - 1) * 120,
    y: (Math.floor(index / 3) - 1) * 80,
    radius: 4,
    thumbnailFrame: index * 24,
  })),
  edges: [
    ...shots.slice(1).map((_, index) => ({ source: index, target: index + 1, similarity: 0.95 })),
    { source: 3, target: 5, similarity: 0.9 },
  ],
  neighbors: 8,
  minSimilarity: 0.9,
  maxDegree: 8,
  minDegree: 2,
  minIslandConnections: 2,
  collisionPadding: 2,
};
const source = {
  context: "test",
  name: "test",
  assetId: "test",
  fingerprint: "test",
  videoPath: "",
  previewVideoPath: "",
  frameRate: 24,
};

export function mountGraph(empty = false, spread = 1, nodeRadius = 4, dense = false) {
  const radiusForView = dense ? (view_degree) => nodeRadius + view_degree * 0.1 : () => nodeRadius;
  const renderedGraph = {
    ...graph,
    edges: dense
      ? shots.flatMap((_, source) =>
          shots.slice(source + 1).map((_, offset) => ({
            source,
            target: source + offset + 1,
            similarity: 1 / (offset + 1),
          })),
        )
      : graph.edges,
    nodes: graph.nodes.map((node) => ({
      ...node,
      x: node.x * spread,
      y: node.y * spread,
      radius: nodeRadius,
    })),
  };
  const host = document.createElement("div");
  host.id = "graph-host";
  host.style.cssText = "position:absolute;left:24px;top:24px;width:800px;height:500px";
  document.body.append(host);
  const reference = document.createElement("div");
  reference.className = "storyboard-icon-view";
  reference.id = "frame-reference";
  reference.style.cssText = "position:fixed;left:-10000px;width:100px;height:100px";
  document.body.append(reference);
  function Harness() {
    const [maxVisibleDegree, setMaxVisibleDegree] = useState(8);
    const [selectedShotIds, setSelectedShotIds] = useState(new Set());
    const [activatedShotId, setActivatedShotId] = useState(null);
    const [activations, setActivations] = useState([]);
    const [shotAnnotations, setShotAnnotations] = useState({});
    const [sprayActive, setSprayActive] = useState(false);
    const [sprays, setSprays] = useState([]);
    window.graphSetAnnotations = setShotAnnotations;
    window.graphSetMaxVisibleDegree = setMaxVisibleDegree;
    window.graphComputedGraph = renderedGraph;
    window.graphSetSelection = setSelectedShotIds;
    window.graphSetSprayActive = setSprayActive;
    window.graphSprays = sprays;
    window.graphSelection = [...selectedShotIds].sort();
    window.graphActivatedShot = activatedShotId;
    window.graphActivations = activations;
    return React.createElement(StoryboardGraphCanvas, {
      graph: empty ? undefined : renderedGraph,
      maxVisibleDegree,
      nodeRadius: radiusForView,
      shots,
      sourceForShot: () => source,
      shotTitle: (shot) => `Shot ${shot.id}`,
      selectedShotIds,
      shotAnnotations,
      sprayActive,
      onExitSpray: () => setSprayActive(false),
      onSprayShots: (ids, historyGroupId, eraseWithAlt) => {
        setSprays((current) => [
          ...current,
          { ids: [...ids].sort(), historyGroupId, eraseWithAlt },
        ]);
      },
      onSelectionChange: setSelectedShotIds,
      onActivateShot: (shot) => {
        setActivatedShotId(shot.id);
        setActivations((current) => [...current, shot.id]);
      },
    });
  }
  createRoot(host).render(React.createElement(Harness));
}

export function mountLiveGraph(holdIndex = false, empty = false, count = 9) {
  const nativeWorker = window.Worker;
  window.graphLiveCalls = [];
  window.graphLiveRequests = [];
  window.graphLiveWorkers = 0;
  window.graphLiveInteractions = { selections: [], activations: [], sprays: [], menus: 0 };
  const liveShots = Array.from({ length: count }, (_, index) => ({
    ...shots[0],
    id: String(index),
    sequence: index + 1,
    start_frame: index * 24,
    end_frame: (index + 1) * 24,
    start_us: index * 1_000_000,
    end_us: (index + 1) * 1_000_000,
  }));
  const pending = [];
  window.graphLiveHold = false;
  const pendingSearch = [];
  const pendingIndex = [];
  window.graphLiveReleaseIndex = () => {
    for (const resolve of pendingIndex.splice(0)) resolve(null);
  };
  window.graphLiveHoldSearch = false;
  window.graphLiveReleaseSearch = () => {
    window.graphLiveHoldSearch = false;
    for (const send of pendingSearch.splice(0)) send();
  };
  window.graphLiveRelease = () => {
    window.graphLiveHold = false;
    for (const send of pending.splice(0)) send();
  };
  window.Worker = class extends nativeWorker {
    constructor(...args) {
      super(...args);
      window.graphLiveWorkers++;
      this.addEventListener("message", (event) => {
        if (event.data.type === "ready") window.graphLiveTarget = event.data.graph;
      });
    }
    postMessage(message) {
      window.graphLiveRequests.push(message);
      const send = () => super.postMessage(message);
      if (window.graphLiveHold) pending.push(send);
      else send();
    }
  };
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: (path) => path,
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command, args) => {
      window.graphLiveCalls.push({ command, args });
      if (command === "select_storyboard_frames" && holdIndex)
        return new Promise((resolve) => pendingIndex.push(resolve));
      if (command === "read_storyboard_graph_vectors")
        return args.shots.map((shot) => ({
          id: shot.id,
          thumbnailFrame: shot.startFrame,
          vector: [Math.cos(Number(shot.id) / 2), Math.sin(Number(shot.id) / 2), 0.1],
        }));
      const matches = () =>
        args.shots.map((shot) => ({
          id: shot.id,
          similarity: (Number(shot.id) + 1) / 10,
          frame: shot.startFrame,
        }));
      if (
        command === "search_storyboards_semantic" ||
        command === "search_storyboards_semantic_batch"
      ) {
        const result =
          command === "search_storyboards_semantic" ? matches() : args.queries.map(matches);
        if (window.graphLiveHoldSearch)
          return new Promise((resolve) => pendingSearch.push(() => resolve(result)));
        return result;
      }
      return null;
    },
  };
  const host = document.createElement("div");
  host.id = "graph-live-host";
  host.style.cssText = "position:absolute;left:24px;top:24px;width:800px;height:500px";
  document.body.append(host);
  function Harness() {
    const [currentShots, setCurrentShots] = useState(empty ? [] : liveShots);
    const [sprayActive, setSprayActive] = useState(false);
    window.graphLiveSetSprayActive = setSprayActive;
    const [filter, setFilter] = useState(null);
    const [query, setQuery] = useState("");
    const [threshold, setThreshold] = useState(0.5);
    const semanticShots = React.useMemo(
      () =>
        currentShots.map((shot) => ({
          id: shot.id,
          assetId: "test",
          fingerprint: "test",
          source: "test",
          startFrame: shot.start_frame,
          endFrame: shot.end_frame,
        })),
      [currentShots],
    );
    const semantic = useStoryboardSemanticSearch(true, query, semanticShots, "graph-live", () =>
      setQuery(""),
    );
    const visible = React.useMemo(
      () =>
        currentShots.filter(
          (shot) =>
            (!filter || filter.includes(shot.id)) &&
            (!query ||
              semantic.status !== "ready" ||
              (semantic.scores.get(shot.id) ?? -1) >= threshold),
        ),
      [currentShots, filter, query, semantic.status, semantic.scores, threshold],
    );
    window.graphLiveFilter = setFilter;
    window.graphLiveQuery = setQuery;
    window.graphLiveThreshold = setThreshold;
    window.graphLiveDelete = (ids) =>
      setCurrentShots((current) => current.filter((shot) => !ids.includes(shot.id)));
    window.graphLiveSearchStatus = semantic.status;
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(TaskProgress, null, null),
      React.createElement(StoryboardGraphView, {
        semanticShots,
        scope: "graph-live",
        available: true,
        shots: visible,
        sourceForShot: () => source,
        shotTitle: (shot) => `Shot ${shot.id}`,
        selectedShotIds: new Set(),
        sprayActive,
        onSelectionChange: (ids) => window.graphLiveInteractions.selections.push([...ids]),
        onActivateShot: (shot) => window.graphLiveInteractions.activations.push(shot.id),
        onSprayShots: (ids) => window.graphLiveInteractions.sprays.push([...ids]),
        onContextMenu: (event) => {
          event.preventDefault();
          window.graphLiveInteractions.menus++;
        },
      }),
    );
  }
  createRoot(host).render(React.createElement(Harness));
}
