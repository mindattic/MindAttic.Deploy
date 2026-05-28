#!/usr/bin/env node
/*
 * deploy.js -- three pipelines under one roof.
 *
 *   Catalog landing pages (default):
 *     For each project in projects.json.projects, FTPS-upload
 *     out/<slug>.htm to <ftpRemoteRoot>/<slug>.htm.
 *
 *   Root sites (--site / --sites):
 *     For each site in projects.json.sites, run preDeploy hooks,
 *     stamp index.htm with a Last Updated timestamp, then FTPS-upload
 *     the configured files glob to the site's ftpRemotePath.
 *
 *   Apps (--app / --apps):
 *     For each app in projects.json.apps (Blazor / GitHub-Actions-driven),
 *     run preDeploy hooks (uiux-pull, powershell, dotnet-build), stage
 *     any `stageOnly` paths, commit (if staged changes), and push the
 *     configured branch. The push triggers the project's existing
 *     .github/workflows/<workflow>.yml. Disabled apps print their note
 *     and skip without firing.
 *
 * Flags (also accept `--flag=value` form):
 *   --only <slug>          : catalog mode -- deploy a landing page; repeatable for a batch
 *   --site <slug>          : site mode    -- deploy a single root site
 *   --sites                : site mode    -- deploy every root site
 *   --app <slug>           : app mode     -- deploy a single Blazor app (via GitHub Actions)
 *   --apps                 : app mode     -- deploy every ENABLED app (use --include-disabled to surface stubs)
 *   --include-disabled     : app mode     -- include `disabled: true` apps in --apps iteration
 *   --dry-run              : any mode     -- preview without firing: app skips commit/push; site skips stamp+FTP; catalog still builds but skips FTP
 *   --skip-build           : catalog mode -- skip the implicit build step
 *
 * Credentials live in secrets/ftp.json (or MINDATTIC_FTP_JSON env in CI).
 */

'use strict';

const fs            = require('fs');
const fsp           = require('fs/promises');
const path          = require('path');
const child_process = require('child_process');
const ftp           = require('basic-ftp');

const repoRoot     = path.resolve(__dirname, '..');
const projectsPath = path.join(repoRoot, 'projects.json');
const secretsPath  = path.join(repoRoot, 'secrets', 'ftp.json');
const outRoot      = path.join(repoRoot, 'out');

// Normalize argv: split `--foo=bar` into `--foo` `bar` so the simple parser below works.
const argv = process.argv.slice(2).flatMap((a) => {
    if (a.startsWith('--') && a.includes('=')) {
        const eq = a.indexOf('=');
        return [a.slice(0, eq), a.slice(eq + 1)];
    }
    return [a];
});

const USAGE = `\
deploy.js -- three pipelines under one roof (catalog / sites / apps).

Flags (also accept --flag=value form):
  --only <slug>        catalog mode: deploy a landing page (repeatable)
  --site <slug>        site mode:    deploy a single root site
  --sites              site mode:    deploy every root site
  --app <slug>         app mode:     deploy a single Blazor app via GitHub Actions
  --apps               app mode:     deploy every enabled app
  --include-disabled   app mode:     include disabled apps in --apps iteration
  --dry-run            preview without firing (no FTP, no git push)
  --skip-build         catalog mode: skip the implicit build step

  Forwarded to src/build.js (catalog mode only):
  --from-github        force README fetch from GitHub raw (used in CI)
  --ref <branch|tag>   git ref for README fetch
  --siblings-root <p>  override sibling-repo lookup root
  --themes-root <p>    path to MindAttic.UiUx/Themes
  --components <ref>   override the MindAttic.UiUx CDN ref pinned in projects.json

  --help, -h           show this help and exit

Run: node src/deploy.js [flags]
`;

if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
}

