param(
    [Parameter(Mandatory = $true)][ValidateSet('Scan', 'Prepare', 'Upgrade', 'Uninstall', 'CheckUninstall', 'CheckBackup', 'Commit', 'Rollback')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$PreviousRoot = '',
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$Result,
    [Parameter(Mandatory = $true)][string]$MainBinary,
    [int]$Ffmpeg = 1,
    [int]$Semantic = 1,
    [int]$Transactional = 0,
    [string]$BackupDirectory = ''
)

# Runs hidden under the installer. Never reads or deletes application data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

function Assert-PlainPath([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Linked install path is not supported: $cursor"
            }
            if ($cursor -ne [IO.Path]::GetFullPath($Path) -and !$item.PSIsContainer) {
                throw "Install parent is not a directory: $cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Resolve-InstallRoot([string]$Path) {
    if ($Path -notmatch '^[a-zA-Z]:[\\/]') { throw "Expected an absolute install path: $Path" }
    if ($Path -match '[\x00-\x1f<>"|?*]' -or $Path.Substring(2).Contains(':')) { throw 'Invalid install path characters' }
    foreach ($part in $Path.Substring(3).Split([char[]]'\/')) {
        if ($part -and ($part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)')) {
            throw "Ambiguous or reserved install path: $Path"
        }
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) { throw 'Cannot use a volume root' }
    Assert-PlainPath $full
    # PowerShell's filesystem provider expands existing 8.3 names. Preserve
    # missing leaves while using the existing prefix's directory identity.
    $cursor = $full
    $missing = [Collections.Generic.Stack[string]]::new()
    while (!(Test-Path -LiteralPath $cursor)) {
        $missing.Push([IO.Path]::GetFileName($cursor))
        $cursor = [IO.Path]::GetDirectoryName($cursor)
        if (!$cursor) { throw 'Cannot resolve install volume' }
    }
    $full = (Get-Item -LiteralPath $cursor -Force).FullName
    foreach ($part in $missing) { $full = [IO.Path]::Combine($full, $part) }
    $full = $full.TrimEnd('\')
    $protected = @([IO.Path]::GetPathRoot($full).TrimEnd('\'), $env:USERPROFILE,
        $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432,
        $env:ProgramData, $env:PUBLIC, $env:WINDIR)
    if ($full -in $protected) { throw "Not an application directory: $full" }
    if ($env:WINDIR -and $full.StartsWith($env:WINDIR.TrimEnd('\') + '\', 'OrdinalIgnoreCase')) {
        throw 'Cannot install inside Windows'
    }
    $cursor = $full
    while ($cursor) {
        if ([IO.Path]::GetFileName($cursor) -eq 'LineCut' -or [IO.File]::Exists((Join-Path $cursor 'linecut.exe'))) {
            throw 'Cannot modify a LineCut installation'
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    Assert-PlainPath $full
    if (Test-Path -LiteralPath $full -PathType Leaf) { throw 'Install root is a file' }
    return $full
}

function Test-Match($Entry, [string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    Assert-PlainPath $Path
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Length -ne $Entry.size) { return $false }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Entry.sha256
}

function Get-TreeFiles([string]$Path) {
    if (!(Test-Path -LiteralPath $Path)) { return }
    Assert-PlainPath $Path
    foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
        Assert-PlainPath $item.FullName
        if ($item.PSIsContainer) { Get-TreeFiles $item.FullName }
        else { $item.FullName }
    }
}

function Publish-Progress([string]$Phase, [string]$File) {
    # NSIS polls this file with ReadINIStr (the Windows profile API), which can
    # briefly lock it. Progress is cosmetic: a failed write must never abort
    # the scan, upgrade, or uninstall worker.
    try {
        [IO.File]::WriteAllLines("$Result.progress", @('[Progress]', "Phase=$Phase", "File=$File"), [Text.Encoding]::Unicode)
    } catch {
        # The installer holds the file while polling; the next update will land.
    }
}

function Complete-Transaction([bool]$Rollback) {
    if (!(Test-Path -LiteralPath "$Result.transaction")) { return }
    $transaction = Get-Content -LiteralPath "$Result.transaction" -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($transaction.version -ne 1 -or $transaction.root -ne $Root -or
        $transaction.directory -notmatch '^\.locution-pro-rollback-[a-f0-9]{32}$') { throw 'Invalid install transaction' }
    $committed = $transaction.PSObject.Properties.Name -contains 'phase' -and $transaction.phase -eq 'committed'
    if ($Rollback -and $committed) {
        throw 'A committed installation cannot be rolled back from cleanup remnants'
    }
    foreach ($entry in $transaction.backups) {
        $base = Resolve-InstallRoot $entry.base
        $backupRoot = Join-Path $base $transaction.directory
        if ($transaction.directory -notmatch '^\.locution-pro-rollback-[a-f0-9]{32}$' -or
            !$entry.path.StartsWith($base + '\', 'OrdinalIgnoreCase') -or
            !$entry.backup.StartsWith($backupRoot + '\', 'OrdinalIgnoreCase') -or
            [IO.Path]::GetFullPath($entry.path) -ne $entry.path -or
            [IO.Path]::GetFullPath($entry.backup) -ne $entry.backup) { throw 'Unsafe install transaction path' }
        Assert-PlainPath $entry.path
        Assert-PlainPath $entry.backup
    }
    if (!$Rollback) {
        # Publish the commit decision before deleting any old bytes. Cleanup is
        # optional after this boundary; a locked backup must never be mistaken
        # for an interrupted installation by the next installer process.
        if (!$committed) {
            $transaction | Add-Member -NotePropertyName phase -NotePropertyValue 'committed' -Force
            $document = $transaction | ConvertTo-Json -Depth 5
            foreach ($base in $transaction.bases) {
                $receipt = Join-Path (Join-Path (Resolve-InstallRoot $base) $transaction.directory) 'transaction.json'
                Assert-PlainPath $receipt
                $temporary = "$receipt.commit"
                Assert-PlainPath $temporary
                [IO.File]::WriteAllText($temporary, $document, [Text.Encoding]::UTF8)
                [IO.File]::Replace($temporary, $receipt, [System.Management.Automation.Language.NullString]::Value)
            }
            # If publishing receipts fails, no backup has been removed and NSIS
            # can still roll back. Seal the private journal after all receipts land.
            [IO.File]::WriteAllText("$Result.transaction.commit", $document, [Text.Encoding]::UTF8)
            [IO.File]::Replace("$Result.transaction.commit", "$Result.transaction", [System.Management.Automation.Language.NullString]::Value)
        }
        $warnings = [Collections.Generic.List[string]]::new()
        foreach ($entry in $transaction.backups) {
            try {
                Assert-PlainPath $entry.backup
                if (Test-Path -LiteralPath $entry.backup -PathType Leaf) { Remove-Item -LiteralPath $entry.backup -Force }
            } catch { $warnings.Add($_.Exception.Message) }
        }
        foreach ($base in $transaction.bases) {
            try {
                $backupRoot = Join-Path (Resolve-InstallRoot $base) $transaction.directory
                Assert-PlainPath $backupRoot
                if (!(Test-Path -LiteralPath $backupRoot)) { continue }
                $remaining = @(Get-ChildItem -LiteralPath $backupRoot -Force | Where-Object { $_.Name -ne 'transaction.json' })
                if ($remaining.Count -gt 0) { throw "Committed backup cleanup deferred: $backupRoot" }
                Remove-Item -LiteralPath (Join-Path $backupRoot 'transaction.json') -Force
                [IO.Directory]::Delete($backupRoot)
            } catch { $warnings.Add($_.Exception.Message) }
        }
        try { Remove-Item -LiteralPath "$Result.transaction" -Force }
        catch { $warnings.Add($_.Exception.Message) }
        if ($warnings.Count -gt 0) {
            $notice = "The operation committed successfully. Old backup cleanup was deferred; updates and uninstall remain available.`r`n" +
                ($warnings -join [Environment]::NewLine)
            try {
                $noticePath = Join-Path $Root ($transaction.directory.Replace('rollback-', 'cleanup-') + '.txt')
                Assert-PlainPath $noticePath
                $stream = [IO.File]::Open($noticePath, 'CreateNew', 'Write', 'None')
                try {
                    $bytes = [Text.Encoding]::UTF8.GetBytes($notice)
                    $stream.Write($bytes, 0, $bytes.Length)
                } finally { $stream.Dispose() }
            } catch { $warnings.Add($_.Exception.Message) }
            [Console]::Error.WriteLine($notice)
            return 10
        }
        return 0
    }
    foreach ($path in $transaction.created) {
        if (!$path.StartsWith($Root + '\', 'OrdinalIgnoreCase') -or [IO.Path]::GetFullPath($path) -ne $path) {
            throw 'Unsafe rollback destination'
        }
        Assert-PlainPath $path
        if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    }
    foreach ($entry in $transaction.backups) {
        if (!(Test-Path -LiteralPath $entry.backup -PathType Leaf)) { continue }
        Assert-PlainPath $entry.path
        if (Test-Path -LiteralPath $entry.path -PathType Leaf) { Remove-Item -LiteralPath $entry.path -Force }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($entry.path)) | Out-Null
        Move-Item -LiteralPath $entry.backup -Destination $entry.path
    }
    foreach ($base in $transaction.bases) {
        $backupRoot = Join-Path (Resolve-InstallRoot $base) $transaction.directory
        if (Test-Path -LiteralPath $backupRoot) {
            Assert-PlainPath $backupRoot
            $receipt = Join-Path $backupRoot 'transaction.json'
            Assert-PlainPath $receipt
            if (Test-Path -LiteralPath $receipt) { Remove-Item -LiteralPath $receipt -Force }
            Assert-PlainPath "$receipt.commit"
            if (Test-Path -LiteralPath "$receipt.commit") { Remove-Item -LiteralPath "$receipt.commit" -Force }
            # Backups use flat numbered names, so no recursive cleanup is needed.
            [IO.Directory]::Delete($backupRoot)
        }
    }
    if (Test-Path -LiteralPath "$Result.transaction.commit") { Remove-Item -LiteralPath "$Result.transaction.commit" -Force }
    Remove-Item -LiteralPath "$Result.transaction" -Force
}

function Test-CommittedBackup([string]$Path, [string]$Base) {
    Assert-PlainPath $Path
    $receipt = Join-Path $Path 'transaction.json'
    Assert-PlainPath $receipt
    if (!(Test-Path -LiteralPath $receipt -PathType Leaf)) {
        # Empty directories can remain if removal failed after the last receipt
        # was deleted. They contain no recovery state and do not block work.
        return @(Get-ChildItem -LiteralPath $Path -Force).Count -eq 0
    }
    $state = Get-Content -LiteralPath $receipt -Raw -Encoding UTF8 | ConvertFrom-Json
    return $state.version -eq 1 -and $state.PSObject.Properties.Name -contains 'phase' -and
        $state.phase -eq 'committed' -and $state.directory -eq [IO.Path]::GetFileName($Path) -and
        $Base -in $state.bases
}

try {
    if ($Mode -eq 'CheckBackup') {
        $Root = Resolve-InstallRoot $Root
        $backup = [IO.Path]::GetFullPath($BackupDirectory)
        if ([IO.Path]::GetDirectoryName($backup) -ne $Root -or
            [IO.Path]::GetFileName($backup) -notmatch '^\.locution-pro-rollback-[a-f0-9]{32}$') { throw 'Invalid backup directory' }
        if (Test-CommittedBackup $backup $Root) { exit 0 }
        exit 2
    }
    if ($Mode -in @('Commit', 'Rollback')) {
        $Root = Resolve-InstallRoot $Root
        $completion = Complete-Transaction ($Mode -eq 'Rollback')
        if ($Mode -eq 'Commit' -and $completion -eq 10) { exit 10 }
        exit 0
    }
    # A failure must never leave a previous successful reuse plan behind.
    if (Test-Path -LiteralPath $Result) { Remove-Item -LiteralPath $Result -Force }
    $Root = Resolve-InstallRoot $Root
    $roots = @($Root)
    if ($PreviousRoot) {
        $PreviousRoot = Resolve-InstallRoot $PreviousRoot
        if ($PreviousRoot -ne $Root) {
            if ($Root.StartsWith($PreviousRoot + '\', 'OrdinalIgnoreCase') -or
                $PreviousRoot.StartsWith($Root + '\', 'OrdinalIgnoreCase')) {
                throw 'Old and new install directories must not contain each other.'
            }
            $roots += $PreviousRoot
        }
    }
    if ($Mode -in @('Prepare', 'Upgrade', 'Uninstall', 'CheckUninstall')) {
        foreach ($base in $roots) {
            if (Test-Path -LiteralPath $base) {
                foreach ($backup in Get-ChildItem -LiteralPath $base -Directory -Force -Filter '.locution-pro-rollback-*') {
                    if (!(Test-CommittedBackup $backup.FullName $base)) {
                        throw "An interrupted installation has retained recovery files in $base. Recover those files before replacing or uninstalling this copy."
                    }
                }
            }
        }
    }
    if ($MainBinary -notmatch '^[\w.-]+\.exe$') { throw 'Invalid main executable name' }
    if ($Mode -in @('Upgrade', 'Uninstall', 'CheckUninstall') -and (!$PreviousRoot -or $Root -ne $PreviousRoot)) {
        throw 'Embedded uninstall requires the identified previous installation as its root'
    }
    if ($Mode -eq 'Upgrade') {
        # Choices follow this stage. Keep every matching optional component until
        # the final Prepare pass applies the choices made in the wizard.
        $Ffmpeg = 1
        $Semantic = 1
    }
    $payload = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($payload.version -ne 1) { throw 'Unsupported installer manifest' }
    $entries = @{}
    $reuse = @{}
    foreach ($entry in $payload.files) {
        Publish-Progress 'hashing' $entry.path
        $parts = $entry.path.Split('\')
        if ($entry.path -match '[\x00-\x1f<>:"|?*\[\]=/]' -or
            @($parts | Where-Object { !$_ -or $_ -in @('.', '..') -or $_ -match '[. ]$' -or
                $_ -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)' }).Count -gt 0 -or
            $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $entry.size -lt 0 -or
            $entry.group -notin @('core', 'ffmpeg', 'transnetv2', 'semantic-search', 'storyboard-semantic')) {
            throw 'Invalid installer manifest entry'
        }
        if ($entries.ContainsKey($entry.path)) { throw 'Duplicate installer manifest entry' }
        $entries[$entry.path] = $entry
        # Check every destination, including missing leaves below existing junctions.
        foreach ($base in $roots) {
            $destination = Join-Path $base $entry.path
            Assert-PlainPath $destination
            if (Test-Path -LiteralPath $destination -PathType Container) { throw "A payload destination is a directory: $destination" }
        }
        # The executable and uninstaller are always replaced. Other core resources,
        # including the Explorer thumbnail provider, can safely keep matching bytes.
        if ($entry.path -in @($MainBinary, 'uninstall.exe')) { continue }
        foreach ($base in $roots) {
            $candidate = Join-Path $base $entry.path
            if (Test-Match $entry $candidate) { $reuse[$entry.path] = $candidate; break }
        }
    }
    $ffmpegEntries = @($payload.files | Where-Object { $_.group -eq 'ffmpeg' })
    $models = @($payload.files | Where-Object {
        $_.group -in @('semantic-search', 'storyboard-semantic') -and $_.path -match '\.(onnx|onnx_data|safetensors)$'
    })
    $reuseFfmpeg = [int]($ffmpegEntries.Count -eq 2 -and @($ffmpegEntries | Where-Object { !$reuse.ContainsKey($_.path) }).Count -eq 0)
    $reuseSemantic = [int]($models.Count -gt 0 -and @($models | Where-Object { !$reuse.ContainsKey($_.path) }).Count -eq 0)
    if ($Mode -in @('Uninstall', 'CheckUninstall')) {
        $reuse.Clear()
        $reuseFfmpeg = 0
        $reuseSemantic = 0
        $Ffmpeg = 0
        $Semantic = 0
    }
    if ($Mode -in @('Prepare', 'Upgrade', 'Uninstall', 'CheckUninstall')) {
        # Both reserved executable paths are written by NSIS after this worker.
        # Validate them even though they are not part of the resource manifest.
        foreach ($base in $roots) {
            foreach ($name in @($MainBinary, 'uninstall.exe')) {
                $path = Join-Path $base $name
                Assert-PlainPath $path
                if (Test-Path -LiteralPath $path -PathType Container) { throw "Executable destination is a directory: $path" }
                if ((!$PreviousRoot -or $base -ne $PreviousRoot) -and (Test-Path -LiteralPath $path)) {
                    throw "A new install cannot overwrite an unrecognized executable: $path"
                }
            }
        }
        $selected = @{}
        foreach ($entry in $payload.files) {
            $selected[$entry.path] = !(($entry.group -eq 'ffmpeg' -and !$Ffmpeg) -or
                ($entry.group -in @('semantic-search', 'storyboard-semantic') -and !$Semantic))
            if (!$selected[$entry.path]) { $reuse.Remove($entry.path) }
        }
        $deletions = @{}
        foreach ($base in $roots) {
            # Only the registry-identified previous installation owns whole trees
            # and root DLLs. A fresh or relocated target can contain unrelated files;
            # an executable/uninstall.exe by itself does not prove ownership.
            $recognized = $PreviousRoot -and $base -eq $PreviousRoot
            $owned = @()
            if ($recognized) {
                foreach ($directory in @('transnetv2', 'semantic-search', 'storyboard-semantic', 'licenses')) {
                    $owned += @(Get-TreeFiles (Join-Path $base $directory))
                }
                if (Test-Path -LiteralPath $base) {
                    $owned += @(Get-ChildItem -LiteralPath $base -File -Force | Where-Object {
                        $_.Extension -eq '.dll' -or $_.Name -in @($MainBinary, 'uninstall.exe', 'ffmpeg.exe', 'ffprobe.exe')
                    } | ForEach-Object { $_.FullName })
                }
            }
            # The main executable is a reserved install destination as well.
            $main = Join-Path $base $MainBinary
            if (Test-Path -LiteralPath $main -PathType Leaf) { $owned += $main }
            foreach ($entry in $payload.files) {
                $path = Join-Path $base $entry.path
                if (Test-Path -LiteralPath $path -PathType Leaf) { $owned += $path }
            }
            foreach ($path in $owned) {
                Assert-PlainPath $path
                $relative = $path.Substring($base.Length + 1)
                if (!$reuse.ContainsKey($relative) -or $reuse[$relative] -ne $path) { $deletions[$path] = $true }
            }
        }
        # Fail on locked files before removing the executable. Never defer deletion
        # of a replacement pathname to reboot: that could delete the new DLL.
        $handles = [Collections.Generic.List[IDisposable]]::new()
        try {
            foreach ($path in $deletions.Keys) {
                # The standalone uninstaller first renames an Explorer-loaded
                # provider to a unique tombstone, never deferring its reusable name.
                if ($Mode -in @('CheckUninstall', 'Uninstall') -and [IO.Path]::GetFileName($path) -eq 'locution_pro_thumbnail_provider.dll') { continue }
                Publish-Progress 'checking-locks' $path
                $handles.Add([IO.File]::Open($path, 'Open', 'ReadWrite', 'None'))
            }
        } finally {
            foreach ($handle in $handles) { $handle.Dispose() }
        }
        if ($Mode -eq 'CheckUninstall') { exit 0 }
        $transaction = $null
        if ($Mode -in @('Prepare', 'Uninstall') -and $Transactional) {
            if (Test-Path -LiteralPath "$Result.transaction") { throw 'An unfinished install transaction already exists' }
            $backupDirectory = '.locution-pro-rollback-' + [Guid]::NewGuid().ToString('N')
            $backups = @()
            $index = 0
            foreach ($path in $deletions.Keys) {
                $base = @($roots | Where-Object { $path.StartsWith($_ + '\', 'OrdinalIgnoreCase') })[0]
                $backupRoot = Join-Path $base $backupDirectory
                Assert-PlainPath $backupRoot
                $backups += @{ base = $base; path = $path; backup = (Join-Path $backupRoot ([string]$index)) }
                $index++
            }
            $created = @()
            foreach ($relative in @($MainBinary, 'uninstall.exe') + @($selected.Keys | Where-Object { $selected[$_] })) {
                $path = Join-Path $Root $relative
                if (!(Test-Path -LiteralPath $path)) { $created += $path }
            }
            $transaction = @{ version = 1; root = $Root; directory = $backupDirectory;
                bases = @($backups | ForEach-Object { $_.base } | Select-Object -Unique); backups = $backups; created = $created }
            $transaction | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$Result.transaction" -Encoding UTF8
            foreach ($base in $transaction.bases) {
                $backupRoot = Join-Path $base $backupDirectory
                [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
                Copy-Item -LiteralPath "$Result.transaction" -Destination (Join-Path $backupRoot 'transaction.json')
            }
        }
        # Remove core code first, then changed or obsolete optional payloads.
        foreach ($base in $roots) {
            $main = Join-Path $base $MainBinary
            if ($deletions.ContainsKey($main)) {
                Publish-Progress 'removing' $main
                Assert-PlainPath $main
                if ($transaction) {
                    $entry = @($transaction.backups | Where-Object { $_.path -eq $main })[0]
                    Move-Item -LiteralPath $main -Destination $entry.backup
                } else { Remove-Item -LiteralPath $main -Force }
                $deletions.Remove($main)
            }
        }
        foreach ($path in @($deletions.Keys)) {
            Publish-Progress 'removing' $path
            Assert-PlainPath $path
            if ($transaction) {
                $entry = @($transaction.backups | Where-Object { $_.path -eq $path })[0]
                Move-Item -LiteralPath $path -Destination $entry.backup
            } else { Remove-Item -LiteralPath $path -Force }
        }
        foreach ($relative in @($reuse.Keys)) {
            $destination = Join-Path $Root $relative
            if ($reuse[$relative] -ne $destination) {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
                Assert-PlainPath $destination
                Assert-PlainPath $reuse[$relative]
                if ($transaction) { Copy-Item -LiteralPath $reuse[$relative] -Destination $destination }
                else { Move-Item -LiteralPath $reuse[$relative] -Destination $destination }
                $reuse[$relative] = $destination
            }
        }
        # Empty directories are harmless; remove deselected trees without touching data.
        if (!$Semantic) {
            foreach ($base in $roots) {
                if (!$PreviousRoot -or $base -ne $PreviousRoot) { continue }
                foreach ($directory in @('semantic-search', 'storyboard-semantic')) {
                    $path = Join-Path $base $directory
                    # All files were enumerated and checked above. Remove only
                    # empty directories; never recurse over a newly swapped tree.
                    if (Test-Path -LiteralPath $path) {
                        Assert-PlainPath $path
                        $directories = @(Get-ChildItem -LiteralPath $path -Directory -Recurse -Force |
                            Sort-Object { $_.FullName.Length } -Descending)
                        foreach ($directoryItem in $directories) {
                            Assert-PlainPath $directoryItem.FullName
                            if (@(Get-ChildItem -LiteralPath $directoryItem.FullName -Force).Count -eq 0) {
                                [IO.Directory]::Delete($directoryItem.FullName)
                            }
                        }
                        if (@(Get-ChildItem -LiteralPath $path -Force).Count -eq 0) { [IO.Directory]::Delete($path) }
                    }
                }
            }
        }
    }
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add('[Components]')
    $lines.Add("Ffmpeg=$reuseFfmpeg")
    $lines.Add("Semantic=$reuseSemantic")
    $lines.Add('[Reuse]')
    foreach ($relative in @($reuse.Keys | Sort-Object)) { $lines.Add("$relative=1") }
    $lines.Add('[Payload]')
    foreach ($entry in $payload.files) { $lines.Add("$($entry.path)=$($entry.sha256)") }
    # NSIS ReadINIStr uses the Windows profile API, which supports UTF-16LE INIs.
    [IO.File]::WriteAllLines($Result, $lines, [Text.Encoding]::Unicode)
    exit 0
} catch {
    $failure = $_.Exception.Message
    if ($Mode -in @('Prepare', 'Uninstall') -and $Transactional -and (Test-Path -LiteralPath "$Result.transaction")) {
        try { Complete-Transaction $true }
        catch { [Console]::Error.WriteLine("Rollback requires recovery from retained .locution-pro-rollback-* files: $($_.Exception.Message)") }
    }
    [Console]::Error.WriteLine($failure)
    exit 2
}
