!ifndef LOCUTION_UPDATE_RESULT_INCLUDED
!define LOCUTION_UPDATE_RESULT_INCLUDED
Var LocutionProUpdateErrorFile
Var LocutionProUpdateCancelFile

!macro LOCUTION_UPDATE_ERROR TEXT
  ${If} $LocutionProUpdateErrorFile != ""
    Push $R8
    FileOpen $R8 "$LocutionProUpdateErrorFile" a
    FileWriteUTF16LE $R8 "${TEXT}$\r$\n"
    FileClose $R8
    Pop $R8
  ${EndIf}
!macroend

!endif