// Reject unknown flags up front. The original parser ignored anything it did
// not recognize, so `node src/deploy.js --help` silently ran a full FTPS
// deploy of every catalog landing page. Fail loudly instead.
const KNOWN_FLAGS = new Set([
    'only', 'site', 'sites', 'app', 'apps', 'include-disabled', 'dry-run', 'skip-build',
    // Forwarded to build.js when running catalog mode (CI uses --from-github).
    'from-github', 'ref', 'siblings-root', 'themes-root', 'components',
    'help',
]);
const VALUE_FLAGS = new Set(['only', 'site', 'app', 'ref', 'siblings-root', 'themes-root', 'components']);
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
        const name = a.slice(2);
        if (!KNOWN_FLAGS.has(name)) {
            process.stderr.write(`deploy.js: unknown flag --${name}\n\n${USAGE}`);
            process.exit(2);
        }
        if (VALUE_FLAGS.has(name)) i++;
    } else if (a.startsWith('-') && a !== '-') {
        process.stderr.write(`deploy.js: unknown flag ${a}\n\n${USAGE}`);
        process.exit(2);
    }
}

function boolFlag(name) {
    return argv.includes('--' + name);
}

function stringFlag(name) {
    const i = argv.indexOf('--' + name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
        throw new Error(`Flag --${name} requires a value (got ${v === undefined ? 'end of args' : 'another flag: ' + v}).`);
    }
    return v;
}

function flagAll(name) {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== '--' + name) continue;
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) {
            throw new Error(`Flag --${name} requires a value.`);
        }
        out.push(v);
    }
    return out;
}

const onlySlugs       = flagAll('only');
const siteSlug        = stringFlag('site');
const allSites        = boolFlag('sites');
const appSlug         = stringFlag('app');
const allApps         = boolFlag('apps');
const dryRun          = boolFlag('dry-run');
const skipBuild       = boolFlag('skip-build');
const includeDisabled = boolFlag('include-disabled');

// Single FTPS connect path for both catalog and site mode. Validates the
// server certificate by default; a legacy/self-signed host can opt out by
// setting "rejectUnauthorized": false in secrets/ftp.json.
function accessFtp(client, ftpCfg) {
    return client.access({
        host:     ftpCfg.host,
        port:     ftpCfg.port || 21,
        user:     ftpCfg.user,
        password: ftpCfg.password,
        secure:   ftpCfg.secure !== false,
        secureOptions: { rejectUnauthorized: ftpCfg.rejectUnauthorized !== false },
    });
}

function loadFtpSettings() {
    if (process.env.MINDATTIC_FTP_JSON) {
        try { return JSON.parse(process.env.MINDATTIC_FTP_JSON); }
        catch (e) { throw new Error('MINDATTIC_FTP_JSON env var is not valid JSON: ' + e.message); }
    }
    if (!fs.existsSync(secretsPath)) {
        throw new Error(`secrets/ftp.json not found. Copy ftp.json.template -> ftp.json and fill in credentials, or set MINDATTIC_FTP_JSON.`);
    }
    return JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
}

function runBuild() {
    return new Promise((resolve, reject) => {
        const args = ['src/build.js'];
        for (const slug of onlySlugs) args.push('--only', slug);
        // Forward every build-relevant flag we accept. Previously only --only
        // was forwarded, so CI's `--from-github` was a silent no-op.
        if (boolFlag('from-github')) args.push('--from-github');
        const passthroughString = ['ref', 'siblings-root', 'themes-root', 'components'];
        for (const name of passthroughString) {
            const v = stringFlag(name);
            if (v !== undefined) args.push('--' + name, v);
        }
        const proc = child_process.spawn(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
        proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`build.js exited ${code}`)));
        proc.on('error', reject);
    });
}

// --- site-mode helpers ------------------------------------------------------

function expandFiles(sourceDir, patterns) {
    const all = fs.readdirSync(sourceDir).filter((f) => {
        try { return fs.statSync(path.join(sourceDir, f)).isFile(); }
        catch (_) { return false; }
    });
    const out = new Set();
    for (const pat of patterns) {
        if (pat.includes('*')) {
            // Escape every regex metacharacter except `*`, then turn `*` into `.*`.
            // (Previously only `.` was escaped, so a glob with e.g. `+` or `(` would
            // be interpreted as a regex operator rather than a literal.)
            const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            all.filter((f) => re.test(f)).forEach((f) => out.add(f));
        } else if (fs.existsSync(path.join(sourceDir, pat))) {
            out.add(pat);
        }
    }
    return [...out].sort();
}

