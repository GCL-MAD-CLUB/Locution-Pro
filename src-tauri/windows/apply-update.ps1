param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Data = '',
    [switch]$Headless
)

# Embedded in the update package. Closing the progress window requests
# cancellation and waits for the transaction to settle, without confirmation.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
$exitCode = 2
$installerExitCode = $null
$installerLock = $null
$parentProcess = $null
$parentAccepted = $false
$request = $null
$form = $null
$worker = $null
$failure = ''
$script:cancelRequested = $false
$script:finished = $false
$directory = if ($Data) { [IO.Path]::GetDirectoryName($Data) } else {
    Join-Path ([IO.Path]::GetTempPath()) ('locution-update-' + [Guid]::NewGuid().ToString('N'))
}
$cancelFile = Join-Path $directory 'cancel'
$errorFile = Join-Path $directory 'error.txt'

function Update-ProgressWindow {
    if ($form) { [Windows.Forms.Application]::DoEvents() }
}

try {
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    if (!$Headless) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.Application]::EnableVisualStyles()
        $form = New-Object Windows.Forms.Form
        $form.Text = 'Locution Pro'
        $form.ClientSize = New-Object Drawing.Size(360, 40)
        $form.FormBorderStyle = 'FixedDialog'
        $form.StartPosition = 'CenterScreen'
        $form.MaximizeBox = $false
        $form.MinimizeBox = $false
        $bar = New-Object Windows.Forms.ProgressBar
        $bar.SetBounds(12, 12, 336, 16)
        $bar.Style = 'Marquee'
        $bar.MarqueeAnimationSpeed = 35
        $form.Controls.Add($bar)
        $form.Add_FormClosing({
            if (!$script:finished) {
                $_.Cancel = $true
                $script:cancelRequested = $true
                [IO.File]::WriteAllText($cancelFile, 'cancel')
            }
        })
        $form.Show()
        Update-ProgressWindow
    }
    if ($Data) {
        $request = Get-Content -LiteralPath $Data -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($request.executable -ne $Executable -or $request.installer -ne $Installer -or $request.version -ne $Version) {
            throw 'The update handoff does not match the installed application and package.'
        }
        $parentProcess = Get-Process -Id $request.parent -ErrorAction Stop
        # Pin the handle before checking identity to prevent PID reuse.
        $null = $parentProcess.Handle
        if ($parentProcess.Path -ne $Executable) {
            $actualPath = $parentProcess.Path
            $parentProcess.Dispose()
            $parentProcess = $null
            throw "The updating application does not match the parent process. Expected: $Executable; actual: $actualPath"
        }
        $installerLock = [IO.File]::Open($Installer, 'Open', 'Read', 'Read')
        if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ne $request.signature) {
            throw 'Update installer SHA-256 mismatch.'
        }
        [IO.File]::WriteAllText((Join-Path $directory 'ready'), 'ready')
        if ($request.PSObject.Properties.Name -contains 'requireAcceptance' -and $request.requireAcceptance) {
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            while (!(Test-Path -LiteralPath (Join-Path $directory 'accepted'))) {
                if ((Test-Path -LiteralPath (Join-Path $directory 'cancel-start')) -or [DateTime]::UtcNow -ge $deadline) {
                    throw 'Update startup was cancelled before the application accepted the handoff.'
                }
                Update-ProgressWindow
                Start-Sleep -Milliseconds 40
            }
        }
        $parentAccepted = $true
        # The package, rather than the application, owns process termination.
        Stop-Process -InputObject $parentProcess -Force
        if (!$parentProcess.WaitForExit(10000)) { throw 'The old application could not be stopped.' }
    }
    Update-ProgressWindow
    if ($script:cancelRequested -or (Test-Path -LiteralPath $cancelFile)) {
        $exitCode = 1
    } else {
        $root = [IO.Path]::GetDirectoryName($Executable)
        # /D must be last and must not be surrounded by quotes (NSIS contract).
        $worker = Start-Process -FilePath $Installer -ArgumentList "/S /UPDATE /ERRORFILE=`"$errorFile`" /CANCELFILE=`"$cancelFile`" /D=$root" -WindowStyle Hidden -PassThru
        while (!$worker.WaitForExit(50)) { Update-ProgressWindow }
        $worker.Refresh()
        if ($null -eq $worker.ExitCode) { throw 'The installer did not return an exit code.' }
        $installerExitCode = [int]$worker.ExitCode
        $exitCode = $installerExitCode
        if (Test-Path -LiteralPath $errorFile) { $failure = [string](Get-Content -LiteralPath $errorFile -Raw -Encoding Unicode) }
        if ($exitCode -ne 0) {
            if ($script:cancelRequested -and $failure.Contains('Update cancelled.') -and !$failure.Contains('Rollback')) {
                $exitCode = 1
            } elseif ($exitCode -eq 1 -and !$failure) {
                $exitCode = 1
            } else {
                if (!$failure) { $failure = "The update installer failed (exit code $exitCode). Use the full installer to repair the installation." }
                throw $failure
            }
        }
    }
} catch {
    $exitCode = 2
    $failure = $_.Exception.Message
    [Console]::Error.WriteLine($failure)
} finally {
    # Never kill a running worker: rollback must finish before restarting.
    if ($worker -and !$worker.HasExited) { $worker.WaitForExit() }
    if ($installerLock) { $installerLock.Dispose() }
    $script:finished = $true
    if ($form) { $form.Close(); $form.Dispose() }
    try {
        if ($parentProcess -and $parentAccepted -and !$parentProcess.HasExited) {
            Stop-Process -InputObject $parentProcess -Force
            if (!$parentProcess.WaitForExit(10000)) { throw 'The old application could not be stopped for restart.' }
        }
        $status = if ($exitCode -eq 0) { 'success' } elseif ($exitCode -eq 1) { 'cancelled' } else { 'failed' }
        $report = @{ version = $Version; exitCode = $exitCode; installerExitCode = $installerExitCode; status = $status; error = $failure }
        try {
            $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'result.json') -Encoding UTF8
        } catch {
            [Console]::Error.WriteLine("Cannot retain the update report: $($_.Exception.Message)")
        }
        $arguments = @()
        if ($request -and $request.project) { $arguments += '"' + $request.project + '"' }
        if ($exitCode -eq 2) {
            # UTF-8 hex carries details without shell quoting ambiguity. The
            # bounded argument stays below Windows' command-line length limit.
            $detail = if ($failure.Length -gt 1800) { $failure.Substring(0, 1800) } else { $failure }
            $payload = @{ version = $Version; exitCode = $exitCode; error = $detail } | ConvertTo-Json -Compress
            $encoded = -join ([Text.Encoding]::UTF8.GetBytes($payload) | ForEach-Object { $_.ToString('x2') })
            $arguments += '--update-error=' + $encoded
        }
        $root = [IO.Path]::GetDirectoryName($Executable)
        $start = @{ FilePath = $Executable; WorkingDirectory = $root }
        if ($arguments.Count) { $start.ArgumentList = $arguments -join ' ' }
        if ($Headless) { $start.WindowStyle = 'Hidden' }
        # A revoked handoff leaves the old application running and editable.
        # Never close or duplicate it after the application rejected startup.
        if (!$parentProcess -or $parentAccepted -or $parentProcess.HasExited) {
            Start-Process @start | Out-Null
        }
    } catch {
        $exitCode = 2
        [Console]::Error.WriteLine("Cannot restart the application: $($_.Exception.Message)")
    }
    if ($parentProcess) { $parentProcess.Dispose() }
}
exit $exitCode
