# MindAttic.Deploy Project Rules

## Conversation
- A bare "do" / "do it" / "yes" from the user means "continue", "keep going", "proceed". Resume the current task without asking for clarification.

## What this is
- Single-source generator + FTPS deployer for every `mindattic.com/<slug>/` landing page.
- Replaces the per-project `scripts/cli/build-html.js` + `deploy.ps1` + `deploy.bat` + `deploy.settings.json` + `package.json` + `node_modules/` machinery that used to live in each of the 13 README-driven projects.
- Replaces the `kind: "landing-page"` and `kind: "build-html-js"` paths in `MindAttic.UIUX/subscribers.json` and the corresponding `sync-landing-page.ps1` / `sync-claudia.ps1` / `sync-chimesh.ps1` splice machinery.

## Layout
- `projects.json` -- canonical list of every landing page (slug, repo, title, tagline). Edit ONLY this to add/remove/retag a project.
- `template/index.template.htm` -- the single canonical landing-page HTML. Uses `{{PLACEHOLDER}}` substitution and CDN-loaded MindAttic.UIUX.
- `src/build.js` -- README -> out/&lt;slug&gt;/index.htm renderer (marked + highlight.js).
- `src/deploy.js` -- FTPS uploader (basic-ftp); runs build implicitly unless `--skip-build`.
- `secrets/ftp.json` -- gitignored FTP credentials (template at `ftp.json.template`).
- `out/` -- generated artifacts (gitignored).
- `.github/workflows/deploy.yml` -- build + deploy all projects on push to `main` or `workflow_dispatch`.

## Editing rules
- **Project metadata (title / tagline / new project / removed project)**: edit `projects.json` only.
- **Visual design / layout of every landing page**: edit `template/index.template.htm`. All 13 sites change on the next deploy.
- **README content of a project**: edit the README in that project's repo. The catalog fetches it at build time (sibling dir on dev box, GitHub raw URL in CI).
- **Reusable components (fonts, Cyberspace, BackHomeM)**: edit in `MindAttic.UIUX/` and bump `componentsVersion` in `projects.json` to pin landing pages to a new ref.
- **Per-project index.htm in the project's own repo**: should not exist after the migration. If you find one, it is a derived artifact; delete it.

## Commands
- `npm run build` -- regenerate `out/<slug>/index.htm` for every catalog project.
- `npm run build -- --only mindatticvault` -- single catalog project.
- `npm run build -- --from-github --ref main` -- force-fetch READMEs from GitHub (default reads from `D:\Projects\MindAttic\<repo>\README.md` if present).
- `npm run deploy` -- build then FTPS upload every catalog project (does NOT touch `sites[]`).
- `npm run deploy -- --only mindatticvault --skip-build` -- single catalog project redeploy without rebuilding.
- `npm run deploy -- --site mindattic.com` -- deploy a single root site (runs that site's preDeploy hooks + stamp + FTPS upload).
- `npm run deploy -- --sites` -- deploy every root site in `projects.json/sites[]`.
- `npm run deploy -- --app streetsamurai` -- deploy a single Blazor app via GitHub Actions (preDeploy hooks + commit `stageOnly` paths + push the configured branch, which fires the project's workflow).
- `npm run deploy -- --apps` -- deploy every enabled app in `projects.json/apps[]`.
- `npm run deploy -- --app streetsamurai --dry-run` -- run preDeploy hooks + report the planned commit/push without executing them. Useful for sanity-checking a sync + build before pushing master.

## Root sites (`projects.json/sites[]`)
- Verbatim FTPS uploads — NOT rendered through `template/index.template.htm`. Each entry: `slug`, `sourceDir` (relative to MindAttic.Deploy repo root), `ftpRemotePath`, `files` (glob like `*.htm` or exact name), `stampFile` (which file gets the `<!-- Last Updated: ... -->` stamp), and optional `preDeploy[]` hooks.
- The per-site `deploy.ps1` / `deploy.bat` / `settings.json` in each root-site repo are dead after migration -- credentials come from MindAttic.Deploy's central `secrets/ftp.json`.

## Apps (`projects.json/apps[]`)
- GitHub-Actions-driven deploys. Currently 5 entries: StreetSamurai (enabled, ships to Azure App Service via push-to-master) + IdiotProof / TaxRateCollector / ThinkTank / Tutor (all `disabled: true` pending Azure infra + `AZURE_WEBAPP_PUBLISH_PROFILE` secret).
- Each entry: `slug`, `sourceDir`, `repo` (owner/name), `branch`, `workflow` (file name in `.github/workflows/`), `disabled` (bool), `disabledNote` (string), `stageOnly` (paths to `git add` before commit; empty = nothing to stage), `commitMessage` (template, `{utc}` is substituted), `preDeploy[]`.
- preDeploy hook kinds: `uiux-pull`, `powershell`, `dotnet-build` (runs `dotnet build <project> -c <configuration> --nologo`; non-zero exit fails the deploy unless `required: false`).
- Disabled apps: `--app <slug>` prints the `disabledNote` and exits 0. To enable, set `disabled: false`.

## Per-project `/deploy` shims
Every MindAttic project's `/deploy` slash command (slash or skill) now shims into `MindAttic.Deploy`. One `/deploy` per project. Two patterns:
- **App projects** (StreetSamurai, IdiotProof, TaxRateCollector, ThinkTank, Tutor): `/deploy` -> `npm run deploy -- --app <slug>` (deploys the APP).
- **Catalog-only projects** (everything else): `/deploy` -> `npm run deploy -- --only <slug>` (deploys the landing page).
Catalog landing pages for the 4 disabled-app projects are deployed centrally from MindAttic.Deploy (`npm run deploy -- --only <slug>`), NOT from each project's `/deploy`.

## Adding a new landing page
1. Append a project block to `projects.json` (`slug`, `repo`, `title`, `tagline`, `theme`). Valid themes today: `Cyberspace` (default for software projects) or `Hardware` (Claudia, ChiMesh).
2. `npm run deploy -- --only <slug>` -- builds and pushes only the new one.

That is the entire procedure. No scaffold script, no per-project `scripts/cli/`, no marker blocks.

## Removing a landing page
1. Remove the block from `projects.json`. The next deploy stops touching it; the server copy of `mindattic.com/<slug>.htm` stays until you manually FTP-delete it. (For projects migrated from the old 3-file subfolder pipeline -- Claudia, ChiMesh -- the legacy `mindattic.com/<slug>/` subdirectory also lingers until deleted.)

## Credentials
- Local: `secrets/ftp.json` (gitignored). Real value committed to `secrets/ftp.json` already in the dev environment.
- CI: GitHub Actions secret `MINDATTIC_FTP_JSON` whose value is the entire JSON object. `deploy.js` reads it from env when present.
