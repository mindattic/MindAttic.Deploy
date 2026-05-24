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
 * Flags:
 *   --only <slug>   : catalog mode -- deploy a single landing page
 *   --site <slug>   : site mode    -- deploy a single root site
 *   --sites         : site mode    -- deploy every root site
 *   --app <slug>    : app mode     -- deploy a single Blazor app (via GitHub Actions)
 *   --apps          : app mode     -- deploy every enabled app
 *   --dry-run       : app mode     -- run preDeploy hooks + report the planned commit/push without executing them
 *   --skip-build    : catalog mode -- skip the implicit build step
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

const argv = process.argv.slice(2);
function flag(name) {
    const i = argv.indexOf('--' + name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return true;
    return v;
}

const onlySlug  = flag('only');
const siteSlug  = flag('site');
const allSites  = flag('sites') === true;
const appSlug   = flag('app');
const allApps   = flag('apps') === true;
const dryRun    = flag('dry-run') === true;
const skipBuild = flag('skip-build') === true;

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
        if (onlySlug) args.push('--only', onlySlug);
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
            const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
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

    process.stdout.write(`\nSite: ${site.slug}  (${sourceDir} -> ${site.ftpRemotePath})\n`);

    await executePreDeploy(site);

    if (site.stampFile) {
        const stampPath = path.join(sourceDir, site.stampFile);
        if (fs.existsSync(stampPath)) {
            const date = stampIndex(stampPath);
            process.stdout.write(`  [stamp] ${site.stampFile} <- ${date}\n`);
        } else {
            process.stdout.write(`  [stamp] (skipped: ${site.stampFile} not found in ${sourceDir})\n`);
        }
    }

    const files = expandFiles(sourceDir, site.files || ['index.htm']);
    if (files.length === 0) {
        process.stdout.write(`  [warn] no files matched ${JSON.stringify(site.files)} in ${sourceDir}\n`);
        return { uploaded: 0, failed: 0 };
    }

    const rawRemote = site.ftpRemotePath || '/';
    const remoteDir = rawRemote === '/' ? '/' : rawRemote.replace(/\/$/, '');
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

    await client.ensureDir(remoteRoot);
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

    const ftpCfg = loadFtpSettings();
    const client = new ftp.Client(60_000);
    client.ftp.verbose = false;

    process.stdout.write(`\nDeploying ${targets.length} site(s) via ftp://${ftpCfg.host}:${ftpCfg.port || 21}/\n`);

    let totalUploaded = 0, totalFailed = 0;
    const siteErrors = [];
    try {
        await client.access({
            host:     ftpCfg.host,
            port:     ftpCfg.port || 21,
            user:     ftpCfg.user,
            password: ftpCfg.password,
            secure:   ftpCfg.secure !== false,
            secureOptions: { rejectUnauthorized: false },
        });
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
    if (onlySlug) {
        projects = projects.filter((p) => p.slug === onlySlug);
        if (!projects.length) throw new Error(`No project with slug '${onlySlug}' in projects.json.`);
    }

    if (!skipBuild) await runBuild();

    const ftpCfg = loadFtpSettings();
    const client = new ftp.Client(60_000);
    client.ftp.verbose = false;

    process.stdout.write(`\nDeploying ${projects.length} landing page(s) to ftp://${ftpCfg.host}:${ftpCfg.port || 21}${ftpRemoteRoot}/...\n`);

    const failed = [];
    try {
        await client.access({
            host:     ftpCfg.host,
            port:     ftpCfg.port || 21,
            user:     ftpCfg.user,
            password: ftpCfg.password,
            secure:   ftpCfg.secure !== false,
            secureOptions: { rejectUnauthorized: false },
        });

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
