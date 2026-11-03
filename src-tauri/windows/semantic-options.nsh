!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var LocutionProBundleSemantic
Var LocutionProSemanticCheckbox
Var LocutionProReuseSemantic

Function LocutionProSemanticSelectionChanged
  Pop $0
  ${NSD_GetState} $LocutionProSemanticCheckbox $LocutionProBundleSemantic
FunctionEnd

Function LocutionProSemanticPageCreate
  Call SkipIfPassive
  ${If} $LocutionProUninstallOnly == 1
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "语义检索" "按画面描述或对白含义搜索。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 8u 100% 12u "安装语义检索组件"
  Pop $LocutionProSemanticCheckbox
  ${NSD_SetState} $LocutionProSemanticCheckbox $LocutionProBundleSemantic
  ${NSD_OnClick} $LocutionProSemanticCheckbox LocutionProSemanticSelectionChanged
  ${NSD_CreateLabel} 0 34u 100% 32u "模型在本机运行，需要额外磁盘空间。不安装时不显示“语义”搜索。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function LocutionProSemanticPageLeave
  ${If} $LocutionProUninstallOnly == 1
    Return
  ${EndIf}
  ${NSD_GetState} $LocutionProSemanticCheckbox $LocutionProBundleSemantic
FunctionEnd
