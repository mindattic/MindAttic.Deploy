# MindAttic.Deploy

**One pipeline. Every MindAttic site. One credential file.**

Every FTP-deployed MindAttic site — the `mindattic.com` root, every `mindattic.com/<slug>.htm` catalog landing page, the long-form build guides (Claudia, ChiMesh), `mindatticcares.com`, and `ryandebraal.com` — is built and uploaded from this one repo. No `scripts/cli/` machinery in each project. No per-project `deploy.ps1`. No duplicated credentials.

---

## Quick start

```bash
npm install
npm run build                          # render every catalog page -> out/
npm run deploy                         # FTPS-upload all catalog pages
npm run deploy -- --only mindatticvault   # just one catalog page
```

The C# CLI (`MindAttic.Deploy.exe`) wraps the same Node pipeline with an interactive multi-select menu and typed subcommands. Build it with `dotnet build` (`net10.0`, version `1.0.0`).

---

## What's in scope

Anything that ships via FTP or GitHub Actions CI:

| Array in `projects.json` | Examples | Remote |
|---|---|---|
| `projects[]` — catalog landing page (README → `<slug>.htm`) | idiotproof, mindatticlegion, mindatticvault, taxratecollector, thinktank, tutor, mediabutler, gridgame2026, mindatticpsst | `/mindattic.com/<slug>.htm` |
| `projects[]` — long-form build guide (Cyberspace theme + parts-picker) | claudia, chimesh | `/mindattic.com/<slug>.htm` |
| `sites[]` — verbatim root-site FTP upload | mindattic.com, mindatticcares.com, ryandebraal.com | site root |
| `apps[]` — Blazor / GitHub-Actions deploys (CI does the actual push) | prose, cursory, personagallery (enabled); idiotproof, taxratecollector, thinktank, tutor, mindattic.frontpage (disabled pending Azure infra) | — |

**Not in this repo.**
- `MindAttic.UiUx` owns the component sources (fonts, Cyberspace effects, BackHomeM, PinFooter) and the marker-block sync for three subscribers that need build-time splice (`mindattic.com/index.htm`, `Prose/wwwroot/`, `MindAttic.Psst/{terms,privacy}.htm`). This repo invokes those splice scripts as `preDeploy` hooks.
- `FractionsOfACent` is a Blazor/CLI scientific app, not an FTP landing page; it has no entry here.

---

## Layout

```
projects.json              canonical registry (projects[], sites[], apps[], componentsVersion)
template/
  index.template.htm       HTML shell for every catalog landing page
src/
  build.js                 README → out/<slug>.htm renderer (marked + highlight.js)
  parts.js                 optional parts-picker augmentation for ChiMesh / Claudia
  deploy.js                FTPS uploader (basic-ftp); runs build implicitly
MindAttic.Deploy.Cli/      C# console app (Spectre.Console.Cli, net10.0)
secrets/
  ftp.json                 gitignored FTP credentials (template: ftp.json.template)
out/                       generated artifacts (gitignored)
.github/workflows/
  deploy.yml               build + deploy all projects on push to main
```

---

## How it works

1. **`projects.json`** has three arrays: `projects[]` (catalog landing pages), `sites[]` (verbatim root-site FTP uploads), and `apps[]` (Blazor / GitHub-Actions deploys). It also holds `componentsVersion` — the jsDelivr ref pinned for MindAttic.UiUx components and themes.
2. **`template/index.template.htm`** is the canonical HTML shell for every `projects[]` entry. `{{PLACEHOLDER}}` substitution, CDN-loaded MindAttic.UiUx components and themes.
3. **`src/build.js`** fetches each `projects[]` entry's `README.md` (from the local sibling repo on dev, or the GitHub raw API in CI), renders it through the template, and writes `out/<slug>.htm`. It also auto-discovers every public non-archived `mindattic` GitHub repo with a README (pass `--no-discover` to skip).
4. **`src/deploy.js`** picks the right handler (catalog project, root site, or Blazor app), runs `preDeploy` hooks (`uiux-pull`, `powershell`, `dotnet-build`, `fetch-descriptions`), and FTPS-uploads to the configured remote path.

Per-project `/deploy` slash commands shell into this repo:

```bash
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --only <slug>
# or for Blazor apps:
cd D:\Projects\MindAttic\MindAttic.Deploy && npm run deploy -- --app <slug>
```

---

## C# CLI (`MindAttic.Deploy.exe`)

Interactive by default; subcommands for non-interactive use:

| Command | What it does |
|---|---|
| `MindAttic.Deploy` | Interactive multi-select menu (catalog + sites + apps) |
| `MindAttic.Deploy catalog [--only <slug>] [--skip-build] [--dry-run]` | Deploy catalog landing pages |
| `MindAttic.Deploy site --slug <slug>` / `--all` | Deploy root sites |
| `MindAttic.Deploy app --slug <slug>` / `--all` `[--dry-run]` | Deploy Blazor / GitHub-Actions apps |
| `MindAttic.Deploy all [--dry-run]` | Deploy every target (catalog + sites + apps) |
| `MindAttic.Deploy list` | Print all targets with slugs and status |
| `MindAttic.Deploy version` | Print version and exe path |

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
  Then: `npm run deploy -- --only newproject`. (`theme` must match a folder under `MindAttic.UiUx/Themes/` — today `Cyberspace` is the only theme; Hardware was retired 2026-05-29.)

- **Verbatim root site**: append to `sites[]` with `sourceDir`, `ftpRemotePath`, and `files[]`. Then: `npm run deploy -- --site <slug>`.

- **Blazor / GitHub-Actions app**: append to `apps[]` with `repo`, `branch`, `workflow`, and `preDeploy` hooks. Then: `npm run deploy -- --app <slug>`.

---

## Credentials

FTP credentials are resolved by `deploy.js` in this order:

1. **`MINDATTIC_FTP_JSON` env var** — the entire JSON object as one value (CI).
2. **`secrets/ftp.json`** — gitignored local file (use `ftp.json.template` as the starting point).

| Where | What |
|-------|------|
| Local | `secrets/ftp.json` (gitignored) |
| CI    | GitHub Actions secret `MINDATTIC_FTP_JSON` |
| READMEs | Public repos: anonymous fetch. Private repos: set `SUBSCRIBER_REPO_TOKEN` or `GITHUB_TOKEN`. |

---

## Component versioning

`projects.json → componentsVersion` pins the jsDelivr ref for MindAttic.UiUx. Use a whole-number tag like `"V4"` for immutable cache hits in production (never SemVer: `V1`, `V2`, `V3`, …). Bumping this is how a font or Cyberspace-effect change propagates to every catalog landing page on the next deploy.
