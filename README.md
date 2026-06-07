# MindAttic.Deploy

**One pipeline. Every MindAttic site. One credential file.**

Every FTP-deployed MindAttic site — the `mindattic.com` root, every `mindattic.com/<slug>.htm` catalog landing page, the long-form build guides (Claudia, ChiMesh), `mindatticcares.com`, and `ryandebraal.com` — is built and uploaded from this one repo. No `scripts/cli/` machinery in each project. No per-project `deploy.ps1`. No duplicated `deploy.settings.json` files holding the same credentials. No drift.

Catalog landing pages and the long-form build guides are rendered from each project's `README.md` via `template/index.template.htm`, with fonts/effects pulled at runtime from the jsDelivr CDN against the `componentsVersion` pinned in `projects.json`. The three root sites are uploaded verbatim. Blazor apps (`apps[]`) are CI-deployed; this repo just owns their slash-command shims and pre-deploy hooks.

```bash
npm install
npm run build                          # render every site -> out/
npm run deploy                         # FTPS-upload everything
npm run deploy -- --only mindatticvault   # just one
```

---

## What's in scope

Anything that ships via FTP. Today that's:

| Array in `projects.json` | Examples | Remote |
|---|---|---|
| `projects[]` — catalog landing page (README -> `<slug>.htm`) | idiotproof, mindatticlegion, mindatticvault, taxratecollector, thinktank, tutor, mediabutler, gridgame2026, mindatticpsst | `/mindattic.com/<slug>.htm` |
| `projects[]` — long-form build guide (same renderer + Cyberspace theme, plus the parts-picker augmentation) | claudia, chimesh | `/mindattic.com/<slug>.htm` |
| `sites[]` — verbatim root-site FTP upload | mindattic.com, mindatticcares.com, ryandebraal.com | site root |
| `apps[]` — Blazor / GitHub-Actions deploys (CI does the actual push) | streetsamurai (enabled); idiotproof, taxratecollector, thinktank, tutor (stubbed pending Azure infra) | — |

**Not in this repo.**
- `MindAttic.UiUx` owns the component sources (fonts, Cyberspace effects, BackHomeM, PinFooter, WebSnapshot) and the marker-block sync for the three subscribers that need build-time splice (`mindattic.com/index.htm`, `StreetSamurai/wwwroot/`, `MindAttic.Psst/{terms,privacy}.htm`). This repo invokes those splice scripts as `preDeploy` hooks for `mindattic.com` and `StreetSamurai`.
- `StreetSamurai` ships via Azure App Service (master push -> CI). This repo's `apps[]` entry just exposes the slash-command shim and the pre-deploy sync.
- `FractionsOfACent` is a Blazor/CLI scientific app, not an FTP landing page; it has no entry here.

---

## How it works

1. **`projects.json`** has three arrays: `projects[]` (catalog landing pages), `sites[]` (verbatim root-site FTP uploads), and `apps[]` (Blazor / GitHub-Actions deploys). It also holds `componentsVersion` — the jsDelivr ref this repo pins for MindAttic.UiUx components and themes.
2. **`template/index.template.htm`** is the canonical HTML shell used to render every entry in `projects[]`. `{{PLACEHOLDER}}` substitution, CDN-loaded MindAttic.UiUx components and themes.
3. **`src/build.js`** fetches each `projects[]` entry's `README.md` (from the local sibling repo or the GitHub raw API in CI), renders it through the template, and writes the rendered output under `out/`.
4. **`src/deploy.js`** picks the right handler (catalog project, root site, or app), runs pre-deploy hooks (`uiux-pull`, `powershell` splice scripts in MindAttic.UiUx, `dotnet-build` for apps, `fetch-descriptions` for mindattic.com), and FTPS-uploads to the configured remote path.

Per-project `/deploy` slash commands shell into this repo:

```
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --only <slug>
# or for Blazor apps:
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --app  <slug>
```

That's the entire pipeline. There is no per-project deploy state.

---

## Adding a new site

Pick the right array in `projects.json`:

- **Catalog landing page** (README-driven, rendered via the template): append to `projects[]`.
  ```json
  {
    "slug":    "newproject",
    "repo":    "NewProject",
    "title":   "NewProject",
    "tagline": "One-line description.",
    "theme":   "Cyberspace"
  }
  ```
  Then: `npm run deploy -- --only newproject`. (`theme` matches a folder name under `MindAttic.UiUx/Themes/` — today `Cyberspace` is the only theme; the Hardware doc theme was retired 2026-05-29.)

- **Verbatim root site** (no template, files uploaded as-is): append to `sites[]` with `sourceDir`, `ftpRemotePath`, and `files[]`. Then: `npm run deploy -- --site <slug>`.

- **Blazor / GitHub-Actions app**: append to `apps[]` with `repo`, `branch`, `workflow`, and `preDeploy` hooks. Then: `npm run deploy -- --app <slug>`.

---

## Credentials (via MindAttic.Vault)

FTP credentials live in MindAttic.Vault's APPDATA file store, the same convention used by `LlmCredentialStore` and `BrokerCredentialStore`:

