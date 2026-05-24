#Requires -Version 5.1
<#
.SYNOPSIS
    Republishes artifacts\MindAttic.Deploy.exe when the exe is missing or any
    project source file (*.cs, *.csproj, Directory.Build.props) is newer than
    the exe. Otherwise it's a fast no-op.

.DESCRIPTION
    Called by run.bat on every launch so MindAttic.Console tabs always start a
    current build without paying the `dotnet run` JIT/restore cost.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo  = (Resolve-Path (Join-Path $here '..')).Path
$exe   = Join-Path $repo 'artifacts\MindAttic.Deploy.exe'
$src   = Join-Path $repo 'MindAttic.Deploy.Cli'
$props = Join-Path $repo 'Directory.Build.props'

function Test-NeedsPublish {
    if (-not (Test-Path $exe)) { return $true }
    $exeTime = (Get-Item $exe).LastWriteTimeUtc

    if ((Test-Path $props) -and (Get-Item $props).LastWriteTimeUtc -gt $exeTime) {
        return $true
    }

    $newer = Get-ChildItem -Path $src -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '\\(bin|obj)\\' -and
            ($_.Extension -eq '.cs' -or $_.Extension -eq '.csproj') -and
            $_.LastWriteTimeUtc -gt $exeTime
        } |
        Select-Object -First 1

    return [bool]$newer
}

if (Test-NeedsPublish) {
    & (Join-Path $here 'publish.ps1')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
