!define LOCUTION_HAS_REGISTRATION_SNAPSHOT
Var LocutionProRegistrationMode
Var LocutionProRegistrationHive
Var LocutionProRegistrationView
Var LocutionProRegistrationSnapshot

!macro LOCUTION_REGISTRATION_COMMAND OUTPUT
  StrCpy ${OUTPUT} '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\registration-state.ps1" -Mode "$LocutionProRegistrationMode" -Hive "$LocutionProRegistrationHive" -View "$LocutionProRegistrationView" -ProductKey "${MANUPRODUCTKEY}" -UninstallKey "${UNINSTKEY}" -Snapshot "$LocutionProRegistrationSnapshot"'
!macroend

Function LocutionProSnapshotRegistration
  InitPluginsDir
  File "/oname=$PLUGINSDIR\registration-state.ps1" "${LOCUTION_INSTALLER_SOURCE_DIR}\registration-state.ps1"
  StrCpy $LocutionProRegistrationSnapshot "$PLUGINSDIR\registration-state.json"
  StrCpy $LocutionProRegistrationHive "CurrentUser"
  !if "${INSTALLMODE}" == "perMachine"
    StrCpy $LocutionProRegistrationHive "LocalMachine"
  !else if "${INSTALLMODE}" == "both"
    ${If} $MultiUser.InstallMode == "AllUsers"
      StrCpy $LocutionProRegistrationHive "LocalMachine"
    ${EndIf}
  !endif
  StrCpy $LocutionProRegistrationView "Registry32"
  ${If} ${RunningX64}
    !if "${ARCH}" == "x64"
      StrCpy $LocutionProRegistrationView "Registry64"
    !else if "${ARCH}" == "arm64"
      StrCpy $LocutionProRegistrationView "Registry64"
    !endif
  ${EndIf}
  StrCpy $LocutionProRegistrationMode "Snapshot"
  !insertmacro LOCUTION_REGISTRATION_COMMAND $0
  nsExec::ExecToStack $0
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 2
    Abort "无法备份安装登记，未修改应用注册信息。"
  ${EndIf}
  StrCpy $LocutionProRegistrationStarted 1
FunctionEnd

Function LocutionProRestoreRegistration
  ${If} $LocutionProRegistrationStarted != 1
    Return
  ${EndIf}
  StrCpy $LocutionProRegistrationMode "Restore"
  !insertmacro LOCUTION_REGISTRATION_COMMAND $0
  nsExec::ExecToStack $0
  Pop $0
  Pop $1
  StrCpy $LocutionProRegistrationStarted 0
  ${If} $0 != 0
    DetailPrint "安装登记恢复未完成：$1"
    ClearErrors
    GetTempFileName $2 "$INSTDIR"
    ${IfNot} ${Errors}
      CopyFiles /SILENT "$LocutionProRegistrationSnapshot" "$2"
    ${EndIf}
    StrCpy $3 "安装登记未能完整恢复，请检查注册表权限。"
    ${IfNot} ${Errors}
      StrCpy $3 "安装登记未能完整恢复。恢复快照：$2"
      DetailPrint "注册表恢复快照：$2"
    ${EndIf}
    IfSilent +2
      MessageBox MB_ICONSTOP|MB_OK "$3"
  ${EndIf}
FunctionEnd
