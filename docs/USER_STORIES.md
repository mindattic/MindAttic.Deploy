---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: stories
status: living
updated: 2026-10-03
---

# MindAttic.Deploy — User Stories
> ✅ done (shipped & tested) · 🟡 partial · ⬜ planned · 🗑️ cut. Every ✅ cites the test.
>
> NOTE: this repo has one automated test file, `test/linked.test.js` (node:test, `npm test`), covering
> the linked deploy and the CLI flag guards. Capabilities proven only by a clean build or an ad-hoc
> manual run are marked 🟡 (not ✅), per [HOUSE-LAW-8](../../MindAttic.HouseRules.md#HOUSE-LAW-8).
> They graduate to ✅ once a verifying test lands ([rfc/0001-test-harness.md](rfc/0001-test-harness.md)).
>
> [DEP-A6](AMENDMENTS.md#DEP-A6) (2026-10-03) retired the catalog landing pages; their stories are
> marked 🗑️ and keep their original text as an audit trail.

## Epic A — Registry-driven, one-pipeline deploy
- **DEP-US-A1 🟡** As the operator, I can deploy any target by editing only `projects.json`, so there is no per-project deploy machinery or drift. *Given a slug in `sites[]` or `apps[]`, When I run the matching command, Then only that target deploys (a linked-group member deploys its whole group).* *(implemented in `src/deploy.js`; no automated test — manual `--dry-run` verified. Re-scoped by [DEP-A6](AMENDMENTS.md#DEP-A6); original in the audit log.)*
- **DEP-US-A2 🟡** As the operator, I can drive the exact same pipeline from either `npm run deploy` or the C# CLI, so both front doors behave identically. *Given the CLI `site`/`uiux`/`app` commands, When invoked, Then they shell into `node --use-system-ca src/deploy.js`.* *(implemented in `Services/DeployRunner.cs`; CLI compiles — `dotnet build -c Release` clean; no behavioral test. Re-scoped by [DEP-A6](AMENDMENTS.md#DEP-A6); original in the audit log.)*
- **DEP-US-A3 🟡** As the operator, I get a loud failure (exit 2) on an unknown flag or a run with no mode flag instead of an accidental full deploy. *Given `--hlep`, a retired catalog flag such as `--only`, or a bare `npm run deploy`, When I run deploy, Then it errors and prints usage.* *(implemented: `KNOWN_FLAGS` guard + no-mode guard in `src/deploy.js`; exercised by the `cli:` tests in `test/linked.test.js`, kept 🟡 until the story's other paths are covered. Re-scoped by [DEP-A6](AMENDMENTS.md#DEP-A6); original in the audit log.)*

## Epic B — Catalog landing pages (README → page) — cut by [DEP-A6](AMENDMENTS.md#DEP-A6)
Each repo's GitHub README is now its project page; nothing here is built or deployed any more.
- **DEP-US-B1 🗑️** *(cut by [DEP-A6](AMENDMENTS.md#DEP-A6); original spec — audit log)* As a project owner, my landing page is rendered from my repo's `README.md` through one canonical template, so editing my docs updates the page on the next deploy. *Given a `projects[]` entry, When I build, Then `out/<slug>.htm` is produced from the README + `template/index.template.htm`.* *(implemented in `src/build.js` `buildOne`; no automated test — ad-hoc `npm run build`.)*
- **DEP-US-B2 🗑️** *(cut by [DEP-A6](AMENDMENTS.md#DEP-A6); original spec — audit log)* As the operator, every public non-archived mindattic repo with a README gets a Cyberspace page automatically, with curated entries overriding metadata. *Given `gh repo list` succeeds, When I build, Then discovered repos are appended to curated ones (curated wins on slug).* *(implemented: `effectiveProjects`/`discoverPublicRepos`; degrades to curated-only without `gh`; no automated test.)*
- **DEP-US-B3 🗑️** *(cut by [DEP-A6](AMENDMENTS.md#DEP-A6); original spec — audit log)* As a hardware-guide owner (ChiMesh/Claudia), my page gains an interactive parts picker when my repo ships `config/parts.json`. *Given `"addon":"parts"`, When I build, Then the gallery/configurator/cost total is injected; otherwise it's a no-op.* *(implemented: `src/parts.js` + `ADDONS` registry; no automated test.)*

## Epic C — Root sites (verbatim upload)
- **DEP-US-C1 🟡** As the operator, I can upload a root site's files verbatim (not templated) to its FTP path with a Last-Updated stamp. *Given a `sites[]` entry, When I run `--site <slug>`, Then preDeploy hooks run, `stampFile` is stamped, and the `files[]` glob is FTPS-uploaded.* *(implemented: `runSiteMode`/`deployOneSite`/`stampIndex`; requires live FTP — not exercised this pass.)*
- **DEP-US-C2 🟡** As the operator, `mindattic.com` re-splices its UiUx markers and fetches repo descriptions before upload. *Given mindattic.com's `preDeploy[]`, When I deploy it, Then `uiux-pull` + `sync-mindattic-com.ps1` + optional `fetch-descriptions.ps1` run first.* *(implemented via `executePreDeploy`; not run this pass.)*

## Epic D — Blazor / GitHub-Actions apps
- **DEP-US-D1 🟡** As the operator, deploying an app runs its build/sync hooks, commits its `stageOnly` paths, and pushes its branch to fire the project's workflow. *Given `apps[]` `prose`, When I run `--app prose`, Then hooks run, staged changes commit, and `origin master` is pushed.* *(implemented: `deployOneApp`; would push real branches — not fired this pass.)*
- **DEP-US-D2 🟡** As the operator, a disabled app prints its note and exits 0 instead of half-deploying. *Given `disabled:true`, When I target it, Then the `disabledNote` prints and nothing fires.* *(implemented: `deployOneApp` early return; no automated test.)*
- **DEP-US-D3 🟡** As the operator, `--dry-run` previews an app/site deploy without committing, pushing, or uploading. *Given `--dry-run` with a mode flag, When I deploy, Then commit/push/FTP are skipped (plain site/app hooks still run, by design; the linked flow runs none).* *(implemented in both modes; the linked dry-run is covered by `test/linked.test.js`, plain modes have no automated test. Re-scoped by [DEP-A6](AMENDMENTS.md#DEP-A6); original in the audit log.)*

## Epic E — Credentials & CI
- **DEP-US-E1 🟡** As the operator, FTP credentials resolve `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`, never embedded in source/output. *Given no env var, When I deploy, Then `secrets/ftp.json` is read (or a clear error if absent).* *(implemented: `loadFtpSettings`; no automated test.)*
- **DEP-US-E2 ⬜** As the operator, I want FTP credentials served from `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault so `secrets/ftp.json` can be retired. *(last unchecked roadmap box; not implemented in `loadFtpSettings`.)*
- **DEP-US-E3 🗑️** *(cut by [DEP-A6](AMENDMENTS.md#DEP-A6) — the workflow was deleted with the catalog; original spec — audit log)* As the operator, CI can build + deploy all catalog pages on `workflow_dispatch`. *Given `MINDATTIC_FTP_JSON` secret, When the workflow runs, Then it checks out UiUx, `npm ci`, and deploys `--from-github`.* *(implemented: `.github/workflows/deploy.yml`; auto-`push` trigger intentionally removed pending the secret.)*

## Priority backlog
Dependency-ordered toward the headline goal (every status above provable):
1. **DEP-US-F1 ⬜** Stand up a test project (see [rfc/0001-test-harness.md](rfc/0001-test-harness.md)) — unblocks promoting Epic A stories to ✅.
2. **DEP-US-F2 ⬜** Add unit coverage for `expandFiles` glob escaping, `stampIndex` idempotency, and flag rejection (pure functions, no network). *(`effectiveProjects` dropped from scope: removed with the catalog by [DEP-A6](AMENDMENTS.md#DEP-A6).)*
3. **DEP-US-E2 ⬜** MindAttic.Vault-backed credential resolution; retire `secrets/ftp.json`.
4. **DEP-US-F3 ⬜** Smoke-deploy step in CI against a throwaway remote (or a mock FTP server) to prove the upload path.

### Audit log
The stories were first captured at adoption of this Codex standard (2026-06-07), derived from `README.md`, `CLAUDE.md`, and the source. When a story is later changed, the original ask is preserved here verbatim, marked "(original spec — audit log)". Cut stories (Epic B, DEP-US-E3) keep their original text in place above.

Re-scoped by [DEP-A6](AMENDMENTS.md#DEP-A6) (2026-10-03):
- **DEP-US-A1** *(original spec — audit log)* As the operator, I can deploy any target by editing only `projects.json`, so there is no per-project deploy machinery or drift. *Given a slug in one of the three arrays, When I run the matching command, Then only that target deploys.* *(implemented in `src/deploy.js`; no automated test — manual `--dry-run` verified.)*
- **DEP-US-A2** *(original spec — audit log)* As the operator, I can drive the exact same pipeline from either `npm run deploy` or the C# CLI, so both front doors behave identically. *Given the CLI `catalog`/`site`/`app` commands, When invoked, Then they shell into `node --use-system-ca src/deploy.js`.* *(implemented in `Services/DeployRunner.cs`; CLI compiles — `dotnet build -c Release` clean; no behavioral test.)*
- **DEP-US-A3** *(original spec — audit log)* As the operator, I get a loud failure (exit 2) on an unknown flag or unknown catalog slug instead of an accidental full deploy. *Given `--hlep` or a bad slug, When I run build/deploy, Then it errors and prints usage.* *(implemented: `KNOWN_FLAGS` guard + slug validation in `build.js`/`deploy.js`; no automated test.)*
- **DEP-US-D3** *(original spec — audit log)* As the operator, `--dry-run` previews an app/site/catalog deploy without committing, pushing, or uploading. *Given `--dry-run`, When I deploy, Then commit/push/FTP are skipped (hooks still run, by design).* *(implemented across all three modes; no automated test.)*
