!include "LogicLib.nsh"
!include "nsDialogs.nsh"
Var LocutionProUninstallOnly
!include "${__FILEDIR__}\semantic-options.nsh"
!define LOCUTION_INSTALLER_SOURCE_DIR "${__FILEDIR__}"

Var LocutionProBundleFfmpeg
Var LocutionProFfmpegPath
Var LocutionProFfprobePath
Var LocutionProBundledRadio
Var LocutionProExternalRadio
Var LocutionProFfmpegInput
Var LocutionProReuseFfmpeg
Var LocutionProPreviousFfmpegChoice
Var LocutionProFfmpegError
Var LocutionProFfmpegErrorLabel

Function LocutionProFindPathFfmpeg
  Push $R0
  Push $R1
  Push $R2
  StrCpy $LocutionProFfmpegPath ""
  ; Pass the full environment PATH directly to Win32; NSIS strings can be
  ; shorter than PATH. An explicit search list also avoids searching CWD.
  System::Call 'kernel32::GetEnvironmentVariableW(w "PATH", p0, i0) i.R0'
  ${If} $R0 <= 1
    Goto locution_find_ffmpeg_done
  ${EndIf}
  IntOp $R1 $R0 * 2
  System::Alloc $R1
  Pop $R2
  ${If} $R2 == 0
    Goto locution_find_ffmpeg_done
  ${EndIf}
  System::Call 'kernel32::GetEnvironmentVariableW(w "PATH", p R2, i R0) i.R1'
  ${If} $R1 > 0
  ${AndIf} $R1 < $R0
    System::Call 'kernel32::SearchPathW(p R2, w "ffmpeg.exe", p0, i ${NSIS_MAX_STRLEN}, w .R1, p0) i.R0'
    ${If} $R0 > 0
    ${AndIf} $R0 < ${NSIS_MAX_STRLEN}
      StrCpy $LocutionProFfmpegPath $R1
    ${EndIf}
  ${EndIf}
  System::Free $R2
locution_find_ffmpeg_done:
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Function LocutionProDetectFfmpeg
  Call LocutionProFindPathFfmpeg
  ${If} $LocutionProFfmpegPath == ""
    StrCpy $LocutionProFfmpegPath "ffmpeg"
    IfFileExists "$PROGRAMFILES\ffmpeg\bin\ffmpeg.exe" 0 +3
      StrCpy $LocutionProFfmpegPath "$PROGRAMFILES\ffmpeg\bin\ffmpeg.exe"
      Goto locution_pro_detect_done
    IfFileExists "$PROGRAMFILES64\ffmpeg\bin\ffmpeg.exe" 0 +3
      StrCpy $LocutionProFfmpegPath "$PROGRAMFILES64\ffmpeg\bin\ffmpeg.exe"
      Goto locution_pro_detect_done
    IfFileExists "$LOCALAPPDATA\ffmpeg\bin\ffmpeg.exe" 0 locution_pro_detect_done
      StrCpy $LocutionProFfmpegPath "$LOCALAPPDATA\ffmpeg\bin\ffmpeg.exe"
  ${EndIf}
locution_pro_detect_done:
FunctionEnd

Function LocutionProUpdateFfmpegControls
  ${NSD_GetState} $LocutionProExternalRadio $0
  ${If} $0 == ${BST_CHECKED}
    EnableWindow $LocutionProFfmpegInput 1
    SendMessage $LocutionProFfmpegInput ${EM_SETSEL} 0 -1
  ${Else}
    EnableWindow $LocutionProFfmpegInput 0
    ${NSD_SetText} $LocutionProFfmpegErrorLabel ""
    StrCpy $LocutionProFfmpegError ""
  ${EndIf}
FunctionEnd

Function LocutionProFfmpegSelectionChanged
  Pop $0
  Call LocutionProUpdateFfmpegControls
FunctionEnd

Function LocutionProFfmpegPageCreate
  Call SkipIfPassive
  ${If} $LocutionProUninstallOnly == 1
    Abort
  ${EndIf}
  ${If} $LocutionProFfmpegPath == ""
    Call LocutionProDetectFfmpeg
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "媒体工具" "选择 FFmpeg 与 ffprobe 的来源。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 0 8u 100% 12u "使用内置工具（推荐）"
  Pop $LocutionProBundledRadio
  ${NSD_CreateRadioButton} 0 30u 100% 12u "使用已有 FFmpeg"
  Pop $LocutionProExternalRadio
  ${NSD_CreateLabel} 12u 54u 88% 12u "ffmpeg.exe 路径："
  Pop $0
  ${NSD_CreateText} 12u 72u 88% 14u "$LocutionProFfmpegPath"
  Pop $LocutionProFfmpegInput
  ${NSD_CreateLabel} 12u 94u 88% 22u "同目录需有 ffprobe.exe。填写 ffmpeg 可从 PATH 查找。"
  Pop $0
  ${NSD_CreateLabel} 12u 122u 88% 18u ""
  Pop $LocutionProFfmpegErrorLabel

  ${If} $LocutionProBundleFfmpeg == 1
    ${NSD_Check} $LocutionProBundledRadio
  ${Else}
    ${NSD_Check} $LocutionProExternalRadio
  ${EndIf}
  ${NSD_OnClick} $LocutionProBundledRadio LocutionProFfmpegSelectionChanged
  ${NSD_OnClick} $LocutionProExternalRadio LocutionProFfmpegSelectionChanged
  Call LocutionProUpdateFfmpegControls
  nsDialogs::Show
