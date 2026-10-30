import { clientError } from "../../errors/model";

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

/**
 * Batch requests share one native model and index read; stale results are discarded.
 * Prompts are deduplicated across both lists so a description repeated as positive and
 * negative is only sent to the model once.
 */
export async function searchSemanticPrompts<T extends PromptMatch>(
  positive: readonly string[],
  negative: readonly string[],
  search: (prompt: string) => Promise<T[]>,
  isCurrent: () => boolean,
  searchBatch?: (prompts: readonly string[]) => Promise<T[][]>,
) {
  const positivePrompts = [...new Set(positive)];
  const negativePrompts = [...new Set(negative)];
  const positiveSet = new Set(positivePrompts);
  const prompts = [
    ...positivePrompts,
    ...negativePrompts.filter((prompt) => !positiveSet.has(prompt)),
  ];
  const results = new Map<string, T[]>();
  if (!isCurrent()) return [];
  if (prompts.length > 1 && searchBatch) {
    const batches = await searchBatch(prompts);
    if (!isCurrent()) return [];
    if (batches.length !== prompts.length)
      throw clientError("UNEXPECTED_ERROR", "Incomplete semantic prompt batch");
    prompts.forEach((prompt, index) => results.set(prompt, batches[index]));
  } else {
    for (const prompt of prompts) {
      if (!isCurrent()) return [];
      results.set(prompt, await search(prompt));
    }
  }
  if (!isCurrent()) return [];
  return combinePromptMatches(
    positivePrompts.map((prompt) => results.get(prompt) ?? []),
    negativePrompts.map((prompt) => results.get(prompt) ?? []),
  );
}
