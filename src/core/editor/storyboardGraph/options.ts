export interface StoryboardGraphOptions {
  minSimilarity: number;
  maxDegree: number;
}

export const defaultStoryboardGraphOptions: Readonly<StoryboardGraphOptions> = {
  minSimilarity: 0.95,
  maxDegree: 8,
};

// World-space radii are shared by simulation, rendering and canvas bounds.
export function storyboardGraphNodeRadius(degree: number) {
  return 6 + Math.max(0, degree - 4) * 0.2 + Math.max(0, degree - 6) * 0.4;
}

export const storyboardGraphCollisionPadding = 2;
