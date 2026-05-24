# MindAttic.Deploy

**One pipeline. Every MindAttic site. One credential file.**

Every FTP-deployed MindAttic site — the `mindattic.com` root, every `mindattic.com/<slug>/` landing page, the long-form build guides (Claudia, ChiMesh), `mindatticcares.com`, and `ryandebraal.com` — is built and uploaded from this one repo. No `scripts/cli/` machinery in each project. No 13 copies of `deploy.ps1`. No 13 `deploy.settings.json` files holding the same credentials. No drift.

> **In-flight migration.** This repo was just renamed from `MindAttic.Catalog`. The README-landing-page pipeline is fully consolidated. Subfolder build guides, root sites, and Vault-backed credentials are being migrated in phases (see [Roadmap](#roadmap)).

```bash
npm install
npm run build                          # render every site -> out/
npm run deploy                         # FTPS-upload everything
npm run deploy -- --only mindatticvault   # just one
```

---

## What's in scope

Anything that ships via FTP. Today that's:

| Kind | Examples | Remote |
|------|----------|--------|
| Catalog landing page (README -> `<slug>.htm`) | idiotproof, fractionsofacent, mindattic.legion, mindattic.vault, taxratecollector, thinktank, tutor, mediabutler, gridgame2026, mindattic.mobile, mindattic.psst | `/mindattic.com/<slug>.htm` |
| Subfolder build guide (3-file: md + htm + index.htm) | claudia, chimesh | `/mindattic.com/<slug>/` |
| Root site | mindattic.com, mindatticcares.com, ryandebraal.com | site root |

**Not in scope.** `StreetSamurai` ships via Azure App Service (master push -> CI). `MindAttic.UiUx`'s `/deploy` is an alias for component fanout, not an FTP upload. Both stay where they are.

---

## How it works

1. **`profiles.json`** lists every deploy target with a `type`: `catalog-landing`, `subfolder-guide`, or `root-site`.
2. **`template/index.template.htm`** is the canonical HTML shell used by `catalog-landing` profiles (one template, all 11 sites). `{{PLACEHOLDER}}` substitution, CDN-loaded MindAttic.UIUX components.
3. **`src/build.js`** fetches each project's source (`README.md` for catalog-landing; project-local markdown for subfolder-guide; verbatim files for root-site) and writes the rendered output under `out/`.
4. **`src/deploy.js`** picks the right profile handler, optionally runs pre-deploy hooks (UiUx sync, fetch-descriptions, stamp), and FTPS-uploads to the configured remote path.

Per-project `/deploy` slash commands shell into this repo:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Projects\MindAttic\MindAttic.Deploy\bin\deploy.ps1" --only <slug>
```

That's the entire pipeline. There is no per-project deploy state.

---

## Adding a new site

1. Append a block to `profiles.json` (pick the right `type`):
   ```json
   {
     "slug":    "newproject",
     "type":    "catalog-landing",
     "repo":    "NewProject",
     "title":   "NewProject",
     "tagline": "One-line description.",
     "theme":   "Cyberspace"
   }
   ```
2. `npm run deploy -- --only newproject`

That's it. (`theme` is required for `catalog-landing` entries; valid values match folder names under `MindAttic.UIUX/Themes/` — today: `Cyberspace` for software projects, `Hardware` for hardware build guides.)

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

`profiles.json -> componentsVersion` pins the jsDelivr ref for MindAttic.UIUX. Use `"main"` for tip-of-tree, or a tag like `"v1.0.0"` for immutable cache hits in production.

---

## Why this replaces the old pipeline

| Old                                                            | New                              |
|----------------------------------------------------------------|----------------------------------|
| Per-project `scripts/cli/build-html.js`, `deploy.ps1`, `deploy.bat`, `deploy.settings.json`, `package.json`, `node_modules/` | one repo, one `package.json`, one install |
| One `deploy.settings.json` per project, each with the same FTP credentials | one Vault entry at `%APPDATA%\MindAttic\Deploy\ftp.json` |
| 13 `index.htm` files in 13 repos with marker blocks            | rendered artifacts in `out/`     |
| `sync-landing-page.ps1` + `sync-claudia.ps1` + `sync-chimesh.ps1` + 9 entries in `subscribers.json` | zero sync scripts, zero splice for landing pages (subfolder-guide profiles still call UiUx sync) |
| Per-project `.claude/commands/deploy.md` doing real work       | per-project shim -> `MindAttic.Deploy/bin/deploy.ps1 --only <slug>` |

Components are loaded via CDN (`jsDelivr`) at runtime instead of being inlined per subscriber. Editing a font or the Cyberspace engine no longer requires a 13-target sync — push to MindAttic.UIUX, bump `componentsVersion` here if you want to pin, redeploy.

---

## Roadmap

See `CLAUDE.md` for the in-flight migration plan.

- [x] Catalog landing pages (11 README-driven sites) — done in the original Catalog repo.
- [x] Rename `MindAttic.Catalog` -> `MindAttic.Deploy` on disk.
- [ ] Add `bin/deploy.ps1` wrapper.
- [ ] Move FTP credentials to `%APPDATA%\MindAttic\Deploy\ftp.json` via MindAttic.Vault; retire `secrets/ftp.json`.
- [ ] Generalise `deploy.js` to dispatch by `profiles[].type` (currently: hard-coded `projects[]` for catalog, `sites[]` for root-site).
- [ ] Port ChiMesh + Claudia subfolder build guides.
- [x] Port mindattic.com, MindAtticCares, and ryandebraal.com root-site deploys — `--site <slug>` / `--sites`.
- [x] Replace every per-project `.claude/skills/deploy/SKILL.md` (and `commands/deploy.md`) with shims that call `MindAttic.Deploy`. Both catalog projects (`--only <slug>`) and Blazor app projects (`--app <slug>`) now point here.
- [x] Add `apps[]` + `--app` / `--apps` / `--dry-run` for Blazor/GitHub-Actions-driven deploys. StreetSamurai is enabled; IdiotProof, TaxRateCollector, ThinkTank, Tutor are stubbed (disabled with notes).
- [x] Delete orphaned local deploy files (`scripts/cli/deploy.*`, `deploy.settings.json*`, root-site `deploy.{bat,ps1}` + `settings.json`) across every MindAttic project; update Vault settings.json `runCommand` entries (the 3 root sites no longer prefix `deploy.bat &&`). Per-repo `git rm` + commit; user pushes.
- [x] `MindAttic.Deploy.Cli` (C# console app modelled on MindAttic.Console). Spectre.Console.Cli, `net10.0`. Commands: `catalog`, `site`, `app`, `version`. Default (no args) is an interactive multi-select prompt grouping catalog + sites + apps. Shells into the canonical `node src/deploy.js` pipeline.

`StreetSamurai` stays Azure-CI-deployed. `MindAttic.UiUx`'s `/deploy` (component fanout) stays where it is.
