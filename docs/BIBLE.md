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
One pipeline that FTPS-deploys the MindAttic root sites (the MindAttic.Web monorepo's sites and its `MindAttic.Web.Shared` asset package, as one linked group) and fires the GitHub-Actions deploys of the Blazor apps — from a single registry (`projects.json`) and a single FTP credential, with zero per-project deploy machinery.

## 2. The product promise {#DEP-§2}
- **One repo, one install, one credential.** `npm install` once; one FTP credential, resolved per [DEP-LAW-3](#DEP-LAW-3). No per-project `deploy.ps1` / `deploy.settings.json` / `node_modules/`.
- **One registry edits everything.** [`projects.json`](#DEP-§4) has two target arrays — `sites[]` (verbatim root sites) and `apps[]` (Blazor/CI apps) — plus `linkedGroups`. Add/retag a target by editing only this file.
- **Two pipelines.** Root sites (including the linked group) and apps. A run names one with a mode flag (`--site`, `--sites`, `--uiux`, `--app`, `--apps`); there is no default pipeline.
- **Two front doors, one engine.** `npm run deploy` (Node) and `MindAttic.Deploy.Cli` (C#) both drive the *same* `src/deploy.js` pipeline — the CLI shells into node. See [DEP-LAW-1](#DEP-LAW-1).
- **Linked deploy.** The MindAttic.Web monorepo holds the shared jsDelivr asset package (its `MindAttic.Web.Shared` folder) and the four sites that load assets from it (`ryandebraal.com`, `mindatticcares.com`, `Hyperspace`, `mindattic.com`) as sibling folders; they are a permanent **linked group** (`linkedGroups` in `projects.json`): deploying any one deploys all of them — next tag pinned in the pages, hooks and stamps, one `Pin MindAttic.Web.Shared V<n>` commit, tag + push, CDN verified byte-exact, then FTP — and aborts before any upload if a gate fails. The flow is specified in [§4.3](#DEP-§4); the code is `src/linked.js`.
- **Project pages live on GitHub.** Each MindAttic repo's GitHub README is its project page; this repo renders and uploads nothing per project.

## 3. What it is NOT {#DEP-§3}
- **NOT a component library.** It does not own fonts, the Cyberspace effects, or theme CSS — those live in `MindAttic.Web.Shared` and are loaded at runtime via jsDelivr or spliced by its sync scripts. This repo only *invokes* those scripts as `preDeploy` hooks.
- **NOT a project-page generator.** Each repo's GitHub README is its project page; adding a README renderer here is a regression.
- **NOT a remote cleaner.** It never deletes files on the FTP host; stale remote files are removed by hand.
- **NOT the editor of component sources.** For the linked group it rewrites the tag pins and stamps in the sites' pages, commits them, and tags and pushes MindAttic.Web; it never edits files inside `MindAttic.Web.Shared` (`Components/`, `fonts/`, the domain asset folders).
- **NOT the host of per-project deploy state.** Projects carry no `scripts/cli/`, `deploy.bat`, `deploy.settings.json` or marker-block deploy files of their own; adding them is a regression.
- **NOT the actual app deployer for Blazor apps.** For `apps[]` entries it commits + pushes a branch; the project's *own* GitHub Actions workflow does the real Azure push.
- **NOT a SemVer project.** Whole-number versioning only ([HOUSE-LAW-1](../../MindAttic.HouseRules.md#HOUSE-LAW-1)), including the MindAttic.Web release tags the linked deploy publishes and pins (`V12`, `V13`, … never `v1.1.1`).
- **NOT a renderer.** `sites[]` files are uploaded verbatim (only the Last-Updated stamp and the linked group's tag pins are rewritten); nothing is templated.
- **NOT a committer of anyone's work.** The linked deploy commits only its own pin, splice and stamp changes inside the group's site folders; any other uncommitted change aborts the run, and a hook that touches a file outside those folders aborts it too.

## 4. Architecture canon {#DEP-§4}

```
                    projects.json  (THE registry)
                    ┌──────────────────────────┬──────────────┐
                    │ sites[] + linkedGroups   │    apps[]    │
                    │ MindAttic.Web root sites │  Blazor / CI │
                    └────────────┬─────────────┴──────┬───────┘
                                 │                    │
                                 ▼                    ▼
              ┌──────────────── src/deploy.js ─────────────────┐
              │ site:   preDeploy hooks → stamp → FTPS         │
              │ linked: src/linked.js — pin → hooks → stamp →  │
              │         commit → tag → push → CDN gate → FTPS  │
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
- **HookProfile** — a `preDeploy` step: `kind` ∈ {`package-pull`, `powershell`, `dotnet-build`}, plus `required`; a powershell hook may declare `tagArg`, the flag that receives the linked release tag (mindattic.com's Cyberspace splice, `MindAttic.Web/MindAttic.Web.Shared/sync/sync-mindattic-com.ps1`, declares `-CyberspaceCdnTag`). `package-pull` runs `git pull` in the linked package's `sourceDir`.
- **DeployConfig** — the deserialized `projects.json` (`sites`, `apps`, `linkedGroups`).
- **Linked group** — one repo holding a jsDelivr package folder plus the site folders that load from it (`linkedGroups`): `mindattic-web` = package `MindAttic.Web.Shared` (repo `mindattic/MindAttic.Web` at `../MindAttic.Web`, `cdnSubpath` `MindAttic.Web.Shared`, `firstTag` `V12`, branch `main`) + sites `ryandebraal.com` → `mindatticcares.com` → `hyperspace` → `mindattic.com`, each with `sourceDir` `../MindAttic.Web/<folder>`. Package URLs are `https://cdn.jsdelivr.net/gh/mindattic/MindAttic.Web@V<n>/MindAttic.Web.Shared/<path>`. The listed order is the FTP order. Deploying any member deploys all.

### 4.3 Key services (VERBS)
- **Mode guard** — `src/deploy.js` refuses a run with none of `--site`/`--sites`/`--uiux`/`--app`/`--apps` (usage, exit 2).
- **Site deploy** (`runSiteMode` / `deployOneSite`) — run `preDeploy`, stamp `<!-- Last Updated -->`, FTPS the `files[]` glob to `ftpRemotePath`.
- **Linked deploy** (`src/linked.js`, `runLinkedMode`) — `planTargets` expands `--site <member>` / `--sites` / `--uiux` (alias `--package`) to the whole group; `--no-link` deploys the named site only, with a loud warning. Everything with a side effect is injected so it is testable. The flow aborts BEFORE any FTP upload if a gate fails:
  1. **Preflight** (`inspectRepo`) — the repo is a git repo on `main` with a clean working tree, `origin` reachable, not behind or diverged from `origin/main`, latest tag an ancestor of `HEAD`, no tag moved on origin, no whole-number tag that exists only locally and is not at `HEAD`, `<cdnSubpath>\tools\build-asset-manifest.ps1 -Verify` passes, every site's page exists inside the repo, FTP secrets resolvable.
  2. **Release tag** (`releaseTagAfter`) — if `HEAD` already carries the latest `V<n>` tag and every page's pins equal it, that tag is **reused** (steps 3–5 are skipped; this is also how a run resumes after a rejected push). Otherwise the release tag is `V<n+1>`, or `firstTag` while the repo has no whole-number tag. Gates before anything is written: no page pins a tag newer than the release tag, every literal package URL exists in the package tree with the manifest's byte count, nothing pins `@main`; a release tag already on origin at another commit aborts (tags are immutable).
  3. **Prepare** — `rewritePins` turns every `gh/<repo>@V<n>/<cdnSubpath>/` pin in each site's `pinFiles` (default: its `stampFile`) into the release tag (idempotent; npm, other repos' and non-package URLs are untouched); each site's `preDeploy` hooks run (a hook with `tagArg` receives the tag; `package-pull` is skipped); each `stampFile` is stamped.
  4. **Commit** — the changed files are committed as `Pin <package slug> V<n>`. A hook that changed a file outside the group's site folders aborts the run. Any failure in steps 3–4 restores the working tree (`reset --hard`, `clean -fd`) to the clean state preflight verified.
  5. **Tag** — annotated `V<n>` on that commit; the message lists the commit subjects since the previous tag.
  6. **Push** — `git push origin main`, then the tag. Never force. A rejected push is a clean abort (`[ABORT] ... Nothing was uploaded`, exit 1); the commit and tag stay local and the next run reuses them.
  7. **CDN gate** (`buildCdnChecks` + `verifyCdn`) — every package URL the pages use (literal URLs, plus every file listed in `<cdnSubpath>/assets-manifest.json` under each site's domain folder, which covers URLs built at runtime from a base prefix) must return HTTP 200 on jsDelivr at the release tag with `access-control-allow-origin: *` and a `content-length` equal to the file in the package folder. Directory-like base URLs and documentation placeholders (`@<tag>/<path>`) are not fetched. Failures retry in shared backoff rounds (default 3 minutes total); a dry run never waits. A tag that is published but fails the gate stays; the next run reuses it.
  8. **FTP** — the committed pages upload in group order over one connection (no second stamp), reconnecting before the next site if an upload closed it; a failing site does not stop the others; the exit code is non-zero if any failed. `--sites` deploys non-member sites after the group. The summary reports whether the repo is clean and in sync with `origin/main`.

  `--dry-run` changes nothing (no fetch, pin edit, hook, stamp, commit, tag, push, FTP connect or upload) and prints the whole plan; gates that would abort print `[WOULD ABORT]`. `--with-tests` (runs `<cdnSubpath>/tests`) is accepted only on a linked deploy. Pushing `main` of MindAttic.Web triggers its `sync-subscribers` workflow only when the push touches the package paths that workflow watches; the pin commit touches only site folders.
- **App deploy** (`runAppMode` / `deployOneApp`) — run `preDeploy`, `git add` `stageOnly`, commit if staged, push `branch` to fire the project's workflow; disabled apps print their note and exit 0.
- **preDeploy hooks** (`executePreDeploy`) — `runPackagePull` (git pull in the linked package's `sourceDir`, read from `projects.json`), `runPowershellHook`, `runDotnetBuildHook`.
- **Credential load** — the C# CLI (`DeployRunner.RunNode`) reads MindAttic.Vault (`FtpCredentialStore.Default.TryGetJson()`, `%APPDATA%\MindAttic\Ftp\ftp.json`) and, when it has content, passes it to node as `MINDATTIC_FTP_JSON`; `loadFtpSettings` in `src/deploy.js` resolves `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`; FTPS via `accessFtp`.
- **CLI dispatch** (`MindAttic.Deploy.Cli`) — `site` (with `--no-link` / `--with-tests`) / `uiux` (alias `package`) / `app` / `all` / `list` / `version` commands; default (no args) is an interactive multi-select menu (`MainMenuCommand`) that runs a linked group once however many of its members are ticked; all shell into `DeployRunner.RunNode`. `ProjectRoster` resolves the repo root and deserializes `projects.json` at startup.

## 5. The Laws {#DEP-§5}
This project **inherits all org-wide laws** from [`MindAttic.HouseRules.md`](../../MindAttic.HouseRules.md) by reference — they are not restated here. Most directly load-bearing for this repo:
- [HOUSE-LAW-1 — Whole-number versioning](../../MindAttic.HouseRules.md#HOUSE-LAW-1) (assembly `Version` *and* the MindAttic.Web `V<n>` release tag the linked deploy pins).
- [HOUSE-LAW-2 — Soft-disable, never hard-delete](../../MindAttic.HouseRules.md#HOUSE-LAW-2) (an `apps[]` entry is disabled with a note, never deleted, until infra exists).
- [HOUSE-LAW-3 — Credentials resolve through MindAttic.Vault](../../MindAttic.HouseRules.md#HOUSE-LAW-3) (FTP creds; see [DEP-LAW-3](#DEP-LAW-3)).
- [HOUSE-LAW-6 — One engine, many front doors](../../MindAttic.HouseRules.md#HOUSE-LAW-6) (the CLI and `npm run deploy` drive the same `src/deploy.js`; see [DEP-LAW-1](#DEP-LAW-1)).
- [HOUSE-LAW-8 — Definition of done is verified, not asserted](../../MindAttic.HouseRules.md#HOUSE-LAW-8) (see [§8](#DEP-§8)).

Project-specific laws:

### DEP-LAW-1 — One pipeline, two front doors {#DEP-LAW-1}
`src/deploy.js` is the single deploy engine. `MindAttic.Deploy.Cli` MUST NOT reimplement deploy logic; it shells into `node --use-system-ca src/deploy.js …` (`Services/DeployRunner.cs`). A behavior change happens in `src/deploy.js` / `src/linked.js`, not in the C# layer.

### DEP-LAW-2 — The registry is the only edit point for targets {#DEP-LAW-2}
Adding, removing, or retagging a deploy target (`sites[]` / `apps[]` entries: slug, paths, files, hooks, disabled) and editing linked-group membership or FTP order (`linkedGroups`) is an edit to [`projects.json`](#DEP-§4) and nothing else. Components live in `MindAttic.Web.Shared`; project pages are each repo's GitHub README.

### DEP-LAW-3 — Credentials never live in code or uploaded output {#DEP-LAW-3}
FTP credentials resolve MindAttic.Vault (C# CLI only, per [HOUSE-LAW-3](../../MindAttic.HouseRules.md#HOUSE-LAW-3)) → `MINDATTIC_FTP_JSON` env → `secrets/ftp.json` (gitignored), and are never embedded in source or any uploaded file.

### DEP-LAW-4 — Shared assets are CDN-pinned to an immutable tag {#DEP-LAW-4}
The sites load shared assets from `MindAttic.Web.Shared` on jsDelivr (`gh/mindattic/MindAttic.Web@V<n>/MindAttic.Web.Shared/`) at an immutable whole-number tag, never `@main` (tip-of-tree, non-atomic, cached ~12h). For the linked group that tag is the release tag the deploy publishes, pins in each site's `pinFiles` and verifies byte-exact on the CDN before any upload; a page never pins a tag newer than the published one.

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
| Linked deploy (`src/linked.js`) | 🟡 partial | `npm test` → 34 tests pass (2026-10-03): tag math incl. `firstTag`, expansion, flag validation, subpath-aware pin rewrite and URLs, dirty/behind/tag-moved/stray-local-tag/site-outside-repo aborts, pin commit + tag + push with a clean tree after, tag reuse, rejected push + resume, hook touching a file outside the site folders aborts and restores, CDN gate incl. runtime-built base prefixes, dry-run changes nothing, partial FTP failure + reconnect, registry consistency — against a throwaway monorepo with a bare origin, a local stand-in for jsDelivr serving the published tag, and a fake FTP. No real MindAttic.Web release has run yet; the first one publishes `V12`. |
| FTPS site upload | 🟡 partial | Exercised by real deploys; no automated test against a real host. |
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
- **preDeploy hook** — a step run before upload/push: `package-pull`, `powershell`, or `dotnet-build`.
- **Mode flag** — one of `--site`, `--sites`, `--uiux`, `--app`, `--apps`; `src/deploy.js` exits 2 without one.
- **Asset manifest** — `MindAttic.Web.Shared/assets-manifest.json`, the verified list of package assets the CDN gate checks.
- **Linked group** — see [§4.2](#DEP-§4); **release tag** — the whole-number `V<n>` tag of MindAttic.Web a linked deploy publishes (or reuses) and pins in the sites; **pin** — the `MindAttic.Web@V<n>` segment of a `…/MindAttic.Web.Shared/` jsDelivr URL; **pin commit** — the `Pin MindAttic.Web.Shared V<n>` commit holding the pins, splices and stamps that the release tag points at; **CDN gate** — the pre-FTP check that every package asset the sites use is live at the release tag with the exact bytes.
- **Front door** — an entry point (the Node `npm run` scripts or the C# CLI) onto the one deploy engine.
- **Stamp** — the `<!-- Last Updated: <iso> -->` comment written into a root site's `stampFile`.
