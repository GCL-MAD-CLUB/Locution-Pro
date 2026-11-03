param(
    [Parameter(Mandatory = $true)][ValidateSet('Snapshot', 'Restore')][string]$Mode,
    [Parameter(Mandatory = $true)][ValidateSet('CurrentUser', 'LocalMachine')][string]$Hive,
    [Parameter(Mandatory = $true)][ValidateSet('Registry32', 'Registry64')][string]$View,
    [Parameter(Mandatory = $true)][string]$ProductKey,
    [Parameter(Mandatory = $true)][string]$UninstallKey,
    [Parameter(Mandatory = $true)][string]$Snapshot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

function Read-Tree([Microsoft.Win32.RegistryKey]$Key) {
    $values = @(
        foreach ($name in $Key.GetValueNames() | Sort-Object) {
            $kind = $Key.GetValueKind($name)
            $data = $Key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            # Store QWORD as text so no JSON consumer can lose integer precision.
            if ($kind -eq 'QWord') { $data = [string]$data }
            [pscustomobject]@{ name = $name; kind = [string]$kind; data = $data }
        }
    )
    $children = @(
        foreach ($name in $Key.GetSubKeyNames() | Sort-Object) {
            $child = $Key.OpenSubKey($name)
            if (!$child) { throw "Cannot snapshot registry subkey: $name" }
            try { [pscustomobject]@{ name = $name; tree = (Read-Tree $child) } }
            finally { $child.Dispose() }
        }
    )
    return [pscustomobject]@{ values = $values; children = $children }
}

function Convert-Value($Value) {
    switch ($Value.kind) {
        { $_ -in @('Binary', 'None') } { return ,([byte[]]@($Value.data)) }
        'DWord' { return [int]$Value.data }
        'QWord' { return [long]$Value.data }
        'MultiString' { return ,([string[]]@($Value.data)) }
        { $_ -in @('String', 'ExpandString') } { return [string]$Value.data }
        default { throw 'Unsupported registry snapshot value kind' }
    }
}

function Assert-Tree($Tree) {
    foreach ($value in $Tree.values) { $null = Convert-Value $value }
    foreach ($child in $Tree.children) {
        if (!$child.name -or $child.name.Contains('\')) { throw 'Invalid registry snapshot subkey' }
        Assert-Tree $child.tree
    }
}

function Restore-Tree([Microsoft.Win32.RegistryKey]$Key, $Tree) {
    # Keep an existing key's ACL; reconcile values and children in place.
    foreach ($name in $Key.GetValueNames()) { $Key.DeleteValue($name) }
    foreach ($value in $Tree.values) {
        $Key.SetValue($value.name, (Convert-Value $value), [Microsoft.Win32.RegistryValueKind]$value.kind)
    }
    $expected = @($Tree.children | ForEach-Object { $_.name })
    foreach ($name in $Key.GetSubKeyNames()) {
        if ($name -notin $expected) { $Key.DeleteSubKeyTree($name) }
    }
    foreach ($child in $Tree.children) {
        $target = $Key.CreateSubKey($child.name)
        try { Restore-Tree $target $child.tree }
        finally { $target.Dispose() }
    }
}

$registry = $null
try {
    $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]$Hive, [Microsoft.Win32.RegistryView]$View)
    $paths = @($ProductKey, $UninstallKey)
    if ($ProductKey -eq $UninstallKey -or @($paths | Where-Object { $_ -notlike 'Software\*' }).Count -gt 0) {
        throw 'Invalid registration keys'
    }
    if ($Mode -eq 'Snapshot') {
        $keys = @(
            foreach ($path in $paths) {
                $key = $registry.OpenSubKey($path)
                try {
                    [pscustomobject]@{ path = $path; exists = ($null -ne $key); tree = $(if ($key) { Read-Tree $key } else { $null }) }
                } finally { if ($key) { $key.Dispose() } }
            }
        )
        $document = @{ version = 1; hive = $Hive; view = $View; keys = $keys } | ConvertTo-Json -Depth 100
        # Never accept a truncated document as a successful snapshot.
        $parsed = $document | ConvertFrom-Json
        foreach ($entry in $parsed.keys) { if ($entry.exists) { Assert-Tree $entry.tree } }
        [IO.File]::WriteAllText($Snapshot, $document, [Text.Encoding]::UTF8)
    } else {
        $state = Get-Content -LiteralPath $Snapshot -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.version -ne 1 -or $state.hive -ne $Hive -or $state.view -ne $View -or
            $state.keys.Count -ne 2 -or $state.keys[0].path -ne $ProductKey -or $state.keys[1].path -ne $UninstallKey) {
            throw 'Registration snapshot does not match this installation context'
        }
        foreach ($entry in $state.keys) { if ($entry.exists) { Assert-Tree $entry.tree } }
        foreach ($entry in $state.keys) {
            if (!$entry.exists) { $registry.DeleteSubKeyTree($entry.path, $false); continue }
            $key = $registry.CreateSubKey($entry.path)
            try { Restore-Tree $key $entry.tree }
            finally { $key.Dispose() }
        }
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
} finally {
    if ($registry) { $registry.Dispose() }
}
