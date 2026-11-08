import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkReleaseAssets } from "./check-release-assets.mjs";
import { isReleaseVersion, isReleaseRepository } from "../site/src/release-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function validateOptions({ repository, version, token }) {
  if (!isReleaseRepository(repository) || !isReleaseVersion(version) || !token) {
    throw new Error("Expected a valid repository, version and GH_TOKEN");
  }
}

async function githubJson(url, options, fetcher) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub release API failed: HTTP ${response.status}`);
  const document = await response.json();
  if (document.errors?.length) throw new Error("GitHub release query failed");
  return document;
}

export async function inspectRelease({ repository, version, token, fetcher = fetch }) {
  validateOptions({ repository, version, token });
  const [owner, name] = repository.split("/");
  const document = await githubJson(
    "https://api.github.com/graphql",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){databaseId isDraft isPrerelease tagName}}}",
        variables: { owner, name, tag: `v${version}` },
      }),
    },
    fetcher,
  );
  if (!document.data?.repository || !("release" in document.data.repository)) {
    throw new Error("Cannot inspect the release repository");
  }
  const release = document.data.repository.release;
  if (release === null) return null;
  if (
    !release ||
    !Number.isSafeInteger(release.databaseId) ||
    release.tagName !== `v${version}` ||
    release.isDraft !== true ||
    release.isPrerelease !== version.includes("-")
  ) {
    throw new Error(
      "Release must be an unpublished draft with matching version and prerelease status",
    );
  }
  return release;
}

export async function prepareReleaseDraft({
  directory,
  version,
  repository,
  token,
  fetcher = fetch,
  run = (args) =>
    execFileSync("gh", args, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, GH_TOKEN: token },
    }),
  sleep = delay,
}) {
  const options = { repository, version, token, fetcher };
  validateOptions(options);
  const { files } = await checkReleaseAssets({ directory, version, repository });
  const prerelease = version.includes("-");
  let release = await inspectRelease(options);
  if (!release) {
    await run([
      "release",
      "create",
      `v${version}`,
      "--repo",
      repository,
      "--verify-tag",
      "--draft",
      "--latest=false",
      `--prerelease=${version.includes("-")}`,
      "--title",
      `Locution Pro v${version}`,
      ...(prerelease ? ["--notes", `Release v${version}`] : ["--generate-notes"]),
    ]);
    release = await inspectRelease(options);
    if (!release) throw new Error("The newly created release draft is missing");
  } else if (prerelease) {
    await run([
      "release",
      "edit",
      `v${version}`,
      "--repo",
      repository,
      "--notes",
      `Release v${version}`,
      "--latest=false",
    ]);
  }
  async function assets() {
    const result = await githubJson(
      `https://api.github.com/repos/${repository}/releases/${release.databaseId}/assets?per_page=100`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
      fetcher,
    );
    if (!Array.isArray(result)) throw new Error("Invalid GitHub release asset response");
    return result;
  }
  const existing = await assets();
  if (existing.some((asset) => !files.some((file) => file.name === asset.name))) {
    throw new Error("Release draft contains unexpected assets");
  }
  const matches = (remote, file) =>
    remote.name === file.name &&
    remote.state === "uploaded" &&
    remote.size === file.size &&
    remote.digest === `sha256:${file.sha256}`;
  // A rerun reuses complete assets and retries only the file that failed.
  // latest.json is uploaded last, after both the installer and checksum file.
  const ordered = [...files].sort(
    (a, b) => Number(a.name === "latest.json") - Number(b.name === "latest.json"),
  );
  for (const file of ordered) {
    if (existing.some((remote) => matches(remote, file))) continue;
    for (let attempt = 1; ; attempt++) {
      const current = await inspectRelease(options);
      if (current?.databaseId !== release.databaseId)
        throw new Error("Release draft changed during upload");
      try {
        await run([
          "release",
          "upload",
          `v${version}`,
          file.path,
          "--repo",
          repository,
          "--clobber",
        ]);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await sleep(attempt * 5000);
      }
    }
  }
  const current = await inspectRelease(options);
  if (current?.databaseId !== release.databaseId)
    throw new Error("Release draft changed during upload");
  const uploaded = await assets();
  if (
    uploaded.length !== files.length ||
    files.some((file) => !uploaded.some((remote) => matches(remote, file)))
  ) {
    throw new Error("GitHub release assets do not match the verified artifact bytes");
  }
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (process.env.RELEASE_TAG !== `v${version}`)
    throw new Error("RELEASE_TAG must match the checked-out version");
  const options = {
    directory: path.join(root, "src-tauri", "target", "release-artifacts"),
    version,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  };
  if (process.argv.length === 3 && process.argv[2] === "--check") await inspectRelease(options);
  else if (process.argv.length === 2) await prepareReleaseDraft(options);
  else throw new Error("Usage: npm run release:draft -- [--check]");
  console.log("Release draft checks passed");
}
