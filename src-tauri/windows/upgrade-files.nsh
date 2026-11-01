!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!define LOCUTION_HAS_UPGRADE_SCAN

Var LocutionProReusePlan
Var LocutionProUpgradeMode
Var LocutionProScanProcess
Var LocutionProScanComplete
Var LocutionProScanRoot
Var LocutionProScanPreviousRoot
Var LocutionProScanBar

!ifndef LOCUTION_PAYLOAD_MANIFEST
  !define LOCUTION_PAYLOAD_MANIFEST "${LOCUTION_INSTALLER_SOURCE_DIR}\..\target\installer\payload-manifest.json"
!endif

; All hash decisions come from this installer's embedded manifest, never from
; metadata left by a previous installation. Scan is read-only; Prepare rehashes.
Function LocutionProExtractUpgradeTools
  InitPluginsDir
  File "/oname=$PLUGINSDIR\upgrade-files.ps1" "${LOCUTION_INSTALLER_SOURCE_DIR}\upgrade-files.ps1"
  File "/oname=$PLUGINSDIR\payload-manifest.json" "${LOCUTION_PAYLOAD_MANIFEST}"
  StrCpy $LocutionProReusePlan "$PLUGINSDIR\reuse-plan.ini"
FunctionEnd

!macro LOCUTION_UPGRADE_COMMAND OUTPUT
  StrCpy ${OUTPUT} '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-files.ps1" -Mode "$LocutionProUpgradeMode" -Root "$INSTDIR" -PreviousRoot "$PreviousInstallDir" -Manifest "$PLUGINSDIR\payload-manifest.json" -Result "$LocutionProReusePlan" -MainBinary "${MAINBINARYNAME}.exe" -Ffmpeg $LocutionProBundleFfmpeg -Semantic $LocutionProBundleSemantic'
!macroend

Function LocutionProReadUpgradePlan
  ReadINIStr $LocutionProReuseFfmpeg "$LocutionProReusePlan" "Components" "Ffmpeg"
  ReadINIStr $LocutionProReuseSemantic "$LocutionProReusePlan" "Components" "Semantic"
FunctionEnd

Function LocutionProUpgradeFailed
  DetailPrint "$1"
  IfSilent +2
    MessageBox MB_ICONSTOP|MB_OK "无法安全更新应用文件。请关闭 Locution Pro 及占用其组件的程序，检查目录权限后重试。$\r$\n$1"
  SetErrorLevel 2
  Quit
FunctionEnd

Function LocutionProPlanUpgrade
  Call LocutionProExtractUpgradeTools
  DetailPrint "正在校验已有组件，请稍候…"
  !insertmacro LOCUTION_UPGRADE_COMMAND $0
  nsExec::ExecToStack $0
  Pop $0
  Pop $1
  ${If} $0 != 0
    Call LocutionProUpgradeFailed
  ${EndIf}
  Call LocutionProReadUpgradePlan
FunctionEnd

