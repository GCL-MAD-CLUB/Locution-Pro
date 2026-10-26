import { version as currentVersion } from "../../package.json";
import { clientError, invokeCommand } from "../errors";

export interface ReleaseInfo {
  version: string;
  title: string;
  body: string;
  url: string;
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
    .then((release): UpdateCheckResult => {
      const comparison = compareVersions(release.version, currentVersion);
      if (comparison === null) {
        throw clientError(
          "UPDATE_RESPONSE_INVALID",
          `Cannot compare release version ${JSON.stringify(release.version)} with ${currentVersion}`,
        );
      }
      return comparison > 0 ? { status: "available", release } : { status: "latest" };
    })
    .finally(() => {
      if (activeCheck === request) activeCheck = null;
    });
  activeCheck = request;
  return request;
}

export { currentVersion };
