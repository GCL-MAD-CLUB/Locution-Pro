param(
    [Parameter(Mandatory = $true)][string]$Data,
    [switch]$NoErrorDialog
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
$directory = [IO.Path]::GetDirectoryName($Data)
$exitCode = 2
$installerExitCode = $null
$installerLock = $null
try {
    $request = Get-Content -LiteralPath $Data -Raw -Encoding UTF8 | ConvertFrom-Json
    $parentProcess = Get-Process -Id $request.parent -ErrorAction Stop
    # Open the parent handle before acknowledging the handoff, avoiding PID reuse.
    $null = $parentProcess.Handle
    if ($parentProcess.Path -ne $request.executable) { throw 'The updating application does not match the parent process.' }
    $installerLock = [IO.File]::Open($request.installer, 'Open', 'Read', 'Read')
    if ((Get-FileHash -LiteralPath $request.installer -Algorithm SHA256).Hash -ne $request.signature) { throw 'Update installer SHA-256 mismatch.' }
    [IO.File]::WriteAllText((Join-Path $directory 'ready'), 'ready')
    if (!$parentProcess.WaitForExit(60000)) { throw 'The old application did not exit; the update was cancelled.' }
    $root = [IO.Path]::GetDirectoryName($request.executable)
    # NSIS requires /D to be the final argument, without surrounding quotes.
    $installer = Start-Process -FilePath $request.installer -ArgumentList "/S /UPDATE /D=$root" -WindowStyle Hidden -PassThru -Wait
    $installer.Refresh()
    if ($null -eq $installer.ExitCode) { throw 'The installer did not return an exit code.' }
    $exitCode = [int]$installer.ExitCode
    $installerExitCode = $exitCode
    @{ exitCode = $exitCode; installerExitCode = $installerExitCode; completedAt = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'result.json') -Encoding UTF8
    if ($exitCode -ne 0) { throw "更新未完成（退出码 $exitCode）。请使用完整安装包检查或修复依赖。项目已保留。" }
    if ($request.project) {
        Start-Process -FilePath $request.executable -ArgumentList ('"' + $request.project + '"') -WorkingDirectory $root | Out-Null
    } else {
        Start-Process -FilePath $request.executable -WorkingDirectory $root | Out-Null
    }
} catch {
    if ($exitCode -eq 0) { $exitCode = 2 }
    $failure = $_.Exception.Message
    @{ exitCode = $exitCode; installerExitCode = $installerExitCode; error = $failure } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $directory 'result.json') -Encoding UTF8
    [Console]::Error.WriteLine($failure)
    if (!$NoErrorDialog) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($failure, 'Locution Pro 更新失败', 'OK', 'Error') | Out-Null
    }
} finally {
    if ($installerLock) { $installerLock.Dispose() }
}
exit $exitCode