FunctionEnd

Function LocutionProFfmpegPageLeave
  ${If} $LocutionProUninstallOnly == 1
    Return
  ${EndIf}
  StrCpy $LocutionProFfmpegError ""
  ${NSD_SetText} $LocutionProFfmpegErrorLabel ""
  ${NSD_GetState} $LocutionProBundledRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $LocutionProBundleFfmpeg 1
    Return
  ${EndIf}

  ${NSD_GetText} $LocutionProFfmpegInput $LocutionProFfmpegPath
  ${If} $LocutionProFfmpegPath == "ffmpeg"
  ${OrIf} $LocutionProFfmpegPath == "ffmpeg.exe"
    Call LocutionProFindPathFfmpeg
    ${If} $LocutionProFfmpegPath == ""
      StrCpy $LocutionProFfmpegError "PATH 中未找到 ffmpeg.exe。"
      Goto locution_pro_ffmpeg_invalid
    ${EndIf}
  ${EndIf}
  ; Validate syntax before NSIS can sanitize it, and derive the sibling by
  ; directory rather than blindly stripping ten characters from user input.
  Push $LocutionProFfmpegPath
  Call NormalizeInstallPath
  Pop $0
  StrCpy $LocutionProFfmpegError "请选择 ffmpeg.exe 文件。"
  ${If} $0 == ""
    Goto locution_pro_ffmpeg_invalid
  ${EndIf}
  ${GetFileName} "$0" $1
  ${If} $1 != "ffmpeg.exe"
    Goto locution_pro_ffmpeg_invalid
  ${EndIf}
  StrCpy $LocutionProFfmpegPath $0
  ${GetParent} "$0" $1
  StrCpy $LocutionProFfprobePath "$1\ffprobe.exe"
  StrCpy $LocutionProFfmpegError "找不到 ffmpeg.exe，请检查路径。"
  IfFileExists "$LocutionProFfmpegPath" 0 locution_pro_ffmpeg_invalid
  StrCpy $LocutionProFfmpegError "同目录未找到 ffprobe.exe。"
  IfFileExists "$LocutionProFfprobePath" 0 locution_pro_ffmpeg_invalid
  StrCpy $LocutionProFfmpegError "请选择 ffmpeg.exe 文件。"
  System::Call 'kernel32::GetFileAttributesW(w "$LocutionProFfmpegPath") i.r0'
  IntOp $0 $0 & 0x10
  ${If} $0 != 0
    Goto locution_pro_ffmpeg_invalid
  ${EndIf}
  StrCpy $LocutionProFfmpegError "同目录的 ffprobe.exe 不是可用文件。"
  System::Call 'kernel32::GetFileAttributesW(w "$LocutionProFfprobePath") i.r0'
  IntOp $0 $0 & 0x10
  ${If} $0 != 0
    Goto locution_pro_ffmpeg_invalid
  ${EndIf}
  StrCpy $LocutionProBundleFfmpeg 0
  StrCpy $LocutionProFfmpegError ""
  Return
locution_pro_ffmpeg_invalid:
  ${NSD_SetText} $LocutionProFfmpegErrorLabel "$LocutionProFfmpegError"
  Abort
FunctionEnd

!macro LocutionProWriteMediaPath TEXT
  FileWriteUTF16LE $0 "${TEXT}"
  ${If} ${Errors}
    FileClose $0
    DetailPrint "无法保存安装器中的媒体工具选项，请检查目录权限。"
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; An empty current file records the bundled choice and prevents migration
  ; from restoring the previous installer's external-tool selection.
  CreateDirectory "$MigrationDataRoot"
  ClearErrors
  FileOpen $0 "$MigrationDataRoot\installer-media-paths.ini" w
  ${If} ${Errors}
    DetailPrint "无法保存安装器中的媒体工具选项，请检查目录权限。"
    SetErrorLevel 2
    Abort
  ${EndIf}
  FileWriteUTF16LE /BOM $0 ""
  ${If} ${Errors}
    FileClose $0
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${If} $LocutionProBundleFfmpeg != 1
    !insertmacro LocutionProWriteMediaPath "ffmpeg_path=$LocutionProFfmpegPath$\r$\n"
    !insertmacro LocutionProWriteMediaPath "ffprobe_path=$LocutionProFfprobePath$\r$\n"
  ${EndIf}
  FileClose $0
  ${If} ${Errors}
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend
