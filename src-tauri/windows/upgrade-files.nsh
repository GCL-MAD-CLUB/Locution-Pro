!include "LogicLib.nsh"

Var LocutionProReusePlan
Var LocutionProUpgradeMode

!ifndef LOCUTION_PAYLOAD_MANIFEST
  !define LOCUTION_PAYLOAD_MANIFEST "${LOCUTION_INSTALLER_SOURCE_DIR}\..\target\installer\payload-manifest.json"
!endif

; All hash decisions come from this installer's embedded manifest, never from
; metadata left by a previous installation. Scan is read-only; Prepare rehashes.
Function LocutionProPlanUpgrade
  InitPluginsDir
  File "/oname=$PLUGINSDIR\upgrade-files.ps1" "${LOCUTION_INSTALLER_SOURCE_DIR}\upgrade-files.ps1"
  File "/oname=$PLUGINSDIR\payload-manifest.json" "${LOCUTION_PAYLOAD_MANIFEST}"
  StrCpy $LocutionProReusePlan "$PLUGINSDIR\reuse-plan.ini"
  DetailPrint "正在校验已有组件，请稍候…"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-files.ps1" -Mode "$LocutionProUpgradeMode" -Root "$INSTDIR" -PreviousRoot "$PreviousInstallDir" -Manifest "$PLUGINSDIR\payload-manifest.json" -Result "$LocutionProReusePlan" -MainBinary "${MAINBINARYNAME}.exe" -Ffmpeg $LocutionProBundleFfmpeg -Semantic $LocutionProBundleSemantic'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    IfSilent +2
      MessageBox MB_ICONSTOP|MB_OK "无法安全更新应用文件。请关闭 Locution Pro 及占用其组件的程序，检查目录权限后重试。$\r$\n$1"
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadINIStr $LocutionProReuseFfmpeg "$LocutionProReusePlan" "Components" "Ffmpeg"
  ReadINIStr $LocutionProReuseSemantic "$LocutionProReusePlan" "Components" "Semantic"
FunctionEnd

Function LocutionProScanUpgrade
  StrCpy $LocutionProUpgradeMode "Scan"
  Call LocutionProPlanUpgrade
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
