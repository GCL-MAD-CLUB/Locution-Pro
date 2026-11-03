Function LocutionProReviewPageCreate
  Call LocutionProInstallOptionsPre
  !insertmacro MUI_HEADER_TEXT "确认安装" "核对以下选项后开始安装。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 28u "安装位置：$\r$\n$INSTDIR"
  Pop $0
  StrCpy $1 "内置 FFmpeg 与 ffprobe"
  ${If} $LocutionProBundleFfmpeg != 1
    StrCpy $1 "$LocutionProFfmpegPath"
  ${EndIf}
  ${NSD_CreateLabel} 0 32u 100% 22u "媒体工具：$1"
  Pop $0
  StrCpy $1 "语义检索：安装"
  ${If} $LocutionProBundleSemantic != 1
    StrCpy $1 "语义检索：不安装"
  ${EndIf}
  ${NSD_CreateLabel} 0 58u 100% 20u "$1"
  Pop $0
  ${If} $LocutionProFreshInstall == 1
    ${NSD_CreateLabel} 0 82u 100% 26u "新副本将接管打开方式，并共享用户数据。"
    Pop $0
  ${EndIf}
  StrCpy $MigrationReviewCheckbox 0
  Call CheckMigrationAllowed
  ${If} $MigrationAllowed == 1
    ${NSD_CreateCheckbox} 0 112u 100% 14u "复制 LineCut 设置与数据"
    Pop $MigrationReviewCheckbox
    ${If} $MigrationOptOut != 1
      ${NSD_Check} $MigrationReviewCheckbox
    ${EndIf}
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function LocutionProReviewPageLeave
  ${If} $MigrationReviewCheckbox != 0
    ${NSD_GetState} $MigrationReviewCheckbox $0
    StrCpy $MigrationOptOut 0
    ${If} $0 != ${BST_CHECKED}
      StrCpy $MigrationOptOut 1
    ${EndIf}
  ${EndIf}
FunctionEnd
