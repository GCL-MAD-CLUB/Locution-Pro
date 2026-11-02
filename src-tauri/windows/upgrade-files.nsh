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
Var LocutionProWorkerRoot
Var LocutionProWorkerPreviousRoot
Var LocutionProWorkerCompletedCallback
Var LocutionProProgressLabel
Var LocutionProProgressFileLabel
Var LocutionProPreparedInstallDir
Var LocutionProTransactionActive

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
  Delete "$LocutionProReusePlan.progress"
  StrCpy $LocutionProWorkerRoot $INSTDIR
  StrCpy $LocutionProWorkerPreviousRoot $PreviousInstallDir
FunctionEnd

!macro LOCUTION_UPGRADE_COMMAND OUTPUT
  StrCpy ${OUTPUT} '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-files.ps1" -Mode "$LocutionProUpgradeMode" -Root "$LocutionProWorkerRoot" -PreviousRoot "$LocutionProWorkerPreviousRoot" -Manifest "$PLUGINSDIR\payload-manifest.json" -Result "$LocutionProReusePlan" -MainBinary "${MAINBINARYNAME}.exe" -Ffmpeg $LocutionProBundleFfmpeg -Semantic $LocutionProBundleSemantic -Transactional 1'
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
  ${If} $LocutionProUpgradeMode == "Prepare"
    StrCpy $LocutionProTransactionActive 1
    StrCpy $LocutionProPreparedInstallDir $INSTDIR
  ${EndIf}
FunctionEnd

Function LocutionProRollbackInstall
  ${If} $LocutionProTransactionActive != 1
    Return
  ${EndIf}
  StrCpy $LocutionProUpgradeMode "Rollback"
  !insertmacro LOCUTION_UPGRADE_COMMAND $0
  nsExec::ExecToStack $0
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "自动恢复未完成，旧文件保留在安装目录中的 .locution-pro-rollback-* 文件夹：$1"
    IfSilent +2
      MessageBox MB_ICONSTOP|MB_OK "安装未完成，自动恢复遇到文件占用或权限问题。请保留安装目录中的 .locution-pro-rollback-* 文件夹以恢复旧文件。$\r$\n$1"
  ${EndIf}
  StrCpy $LocutionProTransactionActive 0
FunctionEnd

Function LocutionProCommitInstall
  ${If} $LocutionProTransactionActive != 1
    Return
  ${EndIf}
  Push $LocutionProUpgradeMode
  StrCpy $LocutionProUpgradeMode "Commit"
  !insertmacro LOCUTION_UPGRADE_COMMAND $0
  nsExec::ExecToStack $0
  Pop $0
  Pop $1
  ${If} $0 != 0
  ${AndIf} $0 != 10
    Pop $LocutionProUpgradeMode
    SetErrorLevel 2
    Abort "无法提交应用文件变更，正在恢复旧文件。"
  ${EndIf}
  ; Only cleanup failures after the durable commit boundary are non-fatal.
  StrCpy $LocutionProTransactionActive 0
  ${If} $0 == 10
    DetailPrint "操作已完成，部分旧文件备份暂未清理；不影响后续更新或卸载：$1"
    ; Silent installs have no dialogs. The worker retains a cleanup notice in
    ; the installation directory without turning a successful operation into a failure.
    IfSilent locution_commit_warning_done
      MessageBox MB_ICONEXCLAMATION|MB_OK "操作已完成，部分旧备份暂未清理，不影响后续更新或卸载。" /SD IDOK
    locution_commit_warning_done:
  ${EndIf}
  Pop $LocutionProUpgradeMode
FunctionEnd

; Only the interactive wizard scans before options. Hashing runs in a hidden
; read-only worker so the progress page and Cancel button keep responding.
Function LocutionProScanPageCreate
  Call SkipIfPassive
  ${If} $LocutionProUninstallOnly == 1
    Abort
  ${EndIf}
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
  StrCpy $LocutionProWorkerCompletedCallback 0
  Call LocutionProUpgradeProgressPageCreate
FunctionEnd

