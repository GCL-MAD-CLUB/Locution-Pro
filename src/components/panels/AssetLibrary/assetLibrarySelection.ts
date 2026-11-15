import type { AssetLibraryNode } from "./assetLibraryNodes";

interface AssetLibrarySelectionContext {
  nodes: readonly AssetLibraryNode[];
  nodeIndex: ReadonlyMap<string, number>;
  selectedKeys: ReadonlySet<string>;
  select: (keys: Iterable<string>, focusKey?: string | null, anchorKey?: string | null) => void;
}

/** File-manager selection over the listed nodes: single, range, toggled, all and inverted. */
export function assetLibrarySelectionActions({
  nodes,
  nodeIndex,
  selectedKeys,
  select,
}: AssetLibrarySelectionContext) {
  function selectAll() {
    select(nodes.map((node) => node.key));
  }

  return {
    selectOnly(key: string) {
      select([key], key, key);
    },

    selectRange(fromKey: string, toKey: string, additive: boolean) {
      const from = nodeIndex.get(fromKey) ?? nodeIndex.get(toKey) ?? 0;
      const to = nodeIndex.get(toKey) ?? 0;
      const range = nodes.slice(Math.min(from, to), Math.max(from, to) + 1).map((node) => node.key);
      select(additive ? [...selectedKeys, ...range] : range, toKey, fromKey);
    },

    toggleNodeSelected(node: AssetLibraryNode) {
      const keys = new Set(selectedKeys);
      if (keys.has(node.key)) keys.delete(node.key);
      else keys.add(node.key);
      select(keys, node.key, node.key);
    },

    selectAll,

    toggleAllSelected() {
      const allSelected = nodes.length > 0 && nodes.every((node) => selectedKeys.has(node.key));
      if (allSelected) select([], null, null);
      else selectAll();
    },

    invertSelection() {
      select(nodes.filter((node) => !selectedKeys.has(node.key)).map((node) => node.key));
    },
  };
}
