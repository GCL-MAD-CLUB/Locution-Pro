!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var IndependentInstallLocation
Var LocutionProPathSafe
Var LocutionProInstallerMutex

!macro LOCUTION_INSTALLER_MUTEX
  System::Call 'kernel32::CreateMutexW(p0, i0, w "Global\LocutionProInstaller") p.r0 ?e'
  Pop $1
  StrCpy $LocutionProInstallerMutex $0
  ${If} $0 == 0
  ${OrIf} $1 == 183
    IfSilent +2
      MessageBox MB_ICONEXCLAMATION|MB_OK "另一个 Locution Pro 安装或卸载程序正在运行。请先关闭它，再重试。"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

; Check existing leaves and every ancestor, including missing descendants below
; junctions. The uninstaller uses the same check before any filesystem mutation.
!macro LOCUTION_PLAIN_PATH_FUNCTION PREFIX
Function ${PREFIX}CheckPlainPath
  Exch $R5
  Push $R6
  Push $R7
  StrCpy $LocutionProPathSafe 0
  StrCpy $R6 $R5 1 1
  ${If} $R6 != ":"
    Goto plain_path_done
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w R5, i ${NSIS_MAX_STRLEN}, w .R5, p0) i.R6'
  ${If} $R6 == 0
  ${OrIf} $R6 >= ${NSIS_MAX_STRLEN}
    Goto plain_path_done
  ${EndIf}
  StrLen $R6 $R5
  ${If} $R6 <= 3
    Goto plain_path_done
  ${EndIf}
  ${If} $R5 == $PROFILE
  ${OrIf} $R5 == $LOCALAPPDATA
  ${OrIf} $R5 == $APPDATA
  ${OrIf} $R5 == $PROGRAMFILES
  ${OrIf} $R5 == $PROGRAMFILES64
  ${OrIf} $R5 == $WINDIR
    Goto plain_path_done
  ${EndIf}
  StrLen $R6 "$WINDIR\"
  StrCpy $R7 $R5 $R6
  ${If} $R7 == "$WINDIR\"
    Goto plain_path_done
  ${EndIf}
  plain_path_loop:
    System::Call 'kernel32::GetFileAttributesW(w R5) i.R6 ?e'
    Pop $R7
    ${If} $R6 == -1
      ${If} $R7 != 2
      ${AndIf} $R7 != 3
        Goto plain_path_done
      ${EndIf}
    ${Else}
      IntOp $R6 $R6 & 0x400
      ${If} $R6 != 0
        Goto plain_path_done
      ${EndIf}
    ${EndIf}
    ${GetParent} "$R5" $R6
    StrLen $R7 $R6
    ${If} $R7 == 2
      StrCpy $R6 "$R6\"
    ${EndIf}
    ${If} $R6 == ""
    ${OrIf} $R6 == $R5
      StrCpy $LocutionProPathSafe 1
      Goto plain_path_done
    ${EndIf}
    StrCpy $R5 $R6
    Goto plain_path_loop
  plain_path_done:
  Pop $R7
  Pop $R6
  Pop $R5
FunctionEnd
!macroend
!insertmacro LOCUTION_PLAIN_PATH_FUNCTION ""
!insertmacro LOCUTION_PLAIN_PATH_FUNCTION "un."

; Stack in/out. Unlike the NSIS instruction, Win32 normalization accepts missing leaves.
Function NormalizeInstallPath
  Exch $R8
  Push $R9
  Push $R7
  Push $R6
  Push $R5
  ClearErrors
  ${If} $R8 == ""
    Goto normalize_install_failed
  ${EndIf}
  ; Relative, drive-relative, UNC and device paths must never depend on CWD.
  StrCpy $R9 $R8 1 1
  ${If} $R9 != ":"
    Goto normalize_install_failed
  ${EndIf}
  StrCpy $R9 $R8 1 2
  ${If} $R9 != "\"
  ${AndIf} $R9 != "/"
    Goto normalize_install_failed
  ${EndIf}
  StrCpy $R7 0
  normalize_install_character:
    StrCpy $R9 $R8 1 $R7
    ${If} $R9 == ""
      Goto normalize_install_api
    ${EndIf}
    ${If} $R9 == '$\"'
    ${OrIf} $R9 == "<"
    ${OrIf} $R9 == ">"
    ${OrIf} $R9 == "|"
    ${OrIf} $R9 == "*"
    ${OrIf} $R9 == "?"
    ${OrIf} $R9 == "$\r"
    ${OrIf} $R9 == "$\n"
    ${OrIf} $R9 == "$\t"
      Goto normalize_install_failed
    ${EndIf}
    ${If} $R9 == ":"
    ${AndIf} $R7 != 1
      Goto normalize_install_failed
    ${EndIf}
    IntOp $R7 $R7 + 1
    Goto normalize_install_character
  normalize_install_api:
    System::Call 'kernel32::GetFullPathNameW(w R8, i ${NSIS_MAX_STRLEN}, w .R8, p0) i.R9'
    ${If} $R9 = 0
    ${OrIf} $R9 >= ${NSIS_MAX_STRLEN}
    ${OrIf} $R8 == ""
      Goto normalize_install_failed
    ${EndIf}
    ; Expand 8.3 aliases in the existing prefix, retaining missing leaves.
    ; String-only comparisons must agree with Windows directory identity.
    StrCpy $R7 $R8
    StrCpy $R6 ""
    normalize_install_existing:
      StrLen $R9 $R7
      ${If} $R9 == 2
        StrCpy $R7 "$R7\"
      ${EndIf}
      System::Call 'kernel32::GetLongPathNameW(w R7, w .R5, i ${NSIS_MAX_STRLEN}) i.R9 ?e'
      Pop $R8
      ${If} $R9 > 0
      ${AndIf} $R9 < ${NSIS_MAX_STRLEN}
        StrCpy $R9 $R5 1 -1
        ${If} $R9 == "\"
          StrCpy $R5 $R5 -1
        ${EndIf}
        StrLen $R9 $R5
        StrLen $R8 $R6
        IntOp $R9 $R9 + $R8
        ${If} $R9 >= ${NSIS_MAX_STRLEN}
          Goto normalize_install_failed
        ${EndIf}
        StrCpy $R8 "$R5$R6"
        Goto normalize_install_trim
      ${EndIf}
      ${If} $R8 != 2
      ${AndIf} $R8 != 3
        Goto normalize_install_failed
      ${EndIf}
      ${GetFileName} "$R7" $R9
      StrCpy $R6 "\$R9$R6"
      ${GetParent} "$R7" $R5
      ${If} $R5 == ""
      ${OrIf} $R5 == $R7
        Goto normalize_install_failed
      ${EndIf}
      StrCpy $R7 $R5
      Goto normalize_install_existing
    ; Trim separators so comparisons have exactly one boundary separator.
    normalize_install_trim:
      StrLen $R9 $R8
      ${If} $R9 <= 3
        Goto normalize_install_failed
      ${EndIf}
      StrCpy $R9 $R8 1 -1
      ${If} $R9 == "\"
        StrCpy $R8 $R8 -1
        Goto normalize_install_trim
      ${EndIf}
    Goto normalize_install_done
  normalize_install_failed:
    StrCpy $R8 ""
    SetErrors
  normalize_install_done:
    Pop $R5
    Pop $R6
    Pop $R7
    Pop $R9
    Exch $R8
