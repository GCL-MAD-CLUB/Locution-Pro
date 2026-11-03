import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("external media tools use the actual wizard validation", { timeout: 60000 }, (t) => {
  assert.equal(process.platform, "win32");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const target = join(root, "src-tauri/target");
  const temporary = mkdtempSync(join(target, "installer-media-"));
  t.after(() => {
    const within = relative(target, resolve(temporary));
    assert(within && !within.startsWith("..") && !isAbsolute(within));
    rmSync(temporary, { recursive: true, force: true });
  });
  const source = join(root, "src-tauri/windows");
  const nsis = (value) => value.replaceAll("$", () => "$$").replaceAll('"', '$\\"');
  const compiler =
    process.env.NSIS_MAKENSIS ?? join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
  const run = (program, args, expected = 0, options = {}) => {
    const result = spawnSync(program, args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      ...options,
    });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      expected,
      `${result.stdout}\n${result.stderr}\n${existsSync(join(temporary, "result.ini")) ? readFileSync(join(temporary, "result.ini"), "utf16le") : ""}`,
    );
  };
  const tools = join(temporary, "media tools");
  mkdirSync(tools);
  const ffmpeg = join(tools, "ffmpeg.exe");
  const ffprobe = join(tools, "ffprobe.exe");
  writeFileSync(ffmpeg, "must not execute");
  writeFileSync(ffprobe, "must not execute");
  const record = join(temporary, "result.ini");
  for (const name of ["semantic-options.nsh", "independent-install.nsh"]) {
    writeFileSync(join(temporary, name), readFileSync(join(source, name), "utf8"));
  }
  writeFileSync(
    join(temporary, "ffmpeg-options.nsh"),
    readFileSync(join(source, "ffmpeg-options.nsh"), "utf8")
      .replace("  nsDialogs::Show", "  ${NSD_CreateTimer} ChooseExternal 100\n  nsDialogs::Show")
      .replace(
        "locution_pro_ffmpeg_invalid:",
        `locution_pro_ffmpeg_invalid:
  WriteINIStr "${nsis(record)}" "Result" "Invalid" "1"
  WriteINIStr "${nsis(record)}" "Result" "Error" "$LocutionProFfmpegError"
  WriteINIStr "${nsis(record)}" "Result" "Normalized" "$LocutionProFfmpegPath"
  WriteINIStr "${nsis(record)}" "Result" "Probe" "$LocutionProFfprobePath"
  SetErrorLevel 2
  Quit
`,
      ),
  );
  const script = join(temporary, "media.nsi");
  const executable = join(temporary, "media.exe");
  writeFileSync(
    script,
    `Unicode true
!include MUI2.nsh
!include FileFunc.nsh
!include "${nsis(join(temporary, "ffmpeg-options.nsh"))}"
!include "${nsis(join(temporary, "independent-install.nsh"))}"
Name "Media tool fixture"
OutFile "${nsis(executable)}"
RequestExecutionLevel user
Page custom LocutionProFfmpegPageCreate LocutionProFfmpegPageLeave
Page custom Finished
!insertmacro MUI_LANGUAGE "SimpChinese"
Function SkipIfPassive
FunctionEnd
Function .onInit
  FileOpen $0 "${nsis(record)}" w
  FileWriteUTF16LE /BOM $0 ""
  FileClose $0
  StrCpy $LocutionProBundleFfmpeg 0
  ReadEnvStr $LocutionProFfmpegPath "LOCUTION_TEST_MEDIA_PATH"
FunctionEnd
Function ChooseExternal
  \${NSD_KillTimer} ChooseExternal
  SendMessage $LocutionProExternalRadio \${BM_CLICK} 0 0
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i \${WM_COMMAND}, p1, p0)'
FunctionEnd
Function Finished
  WriteINIStr "${nsis(record)}" "Result" "Ffmpeg" "$LocutionProFfmpegPath"
  WriteINIStr "${nsis(record)}" "Result" "Probe" "$LocutionProFfprobePath"
  Quit
FunctionEnd
Section
SectionEnd
`,
  );
  run(compiler, ["/V2", "/INPUTCHARSET", "UTF8", script]);
  const unicode = join(temporary, "中文工具");
  mkdirSync(unicode);
  writeFileSync(join(unicode, "ffmpeg.exe"), "must not execute");
  writeFileSync(join(unicode, "ffprobe.exe"), "must not execute");
  const missingProbe = join(temporary, "without-probe");
  mkdirSync(missingProbe);
  writeFileSync(join(missingProbe, "ffmpeg.exe"), "must not execute");
  const directoryProbe = join(temporary, "directory-probe");
  mkdirSync(join(directoryProbe, "ffprobe.exe"), { recursive: true });
  writeFileSync(join(directoryProbe, "ffmpeg.exe"), "must not execute");
  for (const [input, expected, message] of [
    [ffmpeg, 0, ""],
    [join(unicode, "ffmpeg.exe"), 0, ""],
    ["ffmpeg", 0, ""],
    [join(missingProbe, "ffmpeg.exe"), 2, "同目录未找到 ffprobe.exe。"],
    [join(directoryProbe, "ffmpeg.exe"), 2, "同目录的 ffprobe.exe 不是可用文件。"],
    ...(existsSync("D:\\ffmpeg\\bin\\ffmpeg.exe") && existsSync("D:\\ffmpeg\\bin\\ffprobe.exe")
      ? [["D:\\ffmpeg\\bin\\ffmpeg.exe", 0, ""]]
      : []),
  ]) {
    run(executable, [], expected, {
      env: {
        ...process.env,
        PATH: `${tools};${process.env.PATH}`,
        LOCUTION_TEST_MEDIA_PATH: input,
      },
    });
    const state = readFileSync(record, "utf16le");
    if (expected === 0) assert.match(state, /Ffmpeg=.+ffmpeg\.exe/u);
    else assert(state.includes(`Error=${message}`), state);
  }
  const page = readFileSync(join(source, "ffmpeg-options.nsh"), "utf8");
  const invalid = page.slice(
    page.indexOf("locution_pro_ffmpeg_invalid:"),
    page.indexOf("!macro LocutionProWriteMediaPath"),
  );
  assert(!invalid.includes("MessageBox"), "Correctable path errors stay inline in the wizard");
});
