---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: amendments
status: living
updated: 2026-06-07
---

# MindAttic.Deploy — Amendments (append-only; amendment wins over the bible)

> Append-only change log. Never rewrite an amendment; supersede it with a new one. When this list
> grows beyond ~25, fold the settled ones into [BIBLE.md](BIBLE.md) and start a new epoch (note the
> git tag) — full history stays in git.

## DEP-A2 — Three new apps[] entries + CLI commands / ProjectRoster sync (supersedes —) {#DEP-A2}
**What changed.** Three new entries added to `projects.json/apps[]` since Codex adoption: `cursory` (enabled, Cursory.Blazor cooperative cursor puzzles), `personagallery` (enabled, MindAttic.Legion.PersonaGallery Blazor), and `mindatticfrontend` (disabled pending Azure infra, MindAttic.Frontpage Blazor CMS). The enabled app count rose from 1 (Prose) to 3; total `apps[]` entries rose from 5 to 8. BIBLE §4.1 clarified to include `all` / `list` commands (already in code since Codex adoption, just omitted from the prose) and `ProjectRoster.cs` as a named service. CLAUDE.md apps[] count updated. README credentials section corrected to match `deploy.js` actual lookup order (env → `secrets/ftp.json`; APPDATA Vault path is roadmap-only).

**Why.** Codex full-sync 2026-06-07 — reconcile docs against disk reality.

**Migration.** Docs-only. No source code changed. `dotnet build MindAttic.Deploy.slnx -c Release` → `Build succeeded. 0 Warning(s), 0 Error(s)` (2026-06-07).

## DEP-A1 — Adopt the Codex documentation standard (supersedes —)
**What changed.** Installed the MindAttic Codex canonical-documentation layout in this repo: `docs/BIBLE.md` (L0), `docs/USER_STORIES.md` (L2), `docs/AMENDMENTS.md` (L1), `docs/rfc/`, `tools/codex.ps1` (doctor + digest), and the `.claude/hooks/inject-digest.ps1` SessionStart hook.

**Why.** Give MindAttic.Deploy a single source of truth with stable IDs, inherited org-wide House Rules, and tooling that keeps the injected digest honest.

**Migration.** None — this repo had no prior `docs/`, `game_bible.md`, `ARCHITECTURE.md`, amendments file, or structured JSON canon. All content in the new docs was authored fresh from `README.md`, `CLAUDE.md`, `projects.json`, and the `src/` + `MindAttic.Deploy.Cli/` source. The §5 Laws inherit [`MindAttic.HouseRules.md`](../../MindAttic.HouseRules.md) by reference (that file was not modified). `projects.json` remains the operational registry (data the tool reads at runtime); it is documented in BIBLE §4 but is **not** reclassified as L5 canon-as-data, because it is live application config, not derived documentation.
