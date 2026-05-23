# MindAttic.Catalog

**One repo, every landing page. Edit `projects.json`, push, done.**

`mindattic.com/<slug>/` for every software-tagged MindAttic project is generated and deployed from this single repo. No `scripts/cli/` in each project. No `node_modules/` in each project. No marker-block splicing. No cross-repo PR storm.

```bash
npm install
npm run build                          # 13 sites -> out/<slug>/index.htm
npm run deploy                         # FTPS-upload everything
npm run deploy -- --only mindatticvault   # just one
```

---

## How it works

1. **`projects.json`** lists every landing page: `slug`, `repo`, `title`, `tagline`.
2. **`template/index.template.htm`** is one canonical HTML template with `{{PLACEHOLDER}}` substitution and CDN-loaded MindAttic.UIUX (fonts, Cyberspace, BackHomeM).
3. **`src/build.js`** fetches each project's `README.md` (sibling dir on dev box, GitHub raw URL in CI), renders it with `marked` + `highlight.js`, and writes `out/<slug>/index.htm`.
4. **`src/deploy.js`** FTPS-uploads each built file to `/mindattic.com/<slug>/index.htm`.

That is the whole pipeline. There is no per-project state.

---

## Adding a landing page

1. Append a block to `projects.json`:
   ```json
   {
     "slug":    "newproject",
     "repo":    "NewProject",
     "title":   "NewProject",
     "tagline": "One-line description."
   }
   ```
2. `npm run deploy -- --only newproject`

That's it.

---

## Component versioning

`projects.json -> componentsVersion` pins the jsDelivr ref for MindAttic.UIUX. Use `"main"` for tip-of-tree, or a tag like `"v1.0.0"` for immutable cache hits in production.

---

## Credentials

| Where    | What           |
|----------|----------------|
| Local    | `secrets/ftp.json` (gitignored). Template at `secrets/ftp.json.template`. |
| CI       | GitHub Actions secret `MINDATTIC_FTP_JSON` (entire JSON object as one secret). |
| READMEs  | Public repos: anonymous fetch. Private repos: set `SUBSCRIBER_REPO_TOKEN` or `GITHUB_TOKEN`. |

---

## Why this replaces the old pipeline

| Old                                                            | New                              |
|----------------------------------------------------------------|----------------------------------|
| 13 copies of `scripts/cli/build-html.js`                       | one `src/build.js`               |
| 13 copies of `scripts/cli/deploy.ps1` + `deploy.bat`           | one `src/deploy.js`              |
| 13 `scripts/cli/deploy.settings.json` (gitignored creds)       | one `secrets/ftp.json`           |
| 13 `package.json` + `node_modules/`                            | one `package.json` + one install |
| 13 `index.htm` files with marker blocks                        | 13 generated artifacts in `out/` |
| `sync-landing-page.ps1` + `sync-claudia.ps1` + `sync-chimesh.ps1` + 9 landing-page entries in `subscribers.json` | 0 sync scripts, 0 splice |
| Per-project `.claude/skills/deploy/SKILL.md`                   | one `npm run deploy` from one place |

Components are loaded via CDN (`jsDelivr`) at runtime instead of being inlined per subscriber. Editing a font or the Cyberspace engine no longer requires a 13-target sync — push to MindAttic.UIUX, bump `componentsVersion` here if you want to pin, redeploy.
