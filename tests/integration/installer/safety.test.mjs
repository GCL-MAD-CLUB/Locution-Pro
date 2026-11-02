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
  { timeout: 300000 },
  async (t) => {
    assert.equal(process.platform, "win32");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const target = join(root, "src-tauri/target");
    mkdirSync(target, { recursive: true });
    const temporary = mkdtempSync(join(target, "installer-safety-"));
    t.after(() => {
      const within = relative(target, resolve(temporary));
      assert(within && !within.startsWith("..") && !isAbsolute(within));
      rmSync(temporary, { recursive: true, force: true });
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
    const manifest = join(temporary, "manifest.json");
    const payload = join(temporary, "payload.txt");
    writeFileSync(payload, "payload");
    writeFileSync(
      manifest,
      JSON.stringify({
        version: 1,
        files: ["LICENSE", "ffmpeg.exe", "ffprobe.exe", "semantic-search/model.onnx"].map(
          (path) => ({
            path: path.replaceAll("/", "\\"),
            size: 7,
            sha256: createHash("sha256").update("payload").digest("hex"),
            group: path.startsWith("ff")
              ? "ffmpeg"
              : path.includes("/")
                ? "semantic-search"
                : "core",
          }),
        ),
      }),
    );
    const worker = (mode, install, result, extra = [], expected = 0) =>
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
          manifest,
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

    await t.test("all install scopes and dependency packaging branches compile", () => {
      const compiler =
        process.env.NSIS_MAKENSIS ?? join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
      const support = ["debug", "release"]
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
          version: "1.0.0",
          version_with_build: "1.0.0.0",
          install_mode: scope,
          main_binary_name: "locution-pro",
          main_binary_path: nsis(payload),
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
          resources: ["LICENSE"],
          resources_dirs: [],
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
        if (scope === "currentUser") {
          // Execute the complete production template using only mock payloads,
          // isolated registry keys, private data roots and suppressed shortcuts.
          const registry = `Software\\LocutionProInstallerSafetyTests\\${randomUUID()}`;
          t.after(() => {
            assert(/^Software\\LocutionProInstallerSafetyTests\\[a-f0-9-]+$/u.test(registry));
            spawnSync("reg.exe", ["delete", `HKCU\\${registry}`, "/f"], { windowsHide: true });
          });
          const independent = join(temporary, "isolated-independent.nsh");
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
          const build = (manifestPath, failRegistration = false) => {
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
              `!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifestPath)}"\n!define LOCUTION_MIGRATION_LOCAL_ROOT "${nsis(join(temporary, "local"))}"\n!define LOCUTION_MIGRATION_ROAMING_ROOT "${nsis(join(temporary, "roaming"))}"\n${fault}${isolated}`,
            );
            run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", file]);
          };
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
          build(manifest, true);
          run(executable, ["/S", "/NS", `/D=${install}`], 2, options);
          const freshAfter = snapshotRegistration(join(temporary, "fresh-registration-after.json"));
          assert.deepEqual(
            freshAfter,
            freshBefore,
            "Failed fresh install removes newly created registration keys",
          );
          assert(!existsSync(main));
          assert(!existsSync(join(install, "uninstall.exe")));
          build(manifest);
          run(executable, ["/S", "/NS", `/D=${install}`], 0, options);
          assert.equal(readFileSync(main, "utf8"), "payload");
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
          build(manifest, true);
          run(executable, ["/S", "/NS", `/D=${install}`], 2, options);
          const after = snapshotRegistration(join(temporary, "registration-after.json"));
          assert.deepEqual(
            after,
            before,
            "Restore every value, type and child in both registration keys",
          );
          assert.equal(readFileSync(main, "utf8"), "previous working executable");
          assert.deepEqual(readFileSync(join(install, "uninstall.exe")), uninstaller);
        }
      }
    });
  },
);
