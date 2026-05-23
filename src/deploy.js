#!/usr/bin/env node
/*
 * deploy.js -- FTPS-upload every built out/<slug>.htm to
 * <ftpRemoteRoot>/<slug>.htm. Credentials live in secrets/ftp.json.
 *
 * Flags:
 *   --only <slug>   : deploy a single project
 *   --skip-build    : skip the implicit build step
 *
 * Run: node src/deploy.js [flags]
 *
 * In CI, set MINDATTIC_FTP_JSON to the JSON content of secrets/ftp.json
 * (a single GitHub Actions secret with the four FTP fields) and the script
 * reads it from env instead of disk.
 */

'use strict';

const fs           = require('fs');
const fsp          = require('fs/promises');
const path         = require('path');
const child_process = require('child_process');
const ftp          = require('basic-ftp');

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

async function main() {
    const config = JSON.parse(await fsp.readFile(projectsPath, 'utf8'));
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

main().catch((e) => {
    process.stderr.write(`deploy.js: ${e.message}\n`);
    process.exit(1);
});
