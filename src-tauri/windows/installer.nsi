Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Independent compression blocks let verified files skip decompression.
  SetCompressor "{{compression}}"
!endif

; Keep above !include to stay ahead of any plugin command
; see https://github.com/tauri-apps/tauri/pull/15422#discussion_r3289239624
{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
; Only Locution Pro participates in installation and maintenance.
!define INSTALL_IDENTITY "Locution Pro"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALL_IDENTITY}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${INSTALL_IDENTITY}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"
!define LCP_THUMBNAIL_PROVIDER_CLSID "{A7DE0A72-4952-4ED8-8F2E-BAE3AAB48B59}"
!define ITHUMBNAIL_PROVIDER_IID "{E357FCCD-A995-4576-B01F-234630154E96}"
!define LCP_THUMBNAIL_PROVIDER_FILE "locution_pro_thumbnail_provider.dll"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var PreviousUninstallKey
Var PreviousProductKey
Var PreviousInstallDir
Var PreviousMainBinaryName
Var LocutionProOwnsRegistration
Var LocutionProRegistrationStarted

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!addplugindir "${ADDITIONALPLUGINSPATH}"

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

!include "${LOCUTION_INSTALLER_SOURCE_DIR}\independent-install.nsh"
!include "${LOCUTION_INSTALLER_SOURCE_DIR}\upgrade-files.nsh"
!include "${LOCUTION_INSTALLER_SOURCE_DIR}\registration-state.nsh"
!include "${LOCUTION_INSTALLER_SOURCE_DIR}\migration-page.nsh"
!include "${LOCUTION_INSTALLER_SOURCE_DIR}\maintenance-page.nsh"
!include "${LOCUTION_INSTALLER_SOURCE_DIR}\review-page.nsh"

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Enable header images for installer and uninstaller pages when either image is configured.
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!endif

; Uninstaller header image
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!endif

; Uninstaller icon
!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; Installer pages, must be ordered as they appear
; 1. Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; 4. Maintenance choice. No application files change while choosing options.
Page custom PageReinstall PageLeaveReinstall

; 5. Choose install directory page
!define MUI_PAGE_CUSTOMFUNCTION_PRE LocutionProInstallOptionsPre
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE LocutionProDirectoryLeave
!insertmacro MUI_PAGE_DIRECTORY

; Scan once per chosen install location before the optional component pages.
!insertmacro MUI_PAGE_INIT
Page custom LocutionProScanPageCreate LocutionProScanPageLeave

; 6. Choose whether FFmpeg sidecars are installed
!insertmacro MUI_PAGE_INIT
Page custom LocutionProFfmpegPageCreate LocutionProFfmpegPageLeave

; 7. Choose whether subtitle semantic search resources are installed
!insertmacro MUI_PAGE_INIT
Page custom LocutionProSemanticPageCreate LocutionProSemanticPageLeave

; 8. Start menu shortcut page
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE LocutionProInstallOptionsPre
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

!insertmacro MUI_PAGE_INIT
Page custom LocutionProReviewPageCreate LocutionProReviewPageLeave
!insertmacro MUI_PAGE_INIT
Page custom LocutionProUninstallPageCreate LocutionProUninstallPageLeave

; 9. Installation page
!insertmacro MUI_PAGE_INSTFILES

; 10. Migration uses the same wizard and advances automatically after verification.
!insertmacro MUI_PAGE_INIT
Page custom MigrationPageCreate MigrationPageLeave

; 11. Finish page. MUI enables auto-advance from the installation page.
; Use show readme button in the finish page as a button create a desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

Function LocutionProCheckRunningApp
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
FunctionEnd

Function LocutionProVerifyWebView2
  File "/oname=$PLUGINSDIR\verify-webview2.ps1" "${LOCUTION_INSTALLER_SOURCE_DIR}\verify-webview2.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\verify-webview2.ps1" -Path "$6"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 2
    Abort "WebView2 安装程序的 Microsoft 数字签名验证失败，请重新下载安装包。"
  ${EndIf}
FunctionEnd

