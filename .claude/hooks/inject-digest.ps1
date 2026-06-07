<#
  SessionStart hook for MindAttic.Deploy.
  Reads docs/BIBLE.digest.md and emits Claude Code hook JSON injecting it as
  authoritative context. Non-ASCII is escaped to \uXXXX so the output is safe on
  Windows PowerShell 5.1 / Win-1252 consoles. If the digest is missing or empty,
  emits {} (a no-op).
#>
$ErrorActionPreference = 'Stop'

try {
    $repoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $digestPath = Join-Path $repoRoot 'docs\BIBLE.digest.md'

    if (-not (Test-Path $digestPath)) { Write-Output '{}'; exit 0 }
    $digest = [System.IO.File]::ReadAllText($digestPath)
    if ([string]::IsNullOrWhiteSpace($digest)) { Write-Output '{}'; exit 0 }

    $preamble = @"
The following is the AUTHORITATIVE Codex digest for MindAttic.Deploy (DEP), generated from
docs/BIBLE.md. Treat it as the source of truth for what this project IS, is NOT, and the laws
that govern it. When in doubt, defer to docs/BIBLE.md (full detail) and docs/AMENDMENTS.md
(an amendment wins over the bible). Do not contradict it.

"@

    $context = $preamble + $digest

    # JSON-encode with \uXXXX escaping for every non-ASCII char (5.1-safe).
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $context.ToCharArray()) {
        $code = [int][char]$ch
        switch ($ch) {
            '"'  { [void]$sb.Append('\"') }
            '\'  { [void]$sb.Append('\\') }
            "`b" { [void]$sb.Append('\b') }
            "`f" { [void]$sb.Append('\f') }
            "`n" { [void]$sb.Append('\n') }
            "`r" { [void]$sb.Append('\r') }
            "`t" { [void]$sb.Append('\t') }
            default {
                if ($code -lt 32 -or $code -gt 126) {
                    [void]$sb.Append('\u')
                    [void]$sb.Append($code.ToString('x4'))
                } else {
                    [void]$sb.Append($ch)
                }
            }
        }
    }
    $escaped = $sb.ToString()

    $json = '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"' + $escaped + '"}}'
    Write-Output $json
    exit 0
}
catch {
    # Never break session start; emit a no-op on any failure.
    Write-Output '{}'
    exit 0
}
