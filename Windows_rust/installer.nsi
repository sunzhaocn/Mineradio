Unicode true
!include "FileFunc.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define RegistryKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\2542aae7-0464-5cfc-bce5-8b4935dc8fb9"
OutFile "${SETUP_FILE}"
!ifdef ISOLATED
Name "Mineradio Rust 预览版"
InstallDir "$LOCALAPPDATA\Programs\Mineradio-Rust-Preview"
!else
Name "Mineradio"
InstallDir "$LOCALAPPDATA\Programs\Mineradio"
InstallDirRegKey HKCU "${RegistryKey}" "InstallLocation"
!endif
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "${SOURCE_ROOT}\Windows_exe\assets\icon.ico"
!define MUI_UNICON "${SOURCE_ROOT}\Windows_exe\assets\icon.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductName" "Mineradio"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileDescription" "Mineradio Windows 安装程序"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "LegalCopyright" "Mineradio contributors"

Var Stage
Var Backup
Var Existing
Var Updating

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此安装包需要 64 位 Windows。"
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
  StrCpy $Updating 0
  ${GetParameters} $0
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    StrCpy $Updating 1
    SetSilent silent
  ${EndIf}
  ClearErrors
FunctionEnd

Section "Mineradio"
  ${If} $INSTDIR == ""
    Abort "请选择 Mineradio 安装目录。"
  ${EndIf}
  !ifdef ISOLATED
    ReadRegStr $0 HKCU "${RegistryKey}" "InstallLocation"
    ${If} $INSTDIR == $0
    ${OrIf} $INSTDIR == "$LOCALAPPDATA\Programs\Mineradio"
      Abort "请选择独立的预览版安装目录。"
    ${EndIf}
  !endif

  StrCpy $Existing 0
  IfFileExists "$INSTDIR\." 0 Prepare
  IfFileExists "$INSTDIR\Mineradio.exe" 0 Occupied
  StrCpy $Existing 1

  Prepare:
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  StrCpy $Stage "$INSTDIR.setup-$0"
  StrCpy $Backup "$INSTDIR.previous-$0"
  IfFileExists "$Stage\." Occupied 0
  IfFileExists "$Backup\." Occupied 0
  ClearErrors
  SetOutPath "$Stage"
  File /oname=Mineradio.exe "${APP_BINARY}"
  File /oname=Mineradio.ico "${SOURCE_ROOT}\Windows_exe\assets\icon.ico"
  File /oname=LICENSE "${SOURCE_ROOT}\LICENSE"
  SetOutPath "$Stage\resources\tools"
  File "${SOURCE_ROOT}\Windows_exe\build\tools\*.*"
  SetOutPath "$Stage\resources\sdk"
  File "${SOURCE_ROOT}\Windows_exe\sdk\*.*"
  SetOutPath "$Stage\resources\licenses\project"
  File /r "${SOURCE_ROOT}\third_party\*.*"
  IfErrors Failed 0
  WriteUninstaller "$Stage\Uninstall Mineradio.exe"
  IfErrors Failed 0
  SetOutPath "$TEMP"
  ${If} $Existing == 1
    StrCpy $0 0
    CheckPrevious:
    ClearErrors
    Rename "$INSTDIR" "$Backup"
    ${If} ${Errors}
      ${If} $Updating == 1
      ${AndIf} $0 < 20
        IntOp $0 $0 + 1
        Sleep 500
        Goto CheckPrevious
      ${EndIf}
      Goto Busy
    ${EndIf}
  ${EndIf}
  ClearErrors
  Rename "$Stage" "$INSTDIR"
  IfErrors Restore 0

  !ifndef ISOLATED
    WriteRegStr HKCU "${RegistryKey}" "DisplayName" "Mineradio"
    WriteRegStr HKCU "${RegistryKey}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKCU "${RegistryKey}" "Publisher" "Mineradio contributors"
    WriteRegStr HKCU "${RegistryKey}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${RegistryKey}" "DisplayIcon" "$INSTDIR\Mineradio.ico"
    WriteRegStr HKCU "${RegistryKey}" "UninstallString" '"$INSTDIR\Uninstall Mineradio.exe"'
    WriteRegStr HKCU "${RegistryKey}" "QuietUninstallString" '"$INSTDIR\Uninstall Mineradio.exe" /S'
    WriteRegDWORD HKCU "${RegistryKey}" "NoModify" 1
    WriteRegDWORD HKCU "${RegistryKey}" "NoRepair" 1
    CreateShortCut "$SMPROGRAMS\Mineradio.lnk" "$INSTDIR\Mineradio.exe" "" "$INSTDIR\Mineradio.ico"
    CreateShortCut "$DESKTOP\Mineradio.lnk" "$INSTDIR\Mineradio.exe" "" "$INSTDIR\Mineradio.ico"
  !endif
  ${If} $Existing == 1
    DetailPrint "原程序备份位于 $Backup"
  ${EndIf}
  !ifndef ISOLATED
    ${If} $Updating == 1
      Exec '"$INSTDIR\Mineradio.exe"'
    ${EndIf}
  !endif
  Goto Finished

  Restore:
  ${If} $Existing == 1
    ClearErrors
    Rename "$Backup" "$INSTDIR"
    IfErrors RestoreFailed 0
  ${EndIf}
  Goto Failed

  RestoreFailed:
  Abort "原程序位于 $Backup。请关闭 Mineradio 后将此目录改回原安装路径。"
  Occupied:
  Abort "安装目录已被占用。请选择原 Mineradio 安装目录或一个新目录。"
  Busy:
  Abort "请从任务栏托盘彻底退出正在运行的 Mineradio 后重试。"
  Failed:
  Abort "安装文件写入失败，请检查安装目录空间与权限。"
  Finished:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  IfFileExists "$INSTDIR\Mineradio.exe" 0 EndUninstall
  Delete "$INSTDIR\Mineradio.exe"
  IfErrors EndUninstall 0
  Delete "$INSTDIR\Mineradio.ico"
  Delete "$INSTDIR\LICENSE"
  RMDir /r "$INSTDIR\resources\tools"
  RMDir /r "$INSTDIR\resources\sdk"
  RMDir /r "$INSTDIR\resources\licenses\project"
  RMDir "$INSTDIR\resources\licenses"
  RMDir "$INSTDIR\resources"
  Delete "$INSTDIR\Uninstall Mineradio.exe"
  !ifndef ISOLATED
    Delete "$SMPROGRAMS\Mineradio.lnk"
    Delete "$DESKTOP\Mineradio.lnk"
    DeleteRegKey HKCU "${RegistryKey}"
  !endif
  RMDir "$INSTDIR"
  EndUninstall:
SectionEnd
