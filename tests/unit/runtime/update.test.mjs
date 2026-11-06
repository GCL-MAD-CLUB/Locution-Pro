import { createModuleLoader, deferred, flush } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";

const loadTestModule = createModuleLoader(import.meta.url);
const loadModule = (path, imports) => loadTestModule(path, imports, { setTimeout, clearTimeout });

function loadUpdate(release) {
  const invocations = [];
  const pending = deferred();
  const update = loadModule("../../../src/application/update.ts", {
    "../../package.json": { version: "0.4.0" },
    "../errors": {
      invokeCommand: (command) => {
        invocations.push(command);
        if (command === "download_update") return Promise.resolve();
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

test("prerelease builds and release candidates never check, download or notify", async () => {
  const calls = [];
  const preview = loadModule("../../../src/application/update.ts", {
    "../../package.json": { version: "0.4.1-preview" },
    "../errors": {
      invokeCommand: async (command) => {
        calls.push(command);
      },
    },
  });
  assert.equal((await preview.checkForUpdate()).status, "latest");
  assert.deepEqual(calls, []);
  const { update, invocations } = loadUpdate({ version: "999.0.0-rc.1" });
  assert.equal((await update.checkForUpdate()).status, "latest");
  assert.deepEqual(invocations, ["fetch_latest_release"]);
  assert.equal(
    update.startupUpdateNotifications({
      pending: { version: "1.0.0-preview" },
      notes: { version: "1.0.0-rc.1" },
      failure: { version: "1.0.0-beta" },
    }).length,
    0,
  );
});

test("a hung save barrier times out and never launches the updater", async () => {
  const { update } = loadUpdate();
  const barrier = update.createUpdateWriteBarrier(15);
  const pending = deferred();
  const write = barrier.track(pending.promise);
  let installs = 0;
  await assert.rejects(
    update.saveBeforeUpdate({
      needsSave: false,
      settle: barrier.settle,
      save: async () => true,
      snapshot: () => "unchanged",
      install: async () => {
        installs++;
      },
    }),
    /timed out/,
  );
  assert.equal(installs, 0);
  pending.resolve();
  await write;
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
    url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/tag/v0.5.0",
  };
  const { update, invocations, pending } = loadUpdate(release);

  const first = update.checkForUpdate();
  const second = update.checkForUpdate();
  assert.equal(first, second);
  assert.deepEqual(invocations, ["fetch_latest_release"]);
  pending.resolve(release);
  assert.equal(JSON.stringify(await first), JSON.stringify({ status: "available", release }));
  assert.deepEqual(invocations, ["fetch_latest_release", "download_update"]);

  const next = update.checkForUpdate();
  assert.notEqual(next, first);
  assert.equal(JSON.stringify(await next), JSON.stringify({ status: "available", release }));
});

test("update availability waits for the download and falls back to the release page on failure", async () => {
  const download = deferred();
  const update = loadModule("../../../src/application/update.ts", {
    "../../package.json": { version: "0.4.0" },
    "../errors": {
      captureOperationError: () => {},
      invokeCommand: (command) =>
        command === "fetch_latest_release"
          ? Promise.resolve({ version: "0.5.0" })
          : download.promise,
    },
  });
  let result;
  const request = update.checkForUpdate().then((value) => {
    result = value;
  });
  await flush();
  assert.equal(result, undefined);
  download.reject(new Error("Both download sources failed"));
  await request;
  assert.equal(result.status, "manual");
  assert.equal(result.release.version, "0.5.0");
});

test("missing update metadata and hash or cache failures preserve release notes and the manual path", async () => {
  const release = {
    version: "0.5.0",
    title: "New release",
    body: "Notes",
    url: "https://github.com/releases",
  };
  for (const reason of ["No updater in legacy release", "SHA-256 mismatch", "Cache is read-only"]) {
    const update = loadModule("../../../src/application/update.ts", {
      "../../package.json": { version: "0.4.0" },
      "../errors": {
        captureOperationError: () => {},
        invokeCommand: async (command) => {
          if (command === "fetch_latest_release") return release;
          throw new Error(reason);
        },
      },
    });
    const result = await update.checkForUpdate();
    assert.equal(result.status, "manual", reason);
    assert.equal(result.release, release);
  }
});

test("only failure to discover a release rejects the update check, and retry remains possible", async () => {
  const { update, pending } = loadUpdate();
  const request = update.checkForUpdate();
  pending.reject(new Error("All release sources unavailable"));
  await assert.rejects(request, /All release sources unavailable/);
  const retry = update.checkForUpdate();
  assert.notEqual(retry, request);
  await assert.rejects(retry, /All release sources unavailable/);
});

test("startup prioritizes failure details, then release notes and a verified pending update", () => {
  const { update } = loadUpdate();
  const release = { version: "0.5.0", title: "Release", body: "Notes", url: "https://github.com" };
  const failure = { version: "0.5.0", error: "Dependency hash mismatch: runtime.dll", exitCode: 2 };
  const state = { failure, notes: release, pending: release, ignored: false, ignoredVersions: [] };
  const notifications = update.startupUpdateNotifications(state);
  assert.deepEqual(
    Array.from(notifications, (item) => item.status),
    ["installFailed", "installed", "available"],
  );
  assert.equal(notifications[0].failure.error, failure.error);
  state.ignored = true;
  assert.deepEqual(
    Array.from(update.startupUpdateNotifications(state), (item) => item.status),
    ["installFailed", "installed"],
  );
  state.pending = null;
  state.notes = null;
  state.failure = null;
  assert.equal(update.startupUpdateNotifications(state).length, 0);
});

test("startup is read once per session and suppression is persisted for the selected version", async () => {
  const calls = [];
  const state = {
    failure: null,
    notes: null,
    pending: null,
    ignored: false,
    ignoredVersions: ["0.5.0"],
  };
  const update = loadModule("../../../src/application/update.ts", {
    "../../package.json": { version: "0.4.0" },
    "../errors": {
      invokeCommand: async (command, args) => {
        calls.push([command, args]);
        return command === "update_startup" ? state : undefined;
      },
    },
  });
  assert.equal(update.loadUpdateStartup(), update.loadUpdateStartup());
  await update.loadUpdateStartup();
  await update.setUpdateIgnored("0.6.0", true);
  assert.deepEqual(Array.from((await update.loadUpdateStartup()).ignoredVersions), [
    "0.5.0",
    "0.6.0",
  ]);
  await update.setUpdateIgnored("0.5.0", false);
  assert.deepEqual(Array.from((await update.loadUpdateStartup()).ignoredVersions), ["0.6.0"]);
  assert.deepEqual(state.ignoredVersions, ["0.5.0"]);
  await update.acknowledgeUpdateNotes();
  assert.equal(calls.filter(([command]) => command === "update_startup").length, 1);
  assert.equal(calls.at(-1)[0], "acknowledge_update_notes");
});

test("update never launches after a cancelled save or a changed workspace", async () => {
  const { update } = loadUpdate();
  let workspace = "original";
  let installations = 0;
  const options = {
    needsSave: true,
    snapshot: () => workspace,
    install: async () => {
      installations++;
    },
  };
  assert.equal(await update.saveBeforeUpdate({ ...options, save: async () => false }), "cancelled");
  assert.equal(
    await update.saveBeforeUpdate({
      ...options,
      save: async () => {
        workspace = "changed";
        return true;
      },
    }),
    "changed",
  );
  assert.equal(installations, 0);
  const order = [];
  assert.equal(
    await update.saveBeforeUpdate({
      ...options,
      save: async () => {
        order.push("save");
        return true;
      },
      install: async () => {
        order.push("install");
      },
    }),
    "started",
  );
  assert.deepEqual(order, ["save", "install"]);
});

test("update checks treat current and older releases as up to date", async () => {
  for (const version of ["v0.4.0", "0.3.9"]) {
    const { update, invocations } = loadUpdate({
      version,
      title: "",
      body: "",
      url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases",
    });
    assert.equal(JSON.stringify(await update.checkForUpdate()), '{"status":"latest"}');
    assert.deepEqual(invocations, ["fetch_latest_release"]);
  }
});

test("clean workspaces update immediately and failed saves never install", async () => {
  const { update } = loadUpdate();
  let saves = 0;
  let installs = 0;
  const options = {
    snapshot: () => "workspace",
    install: async () => {
      installs++;
    },
    save: async () => {
      saves++;
      throw new Error("Save failed");
    },
  };
  assert.equal(await update.saveBeforeUpdate({ ...options, needsSave: false }), "started");
  assert.equal(saves, 0);
  assert.equal(installs, 1);
  await assert.rejects(update.saveBeforeUpdate({ ...options, needsSave: true }), /Save failed/u);
  assert.equal(installs, 1);
});

test("update waits for in-flight auto-save and writes the current snapshot last", async () => {
  const { update } = loadUpdate();
  const barrier = update.createUpdateWriteBarrier();
  const write = deferred();
  const order = [];
  const pending = barrier.track(
    write.promise.then(() => {
      order.push("old auto-save");
    }),
  );
  const apply = update.saveBeforeUpdate({
    needsSave: false,
    settle: barrier.settle,
    snapshot: () => "current workspace",
    save: async () => {
      order.push("current save");
      return true;
    },
    install: async () => {
      order.push("install");
    },
  });
  await flush();
  assert.deepEqual(order, []);
  write.resolve();
  await pending;
  assert.equal(await apply, "started");
  assert.deepEqual(order, ["old auto-save", "current save", "install"]);
});

test("update checks reject invalid native version metadata", async () => {
  const { update } = loadUpdate({
    version: "latest",
    title: "",
    body: "",
    url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases",
  });
  await assert.rejects(update.checkForUpdate(), (error) => {
    assert.equal(error.code, "UPDATE_RESPONSE_INVALID");
    return true;
  });
  await flush();
});
