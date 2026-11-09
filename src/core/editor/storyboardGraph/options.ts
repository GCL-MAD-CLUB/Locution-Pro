export interface StoryboardGraphOptions {
  minSimilarity: number;
  maxDegree: number;
  maxVisibleDegree: number;
  minDegree: number;
  minIslandConnections: number;
  nodeRadius: (view_degree: number) => number;
  collisionPadding: number;
}

export const defaultStoryboardGraphOptions: Readonly<StoryboardGraphOptions> = {
  minSimilarity: 0.95,
  maxDegree: 18,
  maxVisibleDegree: 6,
  minDegree: 2,
  minIslandConnections: 1,
  nodeRadius: (view_degree) => 6 + Math.max(Math.min(8, view_degree) - 4, 0) * 0.5,
  collisionPadding: 2,
};
