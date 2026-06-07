<#
.SYNOPSIS
  MindAttic Codex tooling for THIS repo (MindAttic.Deploy): doctor + digest.

.DESCRIPTION
  Subcommands:
    doctor  - validate the Codex docs (front-matter, unique IDs, resolvable cross-refs,
              data-schema validation, ✅-story test tokens, cited paths exist, generatedFrom
              freshness). Exits non-zero on any hard error. Regenerates the digest in-memory
              and warns if docs/BIBLE.digest.md is out of date.
    digest  - regenerate docs/BIBLE.digest.md from BIBLE.md §1, §3, §5, §9 + a status index
              + the latest amendment head.

  Windows PowerShell 5.1 safe (no pwsh-only syntax). Run:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/codex.ps1 doctor
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/codex.ps1 digest
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('doctor', 'digest')]
    [string]$Command = 'doctor'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$DocsDir    = Join-Path $RepoRoot 'docs'
$BiblePath  = Join-Path $DocsDir 'BIBLE.md'
$DigestPath = Join-Path $DocsDir 'BIBLE.digest.md'

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

function Read-TextFile {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path)
}

# Split YAML front-matter (between leading `---` fences) from the body.
function Get-FrontMatter {
    param([string]$Text)
    $bom = [string][char]0xFEFF
    $result = @{ HasFm = $false; Map = @{}; Body = $Text }
    if ($Text -notmatch ('^(' + $bom + ')?---\r?\n')) { return $result }
    $lines = $Text -split "`n"
    # find the closing fence
    $start = -1; $end = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $l = ($lines[$i] -replace $bom, '').TrimEnd("`r")
        if ($l -eq '---') {
            if ($start -lt 0) { $start = $i }
            elseif ($end -lt 0) { $end = $i; break }
        }
    }
    if ($start -ne 0 -or $end -lt 0) { return $result }
    $map = @{}
    for ($i = $start + 1; $i -lt $end; $i++) {
        $line = $lines[$i].TrimEnd("`r")
        if ($line -match '^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$') {
            $map[$matches[1]] = $matches[2].Trim()
        }
    }
    $body = ($lines[($end + 1)..($lines.Count - 1)]) -join "`n"
    return @{ HasFm = $true; Map = $map; Body = $body }
}

$script:Errors   = New-Object System.Collections.Generic.List[string]
$script:Warnings = New-Object System.Collections.Generic.List[string]
function Add-Err  { param([string]$m) $script:Errors.Add($m)   | Out-Null }
function Add-Warn { param([string]$m) $script:Warnings.Add($m) | Out-Null }

# Collect the codex-managed markdown + data files that carry front-matter.
function Get-CodexDocs {
    $docs = New-Object System.Collections.Generic.List[string]
    foreach ($n in @('BIBLE.md', 'USER_STORIES.md', 'AMENDMENTS.md')) {
        $p = Join-Path $DocsDir $n
        if (Test-Path $p) { $docs.Add($p) | Out-Null }
    }
    $rfcDir = Join-Path $DocsDir 'rfc'
    if (Test-Path $rfcDir) {
        Get-ChildItem -Path $rfcDir -Filter '*.md' -File | ForEach-Object { $docs.Add($_.FullName) | Out-Null }
    }
    $dataDir = Join-Path $DocsDir 'data'
    if (Test-Path $dataDir) {
        Get-ChildItem -Path $dataDir -Filter '*.json' -File | ForEach-Object { $docs.Add($_.FullName) | Out-Null }
    }
    return $docs
}

$ValidLayers   = @('bible', 'stories', 'amendments', 'rfc', 'data', 'houserules')
$ValidStatuses = @('living', 'done', 'partial', 'planned', 'cut')

# ---------------------------------------------------------------------------
# DIGEST
# ---------------------------------------------------------------------------

# Extract a `## N. Title {#ID}` ... section body from the bible by its number.
function Get-BibleSection {
    param([string]$Body, [string]$SectionNumber)
    $lines = $Body -split "`n"
    $out = New-Object System.Collections.Generic.List[string]
    $inSection = $false
    foreach ($line in $lines) {
        $clean = $line.TrimEnd("`r")
        if ($clean -match '^##\s+(\d+)\.\s') {
            $inSection = ($matches[1] -eq $SectionNumber)
            continue
        }
        if ($inSection) {
            if ($clean -match '^##\s') { break }
            $out.Add($clean) | Out-Null
        }
    }
    return (($out -join "`n").Trim())
}

