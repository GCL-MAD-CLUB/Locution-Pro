import { version as currentVersion } from "../../package.json";
import { clientError, invokeCommand } from "../errors";

export interface ReleaseInfo {
  version: string;
  title: string;
  body: string;
  url: string;
}

export interface UpdateFailure {
  version: string;
  error: string;
  exitCode: number;
}

export interface UpdateStartup {
  pending: ReleaseInfo | null;
  ignored: boolean;
  ignoredVersions: string[];
  notes: ReleaseInfo | null;
  failure: UpdateFailure | null;
}

let startup: Promise<UpdateStartup> | null = null;

export function loadUpdateStartup() {
  // React may mount the startup effect twice. Reading launch arguments and
  // hashing a cached installer is a single operation for this app session.
  return (startup ??= invokeCommand<UpdateStartup>("update_startup"));
}

export function setUpdateIgnored(version: string, ignored: boolean) {
  return invokeCommand<void>("set_update_ignored", { version, ignored }).then(async () => {
    const state = await loadUpdateStartup().catch(() => null);
    if (!state) return;
    state.ignoredVersions = state.ignoredVersions.filter((entry) => entry !== version);
    if (ignored) state.ignoredVersions.push(version);
  });
}

export function acknowledgeUpdateNotes() {
  return invokeCommand<void>("acknowledge_update_notes");
}

export function startupUpdateNotifications(
  state: UpdateStartup,
): Array<
  | { status: "installFailed"; failure: UpdateFailure }
  | { status: "installed"; release: ReleaseInfo }
  | { status: "available"; release: ReleaseInfo; ignored: boolean }
> {
  const notifications: ReturnType<typeof startupUpdateNotifications> = [];
  if (state.failure) notifications.push({ status: "installFailed", failure: state.failure });
  if (state.notes) notifications.push({ status: "installed", release: state.notes });
  if (state.pending && !state.ignored) {
    notifications.push({ status: "available", release: state.pending, ignored: false });
  }
  return notifications;
}

export type UpdateCheckResult =
  { status: "available"; release: ReleaseInfo } | { status: "latest" };

interface ParsedVersion {
  release: [number, number, number];
  prerelease: Array<number | string>;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value
    .trim()
    .match(
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    );
  if (!match) return null;
  const identifiers = match[4]?.split(".") ?? [];
  if (identifiers.some((part) => /^0\d+$/.test(part))) return null;
  const prerelease = identifiers.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease,
  };
}

export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < a.release.length; index++) {
    if (a.release[index] !== b.release[index]) return a.release[index] > b.release[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") {
      return leftPart > rightPart ? 1 : -1;
    }
    if (typeof leftPart !== typeof rightPart) return typeof leftPart === "number" ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

let activeCheck: Promise<UpdateCheckResult> | null = null;

export function checkForUpdate(): Promise<UpdateCheckResult> {
  if (activeCheck) return activeCheck;
  const request = invokeCommand<ReleaseInfo>("fetch_latest_release")
    .then(async (release): Promise<UpdateCheckResult> => {
      const comparison = compareVersions(release.version, currentVersion);
      if (comparison === null) {
        throw clientError(
          "UPDATE_RESPONSE_INVALID",
          `Cannot compare release version ${JSON.stringify(release.version)} with ${currentVersion}`,
        );
      }
      if (comparison <= 0) return { status: "latest" };
      await invokeCommand("download_update", { version: release.version });
      return { status: "available", release };
    })
    .finally(() => {
      if (activeCheck === request) activeCheck = null;
    });
  activeCheck = request;
  return request;
}

export { currentVersion };

export function installPreparedUpdate(version: string, projectPath: string | null) {
  return invokeCommand<void>("install_update", { version, projectPath });
}

export function createUpdateWriteBarrier() {
  const pending = new Set<Promise<unknown>>();
  return {
    track<T>(request: Promise<T>): Promise<T> {
      pending.add(request);
      return request.finally(() => pending.delete(request));
    },
    async settle(): Promise<boolean> {
      const hadWrites = pending.size > 0;
      while (pending.size > 0) await Promise.allSettled([...pending]);
      return hadWrites;
    },
  };
}

export async function saveBeforeUpdate({
  needsSave,
  save,
  snapshot,
  install,
  settle,
}: {
  needsSave: boolean;
  save: () => Promise<boolean>;
  snapshot: () => string;
  install: () => Promise<void>;
  settle?: () => Promise<boolean>;
}): Promise<"cancelled" | "changed" | "started"> {
  const before = snapshot();
  const hadWrites = await settle?.();
  if ((needsSave || hadWrites) && !(await save())) return "cancelled";
  if (snapshot() !== before) return "changed";
  await install();
  return "started";
}
