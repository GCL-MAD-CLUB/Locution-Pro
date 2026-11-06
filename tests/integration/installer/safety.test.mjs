import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test(
  "installer safety boundaries and complete template compilation",
  { timeout: 420000 },
  async (t) => {
    assert.equal(process.platform, "win32");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const target = join(root, "src-tauri/target");
    mkdirSync(target, { recursive: true });
    const temporary = mkdtempSync(join(target, "installer-safety-"));
    t.after(() => {
      const within = relative(target, resolve(temporary));
      assert(within && !within.startsWith("..") && !isAbsolute(within));
      rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    });
    const windows = join(root, "src-tauri/windows");
    const run = (program, args, expected = 0, options = {}) => {
      const result = spawnSync(program, args, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        ...options,
      });
      assert.ifError(result.error);
      assert.equal(
        result.status,
        expected,
        `${result.stdout}\n${result.stderr}\n${options.trace && existsSync(options.trace) ? readFileSync(options.trace, "utf16le") : ""}`,
      );
      if (program.endsWith("makensis.exe")) {
        assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /unknown variable\/constant/iu);
      }
      return result;
    };
    const powershell = join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    function prepareControllerFixture() {
      const application = join(temporary, "application.exe");
      const installer = join(temporary, "updater.exe");
      const compile = join(temporary, "compile-controller-fixture.ps1");
      writeFileSync(
        compile,
        `
$ErrorActionPreference = 'Stop'
Add-Type -OutputAssembly '${application.replaceAll("'", "''")}' -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
public class Fixture {
    public static int Main(string[] args) {
        if (args.Length > 0 && args[0] == "--parent") {
            File.WriteAllText(Environment.GetEnvironmentVariable("LOCUTION_PARENT_READY"), "ready");
            Thread.Sleep(Timeout.Infinite);
        }
        if (args.Length > 0 && args[0] == "/S") {
            int code = int.Parse(Environment.GetEnvironmentVariable("LOCUTION_INSTALLER_EXIT"));
            foreach (string arg in args) {
                if (code != 0 && arg.StartsWith("/ERRORFILE=")) {
                    File.WriteAllText(arg.Substring(11), "Dependency SHA-256 mismatch: runtime.dll", Encoding.Unicode);
                }
            }
            return code;
        }
        File.WriteAllLines(Environment.GetEnvironmentVariable("LOCUTION_RESTART_ARGS"), args);
        return 0;
    }
}
'@
`,
      );
      if (!existsSync(application)) run(powershell, ["-NoProfile", "-File", compile]);
      copyFileSync(application, installer);
      return { application, installer };
    }
    await t.test(
      "updater owns shutdown and restarts after success, failure and cancellation",
      async () => {
        const controller = join(temporary, "apply-update.ps1");
        writeFileSync(
          controller,
          `\uFEFF${readFileSync(join(windows, "apply-update.ps1"), "utf8").replace(/^\ufeff/u, "")}`,
        );
        const { application, installer } = prepareControllerFixture();
        const waitFor = async (predicate, message) => {
          const deadline = Date.now() + 15000;
          while (!predicate()) {
            assert(Date.now() < deadline, message);
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
        };
        for (const outcome of ["success", "failed", "cancelled", "rejected"]) {
          const directory = join(temporary, `controller-${outcome}`);
          mkdirSync(directory);
          const ready = join(directory, "parent-ready");
          const restarted = join(directory, "restart-args");
          const environment = {
            ...process.env,
            LOCUTION_PARENT_READY: ready,
            LOCUTION_RESTART_ARGS: restarted,
            LOCUTION_INSTALLER_EXIT: outcome === "failed" ? "2" : "0",
          };
          const parent = spawn(application, ["--parent"], { windowsHide: true, env: environment });
          const parentExit = new Promise((resolve) => parent.once("exit", resolve));
          let helper;
          try {
            await waitFor(() => existsSync(ready), "Fixture parent did not start");
            const handoff = join(directory, "handoff.json");
            writeFileSync(
              handoff,
              JSON.stringify({
                parent: parent.pid,
                requireAcceptance: true,
                executable: application,
                installer,
                version: "1.0.0",
                signature: createHash("sha256").update(readFileSync(installer)).digest("hex"),
                project: "C:\\project with spaces\\saved.lcp",
              }),
            );
            if (outcome === "cancelled") writeFileSync(join(directory, "cancel"), "cancel");
            helper = spawn(
              powershell,
              [
                "-NoProfile",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                controller,
                "-Installer",
                installer,
                "-Executable",
                application,
                "-Version",
                "1.0.0",
                "-Data",
                handoff,
                "-Headless",
              ],
              { windowsHide: true, env: environment },
            );
            let diagnostics = "";
            helper.stderr.on("data", (chunk) => {
              diagnostics += chunk;
            });
            const helperExit = new Promise((resolve, reject) => {
              helper.once("exit", resolve);
              helper.once("error", reject);
            });
            await waitFor(
              () => existsSync(join(directory, "ready")),
              "The controller did not request acceptance",
            );
            assert.equal(
              parent.exitCode,
              null,
              "The old application must survive until explicit acceptance",
            );
            writeFileSync(
              join(directory, outcome === "rejected" ? "cancel-start" : "accepted"),
              "accepted",
            );
            const helperCode = await helperExit;
            assert.equal(
              helperCode,
              outcome === "success" ? 0 : outcome === "cancelled" ? 1 : 2,
              diagnostics,
            );
            if (outcome === "rejected") {
              assert.equal(
                parent.exitCode,
                null,
                "Revoking startup must leave the application alive",
              );
              assert(
                !existsSync(restarted),
                "A rejected handoff must not start a duplicate application",
              );
              const report = JSON.parse(
                readFileSync(join(directory, "result.json"), "utf8").replace(/^\ufeff/u, ""),
              );
              assert.match(report.error, /cancelled before/u);
              continue;
            }
            await parentExit;
            assert.notEqual(
              parent.exitCode,
              null,
              "The updater must terminate the initiating application",
            );
            await waitFor(
              () => existsSync(restarted) && readFileSync(restarted, "utf8").length > 0,
              "Every outcome must restart the application",
            );
            const report = JSON.parse(
              readFileSync(join(directory, "result.json"), "utf8").replace(/^\ufeff/u, ""),
            );
            assert.equal(report.status, outcome);
            const args = readFileSync(restarted, "utf8");
            assert.match(args, /project with spaces\\saved\.lcp/u);
            if (outcome === "failed") {
              const encoded = args.match(/--update-error=([a-f0-9]+)/u)?.[1];
              assert(encoded, "Failure details must be passed through launch arguments");
              assert.match(
                JSON.parse(Buffer.from(encoded, "hex").toString("utf8")).error,
                /runtime\.dll/u,
              );
            } else assert.doesNotMatch(args, /--update-error/u);
          } finally {
            if (parent.exitCode === null) {
              parent.kill();
              await parentExit;
            }
            if (helper?.exitCode === null) helper.kill();
          }
        }
      },
    );
    const manifest = join(temporary, "manifest.json");
    const payload = join(temporary, "payload.txt");
    writeFileSync(payload, "payload");
    writeFileSync(
      manifest,
      JSON.stringify({
        version: 1,
        files: [
          "LICENSE",
          "locution_pro_thumbnail_provider.dll",
          "ffmpeg.exe",
          "ffprobe.exe",
          "transnetv2/model.onnx",
          "transnetv2/README.md",
          "semantic-search/model.onnx",
        ].map((path) => ({
          path: path.replaceAll("/", "\\"),
          size: 7,
          sha256: createHash("sha256").update("payload").digest("hex"),
          group: path.startsWith("ff")
            ? "ffmpeg"
            : path.includes("/")
              ? path.split("/")[0]
              : "core",
          bundleInUpdate:
            (!path.includes("/") && !path.startsWith("ff")) || path.endsWith("README.md"),
        })),
      }),
    );
    const worker = (mode, install, result, extra = [], expected = 0, manifestPath = manifest) =>
      run(
        powershell,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(windows, "upgrade-files.ps1"),
          "-Mode",
          mode,
          "-Root",
          install,
          "-Manifest",
          manifestPath,
          "-Result",
          result,
          "-MainBinary",
          "locution-pro.exe",
          ...extra,
        ],
        expected,
      );

    const withHeldFile = async (path, image, callback) => {
      const command = image
        ? `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class HeldImage { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadLibraryW(string path); [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr module); }'; $module = [HeldImage]::LoadLibraryW($env:LOCUTION_TEST_LOCK); if ($module -eq [IntPtr]::Zero) { throw 'Cannot load test image' }; [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null; [HeldImage]::FreeLibrary($module) | Out-Null`
        : `$stream = [IO.File]::Open($env:LOCUTION_TEST_LOCK, 'Open', 'Read', 'Read'); [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null; $stream.Dispose()`;
      const holder = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
        windowsHide: true,
        env: { ...process.env, LOCUTION_TEST_LOCK: path },
      });
      const exited = new Promise((done) => holder.once("exit", done));
      try {
        await new Promise((ready, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Test lock did not become ready")),
            10000,
          );
          holder.stdout.once("data", () => {
            clearTimeout(timer);
            ready();
          });
          holder.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          holder.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("Test lock exited before becoming ready"));
          });
        });
        await callback();
      } finally {
        if (holder.exitCode === null) holder.stdin.end("release\n");
        await exited;
      }
    };

    await t.test(
      "update-only validation rejects fresh, corrupt and missing dependencies without mutations",
      () => {
        const install = join(temporary, "update-only");
        const result = join(temporary, "update-only.ini");
        mkdirSync(install);
        const extra = ["-PreviousRoot", install, "-UpdateOnly", "1", "-Transactional", "1"];
        const updateManifest = join(temporary, "update-manifest.json");
        const payloadManifest = JSON.parse(readFileSync(manifest, "utf8"));
        payloadManifest.files.push({
          path: "locution-pro.exe",
          size: 7,
          sha256: createHash("sha256").update("payload").digest("hex"),
          group: "core",
        });
        writeFileSync(updateManifest, JSON.stringify(payloadManifest));
        const updateWorker = (mode, extras = extra, expected = 0) =>
          worker(mode, install, result, extras, expected, updateManifest);
        updateWorker("Prepare", extra, 2);
        assert.deepEqual(readdirSync(install), []);
        writeFileSync(join(install, "locution-pro.exe"), "old executable");
        writeFileSync(join(install, "uninstall.exe"), "old uninstaller");
        const entries = JSON.parse(readFileSync(manifest, "utf8")).files;
        for (const entry of entries) {
          const path = join(install, entry.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, "payload");
        }
        const mandatory = join(install, "transnetv2/model.onnx");
        writeFileSync(mandatory, "damaged");
        updateWorker("Prepare", extra, 2);
        assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old executable");
        assert(!existsSync(`${result}.transaction`));
        writeFileSync(mandatory, "payload");
        rmSync(join(install, "LICENSE"));
        updateWorker("Scan", extra);
        assert(!existsSync(`${result}.transaction`));
        writeFileSync(join(install, "LICENSE"), "payload");
        rmSync(join(install, "semantic-search/model.onnx"));
        updateWorker("Scan", extra, 2);
        updateWorker("Scan", [...extra, "-Semantic", "0"]);
        rmSync(join(install, "ffmpeg.exe"));
        updateWorker("Scan", [...extra, "-Semantic", "0"], 2);
        updateWorker("Scan", [...extra, "-Semantic", "0", "-Ffmpeg", "0"]);
        updateWorker("Prepare", [...extra, "-Semantic", "0", "-Ffmpeg", "0"]);
        assert(!existsSync(join(install, "locution-pro.exe")));
        writeFileSync(join(install, "locution-pro.exe"), "payload");
        updateWorker("Verify", [...extra, "-Semantic", "0", "-Ffmpeg", "0"]);
        writeFileSync(mandatory, "changed after prepare");
        updateWorker("Verify", [...extra, "-Semantic", "0", "-Ffmpeg", "0"], 2);
        writeFileSync(mandatory, "payload");
        worker("Rollback", install, result);
        assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old executable");
        const cancelFile = join(temporary, "cancel-update");
        const cancellable = [...extra, "-Semantic", "0", "-Ffmpeg", "0", "-CancelFile", cancelFile];
        writeFileSync(cancelFile, "cancel");
        updateWorker("Prepare", cancellable, 2);
        assert(
          !existsSync(`${result}.transaction`),
          "Cancellation before Prepare must not modify files",
        );
        rmSync(cancelFile);
        updateWorker("Prepare", cancellable);
        writeFileSync(join(install, "locution-pro.exe"), "payload");
        writeFileSync(cancelFile, "cancel");
        updateWorker("Verify", cancellable, 2);
        updateWorker("Commit", cancellable, 2);
        assert(
          existsSync(`${result}.transaction`),
          "Cancellation must preserve the rollback transaction",
        );
        updateWorker("Rollback", cancellable);
        assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old executable");
        assert(!existsSync(`${result}.transaction`));
      },
    );

    await t.test(
      "locked committed backups warn without blocking later updates or uninstall",
      async () => {
        const install = join(temporary, "deferred-cleanup");
        const result = join(temporary, "deferred-cleanup.ini");
        mkdirSync(install);
        writeFileSync(join(install, "locution-pro.exe"), "old main");
        writeFileSync(join(install, "ffmpeg.exe"), "old ffmpeg");
        worker("Prepare", install, result, ["-PreviousRoot", install, "-Transactional", "1"]);
        const transaction = JSON.parse(
          readFileSync(`${result}.transaction`, "utf8").replace(/^\ufeff/u, ""),
        );
        const held = transaction.backups.find((entry) => entry.path.endsWith("ffmpeg.exe")).backup;
        writeFileSync(join(install, "locution-pro.exe"), "new main");
        await withHeldFile(held, false, () => {
          worker("Commit", install, result, [], 10);
          assert(!existsSync(`${result}.transaction`));
          const receipt = join(install, transaction.directory, "transaction.json");
          assert.equal(
            JSON.parse(readFileSync(receipt, "utf8").replace(/^\ufeff/u, "")).phase,
            "committed",
          );
          worker("CheckBackup", install, result, [
            "-BackupDirectory",
            join(install, transaction.directory),
          ]);
          assert(
            readdirSync(install).some(
              (name) => name.startsWith(".locution-pro-cleanup-") && name.endsWith(".txt"),
            ),
          );
          worker("CheckUninstall", install, result, ["-PreviousRoot", install]);
          worker("Prepare", install, result, ["-PreviousRoot", install, "-Transactional", "1"]);
          worker("Rollback", install, result);
          assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "new main");
        });
      },
    );

    await t.test("an uncommitted backup still blocks a second mutation", () => {
      const install = join(temporary, "pending-backup");
      const result = join(temporary, "pending-backup.ini");
      mkdirSync(install);
      writeFileSync(join(install, "locution-pro.exe"), "old main");
      worker("Prepare", install, result, ["-PreviousRoot", install, "-Transactional", "1"]);
      const state = JSON.parse(
        readFileSync(`${result}.transaction`, "utf8").replace(/^\ufeff/u, ""),
      );
      worker(
        "CheckBackup",
        install,
        result,
        ["-BackupDirectory", join(install, state.directory)],
        2,
      );
      worker(
        "CheckUninstall",
        install,
        join(temporary, "another-plan.ini"),
        ["-PreviousRoot", install],
        2,
      );
      assert(existsSync(`${result}.transaction`));
      worker("Rollback", install, result);
      assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old main");
    });

    await t.test("embedded uninstall can rename an actual loaded thumbnail image", async () => {
      const install = join(temporary, "loaded-image");
      const result = join(temporary, "loaded-image.ini");
      mkdirSync(install);
      const provider = join(install, "locution_pro_thumbnail_provider.dll");
      copyFileSync(join(process.env.SystemRoot, "System32/version.dll"), provider);
      writeFileSync(join(install, "locution-pro.exe"), "old main");
      await withHeldFile(provider, true, () => {
        worker("Uninstall", install, result, ["-PreviousRoot", install, "-Transactional", "1"]);
        assert(!existsSync(provider));
        assert(!existsSync(join(install, "locution-pro.exe")));
        worker("Commit", install, result, [], 10);
        worker("CheckUninstall", install, result, ["-PreviousRoot", install]);
      });
    });

    await t.test("failed installation restores old bytes and removes partial new files", () => {
      const install = join(temporary, "rollback");
      const result = join(temporary, "rollback.ini");
      mkdirSync(install);
      const oldFiles = ["locution-pro.exe", "uninstall.exe", "ffmpeg.exe", "obsolete.dll"];
      for (const name of oldFiles) writeFileSync(join(install, name), `old ${name}`);
      writeFileSync(join(install, "preferences.json"), "user settings");
      worker("Prepare", install, result, ["-PreviousRoot", install, "-Transactional", "1"]);
      assert(!existsSync(join(install, "locution-pro.exe")));
      assert(readdirSync(install).some((name) => name.startsWith(".locution-pro-rollback-")));
      writeFileSync(join(install, "locution-pro.exe"), "partial new executable");
      writeFileSync(join(install, "ffmpeg.exe"), "partial replacement");
      writeFileSync(join(install, "LICENSE"), "new license");
      worker("Rollback", install, result);
      for (const name of oldFiles)
        assert.equal(readFileSync(join(install, name), "utf8"), `old ${name}`);
      assert.equal(readFileSync(join(install, "preferences.json"), "utf8"), "user settings");
      assert(!existsSync(join(install, "LICENSE")));
      assert(!existsSync(`${result}.transaction`));
      assert(!readdirSync(install).some((name) => name.startsWith(".locution-pro-rollback-")));

      worker("Prepare", install, result, ["-PreviousRoot", install, "-Transactional", "1"]);
      writeFileSync(join(install, "locution-pro.exe"), "complete new executable");
      worker("Commit", install, result);
      assert.equal(
        readFileSync(join(install, "locution-pro.exe"), "utf8"),
        "complete new executable",
      );
      assert(!existsSync(`${result}.transaction`));
      assert(!readdirSync(install).some((name) => name.startsWith(".locution-pro-rollback-")));
    });

    await t.test(
      "reserved executable junction and unrelated uninstaller are rejected intact",
      () => {
        const install = join(temporary, "collision");
        const outside = join(temporary, "outside");
        mkdirSync(install);
        mkdirSync(outside);
        writeFileSync(join(outside, "keep.txt"), "foreign");
        symlinkSync(outside, join(install, "uninstall.exe"), "junction");
        worker("Prepare", install, join(temporary, "collision.ini"), [], 2);
        assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "foreign");
        rmSync(join(install, "uninstall.exe"));
        writeFileSync(join(install, "uninstall.exe"), "other application");
        worker("Prepare", install, join(temporary, "collision.ini"), [], 2);
        assert.equal(readFileSync(join(install, "uninstall.exe"), "utf8"), "other application");
      },
    );

    await t.test(
      "root aliases, Windows paths, reserved devices and LineCut descendants fail closed",
      () => {
        for (const path of [
          "relative/app",
          "C:",
          "C:\\",
          process.env.USERPROFILE,
          join(process.env.SystemRoot, "unsafe-app"),
          join(temporary, "NUL.txt", "app"),
          join(temporary, "LPT¹.txt", "app"),
          join(temporary, "ambiguous. ", "app"),
          join(temporary, "LineCut", "app"),
          ...(existsSync("C:\\PROGRA~1") ? ["C:\\PROGRA~1"] : []),
        ])
          worker("Scan", path, join(temporary, "invalid.ini"), [], 2);
      },
    );

    await t.test("unsigned dependency executable is never trusted", () => {
      run(
        powershell,
        ["-NoProfile", "-File", join(windows, "verify-webview2.ps1"), "-Path", payload],
        2,
      );
    });

    await t.test("all install scopes and dependency packaging branches compile", async () => {
      const mainInput = join(temporary, "main-payload.exe");
      const beforeBundling = "MZ __TAURI_BUNDLE_TYPE_VAR_UNK";
      const bundledMain = "MZ __TAURI_BUNDLE_TYPE_VAR_NSS";
      // Reproduce Tauri changing three executable bytes after the hook hashes it.
      writeFileSync(mainInput, bundledMain);
      const compiler =
        process.env.NSIS_MAKENSIS ?? join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
      // A stale debug helper must not mask changes in the release toolchain.
      const support = ["release", "debug"]
        .map((profile) => join(target, profile, "nsis/x64"))
        .find(
          (path) =>
            existsSync(join(path, "utils.nsh")) && existsSync(join(path, "SimpChinese.nsh")),
        );
      assert(
        support,
        "Build the Tauri NSIS bundle once to prepare its utils.nsh and language file",
      );
      const nsis = (value) => value.replaceAll("$", () => "$$").replaceAll('"', '$\\"');
      const template = readFileSync(join(windows, "installer.nsi"), "utf8");
      for (const [scope, mode] of [
        ["currentUser", "downloadBootstrapper"],
        ["perMachine", "embedBootstrapper"],
        ["both", "offlineInstaller"],
      ]) {
        const values = {
          compression: "none",
          manufacturer: "locutionpro",
          product_name: "Locution Pro",
          version: "0.4.2",
          version_with_build: "0.4.2.0",
          install_mode: scope,
          main_binary_name: "locution-pro",
          main_binary_path: nsis(mainInput),
          bundle_id: "com.locutionpro.desktop",
          out_file: nsis(join(temporary, `${scope}.exe`)),
          arch: "x64",
          allow_downgrades: "false",
          additional_plugins_path: nsis(
            join(process.env.LOCALAPPDATA, "tauri/NSIS/Plugins/x86-unicode/additional"),
          ),
          installer_hooks: nsis(join(windows, "ffmpeg-options.nsh")),
          install_webview2_mode: mode,
          minimum_webview2_version: "100.0.0.0",
          webview2_bootstrapper_path: nsis(payload),
          webview2_installer_path: nsis(payload),
          estimated_size: "1",
          start_menu_folder: "Locution Pro",
        };
        let script = template.replace(
          /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gu,
          (_, key, body) => (values[key] ? body : ""),
        );
        script = script.replace(
          /\{\{#each file_associations[^}]*\}\}([\s\S]*?)\{\{\/each\}\}\s*\{\{\/each\}\}/gu,
          (_, body) =>
            body
              .replace(/\{\{#each association.ext[^}]*\}\}/u, "")
              .replaceAll("{{ext}}", "lcp")
              .replaceAll("{{or association.name ext}}", "LocutionPro.Project")
              .replaceAll(
                "{{association-description association.description ext}}",
                "Locution Pro Project",
              ),
        );
        const loops = {
          languages: ["SimpChinese"],
          language_files: [nsis(join(support, "SimpChinese.nsh"))],
          resources: [
            "LICENSE",
            "locution_pro_thumbnail_provider.dll",
            "transnetv2\\model.onnx",
            "transnetv2\\README.md",
            "semantic-search\\model.onnx",
          ],
          resources_dirs: ["transnetv2", "semantic-search"],
          resources_ancestors: [],
          binaries: ["ffmpeg.exe", "ffprobe.exe"],
          deep_link_protocols: ["locutionpro"],
        };
        script = script.replace(
          /\{\{#each (\w+)[^}]*\}\}([\s\S]*?)\{\{\/each\}\}/gu,
          (_, key, body) =>
            loops[key]
              .map((value) =>
                body
                  .replaceAll("{{this}}", value)
                  .replaceAll("{{protocol}}", value)
                  .replaceAll("{{this.[1]}}", value)
                  .replaceAll("{{no-escape @key}}", nsis(payload)),
              )
              .join("\n"),
        );
        script = script
          .replace(/\{\{(\w+)\}\}/gu, (_, key) => values[key] ?? "")
          .replace('!include "utils.nsh"', `!include "${nsis(join(support, "utils.nsh"))}"`);
        assert(!script.includes("{{"));
        const file = join(temporary, `${scope}.nsi`);
        writeFileSync(file, `!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"\n${script}`);
        run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", file]);
        writeFileSync(
          file,
          `!define LOCUTION_UPDATE_ONLY\n!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"\n${script}`,
        );
        // Cached handoffs are only supported without an elevation boundary.
        run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", file], scope === "currentUser" ? 0 : 1);
        if (scope === "currentUser") {
          // Execute the complete production template using only mock payloads,
          // isolated registry keys, private data roots and suppressed shortcuts.
          const registry = `Software\\LocutionProInstallerSafetyTests\\${randomUUID()}`;
          t.after(() => {
            assert(/^Software\\LocutionProInstallerSafetyTests\\[a-f0-9-]+$/u.test(registry));
            spawnSync("reg.exe", ["delete", `HKCU\\${registry}`, "/f"], { windowsHide: true });
          });
          const independent = join(temporary, "isolated-independent.nsh");
          copyFileSync(join(windows, "update-result.nsh"), join(temporary, "update-result.nsh"));
          writeFileSync(
            independent,
            readFileSync(join(windows, "independent-install.nsh"), "utf8")
              .replaceAll("Software\\Classes\\", `${registry}\\Classes\\`)
              .replaceAll(
                "Global\\LocutionProInstaller",
                `Local\\LocutionProInstallerTest-${registry.split("\\").at(-1)}`,
              ),
          );
          let isolated = script
            .replace(
              /ReadRegStr \$4 (HKLM|HKCU) "[^"]+" "pv"/gu,
              (_, hive) => `ReadRegStr $4 HKCU "${registry}\\WebView${hive}" "pv"`,
            )
            .replace(/!define UNINSTKEY "[^"\n]+"/u, `!define UNINSTKEY "${registry}\\Uninstall"`)
            .replace(
              /!define MANUPRODUCTKEY "[^"\n]+"/u,
              `!define MANUPRODUCTKEY "${registry}\\Product"`,
            )
            .replace(/!define MANUKEY "[^"\n]+"/u, `!define MANUKEY "${registry}\\Manufacturer"`)
            .replaceAll("Software\\Classes\\", `${registry}\\Classes\\`)
            .replace(
              '!include "${LOCUTION_INSTALLER_SOURCE_DIR}\\independent-install.nsh"',
              `!include "${nsis(independent)}"`,
            )
            .replace(
              '!define MAINBINARYNAME "locution-pro"',
              '!define MAINBINARYNAME "locution-installer-safety-fixture"',
            )
            .replace(
              '!define INSTALLWEBVIEW2MODE "downloadBootstrapper"',
              '!define INSTALLWEBVIEW2MODE "skip"',
            )
            .replace(
              '!define MINIMUMWEBVIEW2VERSION "100.0.0.0"',
              '!define MINIMUMWEBVIEW2VERSION ""',
            );
          const executable = join(temporary, "isolated.exe");
          const trace = join(temporary, "trace.txt");
          const checkpoint = (message) =>
            `Push $9\nFileOpen $9 "${nsis(trace)}" a\nFileSeek $9 0 END\nFileWriteUTF16LE $9 "${message}$\\r$\\n"\nFileClose $9\nPop $9\n`;
          const migrationSource = join(temporary, "isolated-migration.nsh");
          writeFileSync(
            migrationSource,
            readFileSync(join(windows, "migration-page.nsh"), "utf8")
              .replaceAll(
                /Abort "([^"\r\n]+)"/gu,
                (source, message) => `${checkpoint(`abort: ${message}`)}${source}`,
              )
              .replace(
                "Function PrepareMigrationInstall",
                `Function PrepareMigrationInstall\n${checkpoint("roots: $MigrationDataRoot | $MigrationLegacyRoot")}`,
              ),
          );
          isolated = isolated.replace(
            '!include "${LOCUTION_INSTALLER_SOURCE_DIR}\\migration-page.nsh"',
            `!include "${nsis(migrationSource)}"`,
          );
          for (const operation of [
            "!insertmacro LOCUTION_INSTALLER_MUTEX",
            "Call CaptureMigrationEligibility",
            "Call RecordPendingMigration",
            "Call EnsureIndependentInstallLocation",
            "Call PrepareMigrationInstall",
            "Call LocutionProPlanUpgrade",
            "!insertmacro NSIS_HOOK_PREINSTALL",
            "Call LocutionProCommitInstall",
          ])
            isolated = isolated.replaceAll(
              operation,
              `${checkpoint(`before ${operation}`)}${operation}\n${checkpoint(`after ${operation}`)}`,
            );
          isolated = isolated.replace(/OutFile "[^"\n]+"/u, `OutFile "${nsis(executable)}"`);
          const build = (manifestPath, failRegistration = false, updateOnly = false) => {
            // Heavy dependency sources are absent from an update package, while
            // the application DLL, licenses and metadata must remain embedded.
            const source = updateOnly
              ? isolated
                  .replace(
                    ' -Data "$LocutionProUpdateHandoff"',
                    ' -Headless -Data "$LocutionProUpdateHandoff"',
                  )
                  .replace(
                    /(!insertmacro LOCUTION_INSTALL_FILE )"[^"]+"/gu,
                    (source, prefix, offset, text) =>
                      /"(?:ffmpeg\.exe|ffprobe\.exe|[^"\n]+\.onnx)"/u.test(
                        text.slice(offset + source.length).split("\n", 1)[0],
                      )
                        ? `${prefix}"${nsis(join(temporary, "dependency-not-in-update.exe"))}"`
                        : source,
                  )
                  .replace(
                    '!define MINIMUMWEBVIEW2VERSION ""',
                    '!define MINIMUMWEBVIEW2VERSION "100.0.0.0"',
                  )
              : isolated;
            const fault = failRegistration
              ? `!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "\${MANUPRODUCTKEY}" "UnexpectedNewValue" "must disappear"
  WriteRegStr SHCTX "\${UNINSTKEY}\\UnexpectedChild" "value" "must disappear"
  Abort "Injected failure after registration"
!macroend
`
              : "";
            writeFileSync(
              file,
              `${updateOnly ? "!define LOCUTION_UPDATE_ONLY\n" : ""}!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifestPath)}"\n!define LOCUTION_MIGRATION_LOCAL_ROOT "${nsis(join(temporary, "local"))}"\n!define LOCUTION_MIGRATION_ROAMING_ROOT "${nsis(join(temporary, "roaming"))}"\n${fault}${source}`,
            );
            run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", file]);
          };
          const fullManifest = join(temporary, "full-template-manifest.json");
          const fullPayload = JSON.parse(readFileSync(manifest, "utf8"));
          fullPayload.files.push({
            path: "locution-installer-safety-fixture.exe",
            size: Buffer.byteLength(beforeBundling),
            sha256: createHash("sha256").update(beforeBundling).digest("hex"),
            group: "core",
          });
          writeFileSync(fullManifest, JSON.stringify(fullPayload));
          const install = join(temporary, "full installer 测试");
          const options = {
            trace,
            windowsVerbatimArguments: true,
            argv0: `"${executable}"`,
            env: {
              ...process.env,
              LOCUTION_PRO_DATA_DIR: join(temporary, "fixture-data"),
              LINECUT_DATA_DIR: join(temporary, "fixture-legacy"),
            },
          };
          const main = join(install, "locution-installer-safety-fixture.exe");
          const freshBefore = snapshotRegistration(
            join(temporary, "fresh-registration-before.json"),
          );
          build(fullManifest, true);
          run(executable, ["/S", "/NS", `/D=${install}`], 2, options);
          const freshAfter = snapshotRegistration(join(temporary, "fresh-registration-after.json"));
          assert.deepEqual(
            freshAfter,
            freshBefore,
            "Failed fresh install removes newly created registration keys",
          );
          assert(!existsSync(main));
          assert(!existsSync(join(install, "uninstall.exe")));
          build(fullManifest);
          run(executable, ["/S", "/NS", `/D=${install}`], 0, options);
          assert.equal(readFileSync(main, "utf8"), bundledMain);
          const uninstaller = readFileSync(join(install, "uninstall.exe"));
          writeFileSync(main, "previous working executable");
          const incomplete = join(temporary, "incomplete-manifest.json");
          const missing = JSON.parse(readFileSync(manifest, "utf8"));
          missing.files = missing.files.filter((entry) => entry.path !== "LICENSE");
          writeFileSync(incomplete, JSON.stringify(missing));
          build(incomplete);
          run(executable, ["/S", "/NS", `/D=${install}`], 2, options);
          assert.equal(readFileSync(main, "utf8"), "previous working executable");
          assert.deepEqual(readFileSync(join(install, "uninstall.exe")), uninstaller);
          assert(!readdirSync(install).some((name) => name.startsWith(".locution-pro-rollback-")));

          const registryOptions = {
            env: {
              ...process.env,
              LOCUTION_TEST_REGISTRY: registry,
              LOCUTION_TEST_INSTALL: install,
            },
          };
          const seed = join(temporary, "seed-registration.ps1");
          writeFileSync(
            seed,
            `$ErrorActionPreference = 'Stop'
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')
$product = $base.CreateSubKey($env:LOCUTION_TEST_REGISTRY + '\\Product')
$product.SetValue('BundleFfmpeg', 0, 'DWord')
$product.SetValue('FfmpegPath', 'C:\\old tools\\ffmpeg.exe', 'String')
$product.SetValue('FfprobePath', 'C:\\old tools\\ffprobe.exe', 'String')
$product.SetValue('LargeInteger', [long]::Parse('9223372036854775806'), 'QWord')
$product.SetValue('Binary', [byte[]]@(0, 1, 128, 255), 'Binary')
$product.SetValue('EmptyBinary', [byte[]]@(), 'Binary')
$product.SetValue('Names', [string[]]@('alpha', 'beta'), 'MultiString')
$product.SetValue('Unexpanded', '%SystemRoot%\\tools', 'ExpandString')
$child = $product.CreateSubKey('CustomState'); $child.SetValue('', 'default value'); $child.Dispose()
$product.Dispose()
$arp = $base.CreateSubKey($env:LOCUTION_TEST_REGISTRY + '\\Uninstall')
foreach ($name in @('DisplayName', 'DisplayIcon', 'Publisher', 'MainBinaryName', 'MUI_InstallMode', 'HelpLink')) { $arp.SetValue($name, 'old ' + $name) }
$arp.SetValue('EstimatedSize', 123, 'DWord')
$arp.Dispose(); $base.Dispose()
`,
          );
          run(powershell, ["-NoProfile", "-File", seed], 0, registryOptions);
          function snapshotRegistration(output) {
            run(powershell, [
              "-NoProfile",
              "-File",
              join(windows, "registration-state.ps1"),
              "-Mode",
              "Snapshot",
              "-Hive",
              "CurrentUser",
              "-View",
              "Registry64",
              "-ProductKey",
              `${registry}\\Product`,
              "-UninstallKey",
              `${registry}\\Uninstall`,
              "-Snapshot",
              output,
            ]);
            return JSON.parse(readFileSync(output, "utf8").replace(/^\ufeff/u, ""));
          }
          const before = snapshotRegistration(join(temporary, "registration-before.json"));
          build(fullManifest, true);
          run(executable, ["/S", "/NS", `/D=${install}`], 2, options);
          const after = snapshotRegistration(join(temporary, "registration-after.json"));
          assert.deepEqual(
            after,
            before,
            "Restore every value, type and child in both registration keys",
          );
          assert.equal(readFileSync(main, "utf8"), "previous working executable");
          assert.deepEqual(readFileSync(join(install, "uninstall.exe")), uninstaller);
          const updateManifest = join(temporary, "update-template-manifest.json");
          const updatePayload = JSON.parse(readFileSync(manifest, "utf8"));
          updatePayload.files.push({
            path: "locution-installer-safety-fixture.exe",
            size: Buffer.byteLength(beforeBundling),
            sha256: createHash("sha256").update(beforeBundling).digest("hex"),
            group: "core",
          });
          writeFileSync(updateManifest, JSON.stringify(updatePayload));
          const thumbnail = join(install, "locution_pro_thumbnail_provider.dll");
          const metadata = join(install, "transnetv2/README.md");
          writeFileSync(thumbnail, "old thumbnail DLL 0.4.1");
          writeFileSync(metadata, "old metadata 0.4.1");
          build(updateManifest, false, true);
          const setVersion = (version) =>
            run("reg.exe", [
              "add",
              `HKCU\\${registry}\\Uninstall`,
              "/v",
              "DisplayVersion",
              "/d",
              version,
              "/f",
              "/reg:64",
            ]);
          setVersion("0.4.1");
          const dependency = join(install, "transnetv2/model.onnx");
          run(executable, ["/S", "/UPDATE", "/CHECKUPDATE", `/D=${install}`], 2, options);
          const setWebViewVersion = (version) =>
            run("reg.exe", [
              "add",
              `HKCU\\${registry}\\WebViewHKCU`,
              "/v",
              "pv",
              "/d",
              version,
              "/f",
              "/reg:64",
            ]);
          setWebViewVersion("99.0.0.0");
          run(executable, ["/S", "/UPDATE", "/CHECKUPDATE", `/D=${install}`], 2, options);
          setWebViewVersion("100.0.0.0");
          writeFileSync(dependency, "corrupt dependency");
          const rejectedBefore = snapshotRegistration(
            join(temporary, "update-rejected-before.json"),
          );
          run(executable, ["/S", "/UPDATE", `/D=${install}`], 2, options);
          assert.equal(readFileSync(main, "utf8"), "previous working executable");
          assert.deepEqual(
            snapshotRegistration(join(temporary, "update-rejected-after.json")),
            rejectedBefore,
          );
          writeFileSync(dependency, "payload");
          run(executable, ["/S", "/UPDATE", "/CHECKUPDATE", `/D=${install}`], 0, options);
          assert.equal(readFileSync(main, "utf8"), "previous working executable");
          for (const version of ["0.4.2", "0.4.3"]) {
            setVersion(version);
            run(executable, ["/S", "/UPDATE", `/D=${install}`], 2, options);
          }
          setVersion("0.4.1");
          const fresh = join(temporary, "fresh update target");
          run(executable, ["/S", "/UPDATE", `/D=${fresh}`], 2, options);
          assert(!existsSync(fresh));
          const otherMain = join(temporary, "other-instance/locution-installer-safety-fixture.exe");
          mkdirSync(dirname(otherMain));
          copyFileSync(process.execPath, otherMain);
          const other = spawn(
            otherMain,
            ["-e", "process.stdout.write('ready'); process.stdin.resume()"],
            { windowsHide: true },
          );
          const otherExit = new Promise((resolve) => other.once("exit", resolve));
          try {
            await new Promise((resolve, reject) => {
              other.stdout.once("data", resolve);
              other.once("error", reject);
            });
            run(executable, ["/S", "/UPDATE", `/D=${install}`], 2, options);
            assert.equal(
              other.exitCode,
              null,
              "Update must not kill another application's workspace",
            );
            assert.equal(readFileSync(main, "utf8"), "previous working executable");
          } finally {
            other.stdin.end();
            await otherExit;
          }
          build(updateManifest, true, true);
          const failedUpdateBefore = snapshotRegistration(
            join(temporary, "failed-core-update-before.json"),
          );
          run(executable, ["/S", "/UPDATE", `/D=${install}`], 2, options);
          assert.equal(readFileSync(main, "utf8"), "previous working executable");
          assert.equal(readFileSync(thumbnail, "utf8"), "old thumbnail DLL 0.4.1");
          assert.equal(readFileSync(metadata, "utf8"), "old metadata 0.4.1");
          assert.deepEqual(
            snapshotRegistration(join(temporary, "failed-core-update-after.json")),
            failedUpdateBefore,
          );
          build(updateManifest, false, true);
          run(executable, ["/S", "/UPDATE", `/D=${install}`], 0, options);
          assert.equal(readFileSync(main, "utf8"), bundledMain);
          assert.equal(readFileSync(dependency, "utf8"), "payload");
          assert.equal(readFileSync(thumbnail, "utf8"), "payload");
          assert.equal(readFileSync(metadata, "utf8"), "payload");
          // Run the real bootstrap, including quoted handoff arguments, the
          // embedded controller, worker mutex and failure/restart protocol.
          const { application } = prepareControllerFixture();
          copyFileSync(application, main);
          const bootstrap = join(temporary, "bootstrap handoff");
          mkdirSync(bootstrap);
          const restarted = join(bootstrap, "restart-args");
          const parentReady = join(bootstrap, "parent-ready");
          const bootstrapEnv = {
            ...options.env,
            LOCUTION_PARENT_READY: parentReady,
            LOCUTION_RESTART_ARGS: restarted,
          };
          const parent = spawn(main, ["--parent"], { windowsHide: true, env: bootstrapEnv });
          const parentExit = new Promise((resolve) => parent.once("exit", resolve));
          try {
            const deadline = Date.now() + 10000;
            while (!existsSync(parentReady)) {
              assert(Date.now() < deadline, "Bootstrap parent did not start");
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
            const handoff = join(bootstrap, "handoff.json");
            writeFileSync(
              handoff,
              JSON.stringify({
                parent: parent.pid,
                executable: main,
                installer: executable,
                version: "0.4.2",
                signature: createHash("sha256").update(readFileSync(executable)).digest("hex"),
                project: "C:\\saved project.lcp",
              }),
            );
            run(executable, ["/UPDATE", `/HANDOFF="${handoff}"`, `/D=${install}`], 2, {
              ...options,
              env: bootstrapEnv,
            });
            const report = JSON.parse(
              readFileSync(join(bootstrap, "result.json"), "utf8").replace(/^\ufeff/u, ""),
            );
            assert.equal(report.status, "failed");
            assert.match(report.error, /newer than the installed version/u);
            await Promise.race([
              parentExit,
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(`The package did not stop its parent: ${JSON.stringify(report)}`),
                    ),
                  5000,
                ),
              ),
            ]);
            const restartDeadline = Date.now() + 10000;
            while (!existsSync(restarted) || !readFileSync(restarted, "utf8")) {
              assert(
                Date.now() < restartDeadline,
                "The package bootstrap did not restart the application",
              );
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
            assert.match(readFileSync(restarted, "utf8"), /--update-error=/u);
          } finally {
            if (parent.exitCode === null) {
              parent.kill();
              await parentExit;
            }
          }
        }
      }
    });
  },
);
