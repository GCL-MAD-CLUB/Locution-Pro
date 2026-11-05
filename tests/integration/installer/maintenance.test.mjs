import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("NSIS maintenance and standalone uninstall flows", { timeout: 300000 }, async (t) => {
  assert.equal(process.platform, "win32");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const target = join(root, "src-tauri/target");
  mkdirSync(target, { recursive: true });
  const temporary = mkdtempSync(join(target, "installer-maintenance-"));
  const registry = `Software\\LocutionProMaintenanceTests\\${randomUUID()}`;
  t.after(() => {
    assert(/^Software\\LocutionProMaintenanceTests\\[a-f0-9-]+$/u.test(registry));
    spawnSync("reg.exe", ["delete", `HKCU\\${registry}`, "/f"], { windowsHide: true });
    const within = relative(target, resolve(temporary));
    assert(within && !within.startsWith("..") && !isAbsolute(within));
    rmSync(temporary, { recursive: true, force: true });
  });
  const template = readFileSync(join(root, "src-tauri/windows/installer.nsi"), "utf8");
  const functionSource = (name) =>
    template.match(
      new RegExp(`Function ${name.replaceAll(".", "\\.")}[^\\n]*\\r?\\n[\\s\\S]*?FunctionEnd`, "u"),
    )[0];
  const nsis = (value) => value.replaceAll("$", () => "$$").replaceAll('"', '$\\"');
  const run = (program, args, verbatim = false, expected = 0) => {
    const result = spawnSync(program, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      ...(verbatim ? { windowsVerbatimArguments: true, argv0: `"${program}"` } : {}),
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, `${program}: ${result.stdout}\n${result.stderr}`);
  };
  const compiler =
    process.env.NSIS_MAKENSIS ?? join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
  const compile = (name, body) => {
    const executable = join(temporary, `${name}.exe`);
    const script = join(temporary, `${name}.nsi`);
    writeFileSync(
      script,
      `Unicode true\n!include MUI2.nsh\n!include FileFunc.nsh\nName "Maintenance fixture"\nOutFile "${nsis(executable)}"\nRequestExecutionLevel user\n${body}`,
      "utf8",
    );
    run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", script]);
    return executable;
  };
  const language = `
!insertmacro MUI_LANGUAGE "SimpChinese"
LangString older \${LANG_SIMPCHINESE} "旧的"
LangString unknown \${LANG_SIMPCHINESE} "未知"
LangString alreadyInstalled \${LANG_SIMPCHINESE} "已安装"
LangString alreadyInstalledLong \${LANG_SIMPCHINESE} "已经安装，选择维护操作。"
LangString addOrReinstall \${LANG_SIMPCHINESE} "添加/重新安装组件"
LangString uninstallApp \${LANG_SIMPCHINESE} "卸载 Locution Pro"
LangString chooseMaintenanceOption \${LANG_SIMPCHINESE} "选择要执行的维护操作。"
LangString olderOrUnknownVersionInstalled \${LANG_SIMPCHINESE} "系统中已存在旧版本。"
LangString uninstallBeforeInstalling \${LANG_SIMPCHINESE} "安装前卸载"
LangString dontUninstall \${LANG_SIMPCHINESE} "请勿卸载"
LangString choowHowToInstall \${LANG_SIMPCHINESE} "选择你想要安装 Locution Pro 的方式。"
LangString newerVersionInstalled \${LANG_SIMPCHINESE} "已安装更新版本。"
LangString deleteAppData \${LANG_SIMPCHINESE} "删除应用程序数据"
`;
  const files = [
    "LICENSE",
    "locution_pro_thumbnail_provider.dll",
    "transnetv2\\runtime.dll",
    "semantic-search\\model.onnx",
    "storyboard-semantic\\model.onnx",
    "ffmpeg.exe",
    "ffprobe.exe",
  ];
  const payload = join(temporary, "payload.txt");
  writeFileSync(payload, "payload");
  const manifest = join(temporary, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      files: files.map((path) => ({
        path,
        size: 7,
        sha256: createHash("sha256").update("payload").digest("hex"),
        group: path.includes("\\")
          ? path.split("\\")[0]
          : path.startsWith("ff")
            ? "ffmpeg"
            : "core",
      })),
    }),
  );
  let copy = template.slice(
    template.indexOf("  ; Copy resources"),
    template.indexOf("  ; Publish the executable"),
  );
  const renderLoop = (name, values, render) => {
    copy = copy.replace(
      new RegExp(`\\{\\{#each ${name}\\}\\}([\\s\\S]*?)\\{\\{/each\\}\\}`, "u"),
      (_, body) => values.map((value) => render(body, value)).join("\n"),
    );
  };
  renderLoop(
    "resources_dirs",
    ["transnetv2", "semantic-search", "storyboard-semantic"],
    (body, value) => body.replaceAll("{{this}}", value),
  );
  renderLoop(
    "resources",
    files.filter((name) => !name.startsWith("ff")),
    (body, value) =>
      body.replaceAll("{{this.[1]}}", value).replaceAll("{{no-escape @key}}", nsis(payload)),
  );
  renderLoop("binaries", ["ffmpeg.exe", "ffprobe.exe"], (body, value) =>
    body.replaceAll("{{this}}", value).replaceAll("{{no-escape @key}}", nsis(payload)),
  );
  assert(!copy.includes("{{"));
  const instrumented = (file, timer) =>
    readFileSync(join(root, "src-tauri/windows", file), "utf8").replace(
      "  nsDialogs::Show",
      `  ${timer}\n  nsDialogs::Show`,
    );
  const maintenanceSource = join(temporary, "maintenance-page.nsh");
  writeFileSync(
    maintenanceSource,
    instrumented("maintenance-page.nsh", "${NSD_CreateTimer} ChooseMaintenance 100"),
  );
  const upgradeSource = join(temporary, "upgrade-files.nsh");
  writeFileSync(
    upgradeSource,
    instrumented(
      "upgrade-files.nsh",
      '${If} $LocutionProUpgradeMode != "Scan"\n${NSD_CreateTimer} ContinueUninstall 100\n${EndIf}',
    )
      // A failing worker must end the fixture with its exit code instead of
      // blocking the automated test on a modal dialog.
      .replace(/MessageBox MB_ICONSTOP\|MB_OK "[^"\r\n]*"/u, () => 'DetailPrint "$1"'),
  );
  const semanticSource = join(temporary, "semantic-options.nsh");
  writeFileSync(
    semanticSource,
    instrumented("semantic-options.nsh", "${NSD_CreateTimer} AutoNext 100"),
  );
  const ffmpegSource = join(temporary, "ffmpeg-options.nsh");
  writeFileSync(
    ffmpegSource,
    instrumented("ffmpeg-options.nsh", "${NSD_CreateTimer} AutoNext 100")
      .replace(
        '!include "${__FILEDIR__}\\semantic-options.nsh"',
        `!include "${nsis(semanticSource)}"`,
      )
      .replace(
        '!define LOCUTION_INSTALLER_SOURCE_DIR "${__FILEDIR__}"',
        `!define LOCUTION_INSTALLER_SOURCE_DIR "${nsis(join(root, "src-tauri/windows"))}"`,
      ),
  );
  const oldTimestamp = new Date("2020-01-01T00:00:00Z");
  for (const entry of [
    { name: "upgrade", version: "0.9.0", choice: 1 },
    { name: "fresh", version: "0.9.0", choice: 2, fresh: true },
    {
      name: "fresh-nested-candidate",
      version: "0.9.0",
      choice: 2,
      fresh: true,
      candidate: "nested",
    },
    {
      name: "fresh-invalid-candidate",
      version: "0.9.0",
      choice: 2,
      fresh: true,
      candidate: "invalid",
    },
    { name: "reinstall", version: "1.0.0", choice: 1 },
    { name: "uninstall-only", version: "1.0.0", choice: 2, uninstall: true },
  ]) {
    await t.test(entry.name, () => {
      const old = join(temporary, `${entry.name}-old`);
      const result = join(temporary, `${entry.name}.ini`);
      for (const name of files) {
        const file = join(old, name);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "payload");
        utimesSync(file, oldTimestamp, oldTimestamp);
      }
      writeFileSync(join(old, "locution-pro.exe"), "old main");
      writeFileSync(join(old, "uninstall.exe"), "never run this uninstaller");
      writeFileSync(join(old, "obsolete.dll"), "obsolete");
      writeFileSync(join(old, "preferences.json"), "user data");
      const initial =
        entry.candidate === "nested"
          ? join(old, "nested", "Locution Pro")
          : entry.candidate === "invalid"
            ? join(temporary, "invalid<directory")
            : old;
      const executable = compile(
        entry.name,
        `
!define PRODUCTNAME "Locution Pro"
!define VERSION "1.0.0"
!define INSTALLMODE "currentUser"
!define ALLOWDOWNGRADES "true"
!define MAINBINARYNAME "locution-pro"
!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"
!addplugindir "${nsis(join(process.env.LOCALAPPDATA, "tauri/NSIS/Plugins/x86-unicode/additional"))}"
Var PreviousInstallDir
Var PreviousUninstallKey
Var PassiveMode
Var UpdateMode
Var TestDialog
!include "${nsis(ffmpegSource)}"
!include "${nsis(upgradeSource)}"
!include "${nsis(join(root, "src-tauri/windows/independent-install.nsh"))}"
!include "${nsis(maintenanceSource)}"
Page custom TestMaintenance PageLeaveReinstall
Page custom TestUninstall LocutionProUninstallPageLeave
Page custom BeforeComponents
Page custom LocutionProScanPageCreate LocutionProScanPageLeave
Page custom TestFfmpeg LocutionProFfmpegPageLeave
Page custom TestSemantic LocutionProSemanticPageLeave
!insertmacro MUI_PAGE_INSTFILES
Page custom Finished
${language}
${functionSource("SkipIfPassive")}
Function .onInit
  FileOpen $0 "${nsis(result)}" w
  FileWriteUTF16LE /BOM $0 ""
  FileClose $0
  StrCpy $PreviousInstallDir "${nsis(old)}"
  StrCpy $PreviousUninstallKey "${registry}\\${entry.name}"
  StrCpy $INSTDIR $PreviousInstallDir
  StrCpy $LocutionProInitialInstallDir "${nsis(initial)}"
  StrCpy $LocutionProBundleFfmpeg 1
  StrCpy $LocutionProBundleSemantic 1
  StrCpy $LocutionProPreviousSemanticChoice 1
  WriteRegStr SHCTX "$PreviousUninstallKey" "DisplayVersion" "${entry.version}"
  WriteRegStr SHCTX "$PreviousUninstallKey" "UninstallString" "never-execute"
  Call LocutionProDetectMaintenance
FunctionEnd
Function TestMaintenance
  Call PageReinstall
  \${NSD_KillTimer} ChooseMaintenance
FunctionEnd
Function ChooseMaintenance
  \${NSD_KillTimer} ChooseMaintenance
  \${NSD_GetText} $mui.Header.Text $0
  WriteINIStr "${nsis(result)}" "Maintenance" "Title" "$0"
  \${NSD_GetText} $mui.Header.SubText $0
  WriteINIStr "${nsis(result)}" "Maintenance" "Subtitle" "$0"
  \${NSD_GetText} $R3 $0
  WriteINIStr "${nsis(result)}" "Maintenance" "SecondChoice" "$0"
  SendMessage ${entry.choice === 1 ? "$R2" : "$R3"} \${BM_CLICK} 0 0
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i \${WM_COMMAND}, p1, p0)'
FunctionEnd
Function TestUninstall
  Call LocutionProUninstallPageCreate
  \${NSD_KillTimer} ContinueUninstall
FunctionEnd
Function ContinueUninstall
  \${If} $LocutionProUninstallComplete == 1
    \${NSD_KillTimer} ContinueUninstall
    FindWindow $0 "#32770" "" $HWNDPARENT
    FindWindow $1 "Button" "删除应用程序数据" $0
    WriteINIStr "${nsis(result)}" "Uninstall" "DeleteDataControl" "$1"
    System::Call 'user32::PostMessageW(p $HWNDPARENT, i \${WM_COMMAND}, p1, p0)'
  \${EndIf}
FunctionEnd
Function LocutionProCheckRunningApp
FunctionEnd
Function LocutionProFinishEmbeddedUninstall
  DeleteRegKey SHCTX "$PreviousUninstallKey"
  StrCpy $LocutionProUninstallComplete 1
  WriteINIStr "${nsis(result)}" "Uninstall" "Completed" "1"
FunctionEnd
Function BeforeComponents
  \${NSD_KillTimer} ContinueUninstall
  WriteINIStr "${nsis(result)}" "BeforeComponents" "PreviousRoot" "$PreviousInstallDir"
  WriteINIStr "${nsis(result)}" "BeforeComponents" "InstallDir" "$INSTDIR"
  WriteINIStr "${nsis(result)}" "BeforeComponents" "Fresh" "$LocutionProFreshInstall"
  \${If} $LocutionProFreshInstall == 1
    Push $INSTDIR
    StrCpy $INSTDIR "${nsis(old)}"
    Call LocutionProCheckFreshInstallLocation
    WriteINIStr "${nsis(result)}" "BeforeComponents" "OldPathAllowed" "$LocutionProFreshLocationAllowed"
    StrCpy $INSTDIR "${nsis(old)}\\nested"
    Call LocutionProCheckFreshInstallLocation
    WriteINIStr "${nsis(result)}" "BeforeComponents" "NestedOldPathAllowed" "$LocutionProFreshLocationAllowed"
    Pop $INSTDIR
  \${EndIf}
  \${If} \${FileExists} "${nsis(old)}\\locution-pro.exe"
    WriteINIStr "${nsis(result)}" "BeforeComponents" "OldMain" "1"
  \${Else}
    WriteINIStr "${nsis(result)}" "BeforeComponents" "OldMain" "0"
  \${EndIf}
  Abort
FunctionEnd
Function TestFfmpeg
  StrCpy $TestDialog "ffmpeg"
  Call LocutionProFfmpegPageCreate
  \${NSD_KillTimer} AutoNext
FunctionEnd
Function TestSemantic
  StrCpy $TestDialog "semantic"
  Call LocutionProSemanticPageCreate
  \${NSD_KillTimer} AutoNext
FunctionEnd
Function AutoNext
  \${If} $TestDialog == "ffmpeg"
    System::Call 'user32::IsWindow(p $LocutionProBundledRadio) i.r0'
  \${Else}
    System::Call 'user32::IsWindow(p $LocutionProSemanticCheckbox) i.r0'
  \${EndIf}
  \${If} $0 == 0
    Return
  \${EndIf}
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i \${WM_COMMAND}, p1, p0)'
FunctionEnd
Function Finished
  WriteINIStr "${nsis(result)}" "Install" "Completed" "1"
  Quit
FunctionEnd
Function .onGUIEnd
  Call LocutionProCloseUpgradeScan
FunctionEnd
Section
  \${NSD_KillTimer} AutoNext
  SetAutoClose true
  Call LocutionProDirectoryLeave
  StrCpy $LocutionProUpgradeMode "Prepare"
  Call LocutionProPlanUpgrade
  SetOutPath $INSTDIR
${copy}
  File "/oname=locution-pro.exe" "${nsis(payload)}"
SectionEnd
`,
      );
      run(executable, [], true);
      const state = readFileSync(result, "utf16le");
      assert.match(state, /Title=已安装/u);
      assert(
        state.includes(
          `Subtitle=${entry.version === "1.0.0" ? "选择要执行的维护操作。" : "选择你想要安装 Locution Pro 的方式。"}`,
        ),
      );
      assert(
        state.includes(
          `SecondChoice=${entry.version === "1.0.0" ? "卸载 Locution Pro（保留用户数据）" : "保留旧程序，另选目录安装"}`,
        ),
      );
      assert.equal(readFileSync(join(old, "preferences.json"), "utf8"), "user data");
      if (entry.uninstall) {
        assert.match(state, /Completed=1/u);
        assert.match(state, /DeleteDataControl=0/u);
        assert(!state.includes("[Install]"));
        assert(!existsSync(join(old, "locution-pro.exe")));
        assert(!existsSync(join(old, "semantic-search/model.onnx")));
        return;
      }
      assert.match(state, /\[Install\]\r?\nCompleted=1/u);
      if (entry.fresh) {
        assert.match(state, /PreviousRoot=\r?\n/u);
        assert.match(state, /Fresh=1/u);
        assert.match(state, /OldPathAllowed=0/u);
        assert.match(state, /NestedOldPathAllowed=0/u);
        assert.match(state, /OldMain=1/u);
        assert.equal(readFileSync(join(old, "locution-pro.exe"), "utf8"), "old main");
        assert.equal(
          readFileSync(join(old, "uninstall.exe"), "utf8"),
          "never run this uninstaller",
        );
        assert.equal(readFileSync(join(old, "obsolete.dll"), "utf8"), "obsolete");
        assert.equal(
          statSync(join(old, "semantic-search/model.onnx")).mtimeMs,
          oldTimestamp.getTime(),
        );
        assert.equal(readFileSync(join(`${old} (2)`, "locution-pro.exe"), "utf8"), "payload");
      } else {
        assert.match(state, /OldMain=1/u);
        assert(!existsSync(join(old, "obsolete.dll")));
        assert.equal(readFileSync(join(old, "locution-pro.exe"), "utf8"), "payload");
        assert.equal(
          statSync(join(old, "semantic-search/model.onnx")).mtimeMs,
          oldTimestamp.getTime(),
        );
      }
    });
  }

  const quietIndependent = join(temporary, "quiet-independent.nsh");
  const independent = readFileSync(join(root, "src-tauri/windows/independent-install.nsh"), "utf8");
  // Keep the actual rejection logic; close its failure UI automatically so /P
  // fixtures do not wait for a user to dismiss the aborted installation page.
  writeFileSync(
    quietIndependent,
    independent
      .replace(
        /MessageBox MB_ICONEXCLAMATION\|MB_OK "[^"\r\n]*"/gu,
        'DetailPrint "Rejected invalid installation directory"',
      )
      .replace(/\bAbort\b/gu, "Quit"),
  );
  const quietMaintenance = join(temporary, "quiet-maintenance.nsh");
  writeFileSync(
    quietMaintenance,
    readFileSync(join(root, "src-tauri/windows/maintenance-page.nsh"), "utf8").replace(
      /MessageBox MB_ICONEXCLAMATION\|MB_OK "[^"\r\n]*"/gu,
      'DetailPrint "No fresh installation directory available"',
    ),
  );
  const earlyChecks = template.slice(
    template.indexOf("Section EarlyChecks"),
    template.indexOf("Section WebView2"),
  );
  for (const mode of ["/S", "/P"]) {
    for (const kind of ["LineCut", "legacy-marker"]) {
      await t.test(`${mode} rejects ${kind} target before touching either installation`, () => {
        const base = join(temporary, `rejected-${mode.slice(1)}-${kind}`);
        const old = join(base, "old");
        const foreign = join(base, kind);
        const install = join(foreign, "Locution Pro");
        const touched = join(base, "running-app-check.txt");
        for (const name of [...files, "locution-pro.exe", "uninstall.exe", "preferences.json"]) {
          const file = join(old, name);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, "payload");
        }
        mkdirSync(install, { recursive: true });
        if (kind === "legacy-marker") writeFileSync(join(foreign, "linecut.exe"), "legacy app");
        for (const name of ["ffmpeg.exe", "ffprobe.exe"])
          writeFileSync(join(install, name), "foreign tool");
        const executable = compile(
          `reject-${mode.slice(1)}-${kind}`,
          `
!define PRODUCTNAME "Locution Pro"
!define VERSION "1.0.0"
!define INSTALLMODE "currentUser"
!define ALLOWDOWNGRADES "true"
!define MAINBINARYNAME "locution-pro"
!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"
!addplugindir "${nsis(join(process.env.LOCALAPPDATA, "tauri/NSIS/Plugins/x86-unicode/additional"))}"
Var PreviousInstallDir
Var PreviousUninstallKey
Var PassiveMode
Var UpdateMode
!include "${nsis(join(root, "src-tauri/windows/ffmpeg-options.nsh"))}"
!include "${nsis(join(root, "src-tauri/windows/upgrade-files.nsh"))}"
!include "${nsis(quietIndependent)}"
!include "${nsis(quietMaintenance)}"
!insertmacro MUI_PAGE_INSTFILES
Page custom UnexpectedTargetAccepted
${language}
${functionSource("SkipIfPassive")}
Function .onInit
  StrCpy $PreviousInstallDir "${nsis(old)}"
  StrCpy $PreviousUninstallKey "${registry}\\invalid-target"
  StrCpy $LocutionProHasMaintenance 1
  StrCpy $LocutionProBundleFfmpeg 1
  StrCpy $LocutionProBundleSemantic 1
  StrCpy $PassiveMode ${mode === "/P" ? 1 : 0}
FunctionEnd
Function LocutionProCheckRunningApp
  FileOpen $0 "${nsis(touched)}" w
  FileClose $0
FunctionEnd
Function LocutionProFinishEmbeddedUninstall
FunctionEnd
Function .onInstFailed
  SetErrorLevel 2
  Quit
FunctionEnd
Function UnexpectedTargetAccepted
  FileOpen $0 "${nsis(touched)}" w
  FileClose $0
  SetErrorLevel 3
  Quit
FunctionEnd
${earlyChecks}
`,
        );
        run(executable, [mode, `/D=${install}`], true, 2);
        assert(!existsSync(touched), "Invalid target must be rejected before stopping the app");
        for (const name of [...files, "locution-pro.exe", "uninstall.exe", "preferences.json"]) {
          assert.equal(readFileSync(join(old, name), "utf8"), "payload", name);
        }
        for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
          assert.equal(readFileSync(join(install, name), "utf8"), "foreign tool", name);
        }
        assert(
          !existsSync(join(install, "semantic-search/model.onnx")),
          "Reusable files must not be moved into the rejected target",
        );
      });
    }
  }

  await t.test(
    "fresh-directory exhaustion aborts with the old installation and choices retained",
    () => {
      const old = join(temporary, "all-candidates-used");
      const result = join(temporary, "exhausted.txt");
      mkdirSync(old);
      writeFileSync(join(old, "locution-pro.exe"), "old main");
      for (let number = 2; number <= 100; number += 1) {
        const candidate = `${old} (${number})`;
        mkdirSync(candidate);
        writeFileSync(join(candidate, "foreign.txt"), "keep");
      }
      const executable = compile(
        "exhausted",
        `
!define PRODUCTNAME "Locution Pro"
!define VERSION "1.0.0"
!define INSTALLMODE "currentUser"
!define ALLOWDOWNGRADES "true"
!define MAINBINARYNAME "locution-pro"
!define LOCUTION_PAYLOAD_MANIFEST "${nsis(manifest)}"
!addplugindir "${nsis(join(process.env.LOCALAPPDATA, "tauri/NSIS/Plugins/x86-unicode/additional"))}"
Var PreviousInstallDir
Var PreviousUninstallKey
Var PassiveMode
Var UpdateMode
!include "${nsis(join(root, "src-tauri/windows/ffmpeg-options.nsh"))}"
!include "${nsis(join(root, "src-tauri/windows/upgrade-files.nsh"))}"
!include "${nsis(quietIndependent)}"
!include "${nsis(quietMaintenance)}"
SilentInstall silent
!insertmacro MUI_PAGE_INSTFILES
${language}
${functionSource("SkipIfPassive")}
Function LocutionProCheckRunningApp
FunctionEnd
Function LocutionProFinishEmbeddedUninstall
FunctionEnd
Function .onInstFailed
  FileOpen $0 "${nsis(result)}" w
  FileWriteUTF16LE /BOM $0 "Fresh=$LocutionProFreshInstall$\\r$\\nPrevious=$PreviousInstallDir$\\r$\\nTarget=$INSTDIR$\\r$\\nUpdate=$UpdateMode$\\r$\\nSemantic=$LocutionProBundleSemantic$\\r$\\n"
  FileClose $0
  SetErrorLevel 2
  Quit
FunctionEnd
Section
  StrCpy $PreviousInstallDir "${nsis(old)}"
  StrCpy $LocutionProInitialInstallDir $PreviousInstallDir
  StrCpy $UpdateMode 1
  StrCpy $LocutionProBundleSemantic 0
  StrCpy $LocutionProVersionRelation 1
  StrCpy $ReinstallPageCheck 2
  Call LocutionProApplyMaintenanceChoice
SectionEnd
`,
      );
      run(executable, ["/S"], true, 2);
      const state = readFileSync(result, "utf16le");
      assert.match(state, /Fresh=0/u);
      assert(state.includes(`Previous=${old}\r\n`));
      assert(state.includes(`Target=${old}\r\n`));
      assert.match(state, /Update=1/u);
      assert.match(state, /Semantic=0/u);
      assert.equal(readFileSync(join(old, "locution-pro.exe"), "utf8"), "old main");
      for (let number = 2; number <= 100; number += 1) {
        assert.equal(readFileSync(join(`${old} (${number})`, "foreign.txt"), "utf8"), "keep");
      }
    },
  );

  await t.test("standalone uninstaller retains the original delete-data checkbox", () => {
    const dataBlock = template.slice(
      template.indexOf("  ; Delete app data if the checkbox is selected"),
      template.indexOf("  !ifmacrodef NSIS_HOOK_POSTUNINSTALL"),
    );
    assert(dataBlock.includes("$DeleteAppDataCheckboxState = 1"));
    const data = join(temporary, "standalone-data");
    const record = join(temporary, "standalone.ini");
    const scopedDataBlock = dataBlock
      .replaceAll("$APPDATA\\\${BUNDLEID}", nsis(join(data, "roaming")))
      .replaceAll("$LOCALAPPDATA\\\${BUNDLEID}", nsis(join(data, "local")))
      .replaceAll("$LOCALAPPDATA\\\${PRODUCTNAME}", nsis(join(data, "application")));
    assert(
      !/\$(?:LOCAL)?APPDATA/u.test(scopedDataBlock),
      "All data deletion must stay in the fixture",
    );
    const executable = compile(
      "standalone",
      `
!define MANUPRODUCTKEY "${registry}\\standalone-product"
!define MANUKEY "${registry}\\standalone"
Var UpdateMode
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
Var LocutionProOwnsRegistration
Var TestDeleteData
!define /ifndef WS_EX_LAYOUTRTL 0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.TestShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
${language}
${functionSource("un.ConfirmShow")}
${functionSource("un.ConfirmLeave")}
Function un.onInit
  StrCpy $LocutionProOwnsRegistration 1
  \${GetOptions} $CMDLINE "/DELETE=" $TestDeleteData
FunctionEnd
Function un.TestShow
  Call un.ConfirmShow
  Call un.Drive
FunctionEnd
Function un.Drive
  \${NSD_GetText} $DeleteAppDataCheckbox $0
  WriteINIStr "${nsis(record)}" "Choice" "Label" "$0"
  SendMessage $DeleteAppDataCheckbox \${BM_SETCHECK} $TestDeleteData 0
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i \${WM_COMMAND}, p1, p0)'
FunctionEnd
Section
  FileOpen $0 "${nsis(record)}" w
  FileWriteUTF16LE /BOM $0 ""
  FileClose $0
  WriteUninstaller "$INSTDIR\\uninstall.exe"
SectionEnd
Section Uninstall
  SetAutoClose true
${scopedDataBlock}
  WriteINIStr "${nsis(record)}" "Choice" "DeleteData" "$DeleteAppDataCheckboxState"
SectionEnd
`,
    );
    const install = join(temporary, "standalone");
    mkdirSync(install);
    run(executable, ["/S", `/D=${install}`], true);
    for (const choice of [0, 1]) {
      for (const name of ["roaming", "local", "application"]) {
        mkdirSync(join(data, name), { recursive: true });
        writeFileSync(join(data, name, "settings.json"), "user data");
      }
      run(join(install, "uninstall.exe"), [`/DELETE=${choice}`, `_?=${install}`], true);
      assert.match(readFileSync(record, "utf16le"), new RegExp(`DeleteData=${choice}`, "u"));
      assert.match(readFileSync(record, "utf16le"), /Label=删除应用程序数据/u);
      for (const name of ["roaming", "local", "application"]) {
        assert.equal(existsSync(join(data, name, "settings.json")), choice === 0);
      }
    }
  });
});
