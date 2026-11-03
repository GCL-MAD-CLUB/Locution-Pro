// Compile and run only the real resource-copy blocks in an isolated, silent fixture.
// This does not install Locution Pro or write its registry entries or shortcuts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "node:test";

test("NSIS installer components", { timeout: 300000 }, async (t) => {
  assert.equal(process.platform, "win32", "The NSIS component test requires Windows");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const target = join(root, "src-tauri", "target");
  mkdirSync(target, { recursive: true });
  const temporary = mkdtempSync(join(target, "installer-components-"));
  t.after(() => {
    const withinTarget = relative(target, resolve(temporary));
    assert(withinTarget && !withinTarget.startsWith("..") && !isAbsolute(withinTarget));
    rmSync(temporary, { recursive: true, force: true });
  });
  const template = readFileSync(join(root, "src-tauri/windows/installer.nsi"), "utf8");
  const compiler =
    process.env.NSIS_MAKENSIS ?? join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
  const run = (program, args) => {
    const result = spawnSync(program, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      ...(program.endsWith("components.exe") || program.endsWith("reuse-pages.exe")
        ? { windowsVerbatimArguments: true, argv0: `"${program}"` }
        : {}),
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${program} failed:\n${result.stdout}\n${result.stderr}`);
  };
  const nsis = (value) => value.replaceAll("$", () => "$$").replaceAll('"', '$\\"');
  const resourceNames = [
    "LICENSE",
    "locution_pro_thumbnail_provider.dll",
    "transnetv2\\onnxruntime.dll",
    "semantic-search\\model_quantized.onnx",
    "semantic-search\\model_quantized.onnx_data",
    "semantic-search\\tokenizer.json",
    "semantic-search\\nested\\notice.txt",
    "storyboard-semantic\\model.onnx",
    "storyboard-semantic\\onnxruntime.dll",
  ];
  const binaries = ["ffmpeg.exe", "ffprobe.exe"];

  const fixture = join(temporary, "payload.txt");
  writeFileSync(fixture, "component-test-payload");
  const manifest = join(temporary, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      files: [...resourceNames, ...binaries].map((path) => ({
        path,
        size: 22,
        sha256: createHash("sha256").update("component-test-payload").digest("hex"),
        group: path.includes("\\")
          ? path.split("\\")[0]
          : binaries.includes(path)
            ? "ffmpeg"
            : "core",
      })),
    }),
  );
  const renderLoop = (source, name, values, render) =>
    source.replace(
      new RegExp(`\\{\\{#each ${name}\\}\\}([\\s\\S]*?)\\{\\{/each\\}\\}`, "u"),
      (_, body) => values.map((value) => render(body, value)).join("\n"),
    );
  let copyBlock = template.slice(
    template.indexOf("  ; Copy resources"),
    template.indexOf("  ; Publish the executable"),
  );
  copyBlock = renderLoop(
    copyBlock,
    "resources_dirs",
    ["", "transnetv2", "semantic-search", "semantic-search\\nested", "storyboard-semantic"],
    (body, value) => body.replaceAll("{{this}}", value),
  );
  copyBlock = renderLoop(copyBlock, "resources", resourceNames, (body, value) =>
    body.replaceAll("{{this.[1]}}", value).replaceAll("{{no-escape @key}}", nsis(fixture)),
  );
  copyBlock = renderLoop(copyBlock, "binaries", binaries, (body, value) =>
    body.replaceAll("{{this}}", value).replaceAll("{{no-escape @key}}", nsis(fixture)),
  );
  assert(!copyBlock.includes("{{"), "All resource template values must be rendered");
  const executable = join(temporary, "components.exe");
  const script = join(temporary, "components.nsi");
  writeFileSync(
    script,
    `Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!define MAINBINARYNAME "locution-pro"
!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"
Var PreviousInstallDir
Var PassiveMode
!include "${nsis(join(root, "src-tauri/windows/ffmpeg-options.nsh"))}"
!include "${nsis(join(root, "src-tauri/windows/upgrade-files.nsh"))}"
!include "${nsis(join(root, "src-tauri/windows/independent-install.nsh"))}"
Name "Locution Pro component test"
OutFile "${nsis(executable)}"
RequestExecutionLevel user
SilentInstall silent
Function SkipIfPassive
  Abort
FunctionEnd
Function .onInit
  ${template.match(/StrCpy \$LocutionProBundleSemantic 1/u)[0]}
  StrCpy $LocutionProBundleFfmpeg 1
  \${GetOptions} $CMDLINE "/PREVIOUS=" $PreviousInstallDir
  \${GetOptions} $CMDLINE "/SEMANTIC=" $0
  \${IfNot} \${Errors}
    StrCpy $LocutionProBundleSemantic $0
  \${EndIf}
  \${GetOptions} $CMDLINE "/FFMPEG=" $0
  \${IfNot} \${Errors}
    StrCpy $LocutionProBundleFfmpeg $0
  \${EndIf}
FunctionEnd
Section
  StrCpy $LocutionProUpgradeMode "Prepare"
  Call LocutionProPlanUpgrade
  SetOutPath $INSTDIR
${copyBlock}
SectionEnd
`,
    "utf8",
  );
  run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", script]);
  const cases = [
    { name: "default", semantic: true, ffmpeg: true, args: [] },
    { name: "without-semantic", semantic: false, ffmpeg: true, args: ["/SEMANTIC=0"] },
    { name: "remove-old-model", semantic: false, ffmpeg: true, args: ["/SEMANTIC=0"], old: true },
    { name: "without-ffmpeg", semantic: true, ffmpeg: false, args: ["/FFMPEG=0"] },
    { name: "reuse old files", semantic: true, ffmpeg: true, args: [], reuse: true },
    { name: "repair", semantic: true, ffmpeg: true, args: [], corrupt: true },
    { name: "remove-old-ffmpeg", semantic: true, ffmpeg: false, args: ["/FFMPEG=0"], reuse: true },
    { name: "relocate", semantic: true, ffmpeg: true, args: [], reuse: true, relocate: true },
    { name: "fresh-existing-directory", semantic: true, ffmpeg: true, args: [], foreign: true },
    {
      name: "fresh-without-semantic",
      semantic: false,
      ffmpeg: true,
      args: ["/SEMANTIC=0"],
      foreign: true,
    },
    {
      name: "relocate-existing-directory",
      semantic: true,
      ffmpeg: true,
      args: [],
      reuse: true,
      relocate: true,
      foreign: true,
    },
  ];
  const foreignFiles = [
    "foreign.dll",
    "other.exe",
    "foreign-uninstaller.exe",
    "licenses/foreign.txt",
    "transnetv2/foreign.bin",
    "semantic-search/unrelated.bin",
    "storyboard-semantic/unrelated.bin",
    "cache/user.bin",
    "preferences.json",
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const install = join(temporary, entry.name);
      const old = entry.relocate ? join(temporary, `${entry.name}-previous-location`) : install;
      const oldTimestamp = new Date("2020-01-01T00:00:00Z");
      if (entry.reuse || entry.corrupt) {
        for (const name of [...resourceNames, ...binaries]) {
          const file = join(old, name);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, entry.corrupt ? "component-test-payloae" : "component-test-payload");
          utimesSync(file, oldTimestamp, oldTimestamp);
        }
        writeFileSync(join(old, "locution-pro.exe"), "old core");
        writeFileSync(join(old, "uninstall.exe"), "must not execute");
        writeFileSync(join(old, "obsolete.dll"), "old root DLL");
        writeFileSync(join(old, "transnetv2/obsolete.dll"), "old runtime");
        mkdirSync(join(old, "cache"), { recursive: true });
        writeFileSync(join(old, "cache/user-data.bin"), "keep user data");
        writeFileSync(join(old, "preferences.json"), "keep settings");
      }
      if (entry.old) {
        mkdirSync(join(install, "semantic-search"), { recursive: true });
        writeFileSync(join(install, "semantic-search/stale-model.bin"), "old-model");
      }
      if (entry.foreign) {
        for (const name of foreignFiles) {
          const file = join(install, name);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, `unrelated: ${name}`);
        }
      }
      run(executable, [
        "/S",
        ...entry.args,
        ...(entry.relocate || entry.old || entry.reuse || entry.corrupt
          ? [`/PREVIOUS=${old}`]
          : []),
        `/D=${install}`,
      ]);
      for (const name of resourceNames) {
        assert.equal(
          existsSync(join(install, name)),
          /^(semantic-search|storyboard-semantic)\\/u.test(name) ? entry.semantic : true,
          `${entry.name}: ${name}`,
        );
      }
      assert.equal(
        existsSync(join(install, "semantic-search")),
        entry.semantic || Boolean(entry.foreign),
        entry.name,
      );
      for (const name of binaries) {
        assert.equal(existsSync(join(install, name)), entry.ffmpeg, `${entry.name}: ${name}`);
      }
      assert(!existsSync(join(install, "semantic-search/stale-model.bin")), "Old models removed");
      if (entry.reuse || entry.corrupt) {
        for (const name of [...resourceNames, ...(entry.ffmpeg ? binaries : [])]) {
          assert.equal(readFileSync(join(install, name), "utf8"), "component-test-payload");
          assert.equal(
            statSync(join(install, name)).mtimeMs === oldTimestamp.getTime(),
            Boolean(entry.reuse),
            name,
          );
        }
        for (const name of [
          "locution-pro.exe",
          "uninstall.exe",
          "obsolete.dll",
          "transnetv2/obsolete.dll",
        ]) {
          assert(!existsSync(join(old, name)), `${name} removed without launching uninstaller`);
        }
        assert.equal(readFileSync(join(old, "cache/user-data.bin"), "utf8"), "keep user data");
        assert.equal(readFileSync(join(old, "preferences.json"), "utf8"), "keep settings");
      }
      if (entry.foreign) {
        for (const name of foreignFiles) {
          assert.equal(readFileSync(join(install, name), "utf8"), `unrelated: ${name}`, name);
        }
      }
    });
  }

  const powershell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const helper = (mode, install, result, expected = 0, extra = []) => {
    const processResult = spawnSync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "src-tauri/windows/upgrade-files.ps1"),
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
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    assert.ifError(processResult.error);
    assert.equal(
      processResult.status,
      expected,
      `${processResult.stdout}\n${processResult.stderr}`,
    );
    return processResult;
  };
  const planPath = join(temporary, "scan.ini");
  const reuseInstall = join(temporary, "reuse old files");
  await t.test("verified components remain configurable in the real option pages", () => {
    const pageExecutable = join(temporary, "reuse-pages.exe");
    const pageScript = join(temporary, "reuse-pages.nsi");
    const result = join(temporary, "skipped-pages.ini");
    for (const name of ["ffmpeg-options.nsh", "semantic-options.nsh"]) {
      writeFileSync(
        join(temporary, name),
        readFileSync(join(root, "src-tauri/windows", name), "utf8")
          .replace(
            '!define LOCUTION_INSTALLER_SOURCE_DIR "${__FILEDIR__}"',
            `!define LOCUTION_INSTALLER_SOURCE_DIR "${nsis(join(root, "src-tauri/windows"))}"`,
          )
          .replace(
            "  nsDialogs::Show",
            "  ${NSD_CreateTimer} SelectComponents 100\n  nsDialogs::Show",
          ),
      );
    }
    writeFileSync(
      pageScript,
      `Unicode true
!include MUI2.nsh
!include FileFunc.nsh
!define MAINBINARYNAME "locution-pro"
!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"
Var PreviousInstallDir
Var PassiveMode
Var TestPage
!include "${nsis(join(temporary, "ffmpeg-options.nsh"))}"
!include "${nsis(join(root, "src-tauri/windows/upgrade-files.nsh"))}"
!include "${nsis(join(root, "src-tauri/windows/independent-install.nsh"))}"
Name "Reuse page fixture"
OutFile "${nsis(pageExecutable)}"
RequestExecutionLevel user
Page custom LocutionProScanPageCreate LocutionProScanPageLeave
Page custom TestFfmpeg LocutionProFfmpegPageLeave
Page custom TestSemantic LocutionProSemanticPageLeave
Page custom Finished
!insertmacro MUI_LANGUAGE "English"
${template.match(/Function SkipIfPassive\r?\n[\s\S]*?FunctionEnd/u)[0]}
Function .onInit
  StrCpy $LocutionProBundleFfmpeg 0
  StrCpy $LocutionProBundleSemantic 0
  StrCpy $LocutionProScanComplete 0
  \${GetOptions} $CMDLINE "/P" $0
  \${IfNot} \${Errors}
    StrCpy $PassiveMode 1
  \${EndIf}
FunctionEnd
Function TestFfmpeg
  StrCpy $TestPage "ffmpeg"
  Call LocutionProFfmpegPageCreate
FunctionEnd
Function TestSemantic
  StrCpy $TestPage "semantic"
  Call LocutionProSemanticPageCreate
FunctionEnd
Function SelectComponents
  \${NSD_KillTimer} SelectComponents
  \${If} $TestPage == "ffmpeg"
    WriteINIStr "${nsis(result)}" "Shown" "Ffmpeg" "1"
    SendMessage $LocutionProBundledRadio \${BM_CLICK} 0 0
  \${Else}
    WriteINIStr "${nsis(result)}" "Shown" "Semantic" "1"
    \${NSD_Uncheck} $LocutionProSemanticCheckbox
  \${EndIf}
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i \${WM_COMMAND}, p1, p0)'
FunctionEnd
Function Finished
  WriteINIStr "${nsis(result)}" "Choice" "Ffmpeg" "$LocutionProBundleFfmpeg"
  WriteINIStr "${nsis(result)}" "Choice" "Semantic" "$LocutionProBundleSemantic"
  WriteINIStr "${nsis(result)}" "Scan" "Complete" "$LocutionProScanComplete"
  WriteINIStr "${nsis(result)}" "Scan" "Plan" "$LocutionProReusePlan"
  Quit
FunctionEnd
Function .onGUIEnd
  Call LocutionProCloseUpgradeScan
FunctionEnd
Section
SectionEnd
`,
      "utf8",
    );
    run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", pageScript]);
    run(pageExecutable, [`/D=${reuseInstall}`]);
    const choices = readFileSync(result, "utf8");
    assert.match(choices, /Ffmpeg=1/u);
    assert.match(choices, /\[Choice\]\r?\nFfmpeg=1\r?\nSemantic=0/u);
    assert.match(choices, /\[Shown\]\r?\nFfmpeg=1\r?\nSemantic=1/u);
    assert.match(choices, /Complete=1/u);
    assert.match(choices, /Plan=.+reuse-plan.ini/u);
    // Passive mode keeps the initial component choices and never starts the
    // pre-option worker or extracts its tools/plan. Prepare still runs at install.
    run(pageExecutable, ["/P", `/D=${reuseInstall}`]);
    const passiveChoices = readFileSync(result, "utf8");
    assert.match(passiveChoices, /Ffmpeg=0/u);
    assert.match(passiveChoices, /Semantic=0/u);
    assert.match(passiveChoices, /Complete=0/u);
    assert.match(passiveChoices, /Plan=\r?\n/u);
  });
  await t.test("scan is read-only and component flags require matching model files", () => {
    writeFileSync(join(reuseInstall, "locution-pro.exe"), "old core");
    helper("Scan", reuseInstall, planPath);
    let plan = readFileSync(planPath, "utf16le");
    assert.match(plan, /Ffmpeg=1/u);
    assert.match(plan, /Semantic=1/u);
    assert.equal(readFileSync(join(reuseInstall, "locution-pro.exe"), "utf8"), "old core");
    // A changed runtime still allows the model selection page to be skipped;
    // that runtime is replaced while matching models are kept.
    writeFileSync(join(reuseInstall, "storyboard-semantic/onnxruntime.dll"), "old-runtime");
    helper("Scan", reuseInstall, planPath);
    plan = readFileSync(planPath, "utf16le");
    assert.match(plan, /Semantic=1/u);
    assert(!plan.includes("storyboard-semantic\\onnxruntime.dll=1"));
    writeFileSync(join(reuseInstall, "ffprobe.exe"), "component-test-payloae");
    writeFileSync(
      join(reuseInstall, "semantic-search/model_quantized.onnx"),
      "component-test-payloae",
    );
    helper("Scan", reuseInstall, planPath);
    plan = readFileSync(planPath, "utf16le");
    assert.match(plan, /Ffmpeg=0/u);
    assert.match(plan, /Semantic=0/u);
  });
  const withLock = async (locked, share, callback) => {
    const holder = spawn(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$stream = [IO.File]::Open($env:LOCUTION_TEST_LOCK, 'Open', 'Read', $env:LOCUTION_TEST_SHARE); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $stream.Dispose()",
      ],
      {
        windowsHide: true,
        env: { ...process.env, LOCUTION_TEST_LOCK: locked, LOCUTION_TEST_SHARE: share },
      },
    );
    const exited = new Promise((done) => holder.once("exit", done));
    try {
      await new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error("Lock holder did not start")), 10000);
        holder.stdout.once("data", () => {
          clearTimeout(timer);
          resolveReady();
        });
        holder.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      await callback();
    } finally {
      if (holder.exitCode === null) holder.stdin.end("release\n");
      await exited;
    }
  };
  await t.test(
    "matching core DLL held by Explorer is reused without deleting or rewriting",
    async () => {
      const install = join(temporary, "locked-provider");
      mkdirSync(install);
      const provider = join(install, "locution_pro_thumbnail_provider.dll");
      writeFileSync(provider, "component-test-payload");
      const timestamp = new Date("2020-01-01T00:00:00Z");
      utimesSync(provider, timestamp, timestamp);
      writeFileSync(join(install, "locution-pro.exe"), "old core");
      await withLock(provider, "Read", () => {
        run(executable, ["/S", `/PREVIOUS=${install}`, `/D=${install}`]);
        assert.equal(readFileSync(provider, "utf8"), "component-test-payload");
        assert.equal(statSync(provider).mtimeMs, timestamp.getTime());
        assert(!existsSync(join(install, "locution-pro.exe")), "Main executable still replaced");
      });
      // A changed, locked provider must still fail before removing the executable.
      writeFileSync(provider, "component-test-payloae");
      writeFileSync(join(install, "locution-pro.exe"), "old core");
      await withLock(provider, "Read", () => {
        helper("Prepare", install, planPath, 2);
        assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old core");
        assert.equal(readFileSync(provider, "utf8"), "component-test-payloae");
      });
    },
  );
  await t.test("locked core aborts before deletion and invalidates a previous plan", async () => {
    const locked = join(reuseInstall, "locution-pro.exe");
    helper("Scan", reuseInstall, planPath);
    await withLock(locked, "None", () => {
      helper("Prepare", reuseInstall, planPath, 2);
      assert(existsSync(locked));
      assert(!existsSync(planPath), "Failed preparation cannot retain a successful plan");
      assert.equal(
        readFileSync(join(reuseInstall, "ffprobe.exe"), "utf8"),
        "component-test-payloae",
      );
    });
  });
  await t.test(
    "standalone uninstall moves a held provider away from the reusable DLL path",
    async () => {
      const install = join(temporary, "provider-tombstone");
      mkdirSync(install);
      const provider = join(install, "locution_pro_thumbnail_provider.dll");
      writeFileSync(provider, "old provider");
      writeFileSync(join(install, "locution-pro.exe"), "old main");
      const providerScript = join(temporary, "provider-uninstall.nsi");
      const providerExecutable = join(temporary, "provider-uninstall.exe");
      const record = join(temporary, "provider-tombstone.txt");
      const block = template.slice(
        template.indexOf("  ; Loaded image files can often be renamed"),
        template.indexOf("  ; Delete the app directory"),
      );
      assert(block.includes('Delete /REBOOTOK "$R8"'));
      assert(!block.includes('Delete /REBOOTOK "$INSTDIR'));
      writeFileSync(
        providerScript,
        `Unicode true
!include LogicLib.nsh
Name "Provider uninstall fixture"
OutFile "${nsis(providerExecutable)}"
RequestExecutionLevel user
SilentInstall silent
!define LCP_THUMBNAIL_PROVIDER_FILE "locution_pro_thumbnail_provider.dll"
Section
${block.replace('Delete /REBOOTOK "$R8"', 'Delete "$R8"')}
  FileOpen $0 "${nsis(record)}" w
  FileWriteUTF16LE /BOM $0 "$R8"
  FileClose $0
  SetOutPath $INSTDIR
  File "/oname=locution_pro_thumbnail_provider.dll" "${nsis(fixture)}"
SectionEnd
`,
      );
      run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", providerScript]);
      await withLock(provider, "Read, Delete", () => {
        helper("CheckUninstall", install, planPath, 0, ["-PreviousRoot", install]);
        run(providerExecutable, ["/S", `/D=${install}`]);
        const tombstone = readFileSync(record, "utf16le").replace(/^\ufeff/u, "");
        assert.notEqual(tombstone.toLowerCase(), provider.toLowerCase());
        assert.equal(dirname(tombstone).toLowerCase(), install.toLowerCase());
        assert.equal(readFileSync(provider, "utf8"), "component-test-payload");
        assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old main");
      });
    },
  );
  await t.test("junction in managed resources is rejected without touching its target", () => {
    const install = join(temporary, "linked-install");
    const outside = join(temporary, "foreign-resources");
    mkdirSync(install);
    mkdirSync(outside);
    writeFileSync(join(install, "locution-pro.exe"), "old core");
    writeFileSync(join(outside, "foreign.dll"), "foreign data");
    symlinkSync(outside, join(install, "transnetv2"), "junction");
    helper("Prepare", install, planPath, 2);
    assert.equal(readFileSync(join(outside, "foreign.dll"), "utf8"), "foreign data");
    assert.equal(readFileSync(join(install, "locution-pro.exe"), "utf8"), "old core");
  });
});
