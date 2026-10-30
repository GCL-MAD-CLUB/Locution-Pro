import { createModuleLoader, deferred, flush } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";

const loadModule = createModuleLoader(import.meta.url);

function loadUpdate(release) {
  const invocations = [];
  const pending = deferred();
  const update = loadModule("../../../src/application/update.ts", {
    "../../package.json": { version: "0.4.0" },
    "../errors": {
      invokeCommand: (command) => {
        invocations.push(command);
        return release === undefined ? pending.promise : Promise.resolve(release);
      },
      clientError: (code, detail) => Object.assign(new Error(detail), { code }),
    },
  });
  return { update, invocations, pending };
}

test("update versions follow semantic version precedence", () => {
  const { update } = loadUpdate();

  assert.equal(update.compareVersions("v0.4.0", "0.4.0"), 0);
  assert.equal(update.compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(update.compareVersions("0.4.0", "0.4.1"), -1);
  assert.equal(update.compareVersions("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(update.compareVersions("1.0.0-alpha.1", "1.0.0-alpha"), 1);
  assert.equal(update.compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(update.compareVersions("1.0.0-beta", "1.0.0-alpha"), 1);
  assert.equal(update.compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(update.compareVersions("1.0.0+build.2", "v1.0.0+build.1"), 0);
});

test("update versions reject malformed and ambiguous versions", () => {
  const { update } = loadUpdate();

  for (const value of ["", "1.0", "v1.0.0.0", "1.0.0-01", "01.0.0", "latest"]) {
    assert.equal(update.compareVersions(value, "1.0.0"), null, value);
  }
});

test("update checks expose only newer releases and share an active request", async () => {
  const release = {
    version: "v0.5.0",
    title: "Locution Pro 0.5.0",
    body: "New features",
    url: "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.5.0",
  };
  const { update, invocations, pending } = loadUpdate(release);

  const first = update.checkForUpdate();
  const second = update.checkForUpdate();
  assert.equal(first, second);
  assert.deepEqual(invocations, ["fetch_latest_release"]);
  pending.resolve(release);
  assert.equal(JSON.stringify(await first), JSON.stringify({ status: "available", release }));

  const next = update.checkForUpdate();
  assert.notEqual(next, first);
  assert.equal(JSON.stringify(await next), JSON.stringify({ status: "available", release }));
});

test("update checks treat current and older releases as up to date", async () => {
  for (const version of ["v0.4.0", "0.3.9"]) {
    const { update } = loadUpdate({
      version,
      title: "",
      body: "",
      url: "https://github.com/GCL-MAD-CLUB/LineCut/releases",
    });
    assert.equal(JSON.stringify(await update.checkForUpdate()), '{"status":"latest"}');
  }
});

test("update checks reject invalid native version metadata", async () => {
  const { update } = loadUpdate({
    version: "latest",
    title: "",
    body: "",
    url: "https://github.com/GCL-MAD-CLUB/LineCut/releases",
  });
  await assert.rejects(update.checkForUpdate(), (error) => {
    assert.equal(error.code, "UPDATE_RESPONSE_INVALID");
    return true;
  });
  await flush();
});
