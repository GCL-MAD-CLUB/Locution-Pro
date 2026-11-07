import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { StoryboardGraphCanvas } from "../../../../src/components/panels/StoryboardPanel/views/StoryboardGraphCanvas.tsx";
import "../../../../src/styles.css";
import "../../../../src/components/panels/StoryboardPanel/StoryboardPanel.css";

const shots = Array.from({ length: 9 }, (_, index) => ({
  id: String(index),
  startFrame: index * 24,
  endFrame: (index + 1) * 24,
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

export function mountGraph(empty = false, spread = 1) {
  const renderedGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, x: node.x * spread, y: node.y * spread })),
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
    const [selectedShotIds, setSelectedShotIds] = useState(new Set());
    return React.createElement(StoryboardGraphCanvas, {
      graph: empty ? undefined : renderedGraph,
      shots,
      sourceForShot: () => source,
      shotTitle: (shot) => `Shot ${shot.id}`,
      selectedShotIds,
      onSelectShot: (_, shot) => setSelectedShotIds(new Set([shot.id])),
    });
  }
  createRoot(host).render(React.createElement(Harness));
}