```
%APPDATA%\MindAttic\Deploy\ftp.json
{
  "profiles": {
    "default":     { "host": "...", "port": 21, "user": "...", "password": "...", "secure": true },
    "ryandebraal": { ... }
  }
}
```

| Where | What |
|-------|------|
| Local | `%APPDATA%\MindAttic\Deploy\ftp.json` (Vault-managed). |
| CI    | GitHub Actions secret `MINDATTIC_FTP_JSON` (the entire JSON object as one secret). |
| READMEs | Public repos: anonymous fetch. Private repos: set `SUBSCRIBER_REPO_TOKEN` or `GITHUB_TOKEN`. |

Lookup order in `deploy.js`: `MINDATTIC_FTP_JSON` env -> APPDATA Vault file -> legacy `secrets/ftp.json` (transitional fallback, gitignored).

---

## Component versioning

`projects.json -> componentsVersion` pins the jsDelivr ref for MindAttic.UiUx (both `Components/` and `Themes/` come from this ref). Use `"main"` for tip-of-tree, or a whole-number tag like `"V3"` for immutable cache hits in production (per the MindAttic.Ideas A1 rule — whole numbers only, no SemVer: `V1`, `V2`, `V3`, …, never `v1.1.1`). Bumping this is how a font or Cyberspace-effect change propagates to every catalog landing page on the next deploy.

---

## Why this replaces the old pipeline

| Old                                                            | New                              |
|----------------------------------------------------------------|----------------------------------|
| Per-project `scripts/cli/build-html.js`, `deploy.ps1`, `deploy.bat`, `deploy.settings.json`, `package.json`, `node_modules/` | one repo, one `package.json`, one install |
| One `deploy.settings.json` per project, each with the same FTP credentials | one Vault entry at `%APPDATA%\MindAttic\Deploy\ftp.json` |
| 11 `index.htm` files in 11 repos with marker blocks            | rendered artifacts in `out/`     |
| `sync-landing-page.ps1` + `sync-claudia.ps1` + `sync-chimesh.ps1` + 13 entries in `MindAttic.UiUx/subscribers.json` | zero sync scripts, zero splice for landing pages — MindAttic.UiUx now only owns the three splice subscribers it still needs (mindattic.com, StreetSamurai, MindAttic.Psst legal pages) |
| Per-project `.claude/commands/deploy.md` doing real work       | per-project shim -> `npm run deploy -- --only <slug>` (catalog) or `--app <slug>` (Blazor) |

Components and themes are loaded via CDN (`jsDelivr`) at runtime instead of being inlined per subscriber. Editing a font or the Cyberspace engine no longer requires a 13-target sync — push to MindAttic.UiUx, bump `componentsVersion` here if you want to pin, redeploy.

---

## Roadmap

See `CLAUDE.md` for the in-flight migration plan.

- [x] Catalog landing pages (11 README-driven sites: idiotproof, gridgame2026, mindatticlegion, mindatticpsst, mindatticvault, taxratecollector, thinktank, tutor, mediabutler, claudia, chimesh).
- [x] Rename `MindAttic.Catalog` -> `MindAttic.Deploy` on disk.
- [x] Port mindattic.com, mindatticcares.com, and ryandebraal.com root-site deploys — `--site <slug>` / `--sites`.
- [x] Replace every per-project `.claude/skills/deploy/SKILL.md` (and `commands/deploy.md`) with shims that call `MindAttic.Deploy`. Both catalog projects (`--only <slug>`) and Blazor app projects (`--app <slug>`) now point here.
- [x] Add `apps[]` + `--app` / `--apps` / `--dry-run` for Blazor/GitHub-Actions-driven deploys. StreetSamurai is enabled; IdiotProof, TaxRateCollector, ThinkTank, Tutor are stubbed (disabled with notes).
- [x] Delete orphaned local deploy files (`scripts/cli/deploy.*`, `deploy.settings.json*`, root-site `deploy.{bat,ps1}` + `settings.json`) across every MindAttic project; update Vault settings.json `runCommand` entries (the 3 root sites no longer prefix `deploy.bat &&`). Per-repo `git rm` + commit; user pushes.
- [x] `MindAttic.Deploy.Cli` (C# console app modelled on MindAttic.Console). Spectre.Console.Cli, `net10.0`. Commands: `catalog`, `site`, `app`, `version`. Default (no args) is an interactive multi-select prompt grouping catalog + sites + apps. Shells into the canonical `node src/deploy.js` pipeline.
- [x] Retire deprecated `landing-page` and `build-html-js` paths in `MindAttic.UiUx/subscribers.json` (and the three sync scripts they used). MindAttic.UiUx now only owns the three splice subscribers that genuinely need build-time inlining.
- [ ] Move FTP credentials to `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault; retire `secrets/ftp.json`.

`StreetSamurai` stays Azure-CI-deployed; this repo just owns the slash-command shim and the pre-deploy UiUx sync. `MindAttic.UiUx` keeps its three splice scripts (`sync-mindattic-com.ps1`, `sync-streetsamurai.ps1`, `sync-mindattic-psst.ps1`); two of them run as `preDeploy` hooks from this repo.