Function LocutionProFinishEmbeddedUninstall
  ; Only the internal uninstall stage calls this; it never removes app data.
  StrCpy $LocutionProTransactionActive 1
  Call LocutionProCommitInstall
  DeleteRegKey SHCTX "$PreviousUninstallKey"
  StrCpy $LocutionProUninstallComplete 1
  ${If} $LocutionProUninstallOnly != 1
    Return
  ${EndIf}
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro LOCUTION_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}
  ReadRegStr $0 SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" ""
  ${If} $0 == "$PreviousInstallDir\${LCP_THUMBNAIL_PROVIDER_FILE}"
    DeleteRegKey SHCTX "Software\Classes\LocutionPro.Project\shellex\${ITHUMBNAIL_PROVIDER_IID}"
    DeleteRegValue SHCTX "Software\Classes\LocutionPro.Project" "TypeOverlay"
    DeleteRegKey SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}"
  ${EndIf}
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $0 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $0 == "$\"$PreviousInstallDir\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}
  !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$PreviousInstallDir\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 == 1
    !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    RMDir "$SMPROGRAMS\$AppStartMenuFolder"
  ${EndIf}
  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$PreviousInstallDir\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 == 1
    !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$PreviousInstallDir\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 == 1
    !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
  !insertmacro DeleteAppUserModelId
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  Call RefreshShellAssociations
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; Add add a `Delete app data` check box
  ; $1 inner dialog HWND
  ; $2 window DPI
  ; $3 style
  ; $4 x
  ; $5 y
  ; $6 width
  ; $7 height
  FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
  ${If} $LocutionProOwnsRegistration != 1
    EnableWindow $DeleteAppDataCheckbox 0
  ${EndIf}
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  !insertmacro LOCUTION_INSTALLER_MUTEX
  StrCpy $LocutionProFreshInstall 0
  StrCpy $LocutionProUninstallComplete 0
  StrCpy $LocutionProUninstallOnly 0
  StrCpy $ReinstallPageCheck 1
  StrCpy $MigrationProcess 0
  StrCpy $MigrationComplete 0
  ; Bundled FFmpeg is the default, including passive installs.
  StrCpy $LocutionProBundleFfmpeg 1
  StrCpy $LocutionProBundleSemantic 1
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !insertmacro SetContext
  Call CaptureMigrationEligibility
  !insertmacro SetContext
  Call RecordPendingMigration

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext
  Call FindPreviousInstallation
  Call ReadPreviousInstallLocation
  Call LocutionProDetectMaintenance

  StrCpy $LocutionProInitialInstallDir $INSTDIR
  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; Set default install location
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    StrCpy $LocutionProInitialInstallDir $INSTDIR
    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif

  ; Restore the component choice before scanning reusable resources.
  ; Fresh installations (including silent ones) include semantic search by default.
  ReadRegStr $1 SHCTX "$PreviousUninstallKey" "InstallLocation"
  ${If} $1 != ""
    ClearErrors
    ReadRegDWORD $0 SHCTX "$PreviousProductKey" "BundleSemanticSearch"
    ${IfNot} ${Errors}
    ${AndIf} $0 == 0
      StrCpy $LocutionProBundleSemantic 0
    ${EndIf}
  ${EndIf}
  StrCpy $LocutionProPreviousSemanticChoice $LocutionProBundleSemantic
  ClearErrors
  ReadRegDWORD $0 SHCTX "$PreviousProductKey" "BundleFfmpeg"
  ${IfNot} ${Errors}
  ${AndIf} $0 == 0
    StrCpy $LocutionProBundleFfmpeg 0
    ReadRegStr $LocutionProFfmpegPath SHCTX "$PreviousProductKey" "FfmpegPath"
    ReadRegStr $LocutionProFfprobePath SHCTX "$PreviousProductKey" "FfprobePath"
  ${EndIf}
  StrCpy $LocutionProPreviousFfmpegChoice $LocutionProBundleFfmpeg
FunctionEnd

Function .onVerifyInstDir
  Push $4
  StrCpy $4 $INSTDIR
  Call CheckIndependentInstallLocation
  Pop $4
  ${If} $IndependentInstallLocation != 1
    Abort
  ${EndIf}
  Call LocutionProCheckFreshInstallLocation
  ${If} $LocutionProFreshLocationAllowed != 1
    Abort
  ${EndIf}
FunctionEnd




Section EarlyChecks
  ; /S and /P bypass the directory page. Validate before maintenance can stop
  ; the application, delete files, or transfer reusable components.
  Call EnsureIndependentInstallLocation
  Call LocutionProDirectoryLeave
  ; Version checks must also run for /S and /P, whose wizard pages are skipped.
  StrCpy $R0 1
  ReadRegStr $0 SHCTX "$PreviousUninstallKey" "DisplayVersion"
  ${If} $PreviousInstallDir != ""
  ${AndIf} $0 != ""
    nsis_tauri_utils::SemverCompare "${VERSION}" $0
    Pop $R0
  ${EndIf}
  ; Abort installer if downgrades are disabled
  !if "${ALLOWDOWNGRADES}" == "false"
    ; If downgrading
    ${If} $R0 = -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 <> 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      SetErrorLevel 2
      Abort "$(silentDowngrades)"
    ${EndIf}
  !endif

  ; Dependency installation must succeed before Prepare changes old program files.
