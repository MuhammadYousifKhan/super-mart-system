; Custom NSIS hooks for the electron-builder setup (wired up by build.nsis.include).
;
; The setup carries both the 64-bit and the 32-bit app. electron-builder installs the one
; that matches Windows; this adds a "Choose Version" page so it can be picked by hand.
; The portable exe doesn't use this file and still picks automatically.

!ifndef BUILD_UNINSTALLER
  !include x64.nsh
  !include nsDialogs.nsh

  ; "" until the version page is left (silent installs never show it), then "64" or "32".
  Var posAppArch

  ; electron-builder picks the package to extract with ${RunningX64}, and has no hook for it.
  ; Wrap that test so a 32-bit choice reads as "not 64-bit"; until a choice is made it
  ; behaves exactly like the original test. ${PosWindowsIs64} keeps the original.
  !define PosWindowsIs64 `"" RunningX64 ""`
  !undef RunningX64
  !define RunningX64 `"" PosRunningX64 ""`

  !macro _PosRunningX64 _a _b _t _f
    !define _POS_LBL pos_x64_${__COUNTER__}
    StrCmp $posAppArch "32" 0 ${_POS_LBL}_check
      !if `${_f}` != ``
        Goto `${_f}`
      !else
        Goto ${_POS_LBL}_done
      !endif
    ${_POS_LBL}_check:
    !insertmacro _RunningX64 `${_a}` `${_b}` `${_t}` `${_f}`
    !if `${_f}` == ``
      ${_POS_LBL}_done:
    !endif
    !undef _POS_LBL
  !macroend
!endif

; Shown after the folder page, so it runs in the same (possibly elevated) installer
; process that does the install.
!macro customPageAfterChangeDir
  Var posArch64Radio
  Var posArch32Radio

  Page custom posArchPageShow posArchPageLeave

  Function posArchPageShow
    !insertmacro MUI_HEADER_TEXT "Choose Version" "Choose the 64-bit or 32-bit version of $(^Name)."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${If} ${PosWindowsIs64}
      ${NSD_CreateLabel} 0 0 100% 20u "This PC runs 64-bit Windows, so the 64-bit version is recommended."
    ${Else}
      ${NSD_CreateLabel} 0 0 100% 20u "This PC runs 32-bit Windows, so only the 32-bit version can run on it."
    ${EndIf}
    Pop $0

    ${NSD_CreateRadioButton} 10u 28u 280u 14u "64-bit version (for 64-bit Windows)"
    Pop $posArch64Radio
    ${NSD_CreateRadioButton} 10u 46u 280u 14u "32-bit version (for 32-bit Windows)"
    Pop $posArch32Radio

    ${NSD_CreateLabel} 0 72u 100% 20u "Both versions work the same way and use the same saved data."
    Pop $0

    ${IfNot} ${PosWindowsIs64}
      ${NSD_SetText} $posArch64Radio "64-bit version (not supported on this PC)"
      EnableWindow $posArch64Radio 0
      ${NSD_Check} $posArch32Radio
    ${ElseIf} $posAppArch == "32"
      ${NSD_Check} $posArch32Radio
    ${Else}
      ${NSD_Check} $posArch64Radio
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function posArchPageLeave
    ${NSD_GetState} $posArch64Radio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $posAppArch "64"
    ${Else}
      StrCpy $posAppArch "32"
    ${EndIf}
    Call setInstallSectionSpaceRequired
  FunctionEnd
!macroend
