import type { RenderLifetime } from "../lifetime/RenderLifetime";
import { useMemo } from "react";
import { useBroadcastEvent } from "../events/react";
import type { SystemIdentity } from "../systems/identity";
import { EDIT_CAPABILITY_PROJECTION, type EditCapabilityProjection } from "../state/contracts";
import { usePublishProjection } from "../state/react";

type EditOperation = keyof EditCapabilityProjection["capabilities"];
type EditHandler = () => void | Promise<void>;

export interface EditCapabilityOptions {
  identity: SystemIdentity;
  active: boolean;
  selectedCount: number;
  visibleCount: number;
  readOnly?: boolean;
  pasteCount?: number;
  handlers: Partial<Record<EditOperation, EditHandler>>;
}

export function useEditCapability(lifetime: RenderLifetime, options: EditCapabilityOptions) {
  const {
    identity,
    active,
    selectedCount,
    visibleCount,
    readOnly = false,
    pasteCount = 0,
    handlers,
  } = options;
  const copy = Boolean(handlers.copy && selectedCount > 0);
  const paste = Boolean(handlers.paste && !readOnly && pasteCount > 0);
  const clear = Boolean(handlers.clear && !readOnly && selectedCount > 0);
  const duplicate = Boolean(handlers.duplicate && !readOnly && selectedCount > 0);
  const selectAll = Boolean(handlers.selectAll && visibleCount > 0);
  const clearSelection = Boolean(handlers.clearSelection && selectedCount > 0);
  const can = useMemo(
    () => ({ copy, paste, clear, duplicate, selectAll, clearSelection }),
    [copy, paste, clear, duplicate, selectAll, clearSelection],
  );
  const projection = useMemo<EditCapabilityProjection>(
    () => ({ active, selectedCount, visibleCount, capabilities: can }),
    [active, can, selectedCount, visibleCount],
  );
  usePublishProjection(lifetime, EDIT_CAPABILITY_PROJECTION, identity, projection);

  async function run(operation: EditOperation) {
    const handler = handlers[operation];
    if (!active || !can[operation] || !handler) {
      return "ignored" as const;
    }
    await handler();
    return "handled" as const;
  }

  useBroadcastEvent(lifetime, identity, "edit.copy.requested", () => run("copy"));
  useBroadcastEvent(lifetime, identity, "edit.paste.requested", () => run("paste"));
  useBroadcastEvent(lifetime, identity, "edit.clear.requested", () => run("clear"));
  useBroadcastEvent(lifetime, identity, "edit.duplicate.requested", () => run("duplicate"));
  useBroadcastEvent(lifetime, identity, "edit.select-all.requested", () => run("selectAll"));
  useBroadcastEvent(lifetime, identity, "edit.clear-selection.requested", () =>
    run("clearSelection"),
  );
}