SectionEnd

Section WebView2
  InitPluginsDir
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; An update must also repair a missing runtime before touching old app files.
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; Downloaded code must be trusted before execution. Use the private
        ; extraction directory to avoid a predictable shared TEMP filename.
        Call LocutionProVerifyWebView2
        ClearErrors
        ExecWait '$\"$6$\" ${WEBVIEW2INSTALLERARGS} /install' $1
        ${If} ${Errors}
          SetErrorLevel 2
          Abort "$(webview2AbortError)"
        ${EndIf}
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ${GetFileName} "$R1" $0
            ${If} $0 != "MicrosoftEdgeUpdate.exe"
              SetErrorLevel 2
              Abort "WebView2 更新程序路径无效，请先修复 WebView2 Runtime 后重试。"
            ${EndIf}
            StrCpy $6 $R1
            Call LocutionProVerifyWebView2
            ClearErrors
            ExecWait `"$6" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${IfNot} ${Errors}
            ${AndIf} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "$(webview2InstallError)" /SD IDCANCEL IDRETRY update_webview
              SetErrorLevel 2
              Quit
            ${EndIf}
          ${Else}
            SetErrorLevel 2
            Abort "找不到 WebView2 更新程序，请先安装或修复 WebView2 Runtime 后重试。"
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  Call EnsureIndependentInstallLocation
  Call LocutionProDirectoryLeave
  Call PrepareMigrationInstall
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif
  Call LocutionProCheckRunningApp
  ; Recompute hashes after closing the app, before changing any program files.
  ${If} $LocutionProPreparedInstallDir != $INSTDIR
    StrCpy $LocutionProUpgradeMode "Prepare"
    Call LocutionProPlanUpgrade
  ${EndIf}
  SetOutPath $INSTDIR

  ; Copy resources
  {{#each resources_dirs}}
    StrCpy $0 "{{this}}\" 16
    StrCpy $1 "{{this}}\" 20
    ${If} $LocutionProBundleSemantic == 1
    ${OrIf} $0 != "semantic-search\"
      ${If} $LocutionProBundleSemantic == 1
      ${OrIf} $1 != "storyboard-semantic\"
        CreateDirectory "$INSTDIR\\{{this}}"
      ${EndIf}
    ${EndIf}
  {{/each}}
  {{#each resources}}
    StrCpy $0 "{{this.[1]}}" 16
    StrCpy $1 "{{this.[1]}}" 20
    ${If} $LocutionProBundleSemantic == 1
    ${OrIf} $0 != "semantic-search\"
      ${If} $LocutionProBundleSemantic == 1
      ${OrIf} $1 != "storyboard-semantic\"
        !insertmacro LOCUTION_INSTALL_FILE "{{no-escape @key}}" "{{this.[1]}}"
      ${EndIf}
    ${EndIf}
  {{/each}}

  ; Copy external binaries only when the user selected bundled FFmpeg.
  ${If} $LocutionProBundleFfmpeg == 1
    {{#each binaries}}
      !insertmacro LOCUTION_INSTALL_FILE "{{no-escape @key}}" "{{this}}"
    {{/each}}
  ${EndIf}

  ; Publish the executable only after all required components installed successfully.
  ClearErrors
  File "/oname=${MAINBINARYNAME}.exe" "${MAINBINARYSRCPATH}"
  ${If} ${Errors}
    Delete "$INSTDIR\${MAINBINARYNAME}.exe"
    SetErrorLevel 2
    Abort "无法安装主程序。"
  ${EndIf}

  ; Write the uninstaller before publishing associations and registration.
  ClearErrors
  WriteUninstaller "$INSTDIR\uninstall.exe"
  ${If} ${Errors}
    SetErrorLevel 2
    Abort "无法写入卸载程序，请检查目录权限后重试。"
  ${EndIf}

  Call LocutionProSnapshotRegistration
  Call RecordMigrationOptOut
  ; Create file associations
  ClearErrors
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro LOCUTION_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0" "Open with ${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    {{/each}}
  {{/each}}

  ; The thumbnail provider returns the embedded project-card artwork for `.lcp` files. It never
  ; opens project data, because `.lcp` payloads are encrypted and Explorer is not trusted with it.
  WriteRegStr SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}" "" "Locution Pro Project Thumbnail Provider"
  WriteRegStr SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" "" "$INSTDIR\${LCP_THUMBNAIL_PROVIDER_FILE}"
  WriteRegStr SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr SHCTX "Software\Classes\LocutionPro.Project\shellex\${ITHUMBNAIL_PROVIDER_IID}" "" "${LCP_THUMBNAIL_PROVIDER_CLSID}"
  ; An absent TypeOverlay makes Explorer use the application's DefaultIcon as a lower-right
  ; thumbnail badge. An explicit empty value keeps the supplied project-card artwork unmodified.
  WriteRegStr SHCTX "Software\Classes\LocutionPro.Project" "TypeOverlay" ""
  Call RefreshShellAssociations

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR
  WriteRegDWORD SHCTX "${MANUPRODUCTKEY}" "BundleSemanticSearch" $LocutionProBundleSemantic
  WriteRegDWORD SHCTX "${MANUPRODUCTKEY}" "BundleFfmpeg" $LocutionProBundleFfmpeg
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "FfmpegPath" $LocutionProFfmpegPath
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "FfprobePath" $LocutionProFfprobePath

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Required maintenance registration must be usable before committing files.
  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
  ReadRegStr $1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${If} $0 != $INSTDIR
  ${OrIf} $1 != '$\"$INSTDIR\uninstall.exe$\"'
    SetErrorLevel 2
    Abort "无法登记安装或卸载信息，正在恢复旧文件。请检查权限后重试。"
  ${EndIf}

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create desktop shortcut for silent and passive installers
  ; because finish page will be skipped
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  Call LocutionProCommitInstall

  StrCpy $LocutionProRegistrationStarted 0

  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call MigrateLegacyData
  ${EndIf}

  ; Continue to the migration page without asking the user to click Next.
  SetAutoClose true
SectionEnd

Function .onInstFailed
  Call LocutionProRollbackInstall
  Call LocutionProRestoreRegistration
  SetErrorLevel 2
FunctionEnd

Function .onInstSuccess
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${If} $MigrationComplete != 1
    ${AndIf} $MigrationSkipped != 1
      Return
    ${EndIf}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro LOCUTION_INSTALLER_MUTEX
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE
  StrCpy $DeleteAppDataCheckboxState 0
  StrCpy $LocutionProOwnsRegistration 0
  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $0 == $INSTDIR
    StrCpy $LocutionProOwnsRegistration 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Function un.CheckDataTree
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R0
  Call un.CheckPlainPath
  ${If} $LocutionProPathSafe != 1
    Goto uninstall_data_tree_done
  ${EndIf}
  IfFileExists "$R0" 0 uninstall_data_tree_done
  ClearErrors
  FindFirst $R1 $R2 "$R0\*.*"
  ${If} ${Errors}
    StrCpy $LocutionProPathSafe 0
    Goto uninstall_data_tree_close
  ${EndIf}
  uninstall_data_tree_loop:
    ${If} $R2 == ""
      Goto uninstall_data_tree_close
    ${EndIf}
    ${If} $R2 != "."
    ${AndIf} $R2 != ".."
      Push "$R0\$R2"
      Call un.CheckPlainPath
      ${If} $LocutionProPathSafe != 1
        Goto uninstall_data_tree_close
      ${EndIf}
      StrCpy $R3 $R2 23
      ${If} $R3 == ".locution-pro-rollback-"
        nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-files.ps1" -Mode CheckBackup -Root "$R0" -BackupDirectory "$R0\$R2" -Manifest "$PLUGINSDIR\payload-manifest.json" -Result "$PLUGINSDIR\uninstall-check.ini" -MainBinary "${MAINBINARYNAME}.exe"'
        Pop $0
        Pop $1
        ${If} $0 != 0
          StrCpy $LocutionProPathSafe 0
          Goto uninstall_data_tree_close
        ${EndIf}
      ${EndIf}
      IfFileExists "$R0\$R2\*.*" 0 +3
        Push "$R0\$R2"
        Call un.CheckDataTree
      ${If} $LocutionProPathSafe != 1
        Goto uninstall_data_tree_close
      ${EndIf}
    ${EndIf}
    FindNext $R1 $R2
    Goto uninstall_data_tree_loop
  uninstall_data_tree_close:
    FindClose $R1
  uninstall_data_tree_done:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Section Uninstall

  InitPluginsDir
  File "/oname=$PLUGINSDIR\upgrade-files.ps1" "${LOCUTION_INSTALLER_SOURCE_DIR}\upgrade-files.ps1"
  File "/oname=$PLUGINSDIR\payload-manifest.json" "${LOCUTION_PAYLOAD_MANIFEST}"

  ; Validate the complete set before deleting even the first program file.
  Push $INSTDIR
  Call un.CheckPlainPath
  ${If} $LocutionProPathSafe != 1
    SetErrorLevel 2
    Abort "卸载目录包含链接或无法访问的路径，未删除应用文件。"
  ${EndIf}
  {{#each resources}}
    Push "$INSTDIR\\{{this.[1]}}"
    Call un.CheckPlainPath
    ${If} $LocutionProPathSafe != 1
      SetErrorLevel 2
      Abort "应用组件路径包含链接或无法访问，未删除应用文件。"
    ${EndIf}
  {{/each}}
  StrCpy $LocutionProOwnsRegistration 0
  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $0 == $INSTDIR
    StrCpy $LocutionProOwnsRegistration 1
  ${EndIf}

  ${If} $DeleteAppDataCheckboxState == 1
  ${AndIf} $UpdateMode != 1
  ${AndIf} $LocutionProOwnsRegistration == 1
    SetShellVarContext current
    Push "$APPDATA\${BUNDLEID}"
    Call un.CheckDataTree
    ${If} $LocutionProPathSafe != 1
      SetErrorLevel 2
      Abort "数据目录含链接、未恢复的旧文件备份或无法访问的路径。请取消删除应用数据后重试。"
    ${EndIf}
    Push "$LOCALAPPDATA\${BUNDLEID}"
    Call un.CheckDataTree
    ${If} $LocutionProPathSafe != 1
      SetErrorLevel 2
      Abort "数据目录含链接、未恢复的旧文件备份或无法访问的路径。请取消删除应用数据后重试。"
    ${EndIf}
    Push "$LOCALAPPDATA\${PRODUCTNAME}"
    Call un.CheckDataTree
    ${If} $LocutionProPathSafe != 1
      SetErrorLevel 2
      Abort "数据目录含链接、未恢复的旧文件备份或无法访问的路径。请取消删除应用数据后重试。"
    ${EndIf}
    !insertmacro SetContext
  ${EndIf}

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  ${If} $LocutionProOwnsRegistration == 1
    !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ${EndIf}

  ; Preflight all managed files and locks before deleting the first file. This
  ; also keeps locked Explorer providers from producing a false success result.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-files.ps1" -Mode CheckUninstall -Root "$INSTDIR" -PreviousRoot "$INSTDIR" -Manifest "$PLUGINSDIR\payload-manifest.json" -Result "$PLUGINSDIR\uninstall-check.ini" -MainBinary "${MAINBINARYNAME}.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    SetErrorLevel 2
    Abort "无法安全卸载。请关闭 Locution Pro 和占用组件的程序，检查目录权限及待恢复备份后重试。"
  ${EndIf}

  ; Loaded image files can often be renamed even while Explorer holds them.
  ; Only the unique tombstone may be queued for reboot, so a reinstall at the
  ; original DLL path is never removed by an older uninstall operation.
  IfFileExists "$INSTDIR\${LCP_THUMBNAIL_PROVIDER_FILE}" 0 uninstall_provider_ready
    ClearErrors
    GetTempFileName $R8 "$INSTDIR"
    ${If} ${Errors}
      SetErrorLevel 2
      Abort "无法为缩略图组件创建安全的卸载临时文件，未删除应用文件。"
    ${EndIf}
    Delete "$R8"
    ClearErrors
    Rename "$INSTDIR\${LCP_THUMBNAIL_PROVIDER_FILE}" "$R8"
    ${If} ${Errors}
      SetErrorLevel 2
      Abort "无法移走缩略图组件，未删除应用文件。请重启文件资源管理器或系统后重试。"
    ${EndIf}
    Delete /REBOOTOK "$R8"
  uninstall_provider_ready:

  ; Delete the app directory and its content from disk
  ; Copy main executable
  ClearErrors
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 +2
    Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    IfFileExists "$INSTDIR\\{{this.[1]}}" 0 +2
      Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    IfFileExists "$INSTDIR\\{{this}}" 0 +2
      Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ${If} ${Errors}
    SetErrorLevel 2
    Abort "部分应用文件无法删除。请关闭占用组件的程序后重试；安装登记和应用数据已保留。"
  ${EndIf}

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro LOCUTION_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Remove only the COM registration owned by this installation.
  ReadRegStr $R7 SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" ""
  ${If} $R7 == "$INSTDIR\${LCP_THUMBNAIL_PROVIDER_FILE}"
    DeleteRegKey SHCTX "Software\Classes\LocutionPro.Project\shellex\${ITHUMBNAIL_PROVIDER_IID}"
    DeleteRegValue SHCTX "Software\Classes\LocutionPro.Project" "TypeOverlay"
    DeleteRegKey SHCTX "Software\Classes\CLSID\${LCP_THUMBNAIL_PROVIDER_CLSID}"
  ${EndIf}
  ; Never queue a reusable installation pathname for deletion after a reinstall.
  Delete "$INSTDIR\${LCP_THUMBNAIL_PROVIDER_FILE}"
  Call un.RefreshShellAssociations

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1
  ${AndIf} $LocutionProOwnsRegistration == 1
    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Remove registry information for add/remove programs
  ${If} $LocutionProOwnsRegistration == 1
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif
  ${EndIf}

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
  ${AndIf} $LocutionProOwnsRegistration == 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIf} $LocutionProOwnsRegistration == 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    ClearErrors
    IfFileExists "$APPDATA\${BUNDLEID}\*.*" 0 +2
      RmDir /r "$APPDATA\${BUNDLEID}"
    IfFileExists "$LOCALAPPDATA\${BUNDLEID}\*.*" 0 +2
      RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
    IfFileExists "$LOCALAPPDATA\${PRODUCTNAME}\*.*" 0 +2
      RmDir /r "$LOCALAPPDATA\${PRODUCTNAME}"
    ${If} ${Errors}
      SetErrorLevel 2
      Abort "应用已移除，但部分默认位置的数据无法删除。请检查文件占用和目录权限。"
    ${EndIf}
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function FindPreviousInstallation
  StrCpy $PreviousUninstallKey "${UNINSTKEY}"
  StrCpy $PreviousProductKey "${MANUPRODUCTKEY}"
FunctionEnd

Function RestorePreviousInstallLocation
  Call FindPreviousInstallation
  Call ReadPreviousInstallLocation
  ${If} $PreviousInstallDir != ""
    StrCpy $INSTDIR $PreviousInstallDir
  ${EndIf}
FunctionEnd

Function ReadPreviousInstallLocation
  ReadRegStr $4 SHCTX "$PreviousProductKey" ""
  ${If} $4 == ""
    ReadRegStr $4 SHCTX "$PreviousUninstallKey" "InstallLocation"
  ${EndIf}
  ${If} $4 == ""
  ${AndIf} $MigrationRetry = 1
  ${AndIf} $MigrationEligible = 1
    StrCpy $4 $MigrationPendingInstallDir
  ${EndIf}
  Push $4
  Call StripPathQuotes
  Pop $4
  Push $4
  Call NormalizeInstallPath
  Pop $4
  StrCpy $PreviousInstallDir $4
  StrCpy $PreviousMainBinaryName "${MAINBINARYNAME}.exe"
  Call CheckIndependentInstallLocation
  ${If} $IndependentInstallLocation != 1
    StrCpy $PreviousInstallDir ""
  ${EndIf}
FunctionEnd

Function StripPathQuotes
  Exch $R8
  Push $R9
  StrCpy $R9 $R8 1
  ${If} $R9 == '$\"'
    StrCpy $R8 $R8 "" 1
  ${EndIf}
  StrCpy $R9 $R8 1 -1
  ${If} $R9 == '$\"'
    StrCpy $R8 $R8 -1
  ${EndIf}
  Pop $R9
  Exch $R8
FunctionEnd

Function RefreshShellAssociations
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
FunctionEnd

Function un.RefreshShellAssociations
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Abort
  ${EndIf}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; Update only shortcuts named for Locution Pro.
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$PreviousInstallDir\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$PreviousInstallDir\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Skip creating a new shortcut if requested; existing shortcuts were updated above.
  ${If} $UpdateMode = 1
  ${OrIf} $NoShortcutMode = 1
    Return
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; Update only shortcuts named for Locution Pro.
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$PreviousInstallDir\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    Return
  ${EndIf}

  ; Skip creating a new shortcut if requested; existing shortcuts were updated above.
  ${If} $UpdateMode = 1
  ${OrIf} $NoShortcutMode = 1
    Return
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
