param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Result
)

# Read the old installer's single options file; never execute media tools or change user data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
$paths = @{}
if (Test-Path -LiteralPath $Source -PathType Leaf) {
    $file = Get-Item -LiteralPath $Source -Force
    if ($file.Length -le 65536 -and !($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $text = [IO.File]::ReadAllText($Source, [Text.UTF8Encoding]::new($false, $true))
        foreach ($line in $text.Split([char]"`n")) {
            if ($line -match '^(ffmpeg_path|ffprobe_path)=(.*)$') {
                $name = $Matches[1]
                $value = $Matches[2].Trim()
                if ($value -and $value.Length -lt 1024 -and $value -notmatch '[\x00-\x1f"\ufffd]') {
                    $paths[$name] = $value
                }
            }
        }
    }
}
$external = [int]($paths.ContainsKey('ffmpeg_path') -and $paths.ContainsKey('ffprobe_path'))
$lines = @('[Media]', "External=$external")
if ($external) {
    $lines += "FfmpegPath=$($paths['ffmpeg_path'])", "FfprobePath=$($paths['ffprobe_path'])"
}
[IO.File]::WriteAllLines($Result, $lines, [Text.Encoding]::Unicode)
