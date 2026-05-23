# MindAttic.Catalog Project Rules

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
- `npm run build` -- regenerate `out/<slug>/index.htm` for every project.
- `npm run build -- --only mindatticvault` -- single project.
- `npm run build -- --from-github --ref main` -- force-fetch READMEs from GitHub (default reads from `D:\Projects\MindAttic\<repo>\README.md` if present).
- `npm run deploy` -- build then FTPS upload everything.
- `npm run deploy -- --only mindatticvault --skip-build` -- single-project redeploy without rebuilding.

## Adding a new landing page
1. Append a project block to `projects.json` (`slug`, `repo`, `title`, `tagline`).
2. `npm run deploy -- --only <slug>` -- builds and pushes only the new one.

That is the entire procedure. No scaffold script, no per-project `scripts/cli/`, no marker blocks.

## Removing a landing page
1. Remove the block from `projects.json`. The next deploy stops touching it (the server copy stays until you delete the directory on the FTP host).

## Credentials
- Local: `secrets/ftp.json` (gitignored). Real value committed to `secrets/ftp.json` already in the dev environment.
- CI: GitHub Actions secret `MINDATTIC_FTP_JSON` whose value is the entire JSON object. `deploy.js` reads it from env when present.