FunctionEnd

; $4 is the candidate directory. Neither automatic restoration nor /D may target LineCut.
Function CheckIndependentInstallLocation
  Push $R8
  Push $R9
  StrCpy $IndependentInstallLocation 0
  ${If} $4 == ""
    StrCpy $IndependentInstallLocation 0
    Goto independent_location_done
  ${EndIf}
  Push $4
  Call NormalizeInstallPath
  Pop $R8
  ${If} ${Errors}
  ${OrIf} $R8 == ""
    Goto independent_location_done
  ${EndIf}
  StrCpy $IndependentInstallLocation 1
  Push $R8
  Call CheckPlainPath
  ${If} $LocutionProPathSafe != 1
    StrCpy $IndependentInstallLocation 0
    Goto independent_location_done
  ${EndIf}
  independent_location_loop:
    ${GetFileName} "$R8" $R9
    ; Reject aliases instead of allowing a normalized string to hide them.
    Push $R7
    StrCpy $R7 $R9 1 -1
    ${If} $R7 == "."
    ${OrIf} $R7 == " "
      Pop $R7
      StrCpy $IndependentInstallLocation 0
      Goto independent_location_done
    ${EndIf}
    Pop $R7
    ; Win32 treats trailing dots/spaces as aliases of the same directory component.
    independent_component_trim:
      Push $R7
      StrCpy $R7 $R9 1 -1
      ${If} $R7 == "."
      ${OrIf} $R7 == " "
        StrCpy $R9 $R9 -1
        Pop $R7
        Goto independent_component_trim
      ${EndIf}
      Pop $R7
    ${If} $R9 == "LineCut"
    ${OrIf} ${FileExists} "$R8\linecut.exe"
      StrCpy $IndependentInstallLocation 0
      Goto independent_location_done
    ${EndIf}
    ${GetParent} "$R8" $R9
    ${If} $R9 != ""
    ${AndIf} $R9 != $R8
      StrCpy $R8 $R9
      Goto independent_location_loop
    ${EndIf}
  independent_location_done:
  Pop $R9
  Pop $R8
FunctionEnd

Function EnsureIndependentInstallLocation
  Push $4
  Push $INSTDIR
  Call NormalizeInstallPath
  Pop $4
  Call CheckIndependentInstallLocation
  ${If} $IndependentInstallLocation = 1
    StrCpy $INSTDIR $4
  ${EndIf}
  Pop $4
  ${If} $IndependentInstallLocation != 1
    DetailPrint "安装目录无效，请选择本地磁盘上的独立应用目录。"
    IfSilent +2
      MessageBox MB_ICONEXCLAMATION|MB_OK "请选择本地磁盘上的独立应用目录，不能使用磁盘根目录、相对路径、链接目录或 LineCut 目录。"
    SetErrorLevel 2
    Abort
  ${EndIf}
FunctionEnd

; Register our own Open With entry without taking over another application's default.
!macro LOCUTION_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
    ; A per-machine default is also a foreign association for a per-user install.
    ReadRegStr $R0 HKLM "Software\Classes\.${EXT}" ""
    ${If} $R0 == ""
      WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "${FILECLASS}"
    ${EndIf}
  ${EndIf}
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}" ""
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}" "" `${DESCRIPTION}`
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\DefaultIcon" "" `${ICON}`
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\shell\open" "" `${COMMANDTEXT}`
  WriteRegStr SHCTX "Software\Classes\${FILECLASS}\shell\open\command" "" `${COMMAND}`
!macroend

!macro LOCUTION_UNASSOCIATE EXT FILECLASS
  ; A retained older copy must not remove the active copy's Open With entry.
  ReadRegStr $R0 SHCTX "Software\Classes\${FILECLASS}\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  ${OrIf} $R0 == '$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\"'
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  ${If} $R0 == "${FILECLASS}"
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  DeleteRegKey SHCTX "Software\Classes\${FILECLASS}"
  ${EndIf}
!macroend