; Only the interactive wizard scans before options. Hashing runs in a hidden
; read-only worker so the progress page and Cancel button keep responding.
Function LocutionProScanPageCreate
  Call SkipIfPassive
  ${If} $LocutionProScanComplete == 1
  ${AndIf} $LocutionProScanRoot == $INSTDIR
  ${AndIf} $LocutionProScanPreviousRoot == $PreviousInstallDir
    Abort
  ${EndIf}
  StrCpy $LocutionProScanComplete 0
  StrCpy $LocutionProReuseFfmpeg 0
  StrCpy $LocutionProReuseSemantic 0
  StrCpy $LocutionProUpgradeMode "Scan"
  Call LocutionProExtractUpgradeTools
  !insertmacro MUI_HEADER_TEXT "检查可复用组件" "正在校验已有文件，完成后自动继续。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    StrCpy $1 "无法创建组件校验页面。"
    Call LocutionProUpgradeFailed
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "正在校验 FFmpeg、模型和依赖库。大文件较多时需要一些时间，可以取消安装。"
  Pop $0
  ${NSD_CreateProgressBar} 0 32u 100% 12u ""
  Pop $LocutionProScanBar
  ${NSD_AddStyle} $LocutionProScanBar 0x8 ; PBS_MARQUEE
  SendMessage $LocutionProScanBar ${PBM_SETMARQUEE} 1 40
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 0
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0

  !insertmacro LOCUTION_UPGRADE_COMMAND $0
  ; STARTUPINFOW and PROCESS_INFORMATION in the 32-bit NSIS host.
  System::Call '*(i68, p0, p0, p0, i0, i0, i0, i0, i0, i0, i0, i0, &i2 0, &i2 0, p0, p0, p0, p0) p.r1'
  System::Call '*(p0, p0, i0, i0) p.r2'
  System::Call 'kernel32::CreateProcessW(p0, w r0, p0, p0, i0, i0x08000000, p0, p0, p r1, p r2) i.r3'
  ${If} $3 != 0
    System::Call '*$2(p.r4, p.r5)'
    StrCpy $LocutionProScanProcess $4
    System::Call 'kernel32::CloseHandle(p r5)'
  ${EndIf}
  System::Free $1
  System::Free $2
  ${If} $3 == 0
    StrCpy $1 "无法启动组件校验进程。"
    Call LocutionProUpgradeFailed
  ${EndIf}
  ${NSD_CreateTimer} LocutionProPollUpgradeScan 100
  nsDialogs::Show
  ${NSD_KillTimer} LocutionProPollUpgradeScan
FunctionEnd

Function LocutionProScanPageLeave
  ${If} $LocutionProScanComplete != 1
    Abort
  ${EndIf}
FunctionEnd

Function LocutionProCloseUpgradeScan
  ${If} $LocutionProScanProcess != 0
  ${AndIf} $LocutionProScanProcess != ""
    System::Call 'kernel32::TerminateProcess(p $LocutionProScanProcess, i2)'
    System::Call 'kernel32::CloseHandle(p $LocutionProScanProcess)'
    StrCpy $LocutionProScanProcess 0
  ${EndIf}
FunctionEnd

Function LocutionProPollUpgradeScan
  System::Call 'kernel32::GetExitCodeProcess(p $LocutionProScanProcess, *i.r0) i.r1'
  ${If} $1 != 0
  ${AndIf} $0 == 259
    Return
  ${EndIf}
  ${NSD_KillTimer} LocutionProPollUpgradeScan
  ${If} $1 == 0
  ${OrIf} $0 != 0
    Call LocutionProCloseUpgradeScan
    StrCpy $1 "组件校验未完成。请检查安装目录及文件访问权限。"
    Call LocutionProUpgradeFailed
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p $LocutionProScanProcess)'
  StrCpy $LocutionProScanProcess 0
  Call LocutionProReadUpgradePlan
  StrCpy $LocutionProScanRoot $INSTDIR
  StrCpy $LocutionProScanPreviousRoot $PreviousInstallDir
  StrCpy $LocutionProScanComplete 1
  SendMessage $LocutionProScanBar ${PBM_SETMARQUEE} 0 0
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 1
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 1
  System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p1, p0)'
FunctionEnd

!macro LOCUTION_INSTALL_FILE SOURCE DESTINATION
  ReadINIStr $0 "$LocutionProReusePlan" "Payload" "${DESTINATION}"
  ${If} $0 == ""
    SetErrorLevel 2
    Abort "安装包资源清单不完整：${DESTINATION}"
  ${EndIf}
  ReadINIStr $0 "$LocutionProReusePlan" "Reuse" "${DESTINATION}"
  ${If} $0 != 1
    ClearErrors
    File /a "/oname=${DESTINATION}" "${SOURCE}"
    ${If} ${Errors}
      SetErrorLevel 2
      Abort "无法安装组件：${DESTINATION}"
    ${EndIf}
  ${Else}
    DetailPrint "复用已校验组件：${DESTINATION}"
  ${EndIf}
!macroend