function Get-StatusIndex {
    $counts = @{ Done = 0; Partial = 0; Planned = 0; Cut = 0 }
    # Build the status glyphs from code points so the script file stays ASCII-clean.
    $done    = [char]0x2705                                   # white heavy check mark
    $partial = [char]::ConvertFromUtf32(0x1F7E1)              # large yellow circle
    $planned = [char]0x2B1C                                   # white large square
    $cut     = [char]::ConvertFromUtf32(0x1F5D1)              # wastebasket
    $usPath = Join-Path $DocsDir 'USER_STORIES.md'
    if (Test-Path $usPath) {
        $text = Read-TextFile $usPath
        $counts.Done    = ([regex]::Matches($text, [regex]::Escape($done))).Count
        $counts.Partial = ([regex]::Matches($text, [regex]::Escape($partial))).Count
        $counts.Planned = ([regex]::Matches($text, [regex]::Escape($planned))).Count
        $counts.Cut     = ([regex]::Matches($text, [regex]::Escape($cut))).Count
    }
    return $counts
}

function Get-LatestAmendment {
    $path = Join-Path $DocsDir 'AMENDMENTS.md'
    if (-not (Test-Path $path)) { return '' }
    $fm = Get-FrontMatter (Read-TextFile $path)
    $lines = $fm.Body -split "`n"
    $out = New-Object System.Collections.Generic.List[string]
    $seen = $false
    foreach ($line in $lines) {
        $clean = $line.TrimEnd("`r")
        if ($clean -match '^##\s') {
            if ($seen) { break }
            $seen = $true
        }
        if ($seen) { $out.Add($clean) | Out-Null }
    }
    return (($out -join "`n").Trim())
}

function Build-DigestText {
    if (-not (Test-Path $BiblePath)) { throw "BIBLE.md not found at $BiblePath" }
    $fm   = Get-FrontMatter (Read-TextFile $BiblePath)
    $body = $fm.Body
    $code = if ($fm.Map.ContainsKey('code')) { $fm.Map['code'] } else { 'DEP' }
    $proj = if ($fm.Map.ContainsKey('project')) { $fm.Map['project'] } else { 'MindAttic.Deploy' }

    $s1 = Get-BibleSection $body '1'
    $s3 = Get-BibleSection $body '3'
    $s5 = Get-BibleSection $body '5'
    $s9 = Get-BibleSection $body '9'
    $idx = Get-StatusIndex
    $amd = Get-LatestAmendment

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("AUTHORITATIVE - full detail in docs/BIBLE.md")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("# $proj ($code) - Codex digest")
    [void]$sb.AppendLine("> Generated by tools/codex.ps1 from docs/BIBLE.md. Do not hand-edit.")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## 1. The one sentence")
    [void]$sb.AppendLine($s1)
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## 3. What it is NOT")
    [void]$sb.AppendLine($s3)
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## 5. The Laws")
    [void]$sb.AppendLine($s5)
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## 9. Glossary")
    [void]$sb.AppendLine($s9)
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## Status index (from USER_STORIES.md)")
    [void]$sb.AppendLine(("- done: {0}  partial: {1}  planned: {2}  cut: {3}" -f $idx.Done, $idx.Partial, $idx.Planned, $idx.Cut))
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## Latest amendment")
    [void]$sb.AppendLine($amd)
    return $sb.ToString()
}

function Invoke-Digest {
    $text = Build-DigestText
    # generatedFrom front-matter so doctor can check freshness against BIBLE.md.
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $header = @"
---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: digest
status: living
updated: $today
generatedFrom: DEP-§1
---

"@
    [System.IO.File]::WriteAllText($DigestPath, $header + $text)
    Write-Host "digest: wrote docs/BIBLE.digest.md ($([math]::Round((Get-Item $DigestPath).Length / 1KB, 1)) KB)"
}

# ---------------------------------------------------------------------------
# DOCTOR
# ---------------------------------------------------------------------------

