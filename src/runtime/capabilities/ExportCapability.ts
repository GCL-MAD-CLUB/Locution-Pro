import type { RenderLifetime } from "../lifetime/RenderLifetime";
import { useMemo } from "react";
import { captureOperationError } from "../../errors";
import { useBroadcastEvent } from "../events/react";
import type { SystemIdentity } from "../systems/identity";
import { EXPORT_CAPABILITY_PROJECTION, type ExportCapabilityProjection } from "../state/contracts";
import { usePublishProjection } from "../state/react";

type ExportOperation = keyof ExportCapabilityProjection["capabilities"];
type ExportHandler = () => void | Promise<void>;

export interface ExportCapabilityOptions {
  identity: SystemIdentity;
  active: boolean;
  selectedCount: number;
  hasLastSettings: boolean;
  handlers: Record<ExportOperation, ExportHandler>;
}

/** Publishes the focused panel's export availability and handles global export commands. */
export function useExportCapability(lifetime: RenderLifetime, options: ExportCapabilityOptions) {
  const { identity, active, selectedCount, hasLastSettings, handlers } = options;
  const capabilities = useMemo(
    () => ({
      configure: selectedCount > 0,
      quick: selectedCount > 0 && hasLastSettings,
    }),
    [selectedCount, hasLastSettings],
  );
  const projection = useMemo<ExportCapabilityProjection>(
    () => ({ active, selectedCount, capabilities }),
    [active, capabilities, selectedCount],
  );
  usePublishProjection(lifetime, EXPORT_CAPABILITY_PROJECTION, identity, projection);

  function run(operation: ExportOperation) {
    if (!active || !capabilities[operation]) {
      return "ignored" as const;
    }
    try {
      const result = handlers[operation]();
      if (result instanceof Promise) {
        void result.catch((error) => captureOperationError("export.run", error));
      }
    } catch (error) {
      captureOperationError("export.run", error);
    }
    // Export work continues independently. EventHub must remain available for
    // another shortcut/request while this one is queued or running.
    return "handled" as const;
  }

  useBroadcastEvent(lifetime, identity, "export.configure-selection.requested", () =>
    run("configure"),
  );
  useBroadcastEvent(lifetime, identity, "export.quick-selection.requested", () => run("quick"));
}
