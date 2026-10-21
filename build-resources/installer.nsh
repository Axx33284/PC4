; electron-builder includes this in PC4's installer (build-resources/installer.nsh): next to the normal "PC4"
; shortcut it adds "PC4 Console Mode", which opens PC4 straight into Console Mode (PC4.exe --fullscreen).
!macro customInstall
  CreateShortCut "$DESKTOP\PC4 Console Mode.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--fullscreen" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateShortCut "$SMPROGRAMS\PC4 Console Mode.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--fullscreen" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\PC4 Console Mode.lnk"
  Delete "$SMPROGRAMS\PC4 Console Mode.lnk"
!macroend
