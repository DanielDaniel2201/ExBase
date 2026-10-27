Unicode true
!ifndef REQUEST_EXECUTION_LEVEL
!define REQUEST_EXECUTION_LEVEL "user"
!endif
!include "wails_tools.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "ExBase"
OutFile "..\..\bin\ExBase-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\ExBase"
InstallDirRegKey HKCU "Software\ExBase" "InstallDir"
ManifestDPIAware true
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "ExBase"
VIAddVersionKey /LANG=1033 "FileDescription" "ExBase Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${INFO_PRODUCTVERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "ExBase"
!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\ExBase.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

Var Parameters
Var WaitPID
Var PreviousDir

Function .onInit
    SetShellVarContext current
    SetRegView 64
    !insertmacro wails.checkArchitecture
    ReadRegStr $PreviousDir HKCU "Software\ExBase" "InstallDir"
    ${GetParameters} $Parameters
    ClearErrors
    ${GetOptions} $Parameters "/WAITPID=" $WaitPID
FunctionEnd

Section "Install"
    ${If} $PreviousDir != ""
    ${AndIf} $PreviousDir != $INSTDIR
        MessageBox MB_OK|MB_ICONSTOP "ExBase is already installed in $PreviousDir. Uninstall it before choosing another directory." /SD IDOK
        SetErrorLevel 1
        Quit
    ${EndIf}
    ${If} $WaitPID != ""
        System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $WaitPID) p.r0'
        ${If} $0 != 0
            System::Call 'kernel32::WaitForSingleObject(p r0, i 120000) i.r1'
            System::Call 'kernel32::CloseHandle(p r0)'
            ${If} $1 != 0
                MessageBox MB_OK|MB_ICONSTOP "ExBase did not close. The installed version has not been changed." /SD IDOK
                SetErrorLevel 1
                Quit
            ${EndIf}
        ${EndIf}
    ${EndIf}
    ; Refuse to replace another running instance, including a manually launched copy.
    IfFileExists "$INSTDIR\ExBase.exe" 0 ready
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\ExBase.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
    ${If} $0 == -1
        MessageBox MB_OK|MB_ICONSTOP "Close the installed ExBase before continuing." /SD IDOK
        SetErrorLevel 1
        Quit
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
ready:
    !insertmacro wails.webview2runtime
    SetOutPath "$INSTDIR"
    ; Stage completely before replacing a working executable.
    ClearErrors
    File /oname=ExBase.next.exe "${ARG_WAILS_AMD64_BINARY}"
    IfErrors failed
    Delete "$INSTDIR\ExBase.previous.exe"
    IfFileExists "$INSTDIR\ExBase.exe" 0 publish
    ClearErrors
    Rename "$INSTDIR\ExBase.exe" "$INSTDIR\ExBase.previous.exe"
    IfErrors failed
publish:
    ClearErrors
    Rename "$INSTDIR\ExBase.next.exe" "$INSTDIR\ExBase.exe"
    IfErrors rollback
    ClearErrors
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    IfErrors rollback
    ExecWait '"$INSTDIR\ExBase.exe" --register-install' $0
    ${If} $0 != 0
        Goto rollback
    ${EndIf}
    ClearErrors
    CreateShortcut "$SMPROGRAMS\ExBase.lnk" "$INSTDIR\ExBase.exe"
    IfErrors rollback
    ${If} $WaitPID != ""
        Exec '"$INSTDIR\ExBase.exe"'
    ${EndIf}
    Goto done
rollback:
    ExecWait '"$INSTDIR\ExBase.exe" --unregister-install'
    Delete "$INSTDIR\ExBase.exe"
    Rename "$INSTDIR\ExBase.previous.exe" "$INSTDIR\ExBase.exe"
    IfFileExists "$INSTDIR\ExBase.exe" 0 failed
    ExecWait '"$INSTDIR\ExBase.exe" --register-install'
failed:
    Delete "$INSTDIR\ExBase.next.exe"
    MessageBox MB_OK|MB_ICONSTOP "Installation failed. Close ExBase and check that the selected directory is writable, then run the installer again." /SD IDOK
    SetErrorLevel 1
    Abort
done:
SectionEnd

Section "Uninstall"
    SetShellVarContext current
    SetRegView 64
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\ExBase.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
    ${If} $0 == -1
        MessageBox MB_OK|MB_ICONSTOP "Close ExBase before uninstalling." /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
    ExecWait '"$INSTDIR\ExBase.exe" --unregister-install' $0
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Could not remove ExBase registration. Close ExBase and try again." /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}
    Delete "$SMPROGRAMS\ExBase.lnk"
    Delete "$INSTDIR\ExBase.exe"
    Delete "$INSTDIR\ExBase.previous.exe"
    Delete "$INSTDIR\ExBase.next.exe"
    Delete "$INSTDIR\Uninstall.exe"
    ; Never recursively remove a user-selected directory or user settings/documents.
    RMDir "$INSTDIR"
SectionEnd
