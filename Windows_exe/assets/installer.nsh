; Keep this product's identity independent of the release version. The GUID is
; also pinned in package.json to the identity shipped by the first installer.
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
  Var mineradioExistingInstallDir
  Var mineradioExistingInstallScope
  Var mineradioPerUserInstallDir
  Var mineradioPerMachineInstallDir
  Var mineradioSavedAutorun
  Var mineradioSavedStartupApproved
  Var mineradioSavedStartupApprovedSize

  ; Recover the path when only the Windows uninstall record survived. Never
  ; enumerate/delete another product or an unregistered portable executable.
  !macro mineradioReadInstallPath ROOT RESULT
    ReadRegStr ${RESULT} ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} ${RESULT} == ""
      ReadRegStr ${RESULT} ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
    ${EndIf}
    ${If} ${RESULT} == ""
      ReadRegStr $R0 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      StrCpy $R1 $R0 1
      ${If} $R1 == '$\"'
        StrCpy $R0 $R0 "" 1
        StrCpy $R1 0
        ${Do}
          StrCpy $R2 $R0 1 $R1
          ${If} $R2 == '$\"'
          ${OrIf} $R2 == ""
            ${Break}
          ${EndIf}
          IntOp $R1 $R1 + 1
        ${Loop}
        StrCpy $R0 $R0 $R1
        ${GetFileName} "$R0" $R1
        ${If} $R1 == "${UNINSTALL_FILENAME}"
          ${GetParent} "$R0" ${RESULT}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customInit
    ; Older uninstallers cleared these even when invoked with --updated. Keep
    ; this product's exact values across that first upgrade as well.
    ReadRegStr $mineradioSavedAutorun HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
    StrCpy $mineradioSavedStartupApproved 0
    StrCpy $mineradioSavedStartupApprovedSize 0
    System::Call 'advapi32::RegGetValueW(p 0x80000001, w "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", w "${PRODUCT_NAME}", i 8, p 0, p 0, *i .r0) i .r1'
    ${If} $1 == 0
    ${AndIf} $0 > 0
    ${AndIf} $0 <= 4096
      StrCpy $mineradioSavedStartupApprovedSize $0
      System::Alloc $0
      Pop $mineradioSavedStartupApproved
      ${If} $mineradioSavedStartupApproved != 0
        System::Call 'advapi32::RegGetValueW(p 0x80000001, w "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", w "${PRODUCT_NAME}", i 8, p 0, p $mineradioSavedStartupApproved, *i r0) i .r1'
        ${If} $1 != 0
          System::Free $mineradioSavedStartupApproved
          StrCpy $mineradioSavedStartupApproved 0
        ${EndIf}
      ${EndIf}
    ${EndIf}
    !insertmacro mineradioReadInstallPath HKCU $mineradioPerUserInstallDir
    !insertmacro mineradioReadInstallPath HKLM $mineradioPerMachineInstallDir
    StrCpy $mineradioExistingInstallDir ""
    StrCpy $mineradioExistingInstallScope "CurrentUser"
    ${If} $mineradioPerUserInstallDir != ""
      StrCpy $mineradioExistingInstallDir $mineradioPerUserInstallDir
    ${ElseIf} $mineradioPerMachineInstallDir != ""
      StrCpy $mineradioExistingInstallDir $mineradioPerMachineInstallDir
      StrCpy $mineradioExistingInstallScope "all"
      ; An existing machine installation needs the same permissions, rather
      ; than silently installing a second copy for the current user.
      ${IfNot} ${UAC_IsAdmin}
        MessageBox MB_OK|MB_ICONEXCLAMATION "现有 Mineradio 为所有用户安装。请以管理员身份运行此安装程序，以覆盖原安装位置。"
        SetErrorLevel 740
        Quit
      ${EndIf}
    ${EndIf}
    ${If} $mineradioExistingInstallScope == "all"
      StrCpy $hasPerMachineInstallation "1"
      StrCpy $hasPerUserInstallation "0"
      !insertmacro setInstallModePerAllUsers
    ${Else}
      StrCpy $hasPerMachineInstallation "0"
      StrCpy $hasPerUserInstallation "1"
      !insertmacro setInstallModePerUser
    ${EndIf}
    ${If} $mineradioExistingInstallDir != ""
      StrCpy $INSTDIR $mineradioExistingInstallDir
      ; Legacy uninstallers look up this helper record again. Repair only the
      ; same registered product's path before invoking one, so recovery from
      ; UninstallString cannot make it uninstall a different default folder.
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$mineradioExistingInstallDir"
      ; The silent all-users branch in the builder reapplies /D after .onInit.
      ; Reject a conflicting override there so it cannot create a second copy.
      ${If} $mineradioExistingInstallScope == "all"
      ${AndIf} ${Silent}
        !insertmacro GetDParameter $R0
        ${If} $R0 != ""
        ${AndIf} $R0 != $mineradioExistingInstallDir
          SetErrorLevel 87
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend

  ; The default builder UI otherwise offers both scopes to an administrator.
  ; Retain an existing machine installation; new installations are per-user.
  !macro customInstallMode
    ${If} $mineradioExistingInstallScope == "all"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !macroend

  ; Keep the directory chooser for a first install. An upgrade always returns
  ; to the registered location before any uninstall/extraction takes place.
  !macro customPageAfterChangeDir
    !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !endif
    !define MUI_PAGE_CUSTOMFUNCTION_PRE mineradioInstallFilesPre
    Function mineradioInstallFilesPre
      Call instFilesPre
      ${If} $mineradioExistingInstallDir != ""
        StrCpy $INSTDIR $mineradioExistingInstallDir
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    ; DisplayVersion must be the installer release, not the former app's
    ; version. Keep a stable product name and path in the one uninstall record.
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayName" "${PRODUCT_NAME}"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
    ${If} $mineradioExistingInstallDir != ""
      ${If} $mineradioSavedAutorun != ""
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" "$mineradioSavedAutorun"
      ${EndIf}
      ${If} $mineradioSavedStartupApproved != 0
        System::Call 'advapi32::RegCreateKeyExW(p 0x80000001, w "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", i 0, p 0, i 0, i 2, p 0, *p .r0, p 0) i .r1'
        ${If} $1 == 0
          System::Call 'advapi32::RegSetValueExW(p r0, w "${PRODUCT_NAME}", i 0, i 3, p $mineradioSavedStartupApproved, i $mineradioSavedStartupApprovedSize) i .r1'
          System::Call 'advapi32::RegCloseKey(p r0)'
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${If} $mineradioSavedStartupApproved != 0
      System::Free $mineradioSavedStartupApproved
      StrCpy $mineradioSavedStartupApproved 0
    ${EndIf}
    ; Refresh canonical links even when a previous installer kept shortcuts.
    !insertmacro addStartMenuLink "false"
    !insertmacro addDesktopLink "false"
  !macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCT_NAME}"
  ${EndIf}
!macroend
