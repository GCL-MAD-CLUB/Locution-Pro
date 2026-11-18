import type { SimulationNodeDatum } from "d3-force";

export interface StoryboardGraphEdge {
  source: number;
  target: number;
  similarity: number;
}

export interface StoryboardGraphForceNode extends SimulationNodeDatum {
  id: string;
  radius: number;
  cluster?: number;
}
