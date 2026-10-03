---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: bible
status: living
updated: 2026-10-03
---

# MindAttic.Deploy — Project Bible
> Single source of truth for what MindAttic.Deploy IS, is NOT, and the rules that keep it coherent.
> README.md says how to build/run; this says how to think about the system.

## 1. The one sentence {#DEP-§1}
One pipeline that FTPS-deploys the MindAttic root sites (with the `MindAttic.UiUx` asset package they load, as one linked group) and fires the GitHub-Actions deploys of the Blazor apps — from a single registry (`projects.json`) and a single FTP credential, with zero per-project deploy machinery.

## 2. The product promise {#DEP-§2}
- **One repo, one install, one credential.** `npm install` once; one FTP credential, resolved per [DEP-LAW-3](#DEP-LAW-3). No per-project `deploy.ps1` / `deploy.settings.json` / `node_modules/`.
- **One registry edits everything.** [`projects.json`](#DEP-§4) has two target arrays — `sites[]` (verbatim root sites) and `apps[]` (Blazor/CI apps) — plus `linkedGroups`. Add/retag a target by editing only this file.
- **Two pipelines.** Root sites (including the linked group) and apps. A run names one with a mode flag (`--site`, `--sites`, `--uiux`, `--app`, `--apps`); there is no default pipeline.
- **Two front doors, one engine.** `npm run deploy` (Node) and `MindAttic.Deploy.Cli` (C#) both drive the *same* `src/deploy.js` pipeline — the CLI shells into node. See [DEP-LAW-1](#DEP-LAW-1).
- **Linked deploy.** `MindAttic.UiUx` (the shared jsDelivr asset package) and the three sites that load assets from it (`ryandebraal.com`, `mindatticcares.com`, `mindattic.com`) are a permanent **linked group** (`linkedGroups` in `projects.json`): deploying any one deploys all four — package tag + push, tag pinned in the pages, CDN verified byte-exact, then FTP — and aborts before any upload if a gate fails. The flow is specified in [§4.3](#DEP-§4); the code is `src/linked.js`.
- **Project pages live on GitHub.** Each MindAttic repo's GitHub README is its project page; this repo renders and uploads nothing per project.

## 3. What it is NOT {#DEP-§3}
- **NOT a component library.** It does not own fonts, the Cyberspace effects, or theme CSS — those live in `MindAttic.UiUx` and are loaded at runtime via jsDelivr or spliced by that repo's sync scripts. This repo only *invokes* UiUx scripts as `preDeploy` hooks.
- **NOT a project-page generator.** Each repo's GitHub README is its project page; adding a README renderer here is a regression.
- **NOT a remote cleaner.** It never deletes files on the FTP host; stale remote files are removed by hand.
- **NOT the editor of component sources.** For the linked group it tags and pushes the `MindAttic.UiUx` repo and rewrites the tag pins in the sites' pages; it never edits files inside `Components/`, `fonts/` or the domain asset folders.
- **NOT the host of per-project deploy state.** Projects carry no `scripts/cli/`, `deploy.bat`, `deploy.settings.json` or marker-block deploy files of their own; adding them is a regression.
- **NOT the actual app deployer for Blazor apps.** For `apps[]` entries it commits + pushes a branch; the project's *own* GitHub Actions workflow does the real Azure push.
- **NOT a SemVer project.** Whole-number versioning only ([HOUSE-LAW-1](../../MindAttic.HouseRules.md#HOUSE-LAW-1)), including the `MindAttic.UiUx` release tags the linked deploy publishes and pins (`V1`, `V2`, … never `v1.1.1`).
- **NOT a renderer.** `sites[]` files are uploaded verbatim (only the Last-Updated stamp and the linked group's tag pins are rewritten); nothing is templated.
- **NOT a committer of site repos.** The linked deploy rewrites pins and stamps in the site working trees but never commits or pushes them; it prints a reminder when they have uncommitted or unpushed changes.

## 4. Architecture canon {#DEP-§4}

```
                    projects.json  (THE registry)
                    ┌──────────────────────────┬──────────────┐
                    │ sites[] + linkedGroups   │    apps[]    │
                    │ root sites (+ UiUx pkg)  │  Blazor / CI │
                    └────────────┬─────────────┴──────┬───────┘
                                 │                    │
                                 ▼                    ▼
              ┌──────────────── src/deploy.js ─────────────────┐
              │ site:   preDeploy hooks → stamp → FTPS         │
              │ linked: src/linked.js — package tag + push →   │
              │         pin → hooks → CDN gate → FTPS          │
              │ app:    preDeploy hooks → git commit/push      │
              │ (no mode flag → usage, exit 2)                 │
              └────────────────────┬───────────────────────────┘
                                   │ shells into
     MindAttic.Deploy.Cli (C#)  ───┘  (node --use-system-ca src/deploy.js …)
                                   │
     creds: [CLI only] MindAttic.Vault → MINDATTIC_FTP_JSON env → secrets/ftp.json  (basic-ftp, FTPS)
```

### 4.1 Projects / components
- **`MindAttic.Deploy.Cli/`** — C# console app (`net10.0`, Spectre.Console.Cli, assembly name `MindAttic.Deploy`). A thin front door that shells into the node pipeline (see [`Services/DeployRunner.cs`](../MindAttic.Deploy.Cli/Services/DeployRunner.cs) and [`Services/ProjectRoster.cs`](../MindAttic.Deploy.Cli/Services/ProjectRoster.cs)). Solution: [`MindAttic.Deploy.slnx`](../MindAttic.Deploy.slnx).
- **`src/deploy.js`** — the pipeline (site / app modes; the linked group runs through `src/linked.js`); FTPS via `basic-ftp`; preDeploy hook runner. A run with no mode flag prints usage and exits 2.
- **`src/linked.js`** — the linked deploy ([§4.3](#DEP-§4)).
- **`projects.json`** — the registry (`sites[]`/`apps[]` + `linkedGroups`).
- **`package.json`** — `npm test`, `npm run deploy`, `npm run all` (all sites, then all apps); one runtime dependency, `basic-ftp`.
- **`.github/workflows/cli-ci.yml`** — builds the C# CLI and smoke-tests `--version`. There is no CI deploy workflow; deploys run from the dev box.
- **`test/linked.test.js`** — the node:test suite (`npm test`).
- **`scripts/publish.ps1`, `scripts/ensure-fresh.ps1`** — CLI publish + freshness helpers.
- **`tools/codex.ps1`** — Codex doctor + digest CLI; **`tools/build-readme.ps1`** — regenerates `README.htm` from `README.md`.

### 4.2 Domain model (NOUNS)
- **SiteProfile** — a verbatim root site (`slug`, `sourceDir`, `ftpRemotePath`, `files[]` or `uploadDir: true` (recursive, non-destructive tree upload), `stampFile`, optional `pinFiles[]`, `preDeploy[]`). Uploaded as-is. Each linked-group site uploads only its `index.htm`.
- **AppProfile** — a Blazor / GitHub-Actions deploy target (`slug`, `repo`, `branch`, `workflow`, `disabled`, `disabledNote`, `stageOnly[]`, `commitMessage`, `preDeploy[]`).
- **HookProfile** — a `preDeploy` step: `kind` ∈ {`uiux-pull`, `powershell`, `dotnet-build`}, plus `required`; a powershell hook may declare `tagArg`, the flag that receives the linked release tag (mindattic.com's Cyberspace splice, `MindAttic.UiUx/sync/sync-mindattic-com.ps1`, declares `-CyberspaceCdnTag`).
- **DeployConfig** — the deserialized `projects.json` (`sites`, `apps`, `linkedGroups`).
- **Linked group** — a set of sites inseparable from one package repo (`linkedGroups`): `mindattic-web` = package `MindAttic.UiUx` (`../MindAttic.UiUx`, repo `mindattic/MindAttic.UiUx`, branch `main`) + sites `ryandebraal.com` → `mindatticcares.com` → `mindattic.com`. The listed order is the FTP order (mindattic.com last, because its sync hook runs there). Deploying any member deploys all.

### 4.3 Key services (VERBS)
- **Mode guard** — `src/deploy.js` refuses a run with none of `--site`/`--sites`/`--uiux`/`--app`/`--apps` (usage, exit 2).
- **Site deploy** (`runSiteMode` / `deployOneSite`) — run `preDeploy`, stamp `<!-- Last Updated -->`, FTPS the `files[]` glob to `ftpRemotePath`.
- **Linked deploy** (`src/linked.js`, `runLinkedMode`) — `planTargets` expands `--site <member>` / `--sites` / `--uiux` (alias `--package`) to the whole group; `--no-link` deploys the named site only, with a loud warning. Everything with a side effect is injected so it is testable. The flow aborts BEFORE any FTP upload if a gate fails:
  1. **Preflight** (`inspectPackage`) — the package repo is a git repo on `main` with a clean working tree (never auto-committed), `origin` reachable, not behind or diverged from `origin/main`, latest tag an ancestor of `HEAD`, no whole-number tag that exists only locally and is not at `HEAD`, `tools\build-asset-manifest.ps1 -Verify` passes, site sources exist, FTP secrets resolvable; a page may not pin a tag newer than the release tag.
  2. **Publish** (`publishPackage`) — if `HEAD` already carries the latest `V<n>` tag (or a local-only tag at `HEAD`) it is reused; otherwise `V<n+1>` is created (annotated, message lists the commits), then `git push origin main` and `git push origin <tag>`. Never force. A tag on origin pointing at a different commit is immutable: the run aborts. A failed `git tag` or rejected push is a clean abort (`[ABORT] ... Nothing was uploaded`, exit 1); the next run with `HEAD` unchanged resumes from the local tag. A tag that is published but then fails the CDN gate stays (harmless); the next run reuses it or creates the next one.
  3. **Pin** (`rewritePins`) — every `MindAttic.UiUx@V<n>` in each site's `pinFiles` (default: its `stampFile`) becomes the release tag (idempotent; other jsDelivr URLs are untouched).
  4. **Prepare** — each site's `preDeploy` hooks run (a hook with `tagArg` receives the tag; `uiux-pull` is skipped because step 1 already verified the package).
  5. **CDN gate** (`buildCdnChecks` + `verifyCdn`) — every UiUx URL the pages use (literal URLs, plus every file listed in the package's `assets-manifest.json` under each site's domain folder, which covers URLs built at runtime from a base prefix) must return HTTP 200 on jsDelivr at the release tag with `access-control-allow-origin: *` and a `content-length` equal to the file in the package tree. Directory-like base URLs and documentation placeholders (`@<tag>/<path>`) are not fetched. Failures retry in shared backoff rounds (default 3 minutes total); a dry run never waits.
  6. **FTP** — the sites upload in group order over one connection, reconnecting before the next site if an upload closed it; a failing site does not stop the others; the exit code is non-zero if any failed. `--sites` deploys non-member sites after the group.

  `--dry-run` runs steps 1–5 read-only and prints the plan (no tag, push, pin edit, hook, FTP connect or upload); gates that would abort print `[WOULD ABORT]`. `--with-tests` is accepted only on a linked deploy. Publishing pushes `main` of MindAttic.UiUx, which triggers that repo's `sync-subscribers` workflow when the push touches the paths it watches; a `[skip ci]` package commit suppresses it.
- **App deploy** (`runAppMode` / `deployOneApp`) — run `preDeploy`, `git add` `stageOnly`, commit if staged, push `branch` to fire the project's workflow; disabled apps print their note and exit 0.
- **preDeploy hooks** (`executePreDeploy`) — `runUiuxPull` (git pull MindAttic.UiUx), `runPowershellHook`, `runDotnetBuildHook`.
- **Credential load** — the C# CLI (`DeployRunner.RunNode`) reads MindAttic.Vault (`FtpCredentialStore.Default.TryGetJson()`, `%APPDATA%\MindAttic\Ftp\ftp.json`) and, when it has content, passes it to node as `MINDATTIC_FTP_JSON`; `loadFtpSettings` in `src/deploy.js` resolves `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`; FTPS via `accessFtp`.
- **CLI dispatch** (`MindAttic.Deploy.Cli`) — `site` (with `--no-link` / `--with-tests`) / `uiux` (alias `package`) / `app` / `all` / `list` / `version` commands; default (no args) is an interactive multi-select menu (`MainMenuCommand`) that runs a linked group once however many of its members are ticked; all shell into `DeployRunner.RunNode`. `ProjectRoster` resolves the repo root and deserializes `projects.json` at startup.

## 5. The Laws {#DEP-§5}
This project **inherits all org-wide laws** from [`MindAttic.HouseRules.md`](../../MindAttic.HouseRules.md) by reference — they are not restated here. Most directly load-bearing for this repo:
- [HOUSE-LAW-1 — Whole-number versioning](../../MindAttic.HouseRules.md#HOUSE-LAW-1) (assembly `Version` *and* the `MindAttic.UiUx` `V<n>` release tag the linked deploy pins).
- [HOUSE-LAW-2 — Soft-disable, never hard-delete](../../MindAttic.HouseRules.md#HOUSE-LAW-2) (an `apps[]` entry is disabled with a note, never deleted, until infra exists).
- [HOUSE-LAW-3 — Credentials resolve through MindAttic.Vault](../../MindAttic.HouseRules.md#HOUSE-LAW-3) (FTP creds; see [DEP-LAW-3](#DEP-LAW-3)).
- [HOUSE-LAW-6 — One engine, many front doors](../../MindAttic.HouseRules.md#HOUSE-LAW-6) (the CLI and `npm run deploy` drive the same `src/deploy.js`; see [DEP-LAW-1](#DEP-LAW-1)).
- [HOUSE-LAW-8 — Definition of done is verified, not asserted](../../MindAttic.HouseRules.md#HOUSE-LAW-8) (see [§8](#DEP-§8)).

Project-specific laws:

### DEP-LAW-1 — One pipeline, two front doors {#DEP-LAW-1}
`src/deploy.js` is the single deploy engine. `MindAttic.Deploy.Cli` MUST NOT reimplement deploy logic; it shells into `node --use-system-ca src/deploy.js …` (`Services/DeployRunner.cs`). A behavior change happens in `src/deploy.js` / `src/linked.js`, not in the C# layer.

### DEP-LAW-2 — The registry is the only edit point for targets {#DEP-LAW-2}
Adding, removing, or retagging a deploy target (`sites[]` / `apps[]` entries: slug, paths, files, hooks, disabled) and editing linked-group membership or FTP order (`linkedGroups`) is an edit to [`projects.json`](#DEP-§4) and nothing else. Components live in `MindAttic.UiUx`; project pages are each repo's GitHub README.

### DEP-LAW-3 — Credentials never live in code or uploaded output {#DEP-LAW-3}
FTP credentials resolve MindAttic.Vault (C# CLI only, per [HOUSE-LAW-3](../../MindAttic.HouseRules.md#HOUSE-LAW-3)) → `MINDATTIC_FTP_JSON` env → `secrets/ftp.json` (gitignored), and are never embedded in source or any uploaded file.

### DEP-LAW-4 — Shared assets are CDN-pinned to an immutable tag {#DEP-LAW-4}
The sites load shared assets from `MindAttic.UiUx` on jsDelivr at an immutable whole-number tag, never `@main` (tip-of-tree, non-atomic, cached ~12h). For the linked group that tag is the release tag the deploy publishes, pins in each site's `pinFiles` and verifies byte-exact on the CDN before any upload; a page never pins a tag newer than the published one.

### DEP-LAW-5 — Apps fire CI; this repo never FTPs an app {#DEP-LAW-5}
For `apps[]`, the repo's contract ends at `git push <branch>`; the project's own workflow performs the real (Azure) deploy. A disabled app prints its `disabledNote` and exits 0 — it never half-fires.

### DEP-LAW-6 — Fail loud on unknown input {#DEP-LAW-6}
`src/deploy.js` rejects an unknown flag, a linked-only modifier used outside a linked deploy (`--no-link` without `--site`/`--sites`, `--with-tests` without `--site <member>`/`--sites`/`--uiux`) and a run with no mode flag — each with usage and exit 2 — rather than guessing at a deploy.

## 6. Verified state {#DEP-§6}
Evidence from the dev box (Windows 11, Node 24, .NET 10 SDK).

| Capability | Status | Evidence |
|---|---|---|
| C# CLI builds clean | ✅ done | `dotnet build MindAttic.Deploy.Cli -c Release --nologo` → **0 Warning(s), 0 Error(s)** (2026-10-03). |
| Node pipeline flag-validated | ✅ done | `src/deploy.js` rejects unknown flags, misplaced linked modifiers and a run with no mode flag (exit 2); `--help` works. Covered by the `cli:` tests in `test/linked.test.js`. |
| Linked deploy (`src/linked.js`) | 🟡 partial | `npm test` → 30 tests pass (2026-10-03): tag math, expansion, flag validation, pin rewrite, dirty/behind/tag-moved/stray-local-tag aborts, rejected push + resume, CDN gate incl. runtime-built base prefixes, dry-run writes nothing, partial FTP failure + reconnect, registry consistency — against throwaway git repos, a local stand-in for jsDelivr and a fake FTP. Real linked runs have published the package and uploaded all three sites; the sites currently pin `MindAttic.UiUx@V10`. |
| FTPS site upload | 🟡 partial | Exercised by real linked deploys; no automated test against a real host. |
| App deploy | 🟡 partial | Push-to-branch CI path; no automated test (it would push real branches). |
| Automated test suite | 🟡 partial | `test/linked.test.js` covers the linked deploy and the CLI flag guards; plain site/app modes and the C# CLI have no automated tests ([rfc/0001-test-harness.md](rfc/0001-test-harness.md)). |

## 7. Active frontier {#DEP-§7}
- **RFC:** [rfc/0001-test-harness.md](rfc/0001-test-harness.md) — extend automated tests to the plain site/app modes and the C# CLI so those behaviors can graduate from 🟡 to ✅.
- **Roadmap:** resolve MindAttic.Vault in the Node front door too, so `secrets/ftp.json` can be dropped (DEP-US-E2).
- **Epics:** see [USER_STORIES.md](USER_STORIES.md) — Epic A (registry-driven deploy), Epic C (root sites + linked group), Epic D (Blazor apps), Epic E (credentials), and the priority backlog (test harness).

## 8. Quality bar {#DEP-§8}
A change is **done** when:
1. `dotnet build MindAttic.Deploy.slnx -c Release` is clean (0 warnings — `TreatWarningsAsErrors=true`).
2. `node src/deploy.js --help` runs, `npm test` passes, and a representative `--dry-run` deploy succeeds for the affected mode.
3. Behavior changes land in `src/deploy.js` / `src/linked.js` (not duplicated in the C# CLI — [DEP-LAW-1](#DEP-LAW-1)).
4. Target changes are confined to `projects.json` ([DEP-LAW-2](#DEP-LAW-2)); no credential touches source/output ([DEP-LAW-3](#DEP-LAW-3)).
5. Per [HOUSE-LAW-8](../../MindAttic.HouseRules.md#HOUSE-LAW-8): a status is `✅` in the docs only when a build or run proves it; otherwise `🟡`/`⬜`.
6. `powershell -File tools/codex.ps1 doctor` passes.

## 9. Glossary {#DEP-§9}
- **Root site** — a verbatim FTPS-uploaded site (`mindattic.com` root, `mindatticcares.com`, `ryandebraal.com`, plus the `hyperspace` and `idiotproof-replays` sub-folders); not templated.
- **App** — a Blazor / GitHub-Actions deploy target; this repo commits+pushes, CI deploys.
- **preDeploy hook** — a step run before upload/push: `uiux-pull`, `powershell`, or `dotnet-build`.
- **Mode flag** — one of `--site`, `--sites`, `--uiux`, `--app`, `--apps`; `src/deploy.js` exits 2 without one.
- **Asset manifest** — MindAttic.UiUx's `assets-manifest.json`, the verified list of package assets the CDN gate checks.
- **Linked group** — see [§4.2](#DEP-§4); **release tag** — the whole-number `V<n>` tag of MindAttic.UiUx a linked deploy publishes (or reuses) and pins in the sites; **pin** — the `MindAttic.UiUx@V<n>` segment of a jsDelivr URL; **CDN gate** — the pre-FTP check that every package asset the sites use is live at the release tag with the exact bytes.
- **Front door** — an entry point (the Node `npm run` scripts or the C# CLI) onto the one deploy engine.
- **Stamp** — the `<!-- Last Updated: <iso> -->` comment written into a root site's `stampFile`.
