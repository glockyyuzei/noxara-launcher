!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER

Var NoxaraCreateDesktopShortcut
Var NoxaraDesktopShortcutCheckbox

!macro customPageAfterChangeDir
  Page custom noxaraDesktopShortcutPage noxaraDesktopShortcutPageLeave
!macroend

Function noxaraDesktopShortcutPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 12u "Create shortcuts on your desktop?"
  Pop $0
  ${NSD_CreateCheckbox} 0 16u 100% 12u "Create a desktop shortcut"
  Pop $NoxaraDesktopShortcutCheckbox
  ${NSD_SetState} $NoxaraDesktopShortcutCheckbox ${BST_CHECKED}
  StrCpy $NoxaraCreateDesktopShortcut "1"
  nsDialogs::Show
FunctionEnd

Function noxaraDesktopShortcutPageLeave
  ${NSD_GetState} $NoxaraDesktopShortcutCheckbox $0
  StrCpy $NoxaraCreateDesktopShortcut $0
FunctionEnd

!macro customInstall
  ${IfNot} $NoxaraCreateDesktopShortcut == "0"
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!endif