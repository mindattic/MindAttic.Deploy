---
codex: 1
project: MindAttic.Deploy
code: M.DPLY
layer: stories
status: living
updated: 2026-10-03
---
<!-- GENERATED from MindAttic.Workflow/data/workflow.db by `workflow db render`. Do not edit: this file is rewritten from the database; change stories and tickets with the workflow CLI. -->

# MindAttic.Deploy — User Stories
> ✅ done (shipped & tested) · 🟡 partial · ⬜ planned. Every ✅ cites the test.
>
> This repo has one automated test file, `test/linked.test.js` (node:test, `npm test`), covering
> the linked deploy and the CLI flag guards. Capabilities proven only by a clean build or a manual
> run are marked 🟡 (not ✅), per [HOUSE-LAW-8](../../MindAttic.HouseRules.md#HOUSE-LAW-8).
> They graduate to ✅ once a verifying test lands ([rfc/0001-test-harness.md](rfc/0001-test-harness.md)).

## Epic A — Registry-driven, one-pipeline deploy
- **M.DPLY-US-A1 🟡** As the operator, I can deploy any target by editing only `projects.json`, so there is no per-project deploy machinery or drift. *Given a slug in `sites[]` or `apps[]`, When I run the matching command, Then only that target deploys (a linked-group member deploys its whole group).* *(implemented in `src/deploy.js`; the registry shape is checked by the `registry:` test in `test/linked.test.js`; plain modes have no automated test.)*
- **M.DPLY-US-A2 🟡** As the operator, I can drive the exact same pipeline from either `npm run deploy` or the C# CLI, so both front doors behave identically. *Given the CLI `site`/`uiux`/`app` commands, When invoked, Then they shell into `node --use-system-ca src/deploy.js`.* *(implemented in `Services/DeployRunner.cs`; CLI compiles — `dotnet build -c Release` clean; no behavioral test.)*
- **M.DPLY-US-A3 🟡** As the operator, I get a loud failure (exit 2) on an unknown flag or a run with no mode flag instead of an accidental deploy. *Given `--hlep`, an unknown flag such as `--only`, or a bare `npm run deploy`, When I run deploy, Then it errors and prints usage.* *(implemented: `KNOWN_FLAGS` guard + no-mode guard in `src/deploy.js`; exercised by the `cli:` tests in `test/linked.test.js`; kept 🟡 until the C# CLI path is covered.)*

## Epic C — Root sites (verbatim upload) and the linked group
- **M.DPLY-US-C1 🟡** As the operator, I can upload a root site's files verbatim (not templated) to its FTP path with a Last-Updated stamp. *Given a `sites[]` entry, When I run `--site <slug>`, Then preDeploy hooks run, `stampFile` is stamped, and the `files[]` glob is FTPS-uploaded.* *(implemented: `runSiteMode`/`deployOneSite`/`stampIndex`; requires live FTP — no automated test of the plain mode.)*
- **M.DPLY-US-C2 🟡** As the operator, `mindattic.com` re-splices its MindAttic.Components blocks before upload. *Given mindattic.com's `preDeploy[]`, When I deploy it, Then `package-pull` (skipped inside the linked flow) and `MindAttic.Components/web/build/build-sites.ps1 -Site mindattic.com` (pinning the Components tag from `web/sites.json`) run before the pin commit.* *(implemented via `executePreDeploy`; the hook wiring is checked by the `registry:` test in `test/linked.test.js`; the hook run itself has no automated test.)*
- **M.DPLY-US-C3 🟡** As the operator, deploying any of MindAttic.Web.Shared, ryandebraal.com, mindatticcares.com, Hyperspace or mindattic.com deploys them all from the one MindAttic.Web repo: the next tag is pinned in the pages, hooks and stamps run, a `Pin MindAttic.Web.Shared V<n>` commit is tagged and pushed (or an already-tagged `HEAD` is reused), every asset is verified byte-exact on jsDelivr, then the sites upload — nothing uploads if a gate fails, and the repo is clean and pushed afterwards. *(implemented in `src/linked.js`; covered by `test/linked.test.js` against fixtures; real runs succeed but there is no automated test against the real CDN/host.)*

## Epic D — Blazor / GitHub-Actions apps
- **M.DPLY-US-D1 🟡** As the operator, deploying an app runs its build/sync hooks, commits its `stageOnly` paths, and pushes its branch to fire the project's workflow. *Given an enabled `apps[]` entry, When I run `--app <slug>`, Then hooks run, staged changes commit, and the configured branch is pushed.* *(implemented: `deployOneApp`; would push real branches — no automated test.)*
- **M.DPLY-US-D2 🟡** As the operator, a disabled app prints its note and exits 0 instead of half-deploying. *Given `disabled:true`, When I target it, Then the `disabledNote` prints and nothing fires.* *(implemented: `deployOneApp` early return; no automated test.)*
- **M.DPLY-US-D3 🟡** As the operator, `--dry-run` previews an app/site deploy without committing, pushing, or uploading. *Given `--dry-run` with a mode flag, When I deploy, Then commit/push/FTP are skipped (plain site/app hooks still run, by design; the linked flow runs none).* *(implemented in both modes; the linked dry-run is covered by `test/linked.test.js`, plain modes have no automated test.)*

## Epic E — Credentials
- **M.DPLY-US-E1 🟡** As the operator, FTP credentials resolve MindAttic.Vault (C# CLI) → `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`, never embedded in source/output. *Given no Vault entry and no env var, When I deploy, Then `secrets/ftp.json` is read (or a clear error if absent).* *(implemented: `DeployRunner.RunNode` + `loadFtpSettings`; no automated test.)*
- **M.DPLY-US-E2 ⬜** As the operator, I want `npm run deploy` to resolve MindAttic.Vault as the C# CLI does, so `secrets/ftp.json` can be dropped. *(not implemented in `loadFtpSettings`.)*

## Priority backlog
Dependency-ordered toward the headline goal (every status above provable):
1. **M.DPLY-US-F1 ⬜** Extend the test harness (see [rfc/0001-test-harness.md](rfc/0001-test-harness.md)) to the plain site/app modes and the C# CLI — unblocks promoting Epic A/C/D stories to ✅.
2. **M.DPLY-US-F2 ⬜** Add unit coverage for `expandFiles` glob escaping and `stampIndex` idempotency (pure functions, no network).
3. **M.DPLY-US-E2 ⬜** MindAttic.Vault credential resolution in the Node front door; drop `secrets/ftp.json`.
4. **M.DPLY-US-F3 ⬜** Smoke-deploy step in CI against a throwaway remote (or a mock FTP server) to prove the upload path.

## Tickets
> Permanent log of every change and fix — this repo's ticket system. Rows are append-only: never
> delete or reword one; only move its Status (open → closed / wont-do) and fill in Ref. Status is
> a word, not a glyph, so tickets don't count toward the story index. Keep this section last.

| ID | Date | Type | Status | Summary | Ref |
|---|---|---|---|---|---|
| M.DPLY-T1 | 2026-10-12 | docs | closed | Start the permanent ticket log in USER_STORIES.md | — |
| M.DPLY-T2 | 2026-10-13 | fix | closed | Last Updated stamp keeps the page's own line endings (was always CRLF), so a later page rebuild leaves the stamp line alone | test/stamp.test.js |
| M.DPLY-T3 | 2026-10-14 | chore | closed | NUnit tests for ProjectRoster + DeployConfig (no C# test project exists yet; add MindAttic.Deploy.Cli.Tests with NUnit): Load honours MINDATTIC_DEPLOY_ROOT when the dir exists and ignores it when blank or missing, walks up from the exe dir to the first folder holding both projects.json and src/deploy.js, throws InvalidOperationException when none is found and FileNotFoundException when projects.json is missing; deserialization tolerates comments and trailing commas, applies defaults (branch main, remote origin, empty lists) and round-trips linkedGroups/sites/apps/preDeploy hooks; plus a smoke test that the real projects.json parses with unique slugs - a bad registry breaks every deploy | b72af7b |
| M.DPLY-T4 | 2026-10-14 | chore | open | NUnit tests for DeployRunner argument building: RunSite/RunApp/RunUiux build the right node args (src/deploy.js with --site slug vs --sites, --app slug vs --apps, --uiux, --dry-run, --no-link, --with-tests, --include-disabled) with --use-system-ca always first, and throw ArgumentException when neither slug nor all is given; MINDATTIC_FTP_JSON is set only when the Vault FtpCredentialStore has JSON, inherited env left alone otherwise; node missing (Win32 error 2) returns 127; slugs/paths containing [ do not throw in Markup output - needs a seam (extract arg list builder or injectable process starter) since RunNode spawns node directly | — |
| M.DPLY-T5 | 2026-10-14 | chore | open | NUnit tests for MainMenuCommand and AllCommand batching rules: picking every site collapses to one --sites run and every app to one --apps --include-disabled run, partial picks run per slug, multiple picks from the same linked group run the group only once (later members skipped), Batches count (note it currently ignores linked-group collapsing, so the announced batch count can overstate), LabelFor formatting for sites/apps/disabled, non-zero exit codes counted into a return of 1; AllCommand skips empty sections and returns 1 on any failed batch - extract the plan-building into a testable method behind an injectable runner | — |
| M.DPLY-T6 | 2026-10-14 | chore | open | NUnit tests for SiteCommand/AppCommand Settings.Validate: error when neither --slug nor --all (blank/whitespace slug counts as missing), success with slug only, all only, or both; and that Execute forwards NoLink/WithTests/IncludeDisabled/DryRun flags unchanged to DeployRunner - guards the CLI contract scripts and slash commands depend on | — |
| M.DPLY-T7 | 2026-10-15 | chore | closed | Remove duplicate command copies (/quickload, /quicksave) now centralized at the user level (~/.claude/commands) | M.FLOW-T14 |
| M.DPLY-T8 | 2026-10-16 | chore | closed | install.ps1 adds this repo's 9 .prose/commands stubs for the shared global commands, so any LLM client finds them | mindattic-agent-standard/install.ps1 run 2026-10-16 |
| M.DPLY-T9 | 2026-10-16 | chore | open | Bug hunt: run an exhaustive /bughunt over the whole repo and fix every real bug found (each fix under its own fix ticket), then hunt again; close this only when a full pass finds nothing | user request 2026-10-16: approved repo sweep |
| M.DPLY-T10 | 2026-10-16 | chore | open | Run the full unit test suite and fix every failure (each under its own fix ticket) until it passes; put the passing run in --ref. No test project: close this wont-do saying so | user request 2026-10-16: approved repo sweep |
| M.DPLY-T11 | 2026-10-16 | chore | open | Clean up code and docs: remove dead code, stale comments and outdated or duplicated docs, and simplify where behaviour doesn't change (/simplify); tests stay green | user request 2026-10-16: approved repo sweep |
| M.DPLY-T12 | 2026-10-16 | docs | open | Bring README.md up to date with the code as it is now (what it is, setup, usage, commands, current state), following codex-standard/README-STYLE.md; README.htm regenerated if the repo has one | user request 2026-10-16: approved repo sweep |
| M.DPLY-T13 | 2026-10-16 | feature | open | Log to MindAttic.Log (3.0.0): every app/CLI entry point writes to the standalone MindAttic.Log.db Vault assigns this app (VaultPaths.LoggingDbPath, MindAttic.Vault 6.0.0) through Serilog's WriteToMindAtticLog, tagged with its Component; log startup, user actions that change data, failures and unhandled exceptions (UI thread, AppDomain, unobserved tasks); tests point the log at a temp file. Pattern: MindAttic.Workflow WorkflowLog (M.FLOW-T92), MindAttic.Orchestrator OrchestratorLog | M.FLOW-T92 |
| M.DPLY-T14 | 2026-10-16 | docs | closed | Update USER_STORIES.md | — |
