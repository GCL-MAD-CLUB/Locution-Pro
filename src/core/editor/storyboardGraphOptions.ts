export interface StoryboardGraphOptions {
  minSimilarity: number;
  maxDegree: number;
}

export const defaultStoryboardGraphOptions: Readonly<StoryboardGraphOptions> = {
  minSimilarity: 0.9,
  maxDegree: 8,
};
