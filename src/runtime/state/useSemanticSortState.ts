import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useScopedState } from "./useScopedState";

interface ColumnSort {
  columnId: string;
  direction: "ascending" | "descending";
}

/** Search results choose an initial order; subsequent user sorting owns its override. */
export function useSemanticSortState<Sort extends ColumnSort>(
  context: string,
  version: number | null,
  defaultSort: Sort,
  similarity: Sort,
) {
  const [ordinary, setOrdinary] = useScopedState(context, defaultSort);
  const [sort, setChoice] = useScopedState(
    JSON.stringify([context, version]),
    version === null ? ordinary : similarity,
  );
  const setSort = useCallback<Dispatch<SetStateAction<Sort>>>(
    (action) => {
      const next = typeof action === "function" ? action(sort) : action;
      setChoice(next);
      if (next.columnId !== "similarity") setOrdinary(next);
    },
    [sort, setChoice, setOrdinary],
  );
  return { sort, setSort, ordinary };
}