function Test-Doctor {
    $docs = Get-CodexDocs
    if ($docs.Count -eq 0) { Add-Err "no codex docs found under docs/" }

    $allAnchors = @{}           # id -> file (first definer)
    $crossRefs  = New-Object System.Collections.Generic.List[object]   # @{Id; File}

    foreach ($path in $docs) {
        $rel  = $path.Substring($RepoRoot.Length).TrimStart('\', '/')
        $text = Read-TextFile $path

        if ($path -like '*.json') {
            $fmJson = $null
            try { $fmJson = $text | ConvertFrom-Json } catch { Add-Err "$rel : invalid JSON ($($_.Exception.Message))" ; continue }
            continue   # data-file schema validation handled below
        }

        $fm = Get-FrontMatter $text
        if (-not $fm.HasFm) { Add-Err "$rel : missing YAML front-matter"; continue }
        foreach ($req in @('codex', 'project', 'code', 'layer', 'status', 'updated')) {
            if (-not $fm.Map.ContainsKey($req)) { Add-Err "$rel : front-matter missing '$req'" }
        }
        if ($fm.Map.ContainsKey('layer') -and ($ValidLayers -notcontains $fm.Map['layer'])) {
            Add-Err "$rel : invalid layer '$($fm.Map['layer'])'"
        }
        if ($fm.Map.ContainsKey('status') -and ($ValidStatuses -notcontains $fm.Map['status'])) {
            Add-Err "$rel : invalid status '$($fm.Map['status'])'"
        }
        if ($fm.Map.ContainsKey('updated') -and ($fm.Map['updated'] -notmatch '^\d{4}-\d{2}-\d{2}$')) {
            Add-Err "$rel : 'updated' not YYYY-MM-DD ('$($fm.Map['updated'])')"
        }

        # anchors: {#ID}  (§ = the section sign used in {#CODE-<sect>N})
        foreach ($m in [regex]::Matches($text, '\{#([A-Za-z0-9§\-\.]+)\}')) {
            $id = $m.Groups[1].Value
            if ($allAnchors.ContainsKey($id)) {
                Add-Err "duplicate anchor id {#$id} in $rel (also in $($allAnchors[$id]))"
            } else {
                $allAnchors[$id] = $rel
            }
        }

        # cross-refs: markdown links to (#ID) or (path#ID) — collect internal (#ID) for resolution.
        foreach ($m in [regex]::Matches($text, '\]\(([^)]*?#[^)]+)\)')) {
            $target = $m.Groups[1].Value
            $crossRefs.Add(@{ Raw = $target; File = $rel }) | Out-Null
        }
    }

    # resolve same-file/in-docs anchor links of the form #ID or relativepath#ID (only verify the #ID fragment
    # when the link points inside the docs set; skip external file refs to HouseRules etc. for anchor existence
    # but still sanity-check the path part exists on disk).
    foreach ($cr in $crossRefs) {
        $raw = $cr.Raw
        $hash = $raw.IndexOf('#')
        $pathPart = $raw.Substring(0, $hash)
        $idPart   = $raw.Substring($hash + 1)

        if ([string]::IsNullOrEmpty($pathPart)) {
            # pure in-file anchor — must resolve within the codex anchor set
            if (-not $allAnchors.ContainsKey($idPart)) {
                Add-Err "$($cr.File) : cross-ref (#$idPart) does not resolve to any {#...} anchor"
            }
        } else {
            # path#id — verify the file exists relative to the referring doc's dir
            $baseDir = Join-Path $RepoRoot (Split-Path $cr.File -Parent)
            $resolved = Join-Path $baseDir $pathPart
            if (-not (Test-Path $resolved)) {
                Add-Err "$($cr.File) : cross-ref path '$pathPart' not found on disk"
            } else {
                # if it's one of our codex docs, verify the anchor too
                $full = (Resolve-Path $resolved).Path
                $isCodex = $docs | Where-Object { (Resolve-Path $_).Path -eq $full }
                if ($isCodex) {
                    if (-not $allAnchors.ContainsKey($idPart)) {
                        Add-Err "$($cr.File) : cross-ref to '$pathPart#$idPart' — anchor {#$idPart} not found"
                    }
                }
            }
        }
    }

    # data files validate against _schema/<type>.schema.json (best-effort; presence + id uniqueness)
    $dataDir = Join-Path $DocsDir 'data'
    if (Test-Path $dataDir) {
        $schemaDir = Join-Path $dataDir '_schema'
        $seenIds = @{}
        Get-ChildItem -Path $dataDir -Filter '*.json' -File | ForEach-Object {
            $rel = $_.FullName.Substring($RepoRoot.Length).TrimStart('\', '/')
            $obj = $null
            try { $obj = (Read-TextFile $_.FullName) | ConvertFrom-Json } catch { Add-Err "$rel : invalid JSON"; return }
            $type = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
            $schemaPath = Join-Path $schemaDir "$type.schema.json"
            if (-not (Test-Path $schemaPath)) { Add-Err "$rel : no schema at _schema/$type.schema.json" }
            $entities = if ($obj -is [System.Array]) { $obj } elseif ($obj.PSObject.Properties.Name -contains 'entities') { $obj.entities } else { @($obj) }
            foreach ($e in $entities) {
                if (-not ($e.PSObject.Properties.Name -contains 'id')) { Add-Err "$rel : entity missing 'id'"; continue }
                if ($seenIds.ContainsKey($e.id)) { Add-Err "$rel : duplicate entity id '$($e.id)'" } else { $seenIds[$e.id] = $rel }
            }
        }
    }

    # every ✅ story names a test token, and (best-effort) the test exists somewhere in the tree
    $usPath = Join-Path $DocsDir 'USER_STORIES.md'
    if (Test-Path $usPath) {
        $usText = Read-TextFile $usPath
        $doneGlyph = [char]0x2705
        foreach ($line in ($usText -split "`n")) {
            # Only real story bullets ("- **DEP-US-..."), not legend/blockquote prose.
            if ($line -match '^\s*-\s+\*\*' -and $line.Contains($doneGlyph)) {
                if ($line -notmatch '(verified by|verified via|\btest\b)') {
                    Add-Err "USER_STORIES.md : ✅ story without a test citation: $($line.Trim().Substring(0, [math]::Min(80, $line.Trim().Length)))"
                } else {
                    $tm = [regex]::Match($line, 'verified by `([^`]+)`')
                    if ($tm.Success) {
                        $token = ($tm.Groups[1].Value -split '[ .(]')[0]
                        $hit = Get-ChildItem -Path $RepoRoot -Recurse -File -Include '*.cs', '*.js', '*.ts' -ErrorAction SilentlyContinue |
                               Where-Object { $_.FullName -notmatch '\\(node_modules|bin|obj|out)\\' } |
                               Select-String -SimpleMatch -Pattern $token -List -ErrorAction SilentlyContinue |
                               Select-Object -First 1
                        if (-not $hit) { Add-Warn "USER_STORIES.md : test token '$token' not found in source tree" }
                    }
                }
            }
        }
    }

    # every code path/file cited in the bible exists on disk (backtick `path/with/slash` tokens)
    if (Test-Path $BiblePath) {
        $bibleText = Read-TextFile $BiblePath
        foreach ($m in [regex]::Matches($bibleText, '`([^`]+)`')) {
            $tok = $m.Groups[1].Value
            # Only treat tokens that look like a repo-relative PATH (must contain '/'),
            # so a bare filename mentioned in prose (e.g. a retired `deploy.ps1`) is not
            # flagged. Path must end in a known source extension.
            if ($tok -match '/' -and $tok -match '\.(js|cs|json|ps1|htm|md|slnx|yml)$' -and $tok -notmatch '^https?:') {
                $candidate = Join-Path $RepoRoot ($tok -replace '/', '\')
                if (-not (Test-Path $candidate)) {
                    Add-Warn "BIBLE.md : cited path '$tok' not found on disk"
                }
            }
        }
    }

    # generatedFrom freshness + digest currency
    if (Test-Path $DigestPath) {
        $digestFm = Get-FrontMatter (Read-TextFile $DigestPath)
        if ($digestFm.Map.ContainsKey('generatedFrom')) {
            $srcMtime = (Get-Item $BiblePath).LastWriteTimeUtc
            $artMtime = (Get-Item $DigestPath).LastWriteTimeUtc
            if ($srcMtime -gt $artMtime) {
                Add-Err "BIBLE.digest.md is stale (BIBLE.md modified after the digest). Run: codex.ps1 digest"
            }
        }
        # content currency
        $expected = (Build-DigestText) -replace "`r", ""
        $actualBody = ($digestFm.Body) -replace "`r", ""
        if ($actualBody.Trim() -ne $expected.Trim()) {
            Add-Warn "BIBLE.digest.md content differs from a fresh regeneration. Run: codex.ps1 digest"
        }
    } else {
        Add-Warn "docs/BIBLE.digest.md missing. Run: codex.ps1 digest"
    }

    # ---- report ----
    Write-Host ""
    Write-Host "Codex doctor - MindAttic.Deploy (DEP)"
    Write-Host "-------------------------------------"
    Write-Host ("docs checked : {0}" -f $docs.Count)
    Write-Host ("anchors      : {0}" -f $allAnchors.Count)
    Write-Host ("cross-refs   : {0}" -f $crossRefs.Count)
    if ($script:Warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "WARNINGS:"
        foreach ($w in $script:Warnings) { Write-Host "  ! $w" }
    }
    Write-Host ""
    if ($script:Errors.Count -gt 0) {
        Write-Host "FAIL:"
        foreach ($e in $script:Errors) { Write-Host "  x $e" }
        Write-Host ""
        Write-Host ("doctor: {0} error(s), {1} warning(s)" -f $script:Errors.Count, $script:Warnings.Count)
        exit 1
    }
    Write-Host ("doctor: PASS ({0} warning(s))" -f $script:Warnings.Count)
    exit 0
}

# ---------------------------------------------------------------------------
switch ($Command) {
    'digest' { Invoke-Digest }
    'doctor' { Test-Doctor }
}
