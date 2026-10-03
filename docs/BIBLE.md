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
> **Read [DEP-A6](AMENDMENTS.md#DEP-A6) first** — it retired the catalog landing pages (the `<slug>.htm` pages on mindattic.com)
> and wins over any older wording below; sections it changed say so. Each repo's GitHub README is now its project page.

## 1. The one sentence {#DEP-§1}
One pipeline that FTPS-deploys the MindAttic root sites (with the `MindAttic.UiUx` asset package they load, as one linked group) and fires the GitHub-Actions deploys of the Blazor apps — from a single registry (`projects.json`) and a single Vault-managed credential, with zero per-project deploy machinery. *(Amended by [DEP-A6](AMENDMENTS.md#DEP-A6): README-driven catalog landing pages are no longer built or deployed.)*

## 2. The product promise {#DEP-§2}
- **One repo, one install, one credential.** `npm install` once; `secrets/ftp.json` (or `MINDATTIC_FTP_JSON` in CI) holds the only FTP credential. No per-project `deploy.ps1` / `deploy.settings.json` / `node_modules/`. No drift.
- **One registry edits everything.** [`projects.json`](#DEP-§4) has two target arrays — `sites[]` (verbatim root sites) and `apps[]` (Blazor/CI apps) — plus `linkedGroups`. Add/retag a target by editing only this file. *(Amended by [DEP-A6](AMENDMENTS.md#DEP-A6): the third array, `projects[]` (catalog landing pages), was removed.)*
- ~~**README is the content source.** Catalog pages are rendered from each project's own `README.md` through one canonical template.~~ **Superseded by [DEP-A6](AMENDMENTS.md#DEP-A6)** — each repo's README is shown by GitHub itself; this repo renders nothing.
- ~~**Components ship via CDN, not sync.** Landing pages load fonts/effects/themes from jsDelivr at the `componentsVersion` ref in `projects.json`.~~ **Superseded by [DEP-A6](AMENDMENTS.md#DEP-A6)** — `componentsVersion` is gone; the sites' `MindAttic.UiUx@V<n>` pins are set by the linked deploy ([DEP-A3](AMENDMENTS.md#DEP-A3)).
- **Two front doors, one engine.** `npm run deploy` (Node) and `MindAttic.Deploy.Cli` (C#) both drive the *same* `src/deploy.js` pipeline — the CLI shells into node. See [DEP-LAW-1](#DEP-LAW-1).
- **Linked deploy.** `MindAttic.UiUx` (the shared jsDelivr asset package) and the three sites that load assets from it (`ryandebraal.com`, `mindatticcares.com`, `mindattic.com`) are a permanent **linked group** (`linkedGroups` in `projects.json`): deploying any one deploys all four — package tag + push, tag pinned in the pages, CDN verified byte-exact, then FTP — and aborts before any upload if a gate fails. See [DEP-A3](AMENDMENTS.md#DEP-A3) and `src/linked.js`.
- ~~**Auto-discovery + curation.** Every public, non-archived mindattic repo with a README gets a Cyberspace landing page automatically; curated `projects[]` entries override title/tagline/addon/theme.~~ **Superseded by [DEP-A6](AMENDMENTS.md#DEP-A6)** — no landing pages are generated.

## 3. What it is NOT {#DEP-§3}
- **NOT a component library.** It does not own fonts, the Cyberspace effects, or theme CSS — those live in `MindAttic.UiUx` and are pulled at runtime via jsDelivr / build-time via that repo's splice scripts. This repo only *invokes* two UiUx splice scripts as `preDeploy` hooks.
- **NOT a project-page generator.** Per-project landing pages (the `<slug>.htm` pages on mindattic.com) were retired by [DEP-A6](AMENDMENTS.md#DEP-A6); each repo's GitHub README is its project page. Rebuilding a README renderer here is a regression.
- **NOT a remote cleaner.** It never deletes files on the FTP host; retired remote files (such as the old `<slug>.htm` pages) are removed by hand.
- **NOT the editor of component sources.** For the linked group it tags and pushes the `MindAttic.UiUx` repo and rewrites the tag pins in the sites' pages ([DEP-A3](AMENDMENTS.md#DEP-A3)); it never edits files inside `Components/`, `fonts/` or the domain asset folders.
- **NOT the host of per-project deploy state.** All the old per-project `scripts/cli/`, `deploy.bat`, `deploy.settings.json`, and marker-block `index.htm` files are retired; recreating them is a regression.
- **NOT the actual app deployer for Blazor apps.** For `apps[]` entries it commits + pushes a branch; the project's *own* GitHub Actions workflow does the real Azure push. Prose et al. ship via CI, not via FTP from here.
- **NOT a SemVer project.** Whole-number versioning only ([HOUSE-LAW-1](../../MindAttic.HouseRules.md#HOUSE-LAW-1)), including the `MindAttic.UiUx` release tags the linked deploy publishes and pins (`V1`, `V2`, … never `v1.1.1`).
- **NOT a renderer.** `sites[]` files are uploaded verbatim (only the Last-Updated stamp and the linked group's tag pins are rewritten); nothing is templated. *(Amended by [DEP-A6](AMENDMENTS.md#DEP-A6): the landing-page template is gone.)*

## 4. Architecture canon {#DEP-§4}
*Amended by [DEP-A6](AMENDMENTS.md#DEP-A6):* the catalog column (README render, landing-page template, parts addon, `out/` folder, catalog upload) is gone; two pipelines remain.

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
     creds: MINDATTIC_FTP_JSON env → secrets/ftp.json   (basic-ftp, FTPS)
```

### 4.1 Projects / components
- **`MindAttic.Deploy.Cli/`** — C# console app (`net10.0`, Spectre.Console.Cli, assembly name `MindAttic.Deploy`). A thin front door that shells into the node pipeline (see [`Services/DeployRunner.cs`](../MindAttic.Deploy.Cli/Services/DeployRunner.cs) and [`Services/ProjectRoster.cs`](../MindAttic.Deploy.Cli/Services/ProjectRoster.cs)). Solution: [`MindAttic.Deploy.slnx`](../MindAttic.Deploy.slnx).
- **`src/deploy.js`** — the two-mode pipeline (site / app; the linked group runs through `src/linked.js`); FTPS via `basic-ftp`; preDeploy hook runner. A run with no mode flag prints usage and exits 2.
- **`src/linked.js`** — the linked deploy ([DEP-A3](AMENDMENTS.md#DEP-A3)).
- **`projects.json`** — the registry (`sites[]`/`apps[]` + `linkedGroups`).
- **`.github/workflows/cli-ci.yml`** — builds the C# CLI and smoke-tests `--version`.
- **`test/linked.test.js`** — the node:test suite (`npm test`).
- **`scripts/publish.ps1`, `scripts/ensure-fresh.ps1`** — CLI publish + freshness helpers.
- **`tools/codex.ps1`** — Codex doctor + digest CLI (this standard).
- *Removed by [DEP-A6](AMENDMENTS.md#DEP-A6) (kept for history):* `build.js` (README renderer, theme bundling, auto-discovery, manifest), `parts.js` (parts addon), the landing-page template, `out/`, and the manual CI catalog workflow `deploy.yml`.

### 4.2 Domain model (NOUNS)
- ~~**CatalogProject** — a README-driven landing page (`slug`, `repo`, `title`, `tagline`, `theme`, optional `addon`/`openUrl`/`ref`), uploaded as `<slug>.htm` to the mindattic.com folder.~~ **Removed by [DEP-A6](AMENDMENTS.md#DEP-A6).**
- **SiteProfile** — a verbatim root site (`slug`, `sourceDir`, `ftpRemotePath`, `files[]`, `stampFile`, `preDeploy[]`). Uploaded as-is.
- **AppProfile** — a Blazor / GitHub-Actions deploy target (`slug`, `repo`, `branch`, `workflow`, `disabled`, `stageOnly[]`, `commitMessage`, `preDeploy[]`).
- **HookProfile** — a `preDeploy` step: `kind` ∈ {`uiux-pull`, `powershell`, `dotnet-build`}, plus `required`.
- **DeployConfig** — the deserialized `projects.json` (`sites`, `apps`, `linkedGroups`). *(Amended by [DEP-A6](AMENDMENTS.md#DEP-A6): `componentsVersion`, `ftpRemoteRoot` and `projects` were removed.)*
- **Linked group** — a set of sites inseparable from one package repo (`linkedGroups`): `mindattic-web` = `MindAttic.UiUx` + `ryandebraal.com` + `mindatticcares.com` + `mindattic.com`. Deploying any member deploys all.
- ~~**Theme bundle** — `deps.json` + `theme.css` + `body-prelude.html` from a UiUx theme folder, inlined into landing pages.~~ **Removed by [DEP-A6](AMENDMENTS.md#DEP-A6).**
- ~~**Manifest** — the build's list of slugs that actually rendered.~~ **Removed by [DEP-A6](AMENDMENTS.md#DEP-A6).**

### 4.3 Key services (VERBS)
- ~~**Build** (`build.js`) — README → landing page render.~~ ~~**Catalog deploy** (`runCatalogMode`) — implicit build, then FTPS upload of each page.~~ **Both removed by [DEP-A6](AMENDMENTS.md#DEP-A6).**
- **Mode guard** — `src/deploy.js` refuses a run with none of `--site`/`--sites`/`--uiux`/`--app`/`--apps` (usage, exit 2) ([DEP-A6](AMENDMENTS.md#DEP-A6)).
- **Site deploy** (`runSiteMode` / `deployOneSite`) — run `preDeploy`, stamp `<!-- Last Updated -->`, FTPS the `files[]` glob to `ftpRemotePath`.
- **Linked deploy** (`src/linked.js`, `runLinkedMode`) — `planTargets` expands `--site <member>` / `--sites` / `--uiux` to the group (`--no-link` opts out); `inspectPackage` (preflight), `publishPackage` (tag + push), `rewritePins`, `buildCdnChecks` + `verifyCdn` (CDN gate), then `deployOneSite` per site; everything with a side effect is injected so it is testable.
- **App deploy** (`runAppMode` / `deployOneApp`) — run `preDeploy`, `git add` `stageOnly`, commit if staged, push `branch` to fire the project's workflow; disabled apps print their note and exit 0.
- **preDeploy hooks** (`executePreDeploy`) — `runUiuxPull` (git pull MindAttic.UiUx), `runPowershellHook`, `runDotnetBuildHook`.
- **Credential load** (`loadFtpSettings`) — `MINDATTIC_FTP_JSON` env → `secrets/ftp.json`; FTPS via `accessFtp`.
- **CLI dispatch** (`MindAttic.Deploy.Cli`) — `site` / `uiux` (alias `package`) / `app` / `all` / `list` / `version` commands (the `catalog` command was removed by [DEP-A6](AMENDMENTS.md#DEP-A6)); default (no args) is an interactive multi-select menu (`MainMenuCommand`); all shell into `DeployRunner.RunNode`. `ProjectRoster` resolves the repo root and deserializes `projects.json` at startup.

## 5. The Laws {#DEP-§5}
This project **inherits all org-wide laws** from [`MindAttic.HouseRules.md`](../../MindAttic.HouseRules.md) by reference — they are not restated here. Most directly load-bearing for this repo:
- [HOUSE-LAW-1 — Whole-number versioning](../../MindAttic.HouseRules.md#HOUSE-LAW-1) (assembly `Version` *and* the `MindAttic.UiUx` `V<n>` release tag the linked deploy pins).
- [HOUSE-LAW-2 — Soft-disable, never hard-delete](../../MindAttic.HouseRules.md#HOUSE-LAW-2) (an `apps[]` entry is disabled with a note, never deleted, until infra exists).
- [HOUSE-LAW-3 — Credentials resolve through MindAttic.Vault](../../MindAttic.HouseRules.md#HOUSE-LAW-3) (FTP creds; see [DEP-LAW-3](#DEP-LAW-3)).
- [HOUSE-LAW-6 — One engine, many front doors](../../MindAttic.HouseRules.md#HOUSE-LAW-6) (the CLI and `npm run deploy` drive the same `src/deploy.js`; see [DEP-LAW-1](#DEP-LAW-1)).
- [HOUSE-LAW-8 — Definition of done is verified, not asserted](../../MindAttic.HouseRules.md#HOUSE-LAW-8) (see [§8](#DEP-§8)).

Project-specific laws:

### DEP-LAW-1 — One pipeline, two front doors {#DEP-LAW-1}
`src/deploy.js` is the single deploy engine. `MindAttic.Deploy.Cli` MUST NOT reimplement deploy logic; it shells into `node --use-system-ca src/deploy.js …` (`Services/DeployRunner.cs`). A behavior change happens in `src/deploy.js`, not in the C# layer.

### DEP-LAW-2 — The registry is the only edit point for targets {#DEP-LAW-2}
Adding, removing, or retagging a deploy target (slug/title/tagline/theme/addon/disabled/hooks) is an edit to [`projects.json`](#DEP-§4) and nothing else. README content lives in each project's own repo; visual layout lives in the landing-page template (`index.template.htm`, retired by DEP-A6); components live in `MindAttic.UiUx`.

*Refined by [DEP-A3](AMENDMENTS.md#DEP-A3):* `linkedGroups` is part of the registry (the only place group membership and FTP order are edited).

*Amended by [DEP-A6](AMENDMENTS.md#DEP-A6):* the targets are `sites[]` and `apps[]` entries (slug/paths/files/hooks/disabled); the catalog fields (title/tagline/theme/addon) and the landing-page template are gone. The law itself is unchanged.

### DEP-LAW-3 — Credentials never live in code or rendered output {#DEP-LAW-3}
FTP credentials resolve `MINDATTIC_FTP_JSON` env → `secrets/ftp.json` (gitignored), never embedded in source or any uploaded file. The roadmap target is `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault (per [HOUSE-LAW-3](../../MindAttic.HouseRules.md#HOUSE-LAW-3)).

### DEP-LAW-4 — One theme source of truth, CDN-pinned {#DEP-LAW-4}
*Original law (kept for history):* all component/theme assets load from jsDelivr at the single `componentsVersion` ref in `projects.json`. A pinned tag MUST be an immutable whole-number tag carrying the current `Themes/<Theme>/{deps.json,theme.css}` layout; `"main"` is tip-of-tree and non-atomic (jsDelivr caches it ~12h). Bumping `componentsVersion` is how a UiUx change propagates.

*Refined by [DEP-A3](AMENDMENTS.md#DEP-A3):* for the linked group the `MindAttic.UiUx@V<n>` pin in each site's page is chosen and verified by the deploy (never `@main`; never newer than the published tag).

*Amended by [DEP-A6](AMENDMENTS.md#DEP-A6):* `componentsVersion` no longer exists (it only served the retired catalog pages). **Now:** shared assets load from `MindAttic.UiUx` on jsDelivr at an immutable whole-number tag, never `@main`; for the linked group that tag is the release tag the deploy publishes, pins in each site's `pinFiles` and verifies byte-exact on the CDN before any upload.

### DEP-LAW-5 — Apps fire CI; this repo never FTPs an app {#DEP-LAW-5}
For `apps[]`, the repo's contract ends at `git push <branch>`; the project's own workflow performs the real (Azure) deploy. A disabled app prints its `disabledNote` and exits 0 — it never half-fires.

### DEP-LAW-6 — Fail loud on unknown input {#DEP-LAW-6}
`build.js`/`deploy.js` reject unknown flags (exit 2) and unknown catalog slugs rather than silently running a full deploy. Auto-discovery degrades gracefully (curated-only) when `gh` is unavailable; a repo with no README is *skipped*, not failed.

*Amended by [DEP-A6](AMENDMENTS.md#DEP-A6):* the catalog clauses (catalog slugs, auto-discovery, missing README) are retired with the catalog. **Now:** `src/deploy.js` rejects unknown flags (the retired catalog flags included), a linked-only modifier used outside a linked deploy, and a run with no mode flag — each with usage and exit 2 — rather than guessing at a deploy.

## 6. Verified state {#DEP-§6}
Evidence captured 2026-06-07 on the dev box (Windows 11, `node v24.14.0`, .NET 10 SDK); rows updated 2026-10-03 for [DEP-A6](AMENDMENTS.md#DEP-A6).

| Capability | Status | Evidence |
|---|---|---|
| C# CLI builds clean | ✅ done | `dotnet build MindAttic.Deploy.Cli -c Release` → **0 Warning(s), 0 Error(s)** (2026-10-03, after the `catalog` command was removed). |
| Node pipeline present + flag-validated | ✅ done | `src/deploy.js` rejects unknown flags and a run with no mode flag (exit 2); `--help` works. `npm test` covers both (`cli:` tests in `test/linked.test.js`). |
| Catalog render | 🗑️ cut | Retired by [DEP-A6](AMENDMENTS.md#DEP-A6); code removed. |
| FTPS site upload | 🟡 partial | Requires live `secrets/ftp.json` + remote host; exercised by the 2026-10-02 linked deploy run (three sites uploaded), no automated test against a real host. |
| App deploy (Prose) | 🟡 partial | Push-to-master CI path; not fired in this pass (would push real branches). |
| Linked deploy (`src/linked.js`) | 🟡 partial | 2026-10-02: `npm test` → 29 tests pass (30 since [DEP-A6](AMENDMENTS.md#DEP-A6) added the retired-catalog CLI test) (tag math, expansion, flag validation, pin rewrite, dirty/behind/tag-moved/stray-local-tag aborts, rejected push + resume, CDN gate incl. runtime-built base prefixes, dry-run writes nothing, partial FTP failure + reconnect, registry consistency) against throwaway git repos + a local stand-in for jsDelivr + a fake FTP. First real run 2026-10-02 published `V7`, verified 99 CDN URLs and uploaded all three sites; audit fixes in [DEP-A4](AMENDMENTS.md#DEP-A4). |
| Automated test suite | 🟡 partial | `test/linked.test.js` covers the linked deploy and the CLI flag guards; plain site/app modes and the C# CLI still have no automated tests. DoD ([§8](#DEP-§8)) — see [USER_STORIES backlog](USER_STORIES.md). |

Outside the linked deploy there is **no automated test** in this repo, so every `✅` above is build-proven only; behavioral capabilities are honestly `🟡`/`⬜` until a test or live run proves them.

## 7. Active frontier {#DEP-§7}
- **RFC:** [rfc/0001-test-harness.md](rfc/0001-test-harness.md) — introduce an automated test harness so deploy behaviors can graduate from 🟡 to ✅.
- **Open roadmap items** (from README/CLAUDE): move FTP creds to `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault and retire `secrets/ftp.json` (the last unchecked roadmap box).
- **Epics:** see [USER_STORIES.md](USER_STORIES.md) — Epic A (registry-driven deploy), Epic B (catalog rendering — cut by [DEP-A6](AMENDMENTS.md#DEP-A6)), Epic C (root sites), Epic D (Blazor apps), Epic E (credentials & CI).
- **Manual server cleanup** ([DEP-A6](AMENDMENTS.md#DEP-A6)): the retired `<slug>.htm` pages in the mindattic.com folder are being deleted from the FTP host by the owner by hand.

## 8. Quality bar {#DEP-§8}
A change is **done** when:
1. `dotnet build MindAttic.Deploy.slnx -c Release` is clean (0 warnings — `TreatWarningsAsErrors=true`).
2. `node src/deploy.js --help` runs, `npm test` passes, and a representative `--dry-run` deploy succeeds for the affected mode. *(Amended by [DEP-A6](AMENDMENTS.md#DEP-A6): there is no build step any more.)*
3. Behavior changes land in `src/deploy.js` / `src/linked.js` (not duplicated in the C# CLI — [DEP-LAW-1](#DEP-LAW-1)).
4. Target changes are confined to `projects.json` ([DEP-LAW-2](#DEP-LAW-2)); no credential touches source/output ([DEP-LAW-3](#DEP-LAW-3)).
5. Per [HOUSE-LAW-8](../../MindAttic.HouseRules.md#HOUSE-LAW-8): a status is `✅` in the docs only when a build or run proves it; otherwise `🟡`/`⬜`.
6. `powershell -File tools/codex.ps1 doctor` passes.

## 9. Glossary {#DEP-§9}
- **Catalog page** *(retired by [DEP-A6](AMENDMENTS.md#DEP-A6))* — a README-driven landing page formerly uploaded as `<slug>.htm` to the mindattic.com folder. The repo's GitHub README replaces it.
- **Root site** — a verbatim FTPS-uploaded site (`mindattic.com` root, `mindatticcares.com`, `ryandebraal.com`, plus the `hyperspace` and `idiotproof-replays` sub-folders); not templated.
- **App** — a Blazor / GitHub-Actions deploy target; this repo commits+pushes, CI deploys.
- **Addon** *(retired by [DEP-A6](AMENDMENTS.md#DEP-A6))* — an interactive section (`parts`) formerly layered onto a catalog page.
- **preDeploy hook** — a step run before upload/push: `uiux-pull`, `powershell`, or `dotnet-build`.
- **componentsVersion** *(retired by [DEP-A6](AMENDMENTS.md#DEP-A6))* — the former `projects.json` jsDelivr ref for catalog pages. Site pins are set by the linked deploy.
- **Auto-discovery** *(retired by [DEP-A6](AMENDMENTS.md#DEP-A6))* — the former generation of a page for every public mindattic repo via `gh repo list`.
- **Mode flag** — one of `--site`, `--sites`, `--uiux`, `--app`, `--apps`; `src/deploy.js` exits 2 without one.
- **Asset manifest** — MindAttic.UiUx's `assets-manifest.json`, the verified list of package assets the CDN gate checks. (The catalog build's own manifest was retired by [DEP-A6](AMENDMENTS.md#DEP-A6).)
- **Linked group** — see §4.2; **release tag** — the whole-number `V<n>` tag of MindAttic.UiUx a linked deploy publishes (or reuses) and pins in the sites; **pin** — the `MindAttic.UiUx@V<n>` segment of a jsDelivr URL; **CDN gate** — the pre-FTP check that every package asset the sites use is live at the release tag with the exact bytes.
- **Front door** — an entry point (the Node `npm run` scripts or the C# CLI) onto the one deploy engine.
- **Stamp** — the `<!-- Last Updated: <iso> -->` comment written into a root site's `stampFile`.
