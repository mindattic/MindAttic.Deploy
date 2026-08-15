# MindAttic.Deploy

**One pipeline. Every MindAttic web property. One credential file.**

MindAttic.Deploy is the single repo that builds and FTPS-deploys (or CI-fires) every
MindAttic-owned web property: the `mindattic.com` root site, every `mindattic.com/<slug>.htm`
README-driven landing page, the interactive parts-picker build guides (Claudia, ChiMesh),
`mindatticcares.com`, `ryandebraal.com`, a couple of verbatim sub-folder sites, and the
GitHub-Actions-driven Blazor apps (Prose, Cursory, PersonaGallery, and four disabled stubs
pending Azure infra). There is no per-project `scripts/cli/build-html.js`, `deploy.ps1`,
`deploy.bat`, `deploy.settings.json`, or `node_modules/` anymore — all of that machinery used to
live in each project's own repo and has been retired in favor of this one.

Two front doors drive the exact same engine:

- **Node** — `npm run build` / `npm run deploy` (the canonical pipeline, `src/*.js`).
- **C#** — `MindAttic.Deploy.exe`, a Spectre.Console.Cli app that shells into the same Node
  pipeline (`MindAttic.Deploy.Cli/`). It never reimplements deploy logic itself.

For architecture-level reasoning ("why does this exist, what are the invariants"), see
[docs/BIBLE.md](docs/BIBLE.md). This README is the practical, human-facing tour: how to run it,
how to add a target, how credentials resolve, and what every command does.

---

## Table of contents

