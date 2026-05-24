#Requires -Version 5.1
<#
.SYNOPSIS
    Publishes MindAttic.Deploy.exe as a single file (framework-dependent,
    win-x64) into the artifacts/ directory.

.DESCRIPTION
    Output: <repo>\artifacts\MindAttic.Deploy.exe

    Run from the repo root:
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo    = Resolve-Path (Join-Path $PSScriptRoot '..')
$proj    = Join-Path $repo 'MindAttic.Deploy.Cli\MindAttic.Deploy.Cli.csproj'
$outDir  = Join-Path $repo 'artifacts'
$exeName = 'MindAttic.Deploy.exe'

Write-Host "Publishing $proj"
Write-Host "  -> $outDir\$exeName"

dotnet publish $proj `
    --configuration Release `
    --runtime win-x64 `
    --self-contained false `
    /p:PublishSingleFile=true `
    /p:IncludeNativeLibrariesForSelfExtract=true `
    --output $outDir | Out-Host

if ($LASTEXITCODE -ne 0) {
    Write-Host "Publish failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

$exe = Join-Path $outDir $exeName
if (-not (Test-Path $exe)) {
    Write-Host "Publish completed but $exeName not found at $exe." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Published $exeName ($([math]::Round(((Get-Item $exe).Length / 1MB), 1)) MB)" -ForegroundColor Green
Write-Host "  $exe"
