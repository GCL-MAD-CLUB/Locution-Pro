; Maintenance UI restored from 93c5a0c; cleanup stays inside this installer.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var ReinstallPageCheck
Var LocutionProVersionRelation
Var LocutionProFreshInstall
Var LocutionProRetainedInstallDir
Var LocutionProUninstallOnly
Var LocutionProUninstallComplete
Var LocutionProInitialInstallDir
Var LocutionProPreviousSemanticChoice
Var LocutionProFreshLocationAllowed
Var LocutionProHasMaintenance

!ifndef LOCUTION_FRESH_INSTALL_ATTEMPTS
  !define LOCUTION_FRESH_INSTALL_ATTEMPTS 100
!endif

Function PageReinstall
  ${If} $LocutionProHasMaintenance != 1
    Abort
  ${EndIf}
  ${If} $LocutionProUninstallComplete == 1
    Abort
  ${EndIf}
  ${If} $LocutionProFreshInstall == 1
    StrCpy $PreviousInstallDir $LocutionProRetainedInstallDir
  ${EndIf}
  ${If} $PreviousInstallDir == ""
    Abort
  ${EndIf}
  Call LocutionProPrepareMaintenanceText
  ${If} $PassiveMode = 1
    StrCpy $ReinstallPageCheck 1
    Call PageLeaveReinstall
    Abort
  ${EndIf}
  Call LocutionProShowMaintenanceDialog
FunctionEnd

Function LocutionProPrepareMaintenanceText
  ; Preserve the original version-specific maintenance text and header.
  StrCpy $R4 "$(older)"
  ReadRegStr $R0 SHCTX "$PreviousUninstallKey" "DisplayVersion"
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  Call LocutionProComparePreviousVersion
  StrCpy $R0 $LocutionProVersionRelation
  ; Reinstalling the same version
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ; Upgrading
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ; Downgrading
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${Else}
    Abort
  ${EndIf}
FunctionEnd

Function LocutionProShowMaintenanceDialog
  nsDialogs::Create 1018
  Pop $R4
  ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

  ${NSD_CreateLabel} 0 0 100% 24u $R1
  Pop $R1

  ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
  Pop $R2
  ${NSD_OnClick} $R2 PageReinstallUpdateSelection

  ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
  Pop $R3
  ; Disable this radio button if downgrading and downgrades are disabled
  !if "${ALLOWDOWNGRADES}" == "false"
    ${IfThen} $R0 = -1 ${|} EnableWindow $R3 0 ${|}
  !endif
  ${NSD_OnClick} $R3 PageReinstallUpdateSelection

  ; Check the first radio button if this the first time
  ; we enter this page or if the second button wasn't
  ; selected the last time we were on this page
  ${If} $ReinstallPageCheck <> 2
    SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
  ${Else}
    SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
  ${EndIf}

  ${NSD_SetFocus} $R2
  nsDialogs::Show
FunctionEnd

Function LocutionProComparePreviousVersion
  StrCpy $LocutionProVersionRelation 1
  ReadRegStr $0 SHCTX "$PreviousUninstallKey" "DisplayVersion"
  ${If} $PreviousInstallDir != ""
  ${AndIf} $0 != ""
    nsis_tauri_utils::SemverCompare "${VERSION}" $0
    Pop $LocutionProVersionRelation
  ${EndIf}
FunctionEnd

Function LocutionProDetectMaintenance
  StrCpy $LocutionProHasMaintenance 0
  ${If} $PreviousInstallDir == ""
    Return
  ${EndIf}
  ReadRegStr $0 SHCTX "$PreviousUninstallKey" "UninstallString"
  ${If} $0 != ""
  ${OrIf} ${FileExists} "$PreviousInstallDir\${MAINBINARYNAME}.exe"
    StrCpy $LocutionProHasMaintenance 1
  ${EndIf}
FunctionEnd

Function PageLeaveReinstall
  ${If} $PassiveMode != 1
    Call PageReinstallUpdateSelection
  ${EndIf}
  Call LocutionProApplyMaintenanceChoice
FunctionEnd

Function LocutionProApplyMaintenanceChoice
  StrCpy $LocutionProUninstallOnly 0
  ${If} $ReinstallPageCheck == 2
    ${If} $LocutionProVersionRelation == 0
      StrCpy $LocutionProUninstallOnly 1
    ${Else}
      Call LocutionProChooseFreshInstall
      Return
    ${EndIf}
  ${EndIf}
  ${If} $LocutionProFreshInstall == 1
    StrCpy $INSTDIR $PreviousInstallDir
  ${EndIf}
  StrCpy $LocutionProFreshInstall 0
  StrCpy $LocutionProBundleSemantic $LocutionProPreviousSemanticChoice
FunctionEnd

Function LocutionProChooseFreshInstall
  StrCpy $LocutionProRetainedInstallDir $PreviousInstallDir
  StrCpy $LocutionProFreshInstall 1
  Call LocutionProFreshInstallBase
  Call LocutionProFindFreshInstallLocation
  ${If} $LocutionProFreshLocationAllowed != 1
    ; Keep the previous installation intact if no new directory can be offered.
    StrCpy $LocutionProFreshInstall 0
    StrCpy $INSTDIR $PreviousInstallDir
    MessageBox MB_ICONEXCLAMATION|MB_OK "无法自动选择新的安装目录。请选择“安装前卸载”，或退出后更换安装位置重试。"
    Abort
  ${EndIf}
  StrCpy $PreviousInstallDir ""
  StrCpy $UpdateMode 0
  StrCpy $LocutionProBundleFfmpeg 1
  StrCpy $LocutionProBundleSemantic 1
  StrCpy $LocutionProReuseFfmpeg 0
  StrCpy $LocutionProReuseSemantic 0
  StrCpy $LocutionProScanComplete 0
