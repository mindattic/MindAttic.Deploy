# MindAttic.Deploy

One command deploys every MindAttic web property: FTPS uploads for the root sites, a gated linked release of the shared UiUx asset package, and push-to-deploy triggers for the Blazor apps.

![Node.js](https://img.shields.io/badge/node.js-basic--ftp-339933) ![.NET](https://img.shields.io/badge/.NET-10.0-512BD4) ![CLI](https://img.shields.io/badge/CLI-Spectre.Console-blueviolet) ![Tests](https://img.shields.io/badge/tests-node%3Atest-brightgreen) ![Status](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-all%20rights%20reserved-lightgrey)

```text
                    projects.json  (THE registry)
                    +--------------------------+--------------+
                    | sites[] + linkedGroups   |    apps[]    |
                    | root sites (+ UiUx pkg)  |  Blazor/CI   |
                    +------------+-------------+------+-------+
                                 |                    |
                                 v                    v
              +---------------- src/deploy.js -----------------+
              | site:   preDeploy hooks -> stamp -> FTPS       |
              | linked: src/linked.js -- package tag + push -> |
              |         pin -> hooks -> CDN gate -> FTPS       |
              | app:    preDeploy hooks -> git commit/push     |
              | (no mode flag -> usage, exit 2)                |
              +--------------------+---------------------------+
                                   | shells into
     MindAttic.Deploy.Cli (C#) ----+  (node --use-system-ca src/deploy.js ...)
                                   |
     creds: MindAttic.Vault -> MINDATTIC_FTP_JSON env -> secrets/ftp.json  (basic-ftp, FTPS)
```

Try it: `npm install` then `npm run deploy -- --site mindattic.com --dry-run` for a read-only plan of a full linked release.

## Why

- Ship any MindAttic site or app from one place, with one credential file, instead of a `deploy.ps1` and a `node_modules/` in every repo.
- Never publish a page that points at assets the CDN does not serve yet: the linked deploy checks every jsDelivr URL, byte for byte, before a single file is uploaded.
- Release the shared UiUx package and the three sites that depend on it together, so a site can never drift onto a stale or missing asset tag.
- Preview anything with `--dry-run` and see exactly which gate would stop a real run.
- Mistype a flag and nothing happens: unknown flags and missing modes exit 2 instead of falling through to a deploy.
- Drive it from a terminal, an interactive menu, CI or another launcher: the Node pipeline and the C# exe run the same engine.

## Features

MindAttic.Deploy is the single repo that FTPS-deploys (or CI-fires) every MindAttic-owned web property: the `mindattic.com` root page, `mindatticcares.com`, `ryandebraal.com` (these three plus the `MindAttic.UiUx` asset package deploy together as one linked group), two verbatim sub-folder sites, and the GitHub-Actions-driven Blazor apps (Cursory, PersonaGallery and MindAttic.Ideas enabled; the rest disabled with a note). Projects carry no deploy machinery of their own (no `deploy.ps1`, `deploy.bat`, `deploy.settings.json` or `node_modules/`): everything lives here.

Each MindAttic repo's GitHub README is its project page; this repo renders and uploads nothing for individual projects.

Two front doors drive the exact same engine:

- **Node**: `npm run deploy` (the canonical pipeline, `src/deploy.js` plus `src/linked.js`).
- **C#**: `MindAttic.Deploy.exe`, a Spectre.Console.Cli app that shells into the same Node pipeline (`MindAttic.Deploy.Cli/`). It never reimplements deploy logic itself.

What it ships:

- **Root and sub-sites**: verbatim FTPS upload of a file glob or a whole directory tree, with a Last-Updated stamp.
- **The linked group**: tag and push the MindAttic.UiUx package, pin the tag in every site, verify the CDN, then upload every site in order.
- **Blazor apps**: commit staged paths and push the branch, which fires the project's own GitHub Actions workflow.
- **preDeploy hooks**: `uiux-pull`, `powershell` and `dotnet-build` steps before an upload or push.
- **Soft-disabled apps**: a disabled app prints its `disabledNote` and never half-fires.

## Quick start

Prerequisites: Node.js, an FTP credential (see [Secrets and credential handling](#secrets-and-credential-handling)), and for the C# front door the .NET 10 SDK.

```bash
npm install
npm run deploy -- --sites                # every verbatim root/sub-site (the linked group goes through the linked flow)
npm run deploy -- --site mindattic.com   # ANY linked site deploys the WHOLE group: UiUx package + 3 sites
npm run deploy -- --uiux --dry-run       # preview that linked deploy: nothing tagged, pushed, written or uploaded
npm run deploy -- --site hyperspace      # a site outside the linked group deploys on its own
npm run deploy -- --apps                 # every enabled Blazor/CI app
npm run all                              # sites + apps, back-to-back
```

A mode flag is required. `npm run deploy` with none of `--site`, `--sites`, `--uiux`, `--app` or `--apps` prints usage and exits 2 ("no mode given"); there is no default pipeline.

Or with the C# CLI (build it once with `dotnet build`, or use the published `artifacts\MindAttic.Deploy.exe`):

```powershell
dotnet run --project MindAttic.Deploy.Cli   # interactive multi-select menu
MindAttic.Deploy site --slug mindattic.com --dry-run
MindAttic.Deploy all --dry-run
```

Both paths land in `node --use-system-ca src/deploy.js`. `--use-system-ca` matters here: the dev box re-signs HTTPS via a TLS-interception proxy, so without it both the FTPS connection and the linked deploy's jsDelivr CDN checks fail certificate validation.

What you should see from `node src/deploy.js --help`:

```text
deploy.js -- two pipelines under one roof (sites / apps).
A mode flag is required: --site, --sites, --uiux, --app or --apps.

Flags (also accept --flag=value form):
  --site <slug>        site mode:    deploy a root site (a linked-group member deploys the WHOLE group:
                       package tag + push, pin, CDN gate, then FTP for every site in the group)
  --sites              site mode:    deploy every root site (linked group first, via the linked flow)
  --uiux | --package   linked mode:  publish MindAttic.UiUx and deploy the whole linked group
  --no-link            site mode:    ESCAPE HATCH -- deploy only the named site (loud warning)
  --with-tests         linked mode:  also run MindAttic.UiUx/tests as a gate before publishing
  --app <slug>         app mode:     deploy a single Blazor app via GitHub Actions
  --apps               app mode:     deploy every enabled app
  --include-disabled   app mode:     include disabled apps in --apps iteration
  --dry-run            preview without firing (no FTP, no git push)

  --help, -h           show this help and exit

Run: node src/deploy.js [flags]
```

## What is in scope

Everything that ships via FTP or via a `git push` that fires a GitHub Actions workflow. The single registry, [projects.json](projects.json), has two target arrays plus the linked-group declaration:

| Key | What it is | Shipped how | Entries |
|---|---|---|---|
| `sites[]` | Verbatim root/sub-site upload, not templated | FTPS upload of a `files[]` glob (or a whole directory tree via `uploadDir`) to `ftpRemotePath` | mindattic.com (root), mindatticcares.com, ryandebraal.com, hyperspace, idiotproof-replays |
| `linkedGroups` | Sites that are inseparable from a shared package repo | The linked flow ([Linked deploy](#linked-deploy)): package tag + push, pin, CDN gate, then FTP of every member site | `mindattic-web` = MindAttic.UiUx + ryandebraal.com + mindatticcares.com + mindattic.com |
| `apps[]` | Blazor / GitHub-Actions-driven deploy | `git commit` (of `stageOnly` paths) + `git push <branch>`, which fires the project's own `.github/workflows/<workflow>` (the real Azure push happens there, not here) | cursory, personagallery, ideas (enabled); prose (local-only), idiotproof, taxratecollector, thinktank, tutor, mindatticfrontend (disabled, each with a `disabledNote` explaining exactly why) |

Explicitly out of scope:

- **Project pages.** Every MindAttic repo's GitHub README is its own project page (full docs plus the promo); nothing here renders or uploads per-project pages.
- **Remote cleanup.** This repo never deletes files on the FTP host; stale remote files are removed by hand.
- **UiUx sources.** `MindAttic.UiUx` owns the actual component sources and shared assets (fonts, logos, theme art, the Cyberspace effects). The sites pull them at runtime from jsDelivr; this repo never edits them. It does publish the package for the linked group (tag + push) and re-pin it in the sites (see [Linked deploy](#linked-deploy)), and it invokes UiUx's splice scripts as `preDeploy` hooks (for `mindattic.com`, and for the disabled Prose app).
- **Per-project deploy files.** A `scripts/cli/`, `deploy.ps1`, `deploy.bat` or `deploy.settings.json` in another repo is not used by anything: delete it rather than maintain it.

## How the pipeline works

### Site mode

`--site <slug>` and `--sites`. A member of a linked group never takes this path on its own: `--site <member>` and `--sites` send the group through the [linked flow](#linked-deploy) (unless `--no-link`). Plain site mode covers the sites outside the group (`hyperspace`, `idiotproof-replays`) and `--no-link` runs.

1. Runs the site's `preDeploy[]` hooks (see below).
2. If `stampFile` is set, rewrites (or inserts) a `<!-- Last Updated: <ISO-8601 UTC> -->` HTML comment at the top of that file. BOM-safe and idempotent: it replaces an existing stamp rather than stacking a new one on top.
3. Either recursively uploads a whole tree (`uploadDir: true`: non-destructive, only adds and updates, never deletes remote files absent locally; used for the IdiotProof replay archive) or expands the `files[]` glob against `sourceDir` and FTPS-uploads each matched file to `ftpRemotePath`.
4. `--dry-run` still runs the preDeploy hooks (they can mutate local state: a `git pull`, a PowerShell sync script) but skips the stamp write and the FTP connection.

### App mode

`--app <slug>` and `--apps`.

1. A `disabled: true` app prints its `disabledNote` and returns immediately; it never half-fires.
2. Runs `preDeploy[]` hooks.
3. `git add --` each path in `stageOnly[]`, then commits (message template with `{utc}` substitution) only if something is actually staged; otherwise it pushes the existing HEAD.
4. `git push origin <branch>`, which is expected to fire the project's own `.github/workflows/<workflow>`. The actual Azure deploy happens there, in that repo's CI, not in MindAttic.Deploy. This repo's contract for an app ends at the push.
5. `--apps` without an explicit slug skips disabled apps by default (so you do not accidentally half-fire something waiting on Azure infra); pass `--include-disabled` to have each disabled app print its note once instead of being silently skipped.
6. `--dry-run` still runs the preDeploy hooks but skips the git commit and push.

### preDeploy hook kinds

| Kind | What it does | Notes |
|---|---|---|
| `uiux-pull` | `git -C ../MindAttic.UiUx pull --no-edit --no-rebase` | Fails loudly if the sibling is not a git repo. Skipped inside the linked flow (its preflight already verified the package). |
| `powershell` | `powershell -NoProfile -ExecutionPolicy Bypass -File <file> [args...]` | `file` is resolved relative to the repo root; relative-looking `args` are resolved too. In the linked flow a hook with `tagArg` also receives the release tag. |
| `dotnet-build` | `dotnet build <project> -c <configuration> --nologo` | `configuration` defaults to `Release`. |

Every hook entry can set `"required": false` to make a failure non-fatal (it logs and continues instead of aborting the whole deploy).

## Linked deploy

`MindAttic.UiUx` (the shared jsDelivr asset package) and the three sites that load their fonts, logos, theme art and Cyberspace engine from it are permanently linked. The group is declared in `projects.json` under `linkedGroups`:

```jsonc
"linkedGroups": {
  "mindattic-web": {
    "package": { "slug": "MindAttic.UiUx", "sourceDir": "../MindAttic.UiUx", "repo": "mindattic/MindAttic.UiUx", "branch": "main", "remote": "origin" },
    "sites":   ["ryandebraal.com", "mindatticcares.com", "mindattic.com"]   // FTP order
  }
}
```

The package tag this flow publishes and pins is the only asset version in the system; there is no global version key in `projects.json`.

Deploying any member (`--site ryandebraal.com`, `--site mindatticcares.com`, `--site mindattic.com`, `--sites`, or `--uiux`) runs the same flow (`src/linked.js`). It aborts before any FTP upload if a gate fails:

| Step | Name | What it does or checks |
|---|---|---|
| 1 | **Preflight** | Package repo is on `main` with a clean working tree (never auto-committed), `origin` reachable, not behind or diverged from `origin/main`, latest tag is an ancestor of `HEAD`, no whole-number tag exists only locally (a leftover from a publish whose push failed; it would leave a gap in `V1..Vn`) unless it is at `HEAD`, `tools\build-asset-manifest.ps1 -Verify` passes, every site's page exists, FTP secrets resolve, no page pins a tag newer than the release tag. |
| 2 | **Publish** | If `HEAD` already carries the latest `V<n>` tag it is reused; otherwise tag `V<n+1>` (annotated; message lists the commits since the last tag) and `git push origin main` plus the tag. Never force. A tag that already exists on origin at a different commit aborts (tags are immutable). |
| 3 | **Pin** | Every `MindAttic.UiUx@V<n>` in each site's `pinFiles` (default: its `stampFile`, that is `index.htm`) becomes the release tag. Idempotent; leaves npm and other jsDelivr URLs alone. Uploaded files outside `pinFiles` are never pinned or scanned (none today: each linked site uploads only its `index.htm`). |
| 4 | **Prepare** | Runs each site's `preDeploy` hooks. A powershell hook with `"tagArg": "-CyberspaceCdnTag"` receives the tag; the `uiux-pull` hook is skipped (step 1 already verified or published the package). |
| 5 | **CDN gate** | Every UiUx URL the pages use must be live on jsDelivr at the release tag: HTTP 200, `access-control-allow-origin: *`, `content-length` equal to the file in the package tree. Checked: literal URLs plus every file in `assets-manifest.json` under each site's domain folder (so images a page builds at runtime from a base prefix like `ASSET_BASE + 'themes/...'` are covered). URLs ending in `/` are base prefixes and doc placeholders like `@<tag>/<path>` are ignored. New tags can lag: failures are retried in shared backoff rounds (about 3 minutes). |
| 6 | **FTP** | Uploads the sites in order over one connection (stamp + `files[]`), reconnecting if a failed site left it closed. A failing site does not stop the rest; non-zero exit if any failed; `--sites` then deploys non-member sites. Prints a table and reminds you when a site repo has uncommitted or unpushed changes (the deploy never commits them). |

```bash
npm run deploy -- --site mindattic.com --dry-run   # read-only plan: [WOULD ABORT] lines show gates that would stop a real run
npm run deploy -- --site mindattic.com             # the real thing (same as --site ryandebraal.com / --uiux)
npm run deploy -- --uiux --with-tests              # also run MindAttic.UiUx\tests first
npm run deploy -- --site mindattic.com --no-link   # ESCAPE HATCH: this site only (prints a warning)
```

Things to know:

- **Commit the package first.** A dirty `MindAttic.UiUx` tree aborts the run; commit your asset or component changes, then deploy.
- **Pushing main of MindAttic.UiUx** can trigger its `sync-subscribers` GitHub workflow (it opens review PRs in subscriber repos; it merges nothing). Add `[skip ci]` to the package commit message to suppress it.
- The package is published before the CDN gate (the gate needs the tag to exist). If the gate fails the tag stays (immutable) and nothing is uploaded; fix and re-run.
- If a push is rejected, the run aborts cleanly (nothing uploaded) and the new tag stays local; the next run, with `HEAD` unchanged, resumes from it and pushes it.
- `--no-link` requires `--site` or `--sites`, and `--with-tests` requires a linked deploy; both exit 2 otherwise instead of being silently ignored.
- Each linked site uploads only its `index.htm` (a repo's generated `README.htm` is documentation, not part of the site). `mindattic.com`'s only hooks are `uiux-pull` (skipped inside the linked flow) and the Cyberspace splice.
- `--dry-run` runs steps 1-5 read-only: no tag, push, pin edit, hook, FTP connect or upload. If the release tag is not published yet, it says the live CDN check "would run after the push".
- Design canon: [docs/BIBLE.md](docs/BIBLE.md) (architecture §4, laws §5). Tests: `npm test`.

## Commands

### npm scripts

The Node pipeline is canonical.

| Command | Effect |
|---|---|
| `npm run deploy -- --site <slug>` | Deploy one root or sub site (hooks + stamp + FTPS). A linked-group member deploys the whole group ([Linked deploy](#linked-deploy)). |
| `npm run deploy -- --sites` | Deploy every entry in `sites[]` (the linked group first, via the linked flow, then the rest). |
| `npm run deploy -- --uiux` (alias `--package`) | Publish MindAttic.UiUx (tag + push), pin it, verify the CDN, then deploy every linked site. |
| `npm run deploy -- --site <slug> --no-link` | Escape hatch: deploy only that site, skipping the linked flow (loud warning). |
| `npm run deploy -- --uiux --with-tests` | Linked deploy that also runs `MindAttic.UiUx/tests` (`npm run test:local`) as a gate before publishing. |
| `npm run deploy -- --app <slug>` | Deploy one Blazor/CI app (hooks + commit + push). |
| `npm run deploy -- --apps` | Deploy every enabled app (`--include-disabled` to also print disabled notes). |
| `npm run deploy -- <mode> --dry-run` | Preview any of the above without FTP upload or git push. Plain site and app modes still run their preDeploy hooks; the linked flow runs none of them (hooks mutate files) and writes, tags and pushes nothing. `--dry-run` alone is not a mode and exits 2. |
| `npm run deploy` (no mode flag) | Prints usage and exits 2 ("no mode given"). |
| `npm run all` | `deploy --sites` then `deploy --apps --include-disabled`, in one shot. |
| `npm test` | Run this repo's tests (`test/linked.test.js`, node:test). |
| `node src/deploy.js --help` | Print the full flag reference and exit 0. |

`deploy.js` rejects an unrecognized `--flag` with exit code 2 and prints usage, so a typo like `--hlep` never silently triggers a deploy.

### MindAttic.Deploy.exe

Built from `MindAttic.Deploy.Cli/` (`net10.0`, `AssemblyName=MindAttic.Deploy`, `<Version>1.0.0</Version>`, Spectre.Console.Cli). Every subcommand shells into the identical `node --use-system-ca src/deploy.js ...`; the CLI never reimplements deploy behavior.

| Command | What it does |
|---|---|
| `MindAttic.Deploy` (no args) | Interactive multi-select menu across sites and apps (`MainMenuCommand`). Space toggles, `A` selects all, Enter confirms; nothing selected means exit without deploying. Selecting every site or every app collapses to one `--sites` or `--apps --include-disabled` invocation; several ticked members of a linked group run the group once. |
| `MindAttic.Deploy site --slug <slug> [--dry-run] [--no-link] [--with-tests]` | Deploy one root or sub site (`--site`); a linked member deploys its whole group. Use `--all` instead of `--slug` for every site (`--sites`). |
| `MindAttic.Deploy uiux [--dry-run] [--with-tests]` (alias `package`) | The linked deploy started from the package (`--uiux`). |
| `MindAttic.Deploy app --slug <slug> [--dry-run] [--include-disabled]` | Deploy one Blazor/GitHub-Actions app; `--all` instead of `--slug` deploys every app. |
| `MindAttic.Deploy all [--dry-run]` | Non-interactive "deploy everything": `--sites`, then `--apps --include-disabled`, back-to-back. Meant for scripts, CI and slash commands that do not want to drive an interactive prompt. |
| `MindAttic.Deploy list` | Print every target (slug, sourceDir and remote for sites; slug, repo, branch, workflow and enabled or disabled for apps) as Spectre tables. |
| `MindAttic.Deploy version`, `--version` or `-v` | Print the assembly name, version, and the running exe's process path (works whether launched via `dotnet run`, the raw DLL, or the published single-file exe). |

`ProjectRoster` resolves the repo root by walking up from the exe's directory looking for `projects.json` plus `src/deploy.js` (or honors a `MINDATTIC_DEPLOY_ROOT` env var override), so the exe works when copied anywhere as long as it is still inside (or points at) a MindAttic.Deploy checkout.

### Per-project deploy shims

Every MindAttic project repo that actually ships something has a thin `/deploy` slash command (or skill) that shims into this repo. There is exactly one `/deploy` per such project, and it does one of:

```bash
# App projects (Cursory, PersonaGallery, MindAttic.Ideas, and the disabled ones):
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --app <slug>

# The linked group (MindAttic.UiUx, ryandebraal.com, mindatticcares.com, mindattic.com):
# every one of their /deploy shims runs the SAME linked flow (see "Linked deploy" above).
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --uiux              # from MindAttic.UiUx
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --site <slug>       # from a site (whole group deploys)
```

A project that only has a public page has no `/deploy` here: pushing its README to GitHub publishes the page.

## Adding a new deployable project

A project that only needs a public page needs nothing here: its GitHub README is its page.

For something that actually ships, pick exactly one array in `projects.json`. That is the entire procedure: no scaffold script, no per-project files.

**Verbatim root or sub site**: append to `sites[]` with `sourceDir` (relative to the repo root), `ftpRemotePath`, and either `files[]` (a glob or exact filenames) or `uploadDir: true` (recursive, non-destructive tree upload). Optional `stampFile` and `preDeploy[]`. A site that loads assets from `MindAttic.UiUx` belongs in the linked group: add it to `linkedGroups.mindattic-web.sites` (the listed order is the FTP order) and, if its pinned URLs live outside its `stampFile`, set `pinFiles`. Then:

```bash
npm run deploy -- --site <slug>
```

**Blazor or GitHub-Actions app**: append to `apps[]` with `sourceDir`, `repo` (`owner/name`), `branch`, `workflow` (the `.github/workflows/<file>` in that repo that does the real deploy), `stageOnly[]` (paths to `git add` before committing; an empty array if nothing needs staging), optional `commitMessage` (supports a `{utc}` placeholder) and `preDeploy[]`. New apps should start `"disabled": true` with a `disabledNote` describing exactly what infra is missing, per HOUSE-LAW-2 in `MindAttic.HouseRules.md` (soft-disable, never hard-delete). Then, once enabled:

```bash
npm run deploy -- --app <slug>
```

## Removing a project

Delete the block from the relevant array in `projects.json` (an app is normally disabled with a note instead). The next deploy simply stops touching that target. Whatever the site uploaded is left on the server until someone manually FTP-deletes it; there is no automatic remote cleanup.

## Secrets and credential handling

FTP credentials resolve in this order (implemented in [DeployRunner.cs](MindAttic.Deploy.Cli/Services/DeployRunner.cs) and the `loadFtpSettings` function in [src/deploy.js](src/deploy.js)):

| Priority | Source | Notes |
|---|---|---|
| 1 | **MindAttic.Vault**: `%APPDATA%\MindAttic\Ftp\ftp.json` via `FtpCredentialStore.Default.TryGetJson()` (`MindAttic.Vault` NuGet 2.0.0, referenced by `MindAttic.Deploy.Cli`) | Only reachable through the C# CLI. `DeployRunner.RunNode` reads the Vault file and, when it has content, forwards it to the child `node` process as the `MINDATTIC_FTP_JSON` environment variable. `src/deploy.js` itself needs no Vault-awareness; the C# layer bridges into the same env-var seam. |
| 2 | **The `MINDATTIC_FTP_JSON` environment variable**, if already set on the process | Left completely untouched when Vault has nothing to contribute. This is the seam a CI runner (which has no `%APPDATA%\MindAttic`) would use. |
| 3 | **`secrets/ftp.json`** (gitignored) | Read directly by `deploy.js` only when neither of the above supplied anything. Copy `secrets/ftp.json.template` to `secrets/ftp.json` and fill in real values on a fresh checkout with no Vault entry yet. |

`secrets/ftp.json` shape (see [secrets/ftp.json.template](secrets/ftp.json.template)):

```json
{
  "host":     "ftp.example.com",
  "port":     21,
  "user":     "user@example.com",
  "password": "REPLACE_ME",
  "secure":   true
}
```

Optional: `"servername"` (SNI hostname to validate the TLS cert against, when connecting by IP or a host whose cert does not cover the connection hostname) and `"rejectUnauthorized": false` (only for a legacy or self-signed host you explicitly trust; it disables certificate validation, that is MITM protection, for that connection).

Credentials never live in source or in any uploaded file: `secrets/ftp.json` is gitignored and `MINDATTIC_FTP_JSON` is only ever an environment variable or a Vault-backed local file. `MindAttic.Vault` itself is restored from a vendored `.nupkg` in `lib/local-packages/` (git-tracked, via the repo-root `NuGet.config`) since GitHub-hosted CI runners have no access to a developer's local NuGet feed. Bump the vendored `.nupkg` and the CLI's `PackageReference` version together whenever MindAttic.Vault ships a new release.

## Project layout

```text
projects.json                    canonical registry: sites[], apps[], linkedGroups
src/
  deploy.js                      the pipeline (site / app modes); FTPS via basic-ftp; preDeploy hook runner
  linked.js                      the linked deploy (package tag + push, pin, CDN gate, FTP)
test/
  linked.test.js                 node:test suite (npm test)
MindAttic.Deploy.Cli/            C# console app (net10.0, Spectre.Console.Cli, assembly name MindAttic.Deploy)
  Commands/                      SiteCommand, UiuxCommand, AppCommand, AllCommand, ListCommand,
                                  VersionCommand, MainMenuCommand (the interactive default)
  Services/
    DeployRunner.cs               shells into node --use-system-ca src/deploy.js; bridges MindAttic.Vault creds
    ProjectRoster.cs               resolves the repo root and deserializes projects.json
  Models/DeployConfig.cs          typed projects.json shape (SiteProfile / AppProfile / HookProfile / linked groups)
secrets/
  ftp.json                       gitignored FTP credentials (real value present on this dev box)
  ftp.json.template               starting point for a fresh checkout
artifacts/                        published MindAttic.Deploy.exe (gitignored; produced by scripts/publish.ps1)
lib/local-packages/                vendored MindAttic.Vault .nupkg, git-tracked so CI can restore it
scripts/
  publish.ps1                     dotnet publish -> artifacts\MindAttic.Deploy.exe (single-file, win-x64)
  ensure-fresh.ps1                 republishes only if sources changed newer than the exe
run.bat                            convenience launcher: ensure-fresh.ps1 then exec the published exe
tools/
  codex.ps1                        Codex doctor + digest generator for docs/
  build-readme.ps1                 regenerates README.htm from this file (shared engine)
docs/
  BIBLE.md, AMENDMENTS.md, USER_STORIES.md, BIBLE.digest.md, rfc/
.github/workflows/
  cli-ci.yml                       builds the C# CLI + runs its --version smoke test
```

## Building and testing

```powershell
# Build the C# CLI
dotnet build MindAttic.Deploy.slnx -c Release

# Run the Node tests (no network / no FTP / no secrets required)
npm test

# Sanity-check the Node pipeline
node src/deploy.js --help

# Publish the CLI as a single-file win-x64 exe -> artifacts\MindAttic.Deploy.exe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish.ps1

# run.bat: republishes only if
# sources changed since the last build (scripts\ensure-fresh.ps1), then execs
# the published exe with whatever args were passed.
run.bat --version
```

`npm test` runs `test/linked.test.js` (node:test): the linked deploy against throwaway git repos, a local HTTP stand-in for jsDelivr and a fake FTP client, plus the CLI flag guards (unknown flags, linked-only modifiers, no mode flag) and registry consistency. Plain site and app modes and the C# CLI have no automated tests (`dotnet test` has nothing to run); they are proven by a clean build plus ad-hoc `--dry-run` invocations. See [docs/rfc/0001-test-harness.md](docs/rfc/0001-test-harness.md) for the plan to close that gap and [the user stories](docs/USER_STORIES.md) for which stories are blocked on it.

## CI workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/cli-ci.yml` | Push or PR touching `MindAttic.Deploy.Cli/**`, `global.json`, `Directory.Build.props`, or itself; also `workflow_dispatch` | `dotnet build` the CLI in Release, then smoke-tests it with `--version` (chosen because it short-circuits before touching `projects.json` or the Node pipeline, so it needs no secrets or sibling checkouts). |

There is no CI deploy workflow: deploys run from the dev box.

## Glossary

| Term | Meaning |
|---|---|
| **Root site / sub-site** | A verbatim FTPS-uploaded `sites[]` entry, not templated; only its Last-Updated stamp (and, for the linked group, its package pins) are rewritten. |
| **Linked group** | A package repo plus the sites that load from it, always deployed together (`linkedGroups`; today `mindattic-web`). |
| **Release tag** | The whole-number `V<n>` tag of MindAttic.UiUx a linked deploy publishes (or reuses) and pins in the sites. |
| **CDN gate** | The pre-FTP check that every package asset the sites use is live on jsDelivr at the release tag with the exact bytes. |
| **App** | An `apps[]` entry: this repo commits and pushes a branch; the project's own GitHub Actions workflow performs the actual (Azure) deploy. |
| **Mode flag** | One of `--site`, `--sites`, `--uiux`, `--app`, `--apps`. `deploy.js` exits 2 without one. |
| **preDeploy hook** | A step run before a site or app's upload or push: `uiux-pull`, `powershell`, or `dotnet-build`. |
| **Front door** | An entry point onto the one deploy engine: either the `npm run` scripts or `MindAttic.Deploy.exe`. |
| **Stamp** | The `<!-- Last Updated: <ISO-8601> -->` comment written into a site's `stampFile` on every deploy. |
| **Dry run** | `--dry-run` with a mode flag: plain site and app modes still execute preDeploy hooks (they can mutate local state), but the FTP upload or git commit and push is skipped and only previewed; the linked flow runs nothing that writes. |

## Documentation

This README covers how to build, run, and extend MindAttic.Deploy. For architecture-level reasoning (why it exists, what the invariants are), the repo follows the layered Codex documentation standard:

- [docs/BIBLE.md](docs/BIBLE.md) (L0): what MindAttic.Deploy is and is not, the architecture canon, and the project-specific laws (`DEP-LAW-*`), plus the inherited org-wide House Rules.
- [docs/AMENDMENTS.md](docs/AMENDMENTS.md) (L1): decisions not yet folded into the bible (normally empty).
- [User stories](docs/USER_STORIES.md) (L2): test-cited user stories (`DEP-US-<Epic><n>`); every story marked done cites the test that proves it.
- [docs/rfc/](docs/rfc/): open design notes; once decided they are folded into the bible and stories and deleted.
- [docs/BIBLE.digest.md](docs/BIBLE.digest.md): generated by `tools/codex.ps1 digest`; never hand-edited, injected as session context by `.claude/hooks/inject-digest.ps1`.
- `MindAttic.HouseRules.md` (in the workspace root, the codex-standard repo): org-wide laws inherited by reference (whole-number versioning, soft-disable-never-delete, credentials-through-Vault, one engine with many front doors, verified-not-asserted definition of done).
- [AGENTS.md](AGENTS.md): the entry point for coding agents working in this repo.

## License

This repo has no LICENSE file. All rights reserved.

Part of [MindAttic](https://mindattic.com) — see more projects at [github.com/mindattic](https://github.com/mindattic). Related: [MindAttic.UiUx](https://github.com/mindattic/MindAttic.UiUx), [mindattic.com](https://github.com/mindattic/mindattic.com), [ryandebraal.com](https://github.com/mindattic/ryandebraal.com), [mindatticcares.com](https://github.com/mindattic/mindatticcares.com).