function stampIndex(absFile) {
    const date  = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const stamp = `<!-- Last Updated: ${date} -->`;
    let content = fs.readFileSync(absFile, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const re = /^(?:﻿?<!--\s*Last Updated:.*?-->(?:\r?\n))+/s;
    if (re.test(content)) {
        content = content.replace(re, `${stamp}\r\n`);
    } else {
        content = `${stamp}\r\n${content}`;
    }
    fs.writeFileSync(absFile, content, 'utf8');
    return date;
}

function runUiuxPull() {
    const uiuxRoot = path.resolve(repoRoot, '..', 'MindAttic.UiUx');
    if (!fs.existsSync(path.join(uiuxRoot, '.git'))) {
        throw new Error(`MindAttic.UiUx is not a git repo at ${uiuxRoot}. Clone https://github.com/mindattic/MindAttic.UiUx.git into that folder before re-running deploy.`);
    }
    process.stdout.write(`  [hook] git -C ${uiuxRoot} pull --no-edit --no-rebase\n`);
    const r = child_process.spawnSync('git', ['-C', uiuxRoot, 'pull', '--no-edit', '--no-rebase'], { stdio: 'inherit' });
    if (r.status !== 0) {
        throw new Error(`git pull on MindAttic.UiUx failed (exit ${r.status}). Resolve the conflict / uncommitted changes and re-run.`);
    }
}

function runPowershellHook(file, args) {
    const abs = path.resolve(repoRoot, file);
    if (!fs.existsSync(abs)) {
        throw new Error(`PowerShell script not found: ${abs}`);
    }
    const resolvedArgs = (args || []).map((a) => {
        if (a.startsWith('-') || path.isAbsolute(a)) return a;
        if (a.includes('/') || a.includes('\\') || a.startsWith('..')) return path.resolve(repoRoot, a);
        return a;
    });
    process.stdout.write(`  [hook] powershell -File ${abs}${resolvedArgs.length ? ' ' + resolvedArgs.join(' ') : ''}\n`);
    const r = child_process.spawnSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', abs, ...resolvedArgs],
        { stdio: 'inherit' }
    );
    return r.status;
}

function runDotnetBuildHook(project, configuration) {
    const abs = path.resolve(repoRoot, project);
    if (!fs.existsSync(abs)) {
        throw new Error(`dotnet project not found: ${abs}`);
    }
    const cfg = configuration || 'Release';
    process.stdout.write(`  [hook] dotnet build ${abs} -c ${cfg}\n`);
    const r = child_process.spawnSync('dotnet', ['build', abs, '-c', cfg, '--nologo'], { stdio: 'inherit' });
    return r.status;
}

async function executePreDeploy(profile) {
    for (const hook of profile.preDeploy || []) {
        const required = hook.required !== false;
        try {
            if (hook.kind === 'uiux-pull') {
                runUiuxPull();
            } else if (hook.kind === 'powershell') {
                const code = runPowershellHook(hook.file, hook.args);
                if (code !== 0) throw new Error(`hook exited ${code}`);
            } else if (hook.kind === 'dotnet-build') {
                const code = runDotnetBuildHook(hook.project, hook.configuration);
                if (code !== 0) throw new Error(`hook exited ${code}`);
            } else {
                throw new Error(`Unknown preDeploy kind: ${hook.kind}`);
            }
        } catch (e) {
            if (required) throw e;
            process.stdout.write(`  [hook] (optional) ${e.message} -- continuing\n`);
        }
    }
}

