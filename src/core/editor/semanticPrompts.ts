export interface PromptMatch {
  id: string;
  similarity: number;
  frame?: number;
}

/** Keep the best positive match (and its preview frame), then subtract negative evidence. */
export function combinePromptMatches<T extends PromptMatch>(
  positive: readonly (readonly T[])[],
  negative: readonly (readonly T[])[],
): T[] {
  const best = new Map<string, T>();
  const penalties = new Map<string, number>();
  for (const matches of positive) {
    for (const match of matches) {
      if (!Number.isFinite(match.similarity)) continue;
      const previous = best.get(match.id);
      if (!previous || match.similarity > previous.similarity) best.set(match.id, match);
    }
  }
  for (const matches of negative) {
    for (const match of matches) {
      if (!Number.isFinite(match.similarity)) continue;
      penalties.set(match.id, Math.max(penalties.get(match.id) ?? -Infinity, match.similarity));
    }
  }
  return [...best.values()].map((match) => ({
    ...match,
    similarity: Math.max(0, match.similarity - (penalties.get(match.id) ?? 0)),
  }));
}

/** Sequential requests share the native model; stale work stops before the next prompt. */
export async function searchSemanticPrompts<T extends PromptMatch>(
  positive: readonly string[],
  negative: readonly string[],
  search: (prompt: string) => Promise<T[]>,
  isCurrent: () => boolean,
) {
  const results: T[][] = [];
  for (const prompt of [...positive, ...negative]) {
    if (!isCurrent()) return [];
    results.push(await search(prompt));
  }
  return combinePromptMatches(results.slice(0, positive.length), results.slice(positive.length));
}