FunctionEnd

Function LocutionProFreshInstallBase
  ; Validate before assigning $INSTDIR: NSIS strips invalid path characters
  ; when writing that variable, which would otherwise hide malformed input.
  StrCpy $4 $LocutionProInitialInstallDir
  !if "${INSTALLMODE}" == "both"
    ${If} $4 == "${PLACEHOLDER_INSTALL_DIR}"
      StrCpy $4 "$LOCALAPPDATA\${PRODUCTNAME}"
      ${If} $MultiUser.InstallMode == "AllUsers"
        StrCpy $4 "$PROGRAMFILES\${PRODUCTNAME}"
        ${If} ${RunningX64}
          StrCpy $4 "$PROGRAMFILES64\${PRODUCTNAME}"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !endif
  Push $4
  Call NormalizeInstallPath
  Pop $4
  ${If} $4 == ""
    StrCpy $INSTDIR $LocutionProRetainedInstallDir
    Return
  ${EndIf}
  StrCpy $INSTDIR $4
  Call LocutionProCheckFreshInstallLocation
  StrCpy $4 $INSTDIR
  Call CheckIndependentInstallLocation
  ${If} $LocutionProFreshLocationAllowed != 1
  ${OrIf} $IndependentInstallLocation != 1
    ; Suffixing an invalid path or a descendant can never escape the old tree.
    ; Start from the old directory itself so numbered candidates are siblings.
    StrCpy $INSTDIR $LocutionProRetainedInstallDir
  ${EndIf}
FunctionEnd

Function LocutionProFindFreshInstallLocation
  StrCpy $R5 $INSTDIR
  StrCpy $R4 1
  fresh_install_location:
    ${If} $R4 > ${LOCUTION_FRESH_INSTALL_ATTEMPTS}
      StrCpy $LocutionProFreshLocationAllowed 0
      Return
    ${EndIf}
    Call LocutionProCheckFreshInstallLocation
    StrCpy $4 $INSTDIR
    Call CheckIndependentInstallLocation
    ${If} $LocutionProFreshLocationAllowed == 1
    ${AndIf} $IndependentInstallLocation == 1
    ${AndIfNot} ${FileExists} "$INSTDIR\*.*"
      Return
    ${EndIf}
    IntOp $R4 $R4 + 1
    StrCpy $INSTDIR "$R5 ($R4)"
    Goto fresh_install_location
FunctionEnd

Function LocutionProCheckFreshInstallLocation
  Push $R8
  Push $R9
  Push $R7
  Push $R6
  StrCpy $LocutionProFreshLocationAllowed 1
  ${If} $LocutionProFreshInstall != 1
    Goto fresh_location_done
  ${EndIf}
  Push $INSTDIR
  Call NormalizeInstallPath
  Pop $R8
  Push $LocutionProRetainedInstallDir
  Call NormalizeInstallPath
  Pop $R9
  ${If} $R8 == ""
  ${OrIf} $R9 == ""
    StrCpy $LocutionProFreshLocationAllowed 0
    Goto fresh_location_done
  ${EndIf}
  StrLen $R7 "$R9\"
  StrCpy $R6 "$R8\" $R7
  ${If} $R6 == "$R9\"
    StrCpy $LocutionProFreshLocationAllowed 0
  ${EndIf}
  StrLen $R7 "$R8\"
  StrCpy $R6 "$R9\" $R7
  ${If} $R6 == "$R8\"
    StrCpy $LocutionProFreshLocationAllowed 0
  ${EndIf}
  fresh_location_done:
  Pop $R6
  Pop $R7
  Pop $R9
  Pop $R8
FunctionEnd

Function LocutionProDirectoryLeave
  Call LocutionProCheckFreshInstallLocation
  ${If} $LocutionProFreshLocationAllowed != 1
    MessageBox MB_ICONEXCLAMATION|MB_OK "已选择“请勿卸载”，请为全新安装选择旧安装目录之外的位置。"
    Abort
  ${EndIf}
FunctionEnd

Function LocutionProUninstallPageCreate
  Call SkipIfPassive
  ${If} $PreviousInstallDir == ""
  ${OrIf} $LocutionProHasMaintenance != 1
  ${OrIf} $LocutionProFreshInstall == 1
  ${OrIf} $LocutionProUninstallComplete == 1
    Abort
  ${EndIf}
  Call LocutionProCheckRunningApp
  StrCpy $LocutionProUpgradeMode "Upgrade"
  ${If} $LocutionProUninstallOnly == 1
    StrCpy $LocutionProUpgradeMode "Uninstall"
  ${EndIf}
  Call LocutionProExtractUpgradeTools
  StrCpy $LocutionProWorkerRoot $PreviousInstallDir
  GetFunctionAddress $LocutionProWorkerCompletedCallback LocutionProFinishEmbeddedUninstall
  Call LocutionProUpgradeProgressPageCreate
FunctionEnd

Function LocutionProUninstallPageLeave
  ${If} $LocutionProUninstallComplete != 1
    Abort
  ${EndIf}
  ${If} $LocutionProUninstallOnly == 1
    SetErrorLevel 0
    Quit
  ${EndIf}
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