- [What's in scope](#whats-in-scope)
- [Quick start](#quick-start)
- [Directory layout](#directory-layout)
- [How the pipeline works](#how-the-pipeline-works)
- [CLI reference](#cli-reference)
  - [npm scripts (Node, canonical)](#npm-scripts-node-canonical)
  - [`MindAttic.Deploy.exe` (C#)](#mindatticdeployexe-c)
- [Adding a new deployable project](#adding-a-new-deployable-project)
- [Removing a project](#removing-a-project)
- [Secrets & credential handling](#secrets--credential-handling)
- [Component versioning (`componentsVersion`)](#component-versioning-componentsversion)
- [Parts addon (interactive build guides)](#parts-addon-interactive-build-guides)
- [Per-project `/deploy` shims](#per-project-deploy-shims)
- [Build, publish & test](#build-publish--test)
- [CI workflows](#ci-workflows)
- [Glossary](#glossary)
- [Canonical documentation](#canonical-documentation)

---

## What's in scope

Everything that ships via FTP or via a `git push` that fires a GitHub Actions workflow. The
single registry, [`projects.json`](projects.json), has exactly three arrays:

| Array | What it is | Rendered how | Shipped how | Examples |
|---|---|---|---|---|
| `projects[]` | README-driven catalog landing page | `template/index.template.htm` + the project's own `README.md` | FTPS upload of `out/<slug>.htm` | idiotproof, mindatticlegion, mindatticvault, taxratecollector, thinktank, tutor, mediabutler, gridgame2026, mindatticpsst, mindatticconsole, mindattichelpers, mindatticuiux, prose, cursory, personagallery, mindatticfrontend |
| `projects[]` (+ `addon: "parts"`) | Long-form interactive build guide | same template, plus a parts gallery / build configurator / live cost total | same FTPS upload | claudia, chimesh |
| `sites[]` | Verbatim root/sub-site upload — **not** templated | n/a (files uploaded as-is) | FTPS upload of a `files[]` glob (or a whole directory tree via `uploadDir`) to `ftpRemotePath` | mindattic.com (root), mindatticcares.com, ryandebraal.com, hyperspace, idiotproof-replays |
| `apps[]` | Blazor / GitHub-Actions-driven deploy | n/a — this repo never renders or FTPs these | `git commit` (of `stageOnly` paths) + `git push <branch>`, which fires the project's own `.github/workflows/<workflow>` (the real Azure push happens there, not here) | prose, cursory, personagallery (enabled); idiotproof, taxratecollector, thinktank, tutor, mindatticfrontend (disabled pending Azure infra — each carries a `disabledNote` explaining exactly what's missing) |

Every public, non-archived `mindattic` GitHub repo with a `README.md` also gets an
auto-generated Cyberspace-theme landing page (`build.js`'s `discoverPublicRepos`, via `gh repo
list`), even if it has no entry in `projects.json`. A curated entry always wins on slug; pass
`--no-discover` to build only the curated list, or when `gh` is unavailable the build silently
degrades to curated-only.

**Explicitly out of scope:**
- `MindAttic.UiUx` owns the actual component sources (fonts, the Cyberspace effects, BackHomeM,
  PinFooter). Landing pages pull them at runtime from jsDelivr; this repo only *invokes* two of
  UiUx's splice scripts as `preDeploy` hooks (for `mindattic.com` and for the Prose app).
- Per-project `index.htm` files, `scripts/cli/`, `deploy.ps1`/`deploy.bat`/`deploy.settings.json`
  in any *other* repo are dead. If you find one, it's a leftover from before the migration —
  delete it, don't resurrect it.

---

## Quick start

```bash
npm install
npm run build                            # render every catalog page -> out/
npm run deploy                           # FTPS-upload all catalog pages
npm run deploy -- --only mindatticvault  # just one catalog page
npm run deploy -- --sites                # every verbatim root/sub-site
npm run deploy -- --apps                 # every enabled Blazor/CI app
npm run all                              # catalog + sites + apps, back-to-back
```

Or with the C# CLI (build it once with `dotnet build`, or use the published
`artifacts\MindAttic.Deploy.exe`):

```powershell
dotnet run --project MindAttic.Deploy.Cli   # interactive multi-select menu
MindAttic.Deploy catalog --only mindatticvault
MindAttic.Deploy all --dry-run
```

Both paths land in `node --use-system-ca src/deploy.js`. `--use-system-ca` matters here: the dev
box re-signs HTTPS via a TLS-interception proxy, so without it both the FTPS connection and the
GitHub README fetch fail certificate validation.

---

## Directory layout

```
projects.json                    canonical registry: projects[], sites[], apps[], componentsVersion, ftpRemoteRoot
template/
  index.template.htm             HTML shell for every projects[] entry ({{PLACEHOLDER}} substitution)
src/
  build.js                       README -> out/<slug>.htm renderer (marked + highlight.js), repo auto-discovery
  deploy.js                      the three-mode pipeline (catalog / site / app); FTPS via basic-ftp
  parts.js                       optional "parts" addon: interactive build picker for ChiMesh / Claudia
MindAttic.Deploy.Cli/            C# console app (net10.0, Spectre.Console.Cli, assembly name MindAttic.Deploy)
  Commands/                      CatalogCommand, SiteCommand, AppCommand, AllCommand, ListCommand,
                                  VersionCommand, MainMenuCommand (the interactive default)
  Services/
    DeployRunner.cs               shells into node --use-system-ca src/deploy.js; bridges MindAttic.Vault creds
    ProjectRoster.cs               resolves the repo root and deserializes projects.json
  Models/DeployConfig.cs          typed projects.json shape (CatalogProject / SiteProfile / AppProfile / HookProfile)
secrets/
  ftp.json                       gitignored FTP credentials (real value present on this dev box)
  ftp.json.template               starting point for a fresh checkout
out/                              generated artifacts (gitignored) — out/<slug>.htm + _manifest.json
artifacts/                        published MindAttic.Deploy.exe (gitignored; produced by scripts/publish.ps1)
lib/local-packages/                vendored MindAttic.Vault .nupkg, git-tracked so CI can restore it
scripts/
  publish.ps1                     dotnet publish -> artifacts\MindAttic.Deploy.exe (single-file, win-x64)
  ensure-fresh.ps1                 republishes only if sources changed newer than the exe
run.bat                            convenience launcher: ensure-fresh.ps1 then exec the published exe
tools/
  codex.ps1                        Codex doctor + digest generator for docs/
docs/
  BIBLE.md, AMENDMENTS.md, USER_STORIES.md, BIBLE.digest.md, rfc/
.github/workflows/
  deploy.yml                       manual-only (workflow_dispatch) CI catalog deploy
  cli-ci.yml                       builds the C# CLI + runs its --version smoke test
```

---

## How the pipeline works

```
                          projects.json  (THE registry)
                          +---------------+---------------+--------------+
                          |  projects[]   |   sites[]     |    apps[]    |
                          | catalog pages |  root sites   |  Blazor/CI   |
                          +------+--------+------+--------+------+-------+
                                 |               |               |
   README.md (sibling/GitHub)-->src/build.js    |               |
   template/index.template.htm-->  | (+ src/parts.js addon)      |
   MindAttic.UiUx/Themes/<T>  -->  |               |               |
                                 v               |               |
                            out/<slug>.htm        |               |
                                 |               |               |
                                 v               v               v
                              +--------------- src/deploy.js ---------------+
                              | catalog: FTPS out/<slug>.htm                 |
                              | site:    preDeploy hooks -> stamp -> FTPS    |
                              | app:     preDeploy hooks -> git commit/push  |
                              +------------------+----------------------------+
                                                 | shells into
                    MindAttic.Deploy.Cli (C#) --+  (node --use-system-ca src/deploy.js ...)
                                 |
   creds: MindAttic.Vault -> MINDATTIC_FTP_JSON env -> secrets/ftp.json  (basic-ftp, FTPS)
```

### Catalog mode (default — `projects[]`)

1. `src/build.js` computes the *effective* project list: curated `projects.json` entries plus
   every other public non-archived `mindattic` repo with a README (auto-discovery via `gh repo
   list`), curated entries winning any slug collision.
2. For each project it fetches the README (local sibling repo `D:\Projects\MindAttic\<repo>\` by
   default, or `raw.githubusercontent.com` when `--from-github` is passed or the sibling is
   missing — CI always uses the GitHub path), loads the pinned theme bundle from
   `MindAttic.UiUx/Themes/<Theme>/` (`deps.json` + `theme.css` + `body-prelude.html`), renders the
   README through `marked` + `highlight.js`, runs it through any addon (`parts.js` for ChiMesh /
   Claudia), and substitutes everything into `template/index.template.htm`.
3. The rendered page is written to `out/<slug>.htm`; a manifest of every slug that actually built
   is written to `out/_manifest.json`.
4. `src/deploy.js` (unless `--skip-build`) runs the build implicitly, then FTPS-uploads every
   manifest slug (or just the `--only` slugs) to `<ftpRemoteRoot>/<slug>.htm` (`ftpRemoteRoot`
   defaults to `/mindattic.com`, set in `projects.json`).
5. `--dry-run` still builds but skips the FTP connection/upload entirely, printing what would
   have been uploaded and its size.
6. A README with no `README.md` on its default branch (HTTP 404) is *skipped*, not failed — this
   matters for auto-discovered repos that may never have shipped a README. Any other build error
   fails that one slug; the run continues and exits 1 at the end if anything failed.

### Site mode (`--site <slug>` / `--sites`)

1. Runs the site's `preDeploy[]` hooks (see below).
2. If `stampFile` is set, rewrites (or inserts) a `<!-- Last Updated: <ISO-8601 UTC> -->` HTML
   comment at the top of that file — BOM-safe, idempotent (replaces an existing stamp rather than
   stacking a new one on top).
3. Either recursively uploads a whole tree (`uploadDir: true` — non-destructive, only adds/updates,
   never deletes remote files absent locally; used for the IdiotProof replay archive) or expands
   the `files[]` glob against `sourceDir` and FTPS-uploads each matched file to `ftpRemotePath`.
4. `--dry-run` still **runs the preDeploy hooks** (they can mutate local state — a `git pull`, a
   PowerShell sync script) but skips the stamp write and the FTP connection.

### App mode (`--app <slug>` / `--apps`)

1. A `disabled: true` app prints its `disabledNote` and returns immediately — it never half-fires.
2. Runs `preDeploy[]` hooks.
3. `git add --` each path in `stageOnly[]`, then commits (message template with `{utc}`
   substitution) only if something is actually staged — otherwise it pushes the existing HEAD.
4. `git push origin <branch>`, which is expected to fire the project's own
   `.github/workflows/<workflow>` — the *actual* Azure deploy happens there, in that repo's CI,
   not in MindAttic.Deploy. This repo's contract for an app ends at the push.
5. `--apps` without an explicit slug skips disabled apps by default (so you don't accidentally
   half-fire something waiting on Azure infra); pass `--include-disabled` to have each disabled
   app print its note once instead of being silently skipped.
6. `--dry-run` still runs the preDeploy hooks but skips the git commit and push.

### preDeploy hook kinds

| `kind` | What it does | Notes |
|---|---|---|
| `uiux-pull` | `git -C ../MindAttic.UiUx pull --no-edit --no-rebase` | Fails loudly if the sibling isn't a git repo. |
| `powershell` | `powershell -NoProfile -ExecutionPolicy Bypass -File <file> [args...]` | `file` is resolved relative to the repo root; relative-looking `args` are resolved too. |
| `dotnet-build` | `dotnet build <project> -c <configuration> --nologo` | `configuration` defaults to `Release`. |

Every hook entry can set `"required": false` to make a failure non-fatal (it logs and continues
instead of aborting the whole deploy).

---

## CLI reference

### npm scripts (Node, canonical)

| Command | Effect |
|---|---|
| `npm run build` | `node src/build.js` — render every catalog page to `out/`. |
| `npm run build -- --only <slug>` | Build a single catalog project (repeatable). |
| `npm run build -- --from-github --ref main` | Force README fetch from GitHub raw instead of the local sibling. |
| `npm run build -- --no-discover` | Build only the curated `projects.json` list, skip auto-discovery. |
| `npm run deploy` | `node --use-system-ca src/deploy.js` — build (implicit) then FTPS-upload every catalog page. |
| `npm run deploy -- --only <slug> --skip-build` | Redeploy one already-built page without rebuilding. |
| `npm run deploy -- --site <slug>` | Deploy one root/sub site (hooks + stamp + FTPS). |
| `npm run deploy -- --sites` | Deploy every entry in `sites[]`. |
| `npm run deploy -- --app <slug>` | Deploy one Blazor/CI app (hooks + commit + push). |
| `npm run deploy -- --apps` | Deploy every **enabled** app (`--include-disabled` to also print disabled notes). |
| `npm run deploy -- --dry-run` | Preview any of the above without FTP upload / git push (hooks still run). |
| `npm run all` | `deploy` (catalog) `&&` `deploy --sites` `&&` `deploy --apps --include-disabled`, in one shot. |
| `node src/build.js --help` / `node src/deploy.js --help` | Print full flag reference and exit 0. |

Both `build.js` and `deploy.js` reject an unrecognized `--flag` with exit code 2 and print usage —
a typo like `--hlep` never silently triggers a full production deploy.

### `MindAttic.Deploy.exe` (C#)

Built from `MindAttic.Deploy.Cli/` (`net10.0`, `AssemblyName=MindAttic.Deploy`, `<Version>1.0.0</Version>`,
Spectre.Console.Cli). Every subcommand shells into the identical `node --use-system-ca
src/deploy.js …` — the CLI never reimplements deploy behavior.

| Command | What it does |
|---|---|
| `MindAttic.Deploy` (no args) | Interactive multi-select menu across catalog + sites + apps (`MainMenuCommand`). Space toggles, `A` selects all, Enter confirms; nothing selected = exit without deploying. Selecting every site or every app collapses to one `--sites` / `--apps --include-disabled` invocation instead of N single-target calls. |
| `MindAttic.Deploy catalog [--only <slug>]... [--skip-build] [--dry-run] [--from-github] [--ref <ref>] [--siblings-root <path>] [--themes-root <path>] [--components <ref>]` | Deploy catalog landing pages; every flag is forwarded straight through to `src/build.js`/`src/deploy.js`. |
| `MindAttic.Deploy site (--slug <slug> \| --all) [--dry-run]` | Deploy root/sub sites. |
| `MindAttic.Deploy app (--slug <slug> \| --all) [--dry-run] [--include-disabled]` | Deploy Blazor/GitHub-Actions apps. |
| `MindAttic.Deploy all [--dry-run]` | Non-interactive "deploy everything": every catalog page (one build), then `--sites`, then `--apps --include-disabled`, back-to-back — three batches, one command. Meant for external launchers (MindAttic.Console's Deploy-All menu, CI, slash commands) that don't want to drive an interactive prompt. |
| `MindAttic.Deploy list` | Print every target across all three arrays (slug/repo/theme for catalog; slug/sourceDir/remote for sites; slug/repo/branch/workflow/enabled-or-disabled for apps) as Spectre tables. |
| `MindAttic.Deploy version` / `MindAttic.Deploy --version` / `-v` | Print the assembly name, version, and the running exe's process path (works whether launched via `dotnet run`, the raw DLL, or the published single-file exe). |

`ProjectRoster` resolves the repo root by walking up from the exe's directory looking for
`projects.json` + `src/deploy.js` (or honors a `MINDATTIC_DEPLOY_ROOT` env var override), so the
exe works when copied anywhere as long as it's still inside (or points at) a MindAttic.Deploy
checkout.

---

## Adding a new deployable project

Pick exactly one array in `projects.json` — that's the entire procedure, no scaffold script, no
per-project files:

**Catalog landing page** (README-driven, the common case):

```json
{
  "slug":    "newproject",
  "repo":    "NewProject",
  "title":   "NewProject",
  "tagline": "One-line description.",
  "theme":   "Cyberspace"
}
```

Optional fields: `"openUrl"` (adds an "Open" button linking to a live app, e.g. an Azure URL),
`"addon": "parts"` (layers the interactive build-picker onto the README — see below), `"ref"`
(pin a non-default git ref for the README fetch). `theme` must match a folder under
`MindAttic.UiUx/Themes/` — today `Cyberspace` is the only one (the older `Hardware` theme was
retired 2026-05-29). Then:

```bash
npm run deploy -- --only newproject
```

**Verbatim root/sub site**: append to `sites[]` with `sourceDir` (relative to the repo root),
`ftpRemotePath`, and either `files[]` (a glob or exact filenames) or `uploadDir: true` (recursive,
non-destructive tree upload). Optional `stampFile` and `preDeploy[]`. Then:

```bash
npm run deploy -- --site <slug>
```

**Blazor / GitHub-Actions app**: append to `apps[]` with `sourceDir`, `repo` (`owner/name`),
`branch`, `workflow` (the `.github/workflows/<file>` in *that* repo that does the real deploy),
`stageOnly[]` (paths to `git add` before committing — empty array if nothing needs staging),
optional `commitMessage` (supports a `{utc}` placeholder) and `preDeploy[]`. New apps should start
`"disabled": true` with a `disabledNote` describing exactly what infra is missing, per
[HOUSE-LAW-2](../MindAttic.HouseRules.md#HOUSE-LAW-2) (soft-disable, never hard-delete). Then,
once enabled:

```bash
npm run deploy -- --app <slug>
```

---

## Removing a project

Delete the block from the relevant array in `projects.json`. The next deploy simply stops
touching that target — the server-side copy of `mindattic.com/<slug>.htm` (or whatever the site
uploaded) is left in place until someone manually FTP-deletes it. There is no automatic cleanup.

---

## Secrets & credential handling

FTP credentials resolve in this order (implemented in
[`Services/DeployRunner.cs`](MindAttic.Deploy.Cli/Services/DeployRunner.cs) and
[`src/deploy.js`](src/deploy.js)'s `loadFtpSettings`):

| Priority | Source | Notes |
|---|---|---|
| 1 | **MindAttic.Vault** — `%APPDATA%\MindAttic\Ftp\ftp.json` via `FtpCredentialStore.Default.TryGetJson()` (`MindAttic.Vault` NuGet 2.0.0, referenced by `MindAttic.Deploy.Cli`) | Only reachable through the **C# CLI**. `DeployRunner.RunNode` reads the Vault file and, when it has content, forwards it to the child `node` process as the `MINDATTIC_FTP_JSON` environment variable — `src/deploy.js` itself needs no Vault-awareness at all, the C# layer bridges into the same env-var seam CI has used for years. |
| 2 | **`MINDATTIC_FTP_JSON` environment variable**, if already set on the process | Left completely untouched when Vault has nothing to contribute. This is exactly how GitHub Actions supplies its secret (`secrets.MINDATTIC_FTP_JSON` in `.github/workflows/deploy.yml`) — CI has no `%APPDATA%\MindAttic`, so step 1 is a no-op there and this path keeps working unmodified. |
| 3 | **`secrets/ftp.json`** (gitignored) | Read directly by `deploy.js` only when neither of the above supplied anything. Copy `secrets/ftp.json.template` to `secrets/ftp.json` and fill in real values on a fresh checkout with no Vault entry yet. |

`secrets/ftp.json` shape (see [`secrets/ftp.json.template`](secrets/ftp.json.template)):

```json
{
  "host":     "ftp.example.com",
  "port":     21,
  "user":     "user@example.com",
  "password": "REPLACE_ME",
  "secure":   true
}
```

Optional: `"servername"` (SNI hostname to validate the TLS cert against, when connecting by IP or
a host whose cert doesn't cover the connection hostname) and `"rejectUnauthorized": false` (only
for a legacy/self-signed host you explicitly trust — disables certificate validation, i.e. MITM
protection, for that connection).

Credentials never live in source, the template, or any `out/` artifact — `secrets/ftp.json` is
gitignored and `MINDATTIC_FTP_JSON` is only ever an environment variable or a Vault-backed local
file. `MindAttic.Vault` itself is restored from a vendored `.nupkg` in `lib/local-packages/`
(git-tracked, via the repo-root `NuGet.config`) since GitHub-hosted CI runners have no access to
a developer's local NuGet feed — bump the vendored `.nupkg` and the CLI's `PackageReference`
version together whenever MindAttic.Vault ships a new release.

README fetch credentials (separate from FTP): public repos fetch anonymously; a private repo
needs `SUBSCRIBER_REPO_TOKEN` or `GITHUB_TOKEN` set in the environment.

---

## Component versioning (`componentsVersion`)

`projects.json` → `componentsVersion` (currently `"V4"`) pins the jsDelivr ref
(`cdn.jsdelivr.net/gh/mindattic/MindAttic.UiUx@<ref>`) that every landing page loads its fonts,
Cyberspace effects, and theme CSS from at runtime. Whole-number tags only (`V1`, `V2`, `V3`, …
never SemVer) so a pin is atomic and immutable; `"main"` is tip-of-tree and jsDelivr caches it for
roughly 12 hours, so it is explicitly non-atomic and only meant for active development, not a
production pin. Bumping `componentsVersion` (and redeploying) is the one action that propagates a
UiUx font/effect/theme change to every catalog landing page at once. `--components <ref>` on the
CLI/build script overrides it for a single run without touching `projects.json`.

---

## Parts addon (interactive build guides)

`src/parts.js` implements the one addon registered today (`ADDONS = { parts }` in `build.js`),
used by Claudia and ChiMesh (`"addon": "parts"` in their `projects.json` entries). When a
project's sibling repo ships a `config/parts.json`, `augment()` turns three author-placed markers
in the rendered README HTML into live interactive UI:

| README marker | Becomes |
|---|---|
| `<!-- CONFIG-WIDGET -->` | A build configurator (`<select>` per axis in `configAxes`), persisted to `localStorage`. |
| `<!-- PARTS-GALLERY -->` | A parts gallery: cards grouped by category, each with price, specs table, and "Buy" links (Official / Google / Reputable #n), plus a live running cost total. |
| `<!-- when: k=v;... -->` … `<!-- end -->` | A conditional block, shown/hidden client-side based on the current configurator selections (`!value` negates). |

Per-part preview images (`imageFile` in `parts.json`, rooted at the repo's `config/` dir) are
base64-inlined into the generated CSS so the finished page stays a single self-contained `.htm`
with no separate asset-upload step. Projects with no `config/parts.json` are a complete no-op —
`augment()` returns the README HTML untouched. This addon is the direct successor to ChiMesh's
retired `scripts/cli/build-html.js`: the generation now lives in this one pipeline so `/deploy`
alone produces the finished page.

---

## Per-project `/deploy` shims

Every MindAttic project repo's own `/deploy` slash command (or skill) is a thin shim into this
repo — there is exactly one `/deploy` per project, and it does one of:

```bash
# Catalog-only projects (most of them):
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --only <slug>

# App projects (Prose, Cursory, PersonaGallery, and the four disabled stubs):
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --app <slug>
```

The four disabled-app projects (IdiotProof, TaxRateCollector, ThinkTank, Tutor) still get a
catalog landing page — that page is deployed centrally from here (`--only <slug>`), not from
each project's own `/deploy`, since their app-side deploy is disabled pending Azure infra.

---

## Build, publish & test

```powershell
# Build the C# CLI
dotnet build MindAttic.Deploy.slnx -c Release

# Sanity-check the Node pipeline (no network / no FTP / no secrets required)
node src/build.js --help
node src/deploy.js --help

# Publish the CLI as a single-file win-x64 exe -> artifacts\MindAttic.Deploy.exe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish.ps1

# run.bat (used by MindAttic.Console's "Run Project" tab): republishes only if
# sources changed since the last build (scripts\ensure-fresh.ps1), then execs
# the published exe with whatever args were passed.
run.bat --version
```

There is **no automated test project** in this repo today (`dotnet test` has nothing to run).
Every capability is proven by a clean build plus an ad-hoc manual/`--dry-run` invocation; see
[docs/rfc/0001-test-harness.md](docs/rfc/0001-test-harness.md) for the plan to close that gap and
[docs/USER_STORIES.md](docs/USER_STORIES.md) for which stories are blocked on it.

---

## CI workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/cli-ci.yml` | Push/PR touching `MindAttic.Deploy.Cli/**`, `global.json`, `Directory.Build.props`, or itself; also `workflow_dispatch` | `dotnet build` the CLI in Release, then smoke-tests it with `--version` (chosen because it short-circuits before touching `projects.json` or the Node pipeline, so it needs no secrets or sibling checkouts). |
| `.github/workflows/deploy.yml` | **Manual only** (`workflow_dispatch`, optional `only` input) | Checks out this repo and a sibling `mindattic/MindAttic.UiUx` (for themes), `npm ci`, then `npm run deploy -- --from-github --themes-root ../MindAttic.UiUx/Themes [--only <slug>]` using the `MINDATTIC_FTP_JSON` repository secret. The automatic `push` trigger was deliberately removed — no `MINDATTIC_FTP_JSON` secret is configured on this repo yet, so every push-triggered run would fail; re-enable it once that secret exists. |

---

## Glossary

| Term | Meaning |
|---|---|
| **Catalog page** | A README-driven landing page rendered to `out/<slug>.htm` and FTPS-uploaded to `/mindattic.com/<slug>.htm`. |
| **Root site / sub-site** | A verbatim FTPS-uploaded `sites[]` entry — not passed through `template/index.template.htm`. |
| **App** | A `apps[]` entry: this repo commits + pushes a branch; the *project's own* GitHub Actions workflow performs the actual (Azure) deploy. |
| **Addon** | An optional interactive section layered onto a catalog page's README (today only `"parts"`). |
| **preDeploy hook** | A step run before a site/app's upload or push: `uiux-pull`, `powershell`, or `dotnet-build`. |
| **componentsVersion** | The jsDelivr ref (`main`, or an immutable whole-number tag like `V4`) pinning MindAttic.UiUx components + themes. |
| **Auto-discovery** | `build.js` generating a Cyberspace landing page for every public, non-archived `mindattic` repo with a README, via `gh repo list`. |
| **Manifest** | `out/_manifest.json` — the slugs that actually built, so `deploy.js` uploads exactly what was produced. |
| **Front door** | An entry point onto the one deploy engine — either the `npm run` scripts or `MindAttic.Deploy.exe`. |
| **Stamp** | The `<!-- Last Updated: <ISO-8601> -->` comment written into a site's `stampFile` on every deploy. |
| **Dry run** | `--dry-run`: preDeploy hooks still execute (they can mutate local state), but the FTP upload / git commit+push is skipped and only previewed. |

---

## Canonical documentation

This README covers *how to build, run, and extend* MindAttic.Deploy. For the layered
documentation standard ("Codex") this repo follows:

- **[docs/BIBLE.md](docs/BIBLE.md)** (L0) — what MindAttic.Deploy IS / is NOT, the architecture
  canon, and the project-specific Laws (`DEP-LAW-*`), plus the inherited org-wide House Rules.
- **[docs/AMENDMENTS.md](docs/AMENDMENTS.md)** (L1) — append-only change log (`DEP-A<n>`); an
  amendment wins over the bible where the two disagree.
- **[docs/USER_STORIES.md](docs/USER_STORIES.md)** (L2) — test-cited user stories
  (`DEP-US-<Epic><n>`); every `✅` cites the test that proves it (today every story is `🟡`/`⬜`
  pending [docs/rfc/0001-test-harness.md](docs/rfc/0001-test-harness.md), since there is no
  automated test project yet).
- **[docs/rfc/](docs/rfc/)** — design notes, graduating into the bible + stories once settled.
- **[docs/BIBLE.digest.md](docs/BIBLE.digest.md)** — generated by `tools/codex.ps1 digest`; never
  hand-edited, injected as session context by `.claude/hooks/inject-digest.ps1`.
- **[../MindAttic.HouseRules.md](../MindAttic.HouseRules.md)** — org-wide laws inherited by
  reference (whole-number versioning, soft-disable-never-delete, credentials-through-Vault, one
  engine/many front doors, verified-not-asserted definition of done).