Function LocutionProUpgradeProgressPageCreate
  ${If} $LocutionProUpgradeMode == "Scan"
    !insertmacro MUI_HEADER_TEXT "检查可复用组件" "正在校验已有文件，完成后自动继续。"
  ${Else}
    !insertmacro MUI_HEADER_TEXT "正在卸载旧版本" "在当前安装程序中卸载旧应用，保留应用程序数据。"
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    StrCpy $1 "无法创建组件校验页面。"
    Call LocutionProUpgradeFailed
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "正在校验 FFmpeg、模型和依赖库。大文件较多时需要一些时间，可以取消安装。"
  Pop $LocutionProProgressLabel
  ${If} $LocutionProUpgradeMode != "Scan"
    ${NSD_SetText} $LocutionProProgressLabel "正在校验并卸载旧应用。可复用的组件和应用程序数据将保留，请等待此步骤完成。"
    ${If} $LocutionProUpgradeMode == "Uninstall"
      ${NSD_SetText} $LocutionProProgressLabel "正在卸载应用程序及其内置组件。应用程序数据将保留，请等待此步骤完成。"
    ${EndIf}
    GetDlgItem $0 $HWNDPARENT 2
    EnableWindow $0 0
  ${EndIf}
  ${NSD_CreateProgressBar} 0 32u 100% 12u ""
  Pop $LocutionProScanBar
  ${NSD_AddStyle} $LocutionProScanBar 0x8 ; PBS_MARQUEE
  SendMessage $LocutionProScanBar ${PBM_SETMARQUEE} 1 40
  ${NSD_CreateLabel} 0 54u 100% 36u ""
  Pop $LocutionProProgressFileLabel
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
  ReadINIStr $0 "$LocutionProReusePlan.progress" "Progress" "Phase"
  ${If} $0 == "hashing"
    StrCpy $0 "正在校验已有组件…"
  ${ElseIf} $0 == "checking-locks"
    StrCpy $0 "正在检查待卸载文件是否被占用…"
  ${ElseIf} $0 == "removing"
    StrCpy $0 "正在卸载旧应用…"
  ${EndIf}
  ${If} $0 != ""
    ${NSD_SetText} $LocutionProProgressLabel "$0"
  ${EndIf}
  ReadINIStr $0 "$LocutionProReusePlan.progress" "Progress" "File"
  ${NSD_SetText} $LocutionProProgressFileLabel "$0"
  System::Call 'kernel32::GetExitCodeProcess(p $LocutionProScanProcess, *i.r0) i.r1'
  ${If} $1 != 0
  ${AndIf} $0 == 259
    Return
  ${EndIf}
  ${NSD_KillTimer} LocutionProPollUpgradeScan
  ${If} $1 == 0
  ${OrIf} $0 != 0
    Call LocutionProCloseUpgradeScan
    StrCpy $1 "文件校验或旧版本卸载未完成。请检查安装目录及文件访问权限。"
    Call LocutionProUpgradeFailed
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p $LocutionProScanProcess)'
  StrCpy $LocutionProScanProcess 0
  Call LocutionProReadUpgradePlan
  StrCpy $LocutionProScanRoot $LocutionProWorkerRoot
  StrCpy $LocutionProScanPreviousRoot $LocutionProWorkerPreviousRoot
  StrCpy $LocutionProScanComplete 1
  SendMessage $LocutionProScanBar ${PBM_SETMARQUEE} 0 0
  SendMessage $LocutionProScanBar ${PBM_SETPOS} 100 0
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 1
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 1
  ${If} $LocutionProUpgradeMode == "Scan"
    GetDlgItem $0 $HWNDPARENT 3
    EnableWindow $0 1
    System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p1, p0)'
  ${Else}
    ${If} $LocutionProWorkerCompletedCallback != 0
      Call $LocutionProWorkerCompletedCallback
    ${EndIf}
    ${NSD_SetText} $LocutionProProgressLabel "旧版本卸载完成。应用程序数据已保留。"
    ${NSD_SetText} $LocutionProProgressFileLabel "点击下一步，继续选择安装位置和组件。"
    ${If} $LocutionProUpgradeMode == "Uninstall"
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
      ${NSD_SetText} $LocutionProProgressFileLabel "点击完成以退出。"
    ${EndIf}
  ${EndIf}
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