async function deployOneSite(client, site) {
    const sourceDir = path.resolve(repoRoot, site.sourceDir);
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`sourceDir not found for site '${site.slug}': ${sourceDir}`);
    }

    process.stdout.write(`\nSite: ${site.slug}  (${sourceDir} -> ${site.ftpRemotePath})${dryRun ? '  [DRY-RUN]' : ''}\n`);

    if (dryRun && (site.preDeploy || []).length > 0) {
        process.stdout.write(`  [dry-run] note: preDeploy hooks still RUN (git pull / build / sync scripts may mutate state); only the stamp + FTP upload are skipped.\n`);
    }
    await executePreDeploy(site);

    const rawRemote = site.ftpRemotePath || '/';
    const remoteDir = rawRemote === '/' ? '/' : rawRemote.replace(/\/$/, '');
    const files = expandFiles(sourceDir, site.files || ['index.htm']);

    if (dryRun) {
        if (site.stampFile) process.stdout.write(`  [stamp] (dry-run) would stamp ${site.stampFile}\n`);
        for (const f of files) {
            const remoteShown = remoteDir === '/' ? `/${f}` : `${remoteDir}/${f}`;
            process.stdout.write(`  [ftp]   (dry-run) would upload ${f.padEnd(24)} -> ${remoteShown}\n`);
        }
        return { uploaded: 0, failed: 0 };
    }

    if (site.stampFile) {
        const stampPath = path.join(sourceDir, site.stampFile);
        if (fs.existsSync(stampPath)) {
            const date = stampIndex(stampPath);
            process.stdout.write(`  [stamp] ${site.stampFile} <- ${date}\n`);
        } else {
            process.stdout.write(`  [stamp] (skipped: ${site.stampFile} not found in ${sourceDir})\n`);
        }
    }

    if (files.length === 0) {
        process.stdout.write(`  [warn] no files matched ${JSON.stringify(site.files)} in ${sourceDir}\n`);
        return { uploaded: 0, failed: 0 };
    }

    await client.ensureDir(remoteDir);

    let uploaded = 0, failed = 0;
    for (const f of files) {
        const localPath = path.join(sourceDir, f);
        try {
            await client.uploadFrom(localPath, f);
            const size = fs.statSync(localPath).size;
            const remoteShown = remoteDir === '/' ? `/${f}` : `${remoteDir}/${f}`;
            process.stdout.write(`  [ok]   ${f.padEnd(24)} ${String(size).padStart(7)} bytes -> ${remoteShown}\n`);
            uploaded++;
        } catch (e) {
            process.stdout.write(`  [FAIL] ${f.padEnd(24)} ${e.message}\n`);
            failed++;
        }
    }
    return { uploaded, failed };
}

// --- app mode (Blazor apps / GitHub-Actions-driven deploys) -----------------

