---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: amendments
status: living
updated: 2026-10-02
---

# MindAttic.Deploy — Amendments (append-only; amendment wins over the bible)

> Append-only change log. Never rewrite an amendment; supersede it with a new one. When this list
> grows beyond ~25, fold the settled ones into [BIBLE.md](BIBLE.md) and start a new epoch (note the
> git tag) — full history stays in git.

## DEP-A3 — Linked deploy: MindAttic.UiUx + ryandebraal.com + mindatticcares.com + mindattic.com deploy as one (refines DEP-LAW-2 and DEP-LAW-4; supersedes the README's "UiUx is out of scope" note) {#DEP-A3}
**Decision (user, 2026-10-02):** "Now that these are permanently linked the /deploy for MindAttic.UiUx, ryandebraal.com, mindattic.com, mindatticcares.com needs to all deploy each other all at once each time any one of them is deployed."

**What changed.**
- `projects.json` gains a top-level **`linkedGroups`** object. Group `mindattic-web` = package `MindAttic.UiUx` (`../MindAttic.UiUx`, repo `mindattic/MindAttic.UiUx`, branch `main`, whole-number tags `V<n>`) + sites `ryandebraal.com -> mindatticcares.com -> mindattic.com` (the listed order is the FTP order; mindattic.com is last because its `preDeploy` sync runs there). Membership is permanent. A site hook may declare **`tagArg`** (mindattic.com's sync hook declares `-CyberspaceCdnTag`) and a site may declare **`pinFiles`** (default: its `stampFile`).
- New module **`src/linked.js`** + flags **`--uiux`** (alias `--package`), **`--no-link`**, **`--with-tests`**. `--site <member>`, `--sites` and `--uiux` all deploy the WHOLE group; `--no-link` is the escape hatch (named site only, loud warning); unknown flags still exit 2. C# CLI: new `uiux` command (alias `package`), `site --no-link/--with-tests`; the interactive menu runs a linked group once however many of its members are ticked.
- Per-project `/deploy` shims: new `MindAttic.UiUx/.claude/commands/deploy.md`; the three site shims now describe the linked flow.
- `MindAttic.UiUx/sync/sync-mindattic-com.ps1` derives its default `-CyberspaceCdnTag` from the repo's latest `V*` tag instead of a literal.

**The linked flow** (aborts BEFORE any FTP upload if a gate fails):
1. **Preflight** — package repo is a git repo on `main`, working tree CLEAN (never auto-committed), `origin` reachable, not behind/diverged from `origin/main`, latest tag an ancestor of `HEAD`, `tools\build-asset-manifest.ps1 -Verify` passes, site sources exist, FTP secrets resolvable; a page may not pin a tag newer than the release tag.
2. **Publish** — if `HEAD` already carries the latest `V<n>` tag it is reused; otherwise `V<n+1>` is created (annotated, message lists the commits), then `git push origin main` and `git push origin <tag>`. Never force. A tag that exists on origin pointing at a different commit is **immutable**: the run aborts.
3. **Pin** — every `MindAttic.UiUx@V<n>` in each site's `pinFiles` becomes the release tag (idempotent; other jsDelivr URLs such as npm packages are untouched).
4. **Prepare** — each site's `preDeploy` hooks run (the sync hook receives the tag via `tagArg`; the `uiux-pull` hook is skipped because step 1 already verified/published the package).
5. **CDN gate** — every UiUx URL in the pages (literal URLs, plus every file listed in `assets-manifest.json` under each site's domain folder, which covers URLs a page builds at runtime from a base prefix such as `ASSET_BASE + 'themes/...'`) must be live on jsDelivr at the release tag: HTTP 200, `access-control-allow-origin: *`, `content-length` equal to the file in the package tree. Directory-like base URLs (ending in `/`) and documentation placeholders (`@<tag>/<path>`) are not fetched. A brand-new tag may take a while to appear, so failures are retried in shared backoff rounds (default 3 minutes total); a dry-run never waits.
6. **FTP** — the sites upload in order over one connection; a failing site does not stop the others; the exit code is non-zero if any failed. `--sites` deploys non-member sites after the group.
`--dry-run` runs steps 1-5 read-only and prints the plan: no tag, push, pin edit, hook (hooks mutate files), FTP connect or upload. Gates that would abort are printed as `[WOULD ABORT]` and the plan continues.

**Why.** The three sites load their fonts, logos, theme art and the Cyberspace engine/textures from the MindAttic.UiUx jsDelivr package at tag-pinned URLs ([MAU-A4](../../MindAttic.UiUx/docs/AMENDMENTS.md#MAU-A4)). A site deployed against a tag that is unpublished or missing files is broken; a package published without re-pinning the sites leaves them on stale assets. Making the four one deploy removes the ordering mistakes.

**Refines.** DEP-LAW-2 (the registry is the only edit point): `linkedGroups` is part of the registry. DEP-LAW-4 (one theme source of truth, CDN-pinned): the package tag the sites pin is now chosen and verified by the deploy rather than hand-edited. The README note "MindAttic.UiUx ... out of scope" is superseded for the linked group only: this repo still never edits component sources; it only tags/pushes the package repo and rewrites the tag pins in the sites.

**Known risks / behaviour to expect.**
- Pushing `main` of MindAttic.UiUx triggers its `sync-subscribers` GitHub workflow when the push touches the paths it watches (`Components/**`, `subscribers.json`, `sync/**`, ...). The workflow opens review PRs in the subscriber repos; it merges nothing. Put `[skip ci]` in the package commit message to suppress it when the sync was already done locally.
- The package is published (tag + push) BEFORE the CDN gate, because the gate needs the tag to exist. If the gate then fails, the tag stays (immutable, harmless) and nothing is uploaded; fix and re-run (the next run reuses the tag if `HEAD` did not move, or creates the next one).
- The deploy rewrites pins and stamps in the site working trees but never commits or pushes the site repos; it prints a reminder when they have uncommitted/unpushed changes.
- `fetch-descriptions.ps1` (mindattic.com, optional hook) still runs; the page no longer consumes its output.

**Migration.** Use `npm run deploy -- --site <any member>` or `npm run deploy -- --uiux` (add `--dry-run` first). Tests: `npm test` (`test/linked.test.js`, 24 tests against throwaway git repos, a local HTTP server standing in for jsDelivr and a fake FTP client).

## DEP-A2 — Three new apps[] entries + CLI commands / ProjectRoster sync (supersedes —) {#DEP-A2}
**What changed.** Three new entries added to `projects.json/apps[]` since Codex adoption: `cursory` (enabled, Cursory.Blazor cooperative cursor puzzles), `personagallery` (enabled, MindAttic.Legion.PersonaGallery Blazor), and `mindatticfrontend` (disabled pending Azure infra, MindAttic.Frontpage Blazor CMS). The enabled app count rose from 1 (Prose) to 3; total `apps[]` entries rose from 5 to 8. BIBLE §4.1 clarified to include `all` / `list` commands (already in code since Codex adoption, just omitted from the prose) and `ProjectRoster.cs` as a named service. CLAUDE.md apps[] count updated. README credentials section corrected to match `deploy.js` actual lookup order (env → `secrets/ftp.json`; APPDATA Vault path is roadmap-only).

**Why.** Codex full-sync 2026-06-07 — reconcile docs against disk reality.

**Migration.** Docs-only. No source code changed. `dotnet build MindAttic.Deploy.slnx -c Release` → `Build succeeded. 0 Warning(s), 0 Error(s)` (2026-06-07).

## DEP-A1 — Adopt the Codex documentation standard (supersedes —)
**What changed.** Installed the MindAttic Codex canonical-documentation layout in this repo: `docs/BIBLE.md` (L0), `docs/USER_STORIES.md` (L2), `docs/AMENDMENTS.md` (L1), `docs/rfc/`, `tools/codex.ps1` (doctor + digest), and the `.claude/hooks/inject-digest.ps1` SessionStart hook.

**Why.** Give MindAttic.Deploy a single source of truth with stable IDs, inherited org-wide House Rules, and tooling that keeps the injected digest honest.

**Migration.** None — this repo had no prior `docs/`, `game_bible.md`, `ARCHITECTURE.md`, amendments file, or structured JSON canon. All content in the new docs was authored fresh from `README.md`, `CLAUDE.md`, `projects.json`, and the `src/` + `MindAttic.Deploy.Cli/` source. The §5 Laws inherit [`MindAttic.HouseRules.md`](../../MindAttic.HouseRules.md) by reference (that file was not modified). `projects.json` remains the operational registry (data the tool reads at runtime); it is documented in BIBLE §4 but is **not** reclassified as L5 canon-as-data, because it is live application config, not derived documentation.
