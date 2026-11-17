export interface ColumnSort {
  columnId: string;
  direction: string;
}

export interface SemanticSortDecision<Sort extends ColumnSort> {
  appliedVersion: number;
  /** Replacement sorts, in the same order as the input, when a sort must change. */
  sorts: Sort[] | null;
  clearSourceDirection: boolean;
}

/**
 * Decides whether a newly ready semantic result should take over the column
 * sort, and whether leaving semantic search should restore the user's sort.
 * A dropped result resets the applied version so the same result can take over
 * again after the user changes sort while the search is in flight.
 */
export function semanticSortDecision<Sort extends ColumnSort>(input: {
  hasSemanticResults: boolean;
  showSimilarity: boolean;
  resultVersion: number;
  appliedVersion: number;
  sorts: readonly Sort[];
  ordinary: readonly Sort[];
  similarity: Sort;
}): SemanticSortDecision<Sort> | null {
  let appliedVersion = input.hasSemanticResults ? input.appliedVersion : 0;
  let sorts: Sort[] | null = null;
  let clearSourceDirection = false;
  if (input.hasSemanticResults && input.appliedVersion !== input.resultVersion) {
    appliedVersion = input.resultVersion;
    clearSourceDirection = true;
    sorts = input.sorts.map(() => input.similarity);
  }
  if (!input.showSimilarity) {
    const restored = input.sorts.map((current, index) =>
      current.columnId === "similarity" ? (input.ordinary[index] ?? current) : current,
    );
    if (restored.some((sort, index) => sort !== input.sorts[index])) sorts = restored;
  }
  if (appliedVersion === input.appliedVersion && sorts === null && !clearSourceDirection) {
    return null;
  }
  return { appliedVersion, sorts, clearSourceDirection };
}
