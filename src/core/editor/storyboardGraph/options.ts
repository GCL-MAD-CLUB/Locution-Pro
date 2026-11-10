export interface StoryboardGraphOptions {
  minSimilarity: number;
  maxDegree: number;
  maxVisibleDegree: number;
  minDegree: number;
  minIslandConnections: number;
  nodeRadius: (view_degree: number) => number;
  collisionPadding: number;
  clusterEnabled: boolean;
  clusterResolution: number;
  clusterStrength: number;
  clusterPadding: number;
}

export const defaultStoryboardGraphOptions: Readonly<StoryboardGraphOptions> = {
  minSimilarity: 0.95,
  maxDegree: 18,
  maxVisibleDegree: 6,
  minDegree: 1,
  minIslandConnections: 1,
  nodeRadius: (view_degree) => 6 + Math.max(Math.min(8, view_degree) - 5, 0) * 1,
  collisionPadding: 2,
  clusterEnabled: true,
  clusterResolution: 1,
  clusterStrength: 0.08,
  clusterPadding: 18,
};
