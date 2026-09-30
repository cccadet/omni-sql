!macro NSIS_HOOK_POSTINSTALL
  ; WinGet reads this registry value instead of adding /S to UninstallString.
  WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '$\"$INSTDIR\uninstall.exe$\" /S'
!macroend
