param(
    [Parameter(Mandatory = $true)][ValidateSet('Scan', 'Prepare')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$PreviousRoot = '',
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$Result,
    [Parameter(Mandatory = $true)][string]$MainBinary,
    [int]$Ffmpeg = 1,
    [int]$Semantic = 1
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
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Resolve-InstallRoot([string]$Path) {
    if ($Path -notmatch '^[a-zA-Z]:[\\/]') { throw "Expected an absolute install path: $Path" }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $protected = @([IO.Path]::GetPathRoot($full).TrimEnd('\'), $env:USERPROFILE,
        $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:WINDIR)
    if ($full -in $protected) { throw "Not an application directory: $full" }
    Assert-PlainPath $full
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

try {
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
    if ($MainBinary -notmatch '^[\w.-]+\.exe$') { throw 'Invalid main executable name' }
    $payload = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($payload.version -ne 1) { throw 'Unsupported installer manifest' }
    $entries = @{}
    $reuse = @{}
    foreach ($entry in $payload.files) {
        $parts = $entry.path.Split('\')
        if ($entry.path -match '[\x00-\x1f<>:"|?*\[\]=/]' -or
            @($parts | Where-Object { !$_ -or $_ -in @('.', '..') -or $_ -match '[. ]$' }).Count -gt 0 -or
            $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $entry.size -lt 0 -or
            $entry.group -notin @('core', 'ffmpeg', 'transnetv2', 'semantic-search', 'storyboard-semantic')) {
            throw 'Invalid installer manifest entry'
        }
        if ($entries.ContainsKey($entry.path)) { throw 'Duplicate installer manifest entry' }
        $entries[$entry.path] = $entry
        # Check every destination, including missing leaves below existing junctions.
        foreach ($base in $roots) { Assert-PlainPath (Join-Path $base $entry.path) }
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
    if ($Mode -eq 'Prepare') {
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
                $handles.Add([IO.File]::Open($path, 'Open', 'ReadWrite', 'None'))
            }
        } finally {
            foreach ($handle in $handles) { $handle.Dispose() }
        }
        # Remove core code first, then changed or obsolete optional payloads.
        foreach ($base in $roots) {
            $main = Join-Path $base $MainBinary
            if ($deletions.ContainsKey($main)) {
                Remove-Item -LiteralPath $main -Force
                $deletions.Remove($main)
            }
        }
        foreach ($path in @($deletions.Keys)) { Remove-Item -LiteralPath $path -Force }
        foreach ($relative in @($reuse.Keys)) {
            $destination = Join-Path $Root $relative
            if ($reuse[$relative] -ne $destination) {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
                Move-Item -LiteralPath $reuse[$relative] -Destination $destination
                $reuse[$relative] = $destination
            }
        }
        # Empty directories are harmless; remove deselected trees without touching data.
        if (!$Semantic) {
            foreach ($base in $roots) {
                if (!$PreviousRoot -or $base -ne $PreviousRoot) { continue }
                foreach ($directory in @('semantic-search', 'storyboard-semantic')) {
                    $path = Join-Path $base $directory
                    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
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
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}
