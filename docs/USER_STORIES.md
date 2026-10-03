---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: stories
status: living
updated: 2026-10-03
---

# MindAttic.Deploy — User Stories
> ✅ done (shipped & tested) · 🟡 partial · ⬜ planned. Every ✅ cites the test.
>
> This repo has one automated test file, `test/linked.test.js` (node:test, `npm test`), covering
> the linked deploy and the CLI flag guards. Capabilities proven only by a clean build or a manual
> run are marked 🟡 (not ✅), per [HOUSE-LAW-8](../../MindAttic.HouseRules.md#HOUSE-LAW-8).
> They graduate to ✅ once a verifying test lands ([rfc/0001-test-harness.md](rfc/0001-test-harness.md)).

## Epic A — Registry-driven, one-pipeline deploy
- **DEP-US-A1 🟡** As the operator, I can deploy any target by editing only `projects.json`, so there is no per-project deploy machinery or drift. *Given a slug in `sites[]` or `apps[]`, When I run the matching command, Then only that target deploys (a linked-group member deploys its whole group).* *(implemented in `src/deploy.js`; the registry shape is checked by the `registry:` test in `test/linked.test.js`; plain modes have no automated test.)*
- **DEP-US-A2 🟡** As the operator, I can drive the exact same pipeline from either `npm run deploy` or the C# CLI, so both front doors behave identically. *Given the CLI `site`/`uiux`/`app` commands, When invoked, Then they shell into `node --use-system-ca src/deploy.js`.* *(implemented in `Services/DeployRunner.cs`; CLI compiles — `dotnet build -c Release` clean; no behavioral test.)*
- **DEP-US-A3 🟡** As the operator, I get a loud failure (exit 2) on an unknown flag or a run with no mode flag instead of an accidental deploy. *Given `--hlep`, an unknown flag such as `--only`, or a bare `npm run deploy`, When I run deploy, Then it errors and prints usage.* *(implemented: `KNOWN_FLAGS` guard + no-mode guard in `src/deploy.js`; exercised by the `cli:` tests in `test/linked.test.js`; kept 🟡 until the C# CLI path is covered.)*

## Epic C — Root sites (verbatim upload) and the linked group
- **DEP-US-C1 🟡** As the operator, I can upload a root site's files verbatim (not templated) to its FTP path with a Last-Updated stamp. *Given a `sites[]` entry, When I run `--site <slug>`, Then preDeploy hooks run, `stampFile` is stamped, and the `files[]` glob is FTPS-uploaded.* *(implemented: `runSiteMode`/`deployOneSite`/`stampIndex`; requires live FTP — no automated test of the plain mode.)*
- **DEP-US-C2 🟡** As the operator, `mindattic.com` re-splices its Cyberspace markers at the release tag before upload. *Given mindattic.com's `preDeploy[]`, When I deploy it, Then `uiux-pull` (skipped inside the linked flow) and `sync-mindattic-com.ps1` (receiving the tag via `-CyberspaceCdnTag`) run first.* *(implemented via `executePreDeploy`; the hook wiring is checked by the `registry:` test in `test/linked.test.js`; the hook run itself has no automated test.)*
- **DEP-US-C3 🟡** As the operator, deploying any of MindAttic.UiUx, ryandebraal.com, mindatticcares.com or mindattic.com deploys all four: the package is tagged and pushed, the tag is pinned in the pages, every asset is verified byte-exact on jsDelivr, then the sites upload — and nothing uploads if a gate fails. *(implemented in `src/linked.js`; covered by `test/linked.test.js` against fixtures; real runs succeed but there is no automated test against the real CDN/host.)*

## Epic D — Blazor / GitHub-Actions apps
- **DEP-US-D1 🟡** As the operator, deploying an app runs its build/sync hooks, commits its `stageOnly` paths, and pushes its branch to fire the project's workflow. *Given an enabled `apps[]` entry, When I run `--app <slug>`, Then hooks run, staged changes commit, and the configured branch is pushed.* *(implemented: `deployOneApp`; would push real branches — no automated test.)*
- **DEP-US-D2 🟡** As the operator, a disabled app prints its note and exits 0 instead of half-deploying. *Given `disabled:true`, When I target it, Then the `disabledNote` prints and nothing fires.* *(implemented: `deployOneApp` early return; no automated test.)*
- **DEP-US-D3 🟡** As the operator, `--dry-run` previews an app/site deploy without committing, pushing, or uploading. *Given `--dry-run` with a mode flag, When I deploy, Then commit/push/FTP are skipped (plain site/app hooks still run, by design; the linked flow runs none).* *(implemented in both modes; the linked dry-run is covered by `test/linked.test.js`, plain modes have no automated test.)*

## Epic E — Credentials
- **DEP-US-E1 🟡** As the operator, FTP credentials resolve MindAttic.Vault (C# CLI) → `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`, never embedded in source/output. *Given no Vault entry and no env var, When I deploy, Then `secrets/ftp.json` is read (or a clear error if absent).* *(implemented: `DeployRunner.RunNode` + `loadFtpSettings`; no automated test.)*
- **DEP-US-E2 ⬜** As the operator, I want `npm run deploy` to resolve MindAttic.Vault as the C# CLI does, so `secrets/ftp.json` can be dropped. *(not implemented in `loadFtpSettings`.)*

## Priority backlog
Dependency-ordered toward the headline goal (every status above provable):
1. **DEP-US-F1 ⬜** Extend the test harness (see [rfc/0001-test-harness.md](rfc/0001-test-harness.md)) to the plain site/app modes and the C# CLI — unblocks promoting Epic A/C/D stories to ✅.
2. **DEP-US-F2 ⬜** Add unit coverage for `expandFiles` glob escaping and `stampIndex` idempotency (pure functions, no network).
3. **DEP-US-E2 ⬜** MindAttic.Vault credential resolution in the Node front door; drop `secrets/ftp.json`.
4. **DEP-US-F3 ⬜** Smoke-deploy step in CI against a throwaway remote (or a mock FTP server) to prove the upload path.