function gitSync(sourceDir, args, opts) {
    const r = child_process.spawnSync('git', ['-C', sourceDir, ...args], { stdio: opts?.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function deployOneApp(app) {
    const sourceDir = path.resolve(repoRoot, app.sourceDir);
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`sourceDir not found for app '${app.slug}': ${sourceDir}`);
    }

    process.stdout.write(`\nApp: ${app.slug}  (${sourceDir} -> ${app.repo}@${app.branch})\n`);

    if (app.disabled) {
        process.stdout.write(`  [disabled] ${app.disabledNote || 'Deploy profile is disabled.'}\n`);
        return { fired: false, disabled: true };
    }

    if (dryRun && (app.preDeploy || []).length > 0) {
        process.stdout.write(`  [dry-run] note: preDeploy hooks still RUN (uiux-pull / dotnet build / sync scripts may mutate state or upload assets); only the git commit + push are skipped.\n`);
    }
    await executePreDeploy(app);

    if (Array.isArray(app.stageOnly) && app.stageOnly.length > 0) {
        for (const p of app.stageOnly) {
            process.stdout.write(`  [git] add ${p}\n`);
            const a = gitSync(sourceDir, ['add', '--', p]);
            if (a.status !== 0) throw new Error(`git add ${p} failed (exit ${a.status})`);
        }
    }

    const st = gitSync(sourceDir, ['status', '--porcelain'], { capture: true });
    if (st.status !== 0) throw new Error(`git status failed (exit ${st.status})`);
    const hasStaged = st.stdout.split('\n').some((line) => line.length > 0 && line[0] !== ' ' && line[0] !== '?');

    if (hasStaged) {
        const msgTemplate = app.commitMessage || `Deploy via MindAttic.Deploy ({utc})`;
        const utc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const msg = msgTemplate.replace('{utc}', utc);
        if (dryRun) {
            process.stdout.write(`  [git] (dry-run) commit -m "${msg}"\n`);
        } else {
            process.stdout.write(`  [git] commit -m "${msg}"\n`);
            const c = gitSync(sourceDir, ['commit', '-m', msg]);
            if (c.status !== 0) throw new Error(`git commit failed (exit ${c.status})`);
        }
    } else {
        process.stdout.write(`  [git] no staged changes; will push existing branch HEAD\n`);
    }

    const branch = app.branch || 'main';
    if (dryRun) {
        process.stdout.write(`  [git] (dry-run) push origin ${branch}\n`);
    } else {
        process.stdout.write(`  [git] push origin ${branch}\n`);
        const p = gitSync(sourceDir, ['push', 'origin', branch]);
        if (p.status !== 0) throw new Error(`git push origin ${branch} failed (exit ${p.status})`);
    }

    const actionsUrl = `https://github.com/${app.repo}/actions/workflows/${app.workflow}`;
    process.stdout.write(`  [actions] ${actionsUrl}\n`);
    return { fired: !dryRun, disabled: false, actionsUrl };
}

async function runAppMode(config) {
    const apps = config.apps || [];
    if (apps.length === 0) throw new Error('projects.json has no `apps` array.');
    let targets = apps;
    if (appSlug) {
        targets = apps.filter((a) => a.slug === appSlug);
        if (targets.length === 0) {
            throw new Error(`No app with slug '${appSlug}' (available: ${apps.map((a) => a.slug).join(', ')}).`);
        }
    } else if (allApps && !includeDisabled) {
        // --apps without explicit slug: skip disabled apps so the user does not accidentally fire a
        // real push to master via --apps thinking it would be a no-op for everything.
        const skipped = apps.filter((a) => a.disabled).map((a) => a.slug);
        targets = apps.filter((a) => !a.disabled);
        if (skipped.length > 0) {
            process.stdout.write(`\nSkipping ${skipped.length} disabled app(s): ${skipped.join(', ')}  [pass --include-disabled to surface their notes]\n`);
        }
        if (targets.length === 0) {
            process.stdout.write(`\nNo enabled apps in projects.json/apps[].\n`);
            return;
        }
    }

    process.stdout.write(`\nDeploying ${targets.length} app(s)${dryRun ? '  [DRY-RUN]' : ''}\n`);

    let fired = 0, disabled = 0, errors = 0;
    for (const app of targets) {
        try {
            const r = await deployOneApp(app);
            if (r.fired) fired++;
            else if (r.disabled) disabled++;
        } catch (e) {
            errors++;
            process.stdout.write(`\n  [APP FAIL] ${app.slug}: ${e.message}\n`);
        }
    }
    process.stdout.write(`\nDone. ${fired} fired, ${disabled} disabled, ${errors} errored.\n`);
    if (errors > 0) process.exit(1);
}

// --- catalog mode (unchanged behavior) --------------------------------------

async function uploadOne(client, project, ftpRemoteRoot) {
    const localFile  = path.join(outRoot, `${project.slug}.htm`);
    if (!fs.existsSync(localFile)) {
        throw new Error(`out/${project.slug}.htm not found. Run build first.`);
    }
    const remoteRoot = ftpRemoteRoot.replace(/\/$/, '');
    const remoteFile = `${remoteRoot}/${project.slug}.htm`;

    // The caller runs ensureDir(remoteRoot) once before the loop, leaving the
    // FTP working dir there, so each upload is just a relative put. (Previously
    // ensureDir fired once per project — redundant since the root is shared.)
    await client.uploadFrom(localFile, `${project.slug}.htm`);
    const size = (await fsp.stat(localFile)).size;
    return { slug: project.slug, remoteFile, size };
}

// --- main -------------------------------------------------------------------

async function runSiteMode(config) {
    const sites = config.sites || [];
    if (sites.length === 0) {
        throw new Error('projects.json has no `sites` array.');
    }
    let targets = sites;
    if (siteSlug) {
        targets = sites.filter((s) => s.slug === siteSlug);
        if (targets.length === 0) {
            throw new Error(`No site with slug '${siteSlug}' in projects.json (available: ${sites.map((s) => s.slug).join(', ')}).`);
        }
    }

    const ftpCfg = dryRun ? null : loadFtpSettings();
    const client = new ftp.Client(60_000);
    client.ftp.verbose = false;

    process.stdout.write(`\nDeploying ${targets.length} site(s)${dryRun ? '  [DRY-RUN -- no FTP connect, no uploads]' : ` via ftp://${ftpCfg.host}:${ftpCfg.port || 21}/`}\n`);

    let totalUploaded = 0, totalFailed = 0;
    const siteErrors = [];
    try {
        if (!dryRun) {
            await accessFtp(client, ftpCfg);
        }
        for (const site of targets) {
            try {
                const r = await deployOneSite(client, site);
                totalUploaded += r.uploaded;
                totalFailed   += r.failed;
            } catch (e) {
                siteErrors.push({ slug: site.slug, error: e.message });
                process.stdout.write(`\n  [SITE FAIL] ${site.slug}: ${e.message}\n`);
            }
        }
    } finally {
        client.close();
    }

    process.stdout.write(`\nDone. ${totalUploaded} uploaded, ${totalFailed} failed${siteErrors.length ? `, ${siteErrors.length} site(s) errored before upload` : ''}.\n`);
    if (totalFailed > 0 || siteErrors.length > 0) process.exit(1);
}

async function runCatalogMode(config) {
    const ftpRemoteRoot = config.ftpRemoteRoot || '/mindattic.com';

    let projects = config.projects;
    if (onlySlugs.length > 0) {
        const known = new Set(projects.map((p) => p.slug));
        const missing = onlySlugs.filter((s) => !known.has(s));
        if (missing.length > 0) {
            throw new Error(`Unknown catalog slug(s): ${missing.join(', ')}. Available: ${[...known].join(', ')}.`);
        }
        const wanted = new Set(onlySlugs);
        projects = projects.filter((p) => wanted.has(p.slug));
    }

    if (!skipBuild) await runBuild();

    if (dryRun) {
        process.stdout.write(`\nDeploying ${projects.length} landing page(s)  [DRY-RUN -- no FTP connect, no uploads]\n`);
        const remoteRoot = ftpRemoteRoot.replace(/\/$/, '');
        for (const project of projects) {
            const localFile = path.join(outRoot, `${project.slug}.htm`);
            const exists = fs.existsSync(localFile);
            const size = exists ? fs.statSync(localFile).size : 0;
            const label = exists ? `${String(size).padStart(7)} bytes` : `[missing build artifact]`;
            process.stdout.write(`  [ftp]  (dry-run) would upload ${project.slug.padEnd(18)} ${label} -> ${remoteRoot}/${project.slug}.htm\n`);
        }
        process.stdout.write(`\nDone. ${projects.length} would deploy.\n`);
        return;
    }

    const ftpCfg = loadFtpSettings();
    const client = new ftp.Client(60_000);
    client.ftp.verbose = false;

    process.stdout.write(`\nDeploying ${projects.length} landing page(s) to ftp://${ftpCfg.host}:${ftpCfg.port || 21}${ftpRemoteRoot}/...\n`);

    const failed = [];
    try {
        await accessFtp(client, ftpCfg);
        // All catalog pages share one remote root; navigate into it once.
        await client.ensureDir(ftpRemoteRoot.replace(/\/$/, ''));

        for (const project of projects) {
            try {
                const r = await uploadOne(client, project, ftpRemoteRoot);
                process.stdout.write(`  [ok]   ${r.slug.padEnd(18)} ${String(r.size).padStart(7)} bytes -> ${r.remoteFile}\n`);
            } catch (e) {
                failed.push({ slug: project.slug, error: e.message });
                process.stdout.write(`  [FAIL] ${project.slug.padEnd(18)} ${e.message}\n`);
            }
        }
    } finally {
        client.close();
    }

    if (failed.length) {
        process.stderr.write(`\n${failed.length} project(s) failed to deploy.\n`);
        process.exit(1);
    }
    process.stdout.write(`\nDone. ${projects.length} deployed.\n`);
}

async function main() {
    const config = JSON.parse(await fsp.readFile(projectsPath, 'utf8'));
    if (appSlug || allApps) {
        await runAppMode(config);
    } else if (siteSlug || allSites) {
        await runSiteMode(config);
    } else {
        await runCatalogMode(config);
    }
}

main().catch((e) => {
    process.stderr.write(`deploy.js: ${e.message}\n`);
    process.exit(1);
});
