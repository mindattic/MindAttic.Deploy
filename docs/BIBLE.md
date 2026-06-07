---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: bible
status: living
updated: 2026-06-07
---

# MindAttic.Deploy — Project Bible
> Single source of truth for what MindAttic.Deploy IS, is NOT, and the rules that keep it coherent.
> README.md says how to build/run; this says how to think about the system.

## 1. The one sentence {#DEP-§1}
One pipeline that builds and FTPS-deploys every MindAttic web property — README-driven catalog landing pages, verbatim root sites, and GitHub-Actions-driven Blazor apps — from a single registry (`projects.json`) and a single Vault-managed credential, with zero per-project deploy machinery.

## 2. The product promise {#DEP-§2}
- **One repo, one install, one credential.** `npm install` once; `secrets/ftp.json` (or `MINDATTIC_FTP_JSON` in CI) holds the only FTP credential. No per-project `deploy.ps1` / `deploy.settings.json` / `node_modules/`. No drift.
- **One registry edits everything.** [`projects.json`](#DEP-§4) has exactly three arrays — `projects[]` (catalog landing pages), `sites[]` (verbatim root sites), `apps[]` (Blazor/CI apps). Add/retag a target by editing only this file.
- **README is the content source.** Catalog pages are rendered from each project's own `README.md` (sibling repo on the dev box, GitHub raw in CI) through one canonical template, so editing a project's docs updates its landing page on the next deploy.
- **Components ship via CDN, not sync.** Fonts/effects/themes load at runtime from jsDelivr against the [`componentsVersion`](#DEP-§5) ref pinned in `projects.json`; no per-subscriber inlining for landing pages.
- **Two front doors, one engine.** `npm run deploy` (Node) and `MindAttic.Deploy.Cli` (C#) both drive the *same* `src/deploy.js` pipeline — the CLI shells into node. See [DEP-LAW-1](#DEP-LAW-1).
- **Auto-discovery + curation.** Every public, non-archived mindattic repo with a README gets a Cyberspace landing page automatically; curated `projects[]` entries override title/tagline/addon/theme.

## 3. What it is NOT {#DEP-§3}
- **NOT a component library.** It does not own fonts, the Cyberspace effects, or theme CSS — those live in `MindAttic.UiUx` and are pulled at runtime via jsDelivr / build-time via that repo's splice scripts. This repo only *invokes* two UiUx splice scripts as `preDeploy` hooks.
- **NOT the host of per-project deploy state.** All the old per-project `scripts/cli/`, `deploy.bat`, `deploy.settings.json`, and marker-block `index.htm` files are retired; recreating them is a regression.
- **NOT the actual app deployer for Blazor apps.** For `apps[]` entries it commits + pushes a branch; the project's *own* GitHub Actions workflow does the real Azure push. StreetSamurai et al. ship via CI, not via FTP from here.
- **NOT a SemVer project.** Whole-number versioning only ([HOUSE-LAW-1](../../MindAttic.HouseRules.md#HOUSE-LAW-1)), including the jsDelivr `componentsVersion` tags (`V1`, `V2`, … never `v1.1.1`).
- **NOT a renderer for root sites.** `sites[]` files are uploaded verbatim; they are not passed through `template/index.template.htm`.

## 4. Architecture canon {#DEP-§4}

```
                          projects.json  (THE registry)
                          ┌───────────────┬───────────────┬──────────────┐
                          │  projects[]   │   sites[]     │    apps[]     │
                          │ catalog pages │  root sites   │ Blazor / CI   │
                          └──────┬────────┴──────┬────────┴──────┬───────┘
                                 │               │               │
   README.md (sibling/GitHub) ─► src/build.js    │               │
   template/index.template.htm ─►  │  (+ src/parts.js addon)     │
   MindAttic.UiUx/Themes/<T> ────► │               │               │
                                 ▼               │               │
                            out/<slug>.htm        │               │
                                 │               │               │
                                 ▼               ▼               ▼
                              ┌─────────────── src/deploy.js ───────────────┐
                              │ catalog: FTPS out/<slug>.htm                 │
                              │ site:    preDeploy hooks → stamp → FTPS      │
                              │ app:     preDeploy hooks → git commit/push   │
                              └──────────────────┬───────────────────────────┘
                                                 │ shells into
                    MindAttic.Deploy.Cli (C#)  ──┘  (node --use-system-ca src/deploy.js …)
                                 │
   creds: MINDATTIC_FTP_JSON env → secrets/ftp.json   (basic-ftp, FTPS)
```

### 4.1 Projects / components
- **`MindAttic.Deploy.Cli/`** — C# console app (`net10.0`, Spectre.Console.Cli, assembly name `MindAttic.Deploy`). A thin front door that shells into the node pipeline (see [`Services/DeployRunner.cs`](../MindAttic.Deploy.Cli/Services/DeployRunner.cs) and [`Services/ProjectRoster.cs`](../MindAttic.Deploy.Cli/Services/ProjectRoster.cs)). Solution: [`MindAttic.Deploy.slnx`](../MindAttic.Deploy.slnx).
- **`src/build.js`** — README → `out/<slug>.htm` renderer (`marked` + `highlight.js`), theme bundling, repo auto-discovery, manifest emission.
- **`src/deploy.js`** — the three-mode pipeline (catalog / site / app); FTPS via `basic-ftp`; preDeploy hook runner.
- **`src/parts.js`** — optional `parts` addon (ChiMesh/Claudia build picker), driven by a sibling repo's `config/parts.json`.
- **`template/index.template.htm`** — canonical landing-page HTML shell (`{{PLACEHOLDER}}` substitution).
- **`projects.json`** — the registry (`projects[]`/`sites[]`/`apps[]` + `componentsVersion` + `ftpRemoteRoot`).
- **`.github/workflows/deploy.yml`** — manual-only (`workflow_dispatch`) CI deploy; `cli-ci.yml` builds the C# CLI.
- **`scripts/publish.ps1`, `scripts/ensure-fresh.ps1`** — CLI publish + freshness helpers.
- **`tools/codex.ps1`** — Codex doctor + digest CLI (this standard).

### 4.2 Domain model (NOUNS)
- **CatalogProject** — a README-driven landing page (`slug`, `repo`, `title`, `tagline`, `theme`, optional `addon`/`openUrl`/`ref`). Rendered to `out/<slug>.htm`, uploaded to `/mindattic.com/<slug>.htm`. (`Models/DeployConfig.cs`.)
- **SiteProfile** — a verbatim root site (`slug`, `sourceDir`, `ftpRemotePath`, `files[]`, `stampFile`, `preDeploy[]`). Uploaded as-is.
- **AppProfile** — a Blazor / GitHub-Actions deploy target (`slug`, `repo`, `branch`, `workflow`, `disabled`, `stageOnly[]`, `commitMessage`, `preDeploy[]`).
- **HookProfile** — a `preDeploy` step: `kind` ∈ {`uiux-pull`, `powershell`, `dotnet-build`}, plus `required`.
- **DeployConfig** — the deserialized `projects.json` (`componentsVersion`, `ftpRemoteRoot`, the three arrays).
- **Theme bundle** — `deps.json` + `theme.css` + `body-prelude.html` from `MindAttic.UiUx/Themes/<Theme>` (today only `Cyberspace`).
- **Manifest** — `out/_manifest.json`, the list of slugs that actually rendered, so deploy uploads exactly what built.

### 4.3 Key services (VERBS)
- **Build** (`src/build.js`) — `effectiveProjects` (curated + auto-discovered), `loadReadme`, `loadTheme`, `substitute`, `buildOne` → writes `out/<slug>.htm` + manifest.
- **Catalog deploy** (`runCatalogMode`) — implicit build, then FTPS-upload each manifest slug to `ftpRemoteRoot`.
- **Site deploy** (`runSiteMode` / `deployOneSite`) — run `preDeploy`, stamp `<!-- Last Updated -->`, FTPS the `files[]` glob to `ftpRemotePath`.
- **App deploy** (`runAppMode` / `deployOneApp`) — run `preDeploy`, `git add` `stageOnly`, commit if staged, push `branch` to fire the project's workflow; disabled apps print their note and exit 0.
- **preDeploy hooks** (`executePreDeploy`) — `runUiuxPull` (git pull MindAttic.UiUx), `runPowershellHook`, `runDotnetBuildHook`.
- **Credential load** (`loadFtpSettings`) — `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`; FTPS via `accessFtp`.
- **CLI dispatch** (`MindAttic.Deploy.Cli`) — `catalog` / `site` / `app` / `all` / `list` / `version` commands; default (no args) is an interactive multi-select menu (`MainMenuCommand`); all shell into `DeployRunner.RunNode`. `ProjectRoster` resolves the repo root and deserializes `projects.json` at startup.

## 5. The Laws {#DEP-§5}
This project **inherits all org-wide laws** from [`MindAttic.HouseRules.md`](../../MindAttic.HouseRules.md) by reference — they are not restated here. Most directly load-bearing for this repo:
- [HOUSE-LAW-1 — Whole-number versioning](../../MindAttic.HouseRules.md#HOUSE-LAW-1) (assembly `Version` *and* the jsDelivr `componentsVersion` tag).
- [HOUSE-LAW-2 — Soft-disable, never hard-delete](../../MindAttic.HouseRules.md#HOUSE-LAW-2) (an `apps[]` entry is disabled with a note, never deleted, until infra exists).
- [HOUSE-LAW-3 — Credentials resolve through MindAttic.Vault](../../MindAttic.HouseRules.md#HOUSE-LAW-3) (FTP creds; see [DEP-LAW-3](#DEP-LAW-3)).
- [HOUSE-LAW-6 — One engine, many front doors](../../MindAttic.HouseRules.md#HOUSE-LAW-6) (the CLI and `npm run deploy` drive the same `src/deploy.js`; see [DEP-LAW-1](#DEP-LAW-1)).
- [HOUSE-LAW-8 — Definition of done is verified, not asserted](../../MindAttic.HouseRules.md#HOUSE-LAW-8) (see [§8](#DEP-§8)).

Project-specific laws:

### DEP-LAW-1 — One pipeline, two front doors {#DEP-LAW-1}
`src/deploy.js` is the single deploy engine. `MindAttic.Deploy.Cli` MUST NOT reimplement deploy logic; it shells into `node --use-system-ca src/deploy.js …` (`Services/DeployRunner.cs`). A behavior change happens in `src/deploy.js`, not in the C# layer.

### DEP-LAW-2 — The registry is the only edit point for targets {#DEP-LAW-2}
Adding, removing, or retagging a deploy target (slug/title/tagline/theme/addon/disabled/hooks) is an edit to [`projects.json`](#DEP-§4) and nothing else. README content lives in each project's own repo; visual layout lives in `template/index.template.htm`; components live in `MindAttic.UiUx`.

### DEP-LAW-3 — Credentials never live in code or rendered output {#DEP-LAW-3}
FTP credentials resolve `MINDATTIC_FTP_JSON` env → `secrets/ftp.json` (gitignored), never embedded in source, the template, or any `out/` artifact. The roadmap target is `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault (per [HOUSE-LAW-3](../../MindAttic.HouseRules.md#HOUSE-LAW-3)).

### DEP-LAW-4 — One theme source of truth, CDN-pinned {#DEP-LAW-4}
All component/theme assets load from jsDelivr at the single `componentsVersion` ref in `projects.json`. A pinned tag MUST be an immutable whole-number tag carrying the current `Themes/<Theme>/{deps.json,theme.css}` layout; `"main"` is tip-of-tree and non-atomic (jsDelivr caches it ~12h). Bumping `componentsVersion` is how a UiUx change propagates.

### DEP-LAW-5 — Apps fire CI; this repo never FTPs an app {#DEP-LAW-5}
For `apps[]`, the repo's contract ends at `git push <branch>`; the project's own workflow performs the real (Azure) deploy. A disabled app prints its `disabledNote` and exits 0 — it never half-fires.

### DEP-LAW-6 — Fail loud on unknown input {#DEP-LAW-6}
`build.js`/`deploy.js` reject unknown flags (exit 2) and unknown catalog slugs rather than silently running a full deploy. Auto-discovery degrades gracefully (curated-only) when `gh` is unavailable; a repo with no README is *skipped*, not failed.

## 6. Verified state {#DEP-§6}
Evidence captured 2026-06-07 on the dev box (Windows 11, `node v24.14.0`, .NET 10 SDK).

| Capability | Status | Evidence |
|---|---|---|
| C# CLI builds clean | ✅ done | `dotnet build MindAttic.Deploy.slnx -c Release` → **Build succeeded, 0 Warning(s), 0 Error(s)**. |
| Node pipeline present + flag-validated | ✅ done | `src/build.js` / `src/deploy.js` reject unknown flags (exit 2); `--help` works. |
| Catalog render | 🟡 partial | Code path complete; no committed automated test. Verified ad-hoc via `npm run build`. |
| FTPS catalog/site upload | 🟡 partial | Requires live `secrets/ftp.json` + remote host; not exercised in this pass. |
| App deploy (StreetSamurai) | 🟡 partial | Push-to-master CI path; not fired in this pass (would push real branches). |
| Automated test suite | ⬜ planned | No test project exists in the repo. DoD ([§8](#DEP-§8)) calls for one — see [USER_STORIES backlog](USER_STORIES.md). |

There is **no test project** in this repo today, so every `✅` above is build-proven only; behavioral capabilities are honestly `🟡`/`⬜` until a test or live run proves them.

## 7. Active frontier {#DEP-§7}
- **RFC:** [rfc/0001-test-harness.md](rfc/0001-test-harness.md) — introduce an automated test harness so deploy behaviors can graduate from 🟡 to ✅.
- **Open roadmap items** (from README/CLAUDE): move FTP creds to `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault and retire `secrets/ftp.json` (the last unchecked roadmap box).
- **Epics:** see [USER_STORIES.md](USER_STORIES.md) — Epic A (registry-driven deploy), Epic B (catalog rendering), Epic C (root sites), Epic D (Blazor apps), Epic E (credentials & CI).

## 8. Quality bar {#DEP-§8}
A change is **done** when:
1. `dotnet build MindAttic.Deploy.slnx -c Release` is clean (0 warnings — `TreatWarningsAsErrors=true`).
2. `node src/build.js --help` / `node src/deploy.js --help` run, and a representative `npm run build` (or `--dry-run` deploy) succeeds for the affected mode.
3. Behavior changes land in `src/deploy.js` / `src/build.js` (not duplicated in the C# CLI — [DEP-LAW-1](#DEP-LAW-1)).
4. Target changes are confined to `projects.json` ([DEP-LAW-2](#DEP-LAW-2)); no credential touches source/output ([DEP-LAW-3](#DEP-LAW-3)).
5. Per [HOUSE-LAW-8](../../MindAttic.HouseRules.md#HOUSE-LAW-8): a status is `✅` in the docs only when a build or run proves it; otherwise `🟡`/`⬜`.
6. `powershell -File tools/codex.ps1 doctor` passes.

## 9. Glossary {#DEP-§9}
- **Catalog page** — a README-driven landing page rendered to `out/<slug>.htm` and uploaded to `/mindattic.com/<slug>.htm`.
- **Root site** — a verbatim FTPS-uploaded site (`mindattic.com` root, `mindatticcares.com`, `ryandebraal.com`); not templated.
- **App** — a Blazor / GitHub-Actions deploy target; this repo commits+pushes, CI deploys.
- **Addon** — an optional interactive section layered onto a README page (today only `parts`).
- **preDeploy hook** — a step run before upload/push: `uiux-pull`, `powershell`, or `dotnet-build`.
- **componentsVersion** — the jsDelivr ref (`main` or a whole-number tag like `V4`) pinning MindAttic.UiUx Components + Themes.
- **Auto-discovery** — building a Cyberspace page for every public mindattic repo with a README, via `gh repo list`.
- **Manifest** — `out/_manifest.json`, the slugs that actually rendered.
- **Front door** — an entry point (the Node `npm run` scripts or the C# CLI) onto the one deploy engine.
- **Stamp** — the `<!-- Last Updated: <iso> -->` comment written into a root site's `stampFile`.
