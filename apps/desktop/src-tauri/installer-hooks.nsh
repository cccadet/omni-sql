!define OMNI_SQL_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-runtime.ps1 "${OMNI_SQL_HOOK_DIR}\stop-runtime.ps1"
  ; A 32-bit installer needs native PowerShell to read 64-bit runtime paths.
  StrCpy $0 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $0 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  nsExec::ExecToStack '"$0" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-runtime.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    MessageBox MB_OK|MB_ICONSTOP "Unable to stop omni-sql background processes. Close omni-sql and retry the installation." /SD IDOK
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; WinGet reads this registry value instead of adding /S to UninstallString.
  WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '$\"$INSTDIR\uninstall.exe$\" /S'
  ; Seeds the app language until the user picks one in the app.
  StrCpy $0 "en"
  ${If} $LANGUAGE == 1046
    StrCpy $0 "pt-BR"
  ${ElseIf} $LANGUAGE == 2052
    StrCpy $0 "zh-CN"
  ${EndIf}
  FileOpen $1 "$INSTDIR\installer-language" w
  FileWrite $1 $0
  FileClose $1
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Not tracked by the generated uninstaller; remove it so $INSTDIR can be deleted.
  Delete "$INSTDIR\installer-language"
!macroend
