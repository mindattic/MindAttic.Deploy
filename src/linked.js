/**
 * linked.js -- linked-group deploy (DEP-A3).
 *
 * MindAttic.UiUx (the shared jsDelivr asset package) and the three sites that
 * consume it (ryandebraal.com, mindatticcares.com, mindattic.com) are PERMANENTLY
 * linked: deploying any one of them deploys all four, in this order:
 *
 *   1. preflight   package repo clean, on main, not behind origin, tag sane,
 *                  manifest current, site sources present, FTP secrets resolvable
 *   2. publish     tag the package (V<n+1> if HEAD is ahead of the latest tag),
 *                  push main + the tag (never force, tags are immutable)
 *   3. pin         rewrite every `MindAttic.UiUx@V<n>` in the sites to the release tag
 *   4. prepare     run each site's preDeploy hooks (the sync splice gets the tag)
 *   5. CDN gate    every asset the sites use must be live on jsDelivr at that tag with
 *                  the exact bytes -- aborts BEFORE any FTP upload if anything is missing
 *   6. FTP         upload the sites in order, continue past a failed site, report a table
 *
 * Everything with a side effect is injected through `deps`, so the orchestration
 * is testable against throwaway git repos, a local http server and a fake FTP client.
 * deploy.js wires the real implementations; nothing here talks to FTP directly.
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const http          = require('http');
const https         = require('https');
const child_process = require('child_process');

// --- tags -------------------------------------------------------------------

const TAG_RE = /^V(\d+)$/;

function parseTag(tag) {
    const m = TAG_RE.exec(String(tag));
    return m ? parseInt(m[1], 10) : null;
}

/** Whole-number tags only, sorted NUMERICALLY (V10 > V9). */
function sortTags(tags) {
    return tags.filter((t) => parseTag(t) !== null).sort((a, b) => parseTag(a) - parseTag(b));
}

function latestTag(tags) {
    const s = sortTags(tags);
    return s.length ? s[s.length - 1] : null;
}

function nextTag(tag) {
    const n = parseTag(tag);
    if (n === null) throw new Error(`not a whole-number tag: ${tag}`);
    return `V${n + 1}`;
}

// --- planning: which targets does a flag combination mean? ------------------

function findGroupOfSite(config, slug) {
    for (const [name, group] of Object.entries(config.linkedGroups || {})) {
        if ((group.sites || []).includes(slug)) return { name, group };
    }
    return null;
}

function firstPackageGroup(config) {
    for (const [name, group] of Object.entries(config.linkedGroups || {})) {
        if (group.package) return { name, group };
    }
    return null;
}

/**
 * Turn the site-ish flags into a plan.
 *   { kind: 'linked', groupName, group, sites: [site...], others: [site...], warnings: [] }
 *   { kind: 'plain',  sites: [site...], warnings: [] }
 * `--site X` (member) / `--sites` / `--uiux` expand to the whole group; `--no-link` is the escape hatch.
 */
function planTargets(config, { siteSlug, allSites, uiux, noLink }) {
    const sites = config.sites || [];
    const bySlug = new Map(sites.map((s) => [s.slug, s]));
    const warnings = [];

    const groupSites = (group) => group.sites.map((slug) => {
        const s = bySlug.get(slug);
        if (!s) throw new Error(`linkedGroups member '${slug}' is not in projects.json sites[].`);
        return s;
    });

    if (uiux) {
        if (noLink) throw new Error('--no-link cannot be combined with --uiux/--package (the package IS the link).');
        const g = firstPackageGroup(config);
        if (!g) throw new Error('projects.json has no linkedGroups entry with a `package`.');
        return { kind: 'linked', groupName: g.name, group: g.group, sites: groupSites(g.group), others: [], warnings };
    }

    if (siteSlug) {
        const site = bySlug.get(siteSlug);
        if (!site) throw new Error(`No site with slug '${siteSlug}' in projects.json (available: ${sites.map((s) => s.slug).join(', ')}).`);
        const g = findGroupOfSite(config, siteSlug);
        if (g && !noLink) {
            return { kind: 'linked', groupName: g.name, group: g.group, sites: groupSites(g.group), others: [], warnings };
        }
        if (g && noLink) {
            warnings.push(`--no-link: deploying '${siteSlug}' ALONE. It is permanently linked to ${g.group.package.slug} and ${g.group.sites.filter((s) => s !== siteSlug).join(', ')}; their pinned asset tag may now disagree with this page.`);
        }
        return { kind: 'plain', sites: [site], warnings };
    }

    if (allSites) {
        const g = firstPackageGroup(config);
        if (g && !noLink) {
            const inGroup = new Set(g.group.sites);
            return { kind: 'linked', groupName: g.name, group: g.group, sites: groupSites(g.group), others: sites.filter((s) => !inGroup.has(s.slug)), warnings };
        }
        if (g && noLink) warnings.push('--no-link: deploying every site WITHOUT the linked-group publish/pin/CDN gate.');
        return { kind: 'plain', sites, warnings };
    }

    throw new Error('planTargets called without a site-mode flag.');
}

// --- pins -------------------------------------------------------------------

const PIN_RE = /(cdn\.jsdelivr\.net\/gh\/mindattic\/MindAttic\.UiUx@)(V\d+)/g;
const URL_RE = /https:\/\/cdn\.jsdelivr\.net\/gh\/mindattic\/MindAttic\.UiUx@([A-Za-z0-9._-]+)\/([^\s"'`)<>\\]*)/g;

/** Rewrite every UiUx tag pin to `tag`. Idempotent; leaves other jsDelivr URLs (npm, other repos) alone. */
function rewritePins(text, tag) {
    const changes = [];
    const out = text.replace(PIN_RE, (m, pre, old, offset) => {
        if (old !== tag) {
            const line = text.slice(0, offset).split('\n').length;
            changes.push({ from: old, to: tag, line });
        }
        return pre + tag;
    });
    return { text: out, changes };
}

/** Every UiUx URL in a text. `isPrefix` = the URL is a directory-like base (ends in '/'), not a file. */
function collectUiuxUrls(text) {
    const seen = new Map();
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
        const tag = m[1];
        let rel = m[2];
        // A trailing sentence/JS punctuation char is never part of a path here.
        rel = rel.replace(/[;,]+$/, '');
        let decoded;
        try { decoded = decodeURIComponent(rel); } catch (_) { decoded = rel; }
        const url = `https://cdn.jsdelivr.net/gh/mindattic/MindAttic.UiUx@${tag}/${rel}`;
        if (!seen.has(url)) {
            // `@<tag>/<path>`, `{{x}}`, `${x}`, `*` ... are examples/templates, not references to a real file.
            const isTemplate = /[<>{}$*]|&lt;|&gt;|%3C|%3E|%7B/i.test(rel) || /[<>{}$*]|&lt;|&gt;/i.test(tag);
            seen.set(url, { url, tag, path: decoded, isTemplate, isPrefix: decoded === '' || decoded.endsWith('/') });
        }
    }
    return [...seen.values()];
}

function cdnUrl(tag, relPath) {
    return `https://cdn.jsdelivr.net/gh/mindattic/MindAttic.UiUx@${tag}/` + relPath.split('/').map(encodeURIComponent).join('/');
}

// --- git --------------------------------------------------------------------

function git(cwd, args, opts = {}) {
    const r = child_process.spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`failed to launch git (is it on PATH?): ${r.error.message}`);
    // `raw` keeps leading whitespace (git status --porcelain columns); default trims.
    const out = { status: r.status, stdout: opts.raw ? (r.stdout || '').replace(/\s+$/, '') : (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
    if (r.status !== 0 && !opts.allowFail) {
        throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${out.stderr || out.stdout}`);
    }
    return out;
}

function remoteTags(pkgDir, remote) {
    // { 'V7': { sha, peeled } } -- peeled = the commit an annotated tag points at.
    const r = git(pkgDir, ['ls-remote', '--tags', remote], { allowFail: true });
    if (r.status !== 0) return null;
    const tags = {};
    for (const line of r.stdout.split('\n')) {
        const m = /^([0-9a-f]{40})\s+refs\/tags\/([^\s^]+)(\^\{\})?$/.exec(line.trim());
        if (!m) continue;
        const t = (tags[m[2]] = tags[m[2]] || {});
        if (m[3]) t.peeled = m[1]; else t.sha = m[1];
    }
    for (const t of Object.values(tags)) t.commit = t.peeled || t.sha;
    return tags;
}

function buildTagMessage(pkgDir, tag, prev) {
    const range = prev ? `${prev}..HEAD` : 'HEAD';
    const r = git(pkgDir, ['log', '--pretty=%s', range], { allowFail: true });
    const subjects = r.status === 0 && r.stdout ? r.stdout.split('\n') : [];
    const shown = subjects.slice(0, 20).map((s) => `- ${s}`);
    if (subjects.length > 20) shown.push(`- ...and ${subjects.length - 20} more`);
    return `${tag} -- published by MindAttic.Deploy\n\n${shown.join('\n') || '(no commits listed)'}`;
}

// --- preflight --------------------------------------------------------------

/**
 * Inspect the package repo. Never mutates anything unless `fetch` is true (real runs fetch tags so
 * "behind origin" is judged against fresh data; dry-runs use ls-remote only so they write nothing).
 * Returns { problems: [string], info: {...} }.
 */
function inspectPackage({ pkgDir, branch = 'main', remote = 'origin', fetch = false }) {
    const problems = [];
    const info = { pkgDir, branch, remote };

    if (!fs.existsSync(pkgDir) || git(pkgDir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).stdout !== 'true') {
        problems.push(`package dir is not a git repo: ${pkgDir}`);
        return { problems, info };
    }

    info.head = git(pkgDir, ['rev-parse', 'HEAD']).stdout;
    info.currentBranch = git(pkgDir, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    if (info.currentBranch !== branch) {
        problems.push(`package repo is on '${info.currentBranch}', not '${branch}' -- switch to ${branch} before a linked deploy.`);
    }

    const dirty = git(pkgDir, ['status', '--porcelain'], { raw: true }).stdout;
    info.dirty = dirty ? dirty.split('\n') : [];
    if (info.dirty.length) {
        const shown = info.dirty.slice(0, 15).join('\n    ');
        problems.push(`package repo has ${info.dirty.length} uncommitted change(s) (deploy never auto-commits -- commit or discard them first):\n    ${shown}${info.dirty.length > 15 ? `\n    ...and ${info.dirty.length - 15} more` : ''}`);
    }

    const rtags = remoteTags(pkgDir, remote);
    if (rtags === null) {
        problems.push(`cannot reach '${remote}' (git ls-remote failed) -- the package must be pushed to GitHub for jsDelivr to serve it.`);
        info.remoteReachable = false;
        return { problems, info };
    }
    info.remoteReachable = true;
    info.remoteTags = rtags;

    // Immutability, checked BEFORE fetching: a whole-number tag that exists both locally and on origin must
    // point at the same commit. (A moved/re-pushed tag also makes `git fetch --tags` refuse with an opaque error.)
    const tagMismatch = [];
    for (const [name, rt] of Object.entries(rtags)) {
        if (parseTag(name) === null) continue;
        const lc = git(pkgDir, ['rev-parse', '--verify', '--quiet', `refs/tags/${name}^{commit}`], { allowFail: true });
        if (lc.status === 0 && lc.stdout !== rt.commit) tagMismatch.push({ name, local: lc.stdout, remote: rt.commit });
    }
    for (const m of tagMismatch) {
        problems.push(`tag ${m.name} already exists on ${remote} and points at ${m.remote.slice(0, 8)}, but locally it points at ${m.local.slice(0, 8)} -- published tags are immutable; refusing to move or reuse it.`);
    }

    if (fetch && tagMismatch.length === 0) {
        const f = git(pkgDir, ['fetch', remote, '--tags'], { allowFail: true });
        if (f.status !== 0) problems.push(`git fetch ${remote} --tags failed: ${f.stderr || f.stdout || '(no output)'}`);
    }

    // Remote main vs local HEAD.
    const rm = git(pkgDir, ['ls-remote', remote, `refs/heads/${branch}`], { allowFail: true });
    const remoteMain = rm.status === 0 && rm.stdout ? rm.stdout.split(/\s+/)[0] : null;
    info.remoteMain = remoteMain;
    info.ahead = 0;
    if (remoteMain && remoteMain !== info.head) {
        const haveObj = git(pkgDir, ['cat-file', '-e', `${remoteMain}^{commit}`], { allowFail: true }).status === 0;
        const isAncestor = haveObj && git(pkgDir, ['merge-base', '--is-ancestor', remoteMain, 'HEAD'], { allowFail: true }).status === 0;
        if (!isAncestor) {
            problems.push(`local ${branch} is BEHIND or has DIVERGED from ${remote}/${branch} (${remoteMain.slice(0, 8)}${haveObj ? '' : ', not present locally'}) -- pull/merge first.`);
        } else {
            info.ahead = parseInt(git(pkgDir, ['rev-list', '--count', `${remoteMain}..HEAD`]).stdout, 10);
        }
    } else if (!remoteMain) {
        // Remote has no main yet: everything is "ahead".
        info.ahead = parseInt(git(pkgDir, ['rev-list', '--count', 'HEAD']).stdout, 10);
    }

    // Tags: union of local and remote whole-number tags.
    const localTags = git(pkgDir, ['tag', '--list']).stdout.split('\n').filter(Boolean);
    const all = [...new Set([...localTags, ...Object.keys(rtags)])];
    info.latest = latestTag(all);
    const atHead = git(pkgDir, ['tag', '--points-at', 'HEAD']).stdout.split('\n').filter(Boolean);
    info.headTag = latestTag(atHead);

    // A whole-number tag that exists only locally and is NOT at HEAD was created by an earlier run whose push
    // failed (or by hand). Publishing past it would leave a permanent gap in the V1..Vn sequence (that tag would
    // never reach origin), so stop and let a human publish or delete it. A local-only tag AT HEAD is fine: it is
    // this run's release and gets pushed in step 2.
    for (const t of sortTags(localTags)) {
        if (rtags[t] || t === info.headTag) continue;
        problems.push(`tag ${t} exists locally but not on ${remote}, and is not at HEAD -- an earlier publish never reached ${remote}. Push it (git push ${remote} ${t}) or delete it (git tag -d ${t}) before a linked deploy.`);
    }

    if (info.latest) {
        const tagCommit = git(pkgDir, ['rev-parse', '--verify', '--quiet', `refs/tags/${info.latest}^{commit}`], { allowFail: true });
        const known = tagCommit.status === 0 ? tagCommit.stdout : (rtags[info.latest] && rtags[info.latest].commit);
        info.latestCommit = known;
        const isAnc = tagCommit.status === 0 && git(pkgDir, ['merge-base', '--is-ancestor', tagCommit.stdout, 'HEAD'], { allowFail: true }).status === 0;
        if (!isAnc) {
            problems.push(`latest tag ${info.latest} is not an ancestor of HEAD${tagCommit.status === 0 ? '' : ' (and not present locally)'} -- tags are immutable; reconcile ${branch} with ${info.latest} first.`);
        }
    }

    // Release tag decision.
    if (info.latest && info.headTag === info.latest) {
        info.releaseTag = info.latest;
        info.newTag = false;
    } else {
        info.releaseTag = info.latest ? nextTag(info.latest) : 'V1';
        info.newTag = true;
    }

    // Immutability: the release tag, if already on origin, must point at HEAD.
    const onRemote = rtags[info.releaseTag];
    info.releaseTagOnRemote = !!onRemote;
    if (onRemote && onRemote.commit !== info.head) {
        problems.push(`tag ${info.releaseTag} already exists on ${remote} and points at ${onRemote.commit.slice(0, 8)}, not HEAD (${info.head.slice(0, 8)}) -- published tags are immutable; refusing to move or reuse it.`);
    }

    return { problems, info };
}

function runManifestVerify(pkgDir) {
    const script = path.join(pkgDir, 'tools', 'build-asset-manifest.ps1');
    if (!fs.existsSync(script)) return { skipped: true, ok: true };
    const r = child_process.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Verify'], { encoding: 'utf8' });
    if (r.error) return { ok: false, message: `could not launch powershell: ${r.error.message}` };
    return { ok: r.status === 0, message: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function runPackageTests(pkgDir) {
    const dir = path.join(pkgDir, 'tests');
    if (!fs.existsSync(path.join(dir, 'package.json'))) return { skipped: true, ok: true };
    const r = child_process.spawnSync('npm', ['run', 'test:local'], { cwd: dir, shell: true, encoding: 'utf8', stdio: 'inherit' });
    return { ok: r.status === 0, message: `npm run test:local exited ${r.status}` };
}

// --- publish ----------------------------------------------------------------

function publishPackage({ pkgDir, info, remote = 'origin', branch = 'main', log }) {
    const tag = info.releaseTag;
    if (info.newTag) {
        const msg = buildTagMessage(pkgDir, tag, info.latest);
        log(`  [git]  tag -a ${tag}\n`);
        const t = git(pkgDir, ['tag', '-a', tag, '-m', msg], { allowFail: true });
        if (t.status !== 0) throw new LinkedAbort(`git tag -a ${tag} failed: ${t.stderr || t.stdout}`);
    }
    if (info.ahead > 0) {
        log(`  [git]  push ${remote} ${branch}  (${info.ahead} commit(s))\n`);
        const p = git(pkgDir, ['push', remote, branch], { allowFail: true });
        if (p.status !== 0) throw new LinkedAbort(`git push ${remote} ${branch} was rejected: ${p.stderr}\n        The tag ${tag} exists locally only; the next run resumes from it.`);
    } else {
        log(`  [git]  ${branch} already on ${remote}; nothing to push\n`);
    }
    if (!info.releaseTagOnRemote) {
        log(`  [git]  push ${remote} ${tag}\n`);
        const p = git(pkgDir, ['push', remote, `refs/tags/${tag}`], { allowFail: true });
        if (p.status !== 0) throw new LinkedAbort(`git push ${remote} ${tag} was rejected: ${p.stderr}\n        The next run resumes from the local tag.`);
    } else {
        log(`  [git]  ${tag} already on ${remote} at HEAD; nothing to push\n`);
    }
}

// --- CDN verification -------------------------------------------------------

function httpProbe(url, { method = 'HEAD', timeoutMs = 20000, redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? https : http;
        const req = lib.request(url, {
            method,
            headers: { 'accept-encoding': 'identity', 'user-agent': 'MindAttic.Deploy linked-deploy' },
            timeout: timeoutMs,
        }, (res) => {
            const status = res.statusCode;
            if ([301, 302, 307, 308].includes(status) && res.headers.location && redirects > 0) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                return resolve(httpProbe(next, { method, timeoutMs, redirects: redirects - 1 }));
            }
            let bytes = 0;
            if (method === 'GET') {
                res.on('data', (c) => { bytes += c.length; });
                res.on('end', () => resolve({ status, headers: res.headers, bytes }));
            } else {
                res.resume();
                resolve({ status, headers: res.headers });
            }
        });
        req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
        req.on('error', reject);
        req.end();
    });
}

async function probeOnce(url, expectBytes, probe) {
    let r = await probe(url, { method: 'HEAD' });
    if (r.status === 405 || r.status === 501) r = await probe(url, { method: 'GET' });
    if (r.status !== 200) return { ok: false, reason: `HTTP ${r.status}` };
    const acao = r.headers['access-control-allow-origin'];
    if (acao !== '*') return { ok: false, reason: `access-control-allow-origin is ${acao === undefined ? 'missing' : `'${acao}'`} (need '*')` };
    let len = r.headers['content-length'] !== undefined ? parseInt(r.headers['content-length'], 10) : undefined;
    if (len === undefined || Number.isNaN(len)) {
        const g = await probe(url, { method: 'GET' });
        if (g.status !== 200) return { ok: false, reason: `HTTP ${g.status} (GET)` };
        len = g.bytes;
    }
    if (len !== expectBytes) return { ok: false, reason: `content-length ${len} != expected ${expectBytes}` };
    return { ok: true };
}

/**
 * checks: [{ url, expectBytes, label }]. All are probed once (limited concurrency); only the FAILURES are
 * re-probed, in rounds with exponential backoff, until `retry.totalMs` has elapsed since the start (a
 * brand-new tag can take a minute to appear on jsDelivr). One shared deadline -- not one per URL -- so a
 * hundred permanent 404s cost one deadline, not a hundred. totalMs: 0 = a single pass, no retries.
 * Returns { failures: [{url, label, reason}] }.
 */
async function verifyCdn({ checks, rewriteUrl = (u) => u, probe = httpProbe, concurrency = 6, retry = {}, log = () => {} }) {
    const totalMs = retry.totalMs ?? 180000;
    const baseMs  = retry.baseMs ?? 2000;
    const maxMs   = retry.maxMs ?? 15000;
    const start = Date.now();
    let pending = checks.map((c) => ({ c, ok: false, reason: 'not probed' }));
    let delay = baseMs;
    let round = 0;

    async function pool(items, fn) {
        let next = 0;
        async function worker() { while (next < items.length) { const it = items[next++]; await fn(it); } }
        await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, worker));
    }

    for (;;) {
        round++;
        let done = 0;
        await pool(pending, async (it) => {
            try {
                const r = await probeOnce(rewriteUrl(it.c.url), it.c.expectBytes, probe);
                it.ok = r.ok; it.reason = r.reason;
            } catch (e) {
                it.ok = false; it.reason = `request failed: ${e.message}`;
            }
            done++;
            if (round === 1 && (done % 25 === 0 || done === pending.length)) log(`  [cdn]  checked ${done}/${pending.length}\n`);
        });
        pending = pending.filter((it) => !it.ok);
        if (pending.length === 0) break;
        if (Date.now() - start + delay > totalMs) break;
        log(`  [cdn]  ${pending.length} URL(s) not ready yet; retrying in ${Math.round(delay / 1000)}s (round ${round})\n`);
        await new Promise((res) => setTimeout(res, delay));
        delay = Math.min(delay * 2, maxMs);
    }
    return { failures: pending.map((it) => ({ url: it.c.url, label: it.c.label, reason: it.reason })) };
}

/**
 * Work out everything the CDN must serve for these site texts at `tag`.
 *  - literal UiUx URLs (files): bytes from the local package tree (or manifest)
 *  - literal URLs ending in '/' are BASE PREFIXES (the page builds file URLs from them at runtime): not fetched
 *  - every manifest file under each site's domain folder (`<slug>/...`) -- covers runtime-built URLs
 * Returns { checks, local: [string] (problems found without the network), prefixes: [...] }.
 */
function buildCdnChecks({ siteTexts, pkgDir, tag }) {
    const local = [];
    const prefixes = [];
    const templates = [];
    const wanted = new Map(); // path -> { expectBytes, label }

    let manifest = null;
    const mpath = path.join(pkgDir, 'assets-manifest.json');
    if (fs.existsSync(mpath)) {
        try { manifest = JSON.parse(fs.readFileSync(mpath, 'utf8').replace(/^﻿/, '')); }
        catch (e) { local.push(`assets-manifest.json is not valid JSON: ${e.message}`); }
    }
    const mfiles = new Map(((manifest && manifest.files) || []).map((f) => [f.path, f]));

    const add = (relPath, label) => {
        if (wanted.has(relPath)) { wanted.get(relPath).labels.add(label); return; }
        const abs = path.join(pkgDir, relPath);
        const m = mfiles.get(relPath);
        let bytes;
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) bytes = fs.statSync(abs).size;
        if (bytes === undefined) {
            local.push(`${label}: references '${relPath}', which is not in the package tree at HEAD`);
            return;
        }
        if (m && m.bytes !== bytes) {
            local.push(`${label}: assets-manifest.json says ${relPath} is ${m.bytes} bytes but the file on disk is ${bytes} (manifest is stale)`);
            return;
        }
        wanted.set(relPath, { expectBytes: bytes, labels: new Set([label]) });
    };

    for (const { slug, text } of siteTexts) {
        for (const u of collectUiuxUrls(text)) {
            if (u.isTemplate) { templates.push({ site: slug, url: u.url }); continue; }
            if (u.tag !== tag) {
                local.push(`${slug}: references ${u.url} -- pinned to '${u.tag}', expected release tag ${tag}`);
                continue;
            }
            if (u.isPrefix) { prefixes.push({ site: slug, url: u.url }); continue; }
            add(u.path, `${slug} (literal)`);
        }
        // Everything the manifest lists under this site's domain folder.
        for (const f of mfiles.values()) {
            if (f.path.startsWith(slug + '/')) add(f.path, `${slug} (manifest)`);
        }
    }

    const checks = [...wanted.entries()].map(([p, v]) => ({
        url: cdnUrl(tag, p),
        expectBytes: v.expectBytes,
        label: [...v.labels].join(', '),
    }));
    return { checks, local, prefixes, templates, usedManifest: !!manifest };
}

// --- site files / pins ------------------------------------------------------

/**
 * The pages of a site that load package assets (pinned + CDN-checked). Default: the site's stampFile
 * (index.htm); override per site with `pinFiles`. Other uploaded files (e.g. a generated README.htm whose
 * body is documentation full of example URLs) are deployed but never pinned or scanned.
 */
function siteHtmlFiles(site, repoRoot, expandFiles) {
    const dir = path.resolve(repoRoot, site.sourceDir);
    if (!fs.existsSync(dir)) return { dir, files: [] };
    const wanted = site.pinFiles || [site.stampFile || 'index.htm'];
    const uploaded = new Set(expandFiles(dir, site.files || ['index.htm']));
    const files = wanted.filter((f) => uploaded.has(f) && /\.html?$/i.test(f));
    return { dir, files };
}

// --- orchestration ----------------------------------------------------------

class LinkedAbort extends Error {}

/**
 * opts: { config, plan, dryRun, withTests, repoRoot }
 * deps: { log, expandFiles, deployOneSite(client, site, {skipHooks}), executeHooks(site, {tag}),
 *         createClient(), accessFtp(client, cfg), loadFtpSettings(), probe, rewriteUrl, retry,
 *         verifyManifest(pkgDir), runTests(pkgDir) }
 */
async function runLinked(opts, deps) {
    const { plan, dryRun, withTests, repoRoot } = opts;
    const log = deps.log || ((s) => process.stdout.write(s));
    const group = plan.group;
    const pkgDir = path.resolve(repoRoot, group.package.sourceDir);
    const branch = group.package.branch || 'main';
    const remote = group.package.remote || 'origin';
    const wouldAbort = [];     // dry-run: gates that would stop a real run
    const result = { ok: true, aborted: false, tag: null, sites: [], wouldAbort };

    const gateFail = (msg) => {
        if (dryRun) { wouldAbort.push(msg); log(`  [WOULD ABORT] ${msg}\n`); }
        else throw new LinkedAbort(msg);
    };

    try {
        log(`\nLinked deploy: group '${plan.groupName}'${dryRun ? '  [DRY-RUN -- nothing is tagged, pushed, written or uploaded]' : ''}\n`);
        log(`  package : ${group.package.slug} (${pkgDir})\n`);
        log(`  sites   : ${plan.sites.map((s) => s.slug).join(' -> ')}   (FTP order)\n`);
        for (const w of plan.warnings || []) log(`  [warn] ${w}\n`);

        // 1. preflight ------------------------------------------------------
        log(`\n[1/6] preflight\n`);
        const { problems, info } = inspectPackage({ pkgDir, branch, remote, fetch: !dryRun });
        for (const p of problems) gateFail(p);
        if (!info.head) throw new LinkedAbort('cannot continue without a package git repo.');

        const mv = (deps.verifyManifest || runManifestVerify)(pkgDir);
        if (mv.skipped) log(`  [ok]   (no tools/build-asset-manifest.ps1 in the package -- manifest gate skipped)\n`);
        else if (mv.ok) log(`  [ok]   assets-manifest.json is current\n`);
        else gateFail(`assets-manifest.json is stale or invalid -- run tools\\build-asset-manifest.ps1 and commit it.\n    ${mv.message || ''}`);

        if (withTests) {
            const t = (deps.runTests || runPackageTests)(pkgDir);
            if (t.skipped) log(`  [warn] --with-tests: no tests/ package found in ${group.package.slug}; skipped\n`);
            else if (t.ok) log(`  [ok]   package tests passed\n`);
            else gateFail(`package tests failed (${t.message})`);
        }

        for (const site of plan.sites) {
            const { dir, files } = siteHtmlFiles(site, repoRoot, deps.expandFiles);
            if (!fs.existsSync(dir)) gateFail(`site '${site.slug}': sourceDir not found: ${dir}`);
            else if (files.length === 0) gateFail(`site '${site.slug}': no .htm/.html files matched ${JSON.stringify(site.files)} in ${dir}`);
        }

        let ftpOk = true;
        try { deps.loadFtpSettings(); } catch (e) { ftpOk = false; if (dryRun) log(`  [warn] FTP secrets not resolvable (${e.message}) -- not needed for a dry-run\n`); else gateFail(`FTP secrets: ${e.message}`); }
        if (ftpOk) log(`  [ok]   FTP secrets resolvable\n`);

        log(`  [ok]   package: HEAD ${info.head.slice(0, 8)} on ${info.currentBranch}, latest tag ${info.latest || '(none)'}, ${info.ahead} commit(s) ahead of ${remote}/${branch}\n`);

        // Read the sites now (still before anything is tagged/pushed/written) so every
        // "this can never work" condition aborts BEFORE the package is published.
        const tag0 = info.releaseTag;
        const siteState = [];   // { site, dir, files: [{file, abs, text, rewritten, changes}] }
        for (const site of plan.sites) {
            const { dir, files } = siteHtmlFiles(site, repoRoot, deps.expandFiles);
            const st = { site, dir, files: [] };
            for (const f of files) {
                const abs = path.join(dir, f);
                const text = fs.readFileSync(abs, 'utf8');
                const rw = rewritePins(text, tag0);
                st.files.push({ file: f, abs, text, rewritten: rw.text, changes: rw.changes });
            }
            siteState.push(st);
        }
        // A pin NEWER than the release tag means the page references package work that was never tagged.
        for (const st of siteState) for (const f of st.files) {
            const newer = f.changes.filter((c) => parseTag(c.from) > parseTag(tag0));
            if (newer.length) gateFail(`${st.site.slug}/${f.file} pins ${[...new Set(newer.map((c) => c.from))].join(', ')} but the release tag would be ${tag0} -- the page references a package version that has not been tagged (commit + tag the package first).`);
        }
        // Local-only asset checks (path exists in the package tree, manifest not stale, one tag everywhere).
        const early = buildCdnChecks({ siteTexts: siteState.flatMap((st) => st.files.map((f) => ({ slug: st.site.slug, text: f.rewritten }))), pkgDir, tag: tag0 });
        for (const p of early.local) gateFail(p);

        // 2. publish --------------------------------------------------------
        const tag = info.releaseTag;
        result.tag = tag;
        log(`\n[2/6] publish package  ->  ${tag}${info.newTag ? '  (NEW tag)' : '  (existing tag at HEAD)'}\n`);
        if (dryRun) {
            if (info.newTag) log(`  [git]  (dry-run) would tag -a ${tag} and push ${remote} ${branch} + ${tag}\n`);
            else log(`  [git]  (dry-run) ${tag} already at HEAD${info.releaseTagOnRemote ? ' and on origin' : ' (NOT yet on origin -- would push it)'}${info.ahead ? `; would push ${info.ahead} commit(s) to ${remote}/${branch}` : ''}\n`);
        } else {
            publishPackage({ pkgDir, info, remote, branch, log });
        }

        // 3. pin ------------------------------------------------------------
        log(`\n[3/6] pin ${tag} in the sites\n`);
        for (const st of siteState) for (const f of st.files) {
            if (f.changes.length === 0) { log(`  [ok]   ${st.site.slug}/${f.file}: already pinned to ${tag}\n`); continue; }
            const froms = [...new Set(f.changes.map((c) => c.from))].join(', ');
            log(`  [pin]  ${st.site.slug}/${f.file}: ${froms} -> ${tag}  (${f.changes.length} pin(s), line(s) ${f.changes.slice(0, 8).map((c) => c.line).join(', ')}${f.changes.length > 8 ? ', ...' : ''})${dryRun ? '  [dry-run: not written]' : ''}\n`);
            if (!dryRun) fs.writeFileSync(f.abs, f.rewritten, 'utf8');
        }

        // 4. prepare (hooks) ------------------------------------------------
        log(`\n[4/6] prepare sites (preDeploy hooks)\n`);
        for (const site of plan.sites) {
            const hooks = site.preDeploy || [];
            if (hooks.length === 0) { log(`  [ok]   ${site.slug}: no hooks\n`); continue; }
            if (dryRun) {
                for (const h of hooks) log(`  [hook] (dry-run) skipped ${h.kind}${h.file ? ' ' + h.file : ''}${h.required === false ? ' (optional)' : ''} -- hooks mutate files; they run for real only in a non-dry run\n`);
            } else {
                log(`  ${site.slug}:\n`);
                await deps.executeHooks(site, { tag, skipUiuxPull: true });
            }
        }

        // 5. CDN gate -------------------------------------------------------
        log(`\n[5/6] CDN gate  (every asset the sites use must be live on jsDelivr at ${tag}, byte-exact)\n`);
        const siteTexts = [];
        for (const st of siteState) {
            for (const f of st.files) {
                // After hooks (real run) the file on disk is the truth; in a dry-run use the would-be text.
                const text = dryRun ? f.rewritten : fs.readFileSync(f.abs, 'utf8');
                siteTexts.push({ slug: st.site.slug, text });
            }
        }
        const plan5 = buildCdnChecks({ siteTexts, pkgDir, tag });
        for (const p of plan5.local) gateFail(p);
        for (const p of plan5.templates || []) log(`  [info] ${p.site}: ignoring template/example URL ${p.url}\n`);
        for (const p of plan5.prefixes) log(`  [info] ${p.site}: base prefix ${p.url} (files under it are built at runtime; covered by the manifest)\n`);
        if (!plan5.usedManifest) log(`  [warn] no assets-manifest.json in the package -- only literal URLs can be verified\n`);
        log(`  [cdn]  ${plan5.checks.length} URL(s) to verify\n`);

        const tagPublished = !dryRun || (!info.newTag && info.releaseTagOnRemote);
        if (!tagPublished) {
            log(`  [cdn]  (dry-run) ${tag} is not published yet -- the live CDN check would run after the push\n`);
        } else if (plan5.checks.length) {
            const v = await verifyCdn({
                checks: plan5.checks, rewriteUrl: deps.rewriteUrl, probe: deps.probe || httpProbe,
                retry: dryRun ? { totalMs: 0 } : deps.retry,   // a dry-run never waits for a CDN to catch up
                log, concurrency: 6,
            });
            if (v.failures.length) {
                const byReason = new Map();
                for (const f of v.failures) byReason.set(f.reason, [...(byReason.get(f.reason) || []), f]);
                const lines = [...byReason.entries()].map(([reason, list]) => {
                    const shown = list.slice(0, 6).map((f) => `      ${f.url}  [${f.label}]`).join('\n');
                    return `    ${list.length} x ${reason}\n${shown}${list.length > 6 ? `\n      ...and ${list.length - 6} more` : ''}`;
                }).join('\n');
                gateFail(`${v.failures.length} of ${plan5.checks.length} CDN URL(s) failed verification at ${tag}:\n${lines}`);
            } else {
                log(`  [ok]   all ${plan5.checks.length} URL(s) live at ${tag} with matching bytes\n`);
            }
        }

        // 6. FTP ------------------------------------------------------------
        log(`\n[6/6] FTP deploy${dryRun ? '  [DRY-RUN]' : ''}\n`);
        if (dryRun && wouldAbort.length) {
            log(`  (dry-run) ${wouldAbort.length} gate(s) above WOULD abort a real run before any upload. Showing the upload plan anyway:\n`);
        }
        let client = null;
        if (!dryRun) {
            client = deps.createClient();
            await deps.accessFtp(client, deps.loadFtpSettings());
        }
        // A failed upload can leave the shared connection closed (basic-ftp marks the client `closed`); reconnect
        // before the next site so one bad site does not make every later site fail with "Client is closed".
        const ensureConnected = async () => {
            if (dryRun || !client || !client.closed) return;
            log(`  [ftp]  connection was closed by the previous failure; reconnecting\n`);
            client = deps.createClient();
            await deps.accessFtp(client, deps.loadFtpSettings());
        };
        try {
            for (const site of plan.sites) {
                try {
                    await ensureConnected();
                    const r = await deps.deployOneSite(client, site, { skipHooks: true });
                    result.sites.push({ slug: site.slug, uploaded: r.uploaded, failed: r.failed, error: null });
                } catch (e) {
                    log(`\n  [SITE FAIL] ${site.slug}: ${e.message}\n`);
                    result.sites.push({ slug: site.slug, uploaded: 0, failed: 1, error: e.message });
                }
            }
            // Other (non-group) sites requested via --sites go after the group, over the same connection.
            for (const site of plan.others || []) {
                try {
                    await ensureConnected();
                    const r = await deps.deployOneSite(client, site, {});
                    result.sites.push({ slug: site.slug, uploaded: r.uploaded, failed: r.failed, error: null, other: true });
                } catch (e) {
                    log(`\n  [SITE FAIL] ${site.slug}: ${e.message}\n`);
                    result.sites.push({ slug: site.slug, uploaded: 0, failed: 1, error: e.message, other: true });
                }
            }
        } finally {
            if (client) client.close();
        }

        // Summary table --------------------------------------------------------
        log(`\nLinked deploy summary  (package ${group.package.slug} @ ${tag})\n`);
        for (const s of result.sites) {
            const status = dryRun ? 'dry-run' : (s.error || s.failed ? 'FAILED' : 'ok');
            log(`  ${s.slug.padEnd(22)} ${String(s.uploaded).padStart(3)} uploaded  ${String(s.failed).padStart(2)} failed  ${status}${s.error ? '  (' + s.error + ')' : ''}\n`);
        }
        if (!dryRun) {
            for (const st of siteState) {
                const sd = st.dir;
                const dirty = git(sd, ['status', '--porcelain'], { allowFail: true });
                const unpushed = git(sd, ['rev-list', '--count', '@{u}..HEAD'], { allowFail: true });
                const notes = [];
                if (dirty.status === 0 && dirty.stdout) notes.push(`${dirty.stdout.split('\n').length} uncommitted change(s)`);
                if (unpushed.status === 0 && parseInt(unpushed.stdout, 10) > 0) notes.push(`${unpushed.stdout} unpushed commit(s)`);
                if (notes.length) log(`  [note] ${st.site.slug}: ${notes.join(', ')} -- deploy does not commit or push site repos\n`);
            }
        }
        const bad = result.sites.filter((s) => s.error || s.failed);
        result.ok = dryRun ? true : bad.length === 0;
        if (dryRun && wouldAbort.length) log(`\nDry-run complete: ${wouldAbort.length} gate(s) WOULD ABORT a real run (see [WOULD ABORT] lines).\n`);
        else if (dryRun) log(`\nDry-run complete: a real run would pass every gate and upload ${plan.sites.length} site(s).\n`);
        else log(bad.length ? `\nDone with ${bad.length} failed site(s).\n` : `\nDone. All ${result.sites.length} site(s) deployed against ${group.package.slug}@${tag}.\n`);
    } catch (e) {
        if (!(e instanceof LinkedAbort)) throw e;
        result.ok = false;
        result.aborted = true;
        log(`\n[ABORT] ${e.message}\n        Nothing was uploaded.\n`);
    }
    return result;
}

module.exports = {
    parseTag, sortTags, latestTag, nextTag,
    planTargets, findGroupOfSite,
    rewritePins, collectUiuxUrls, cdnUrl,
    inspectPackage, publishPackage, remoteTags, buildTagMessage,
    httpProbe, verifyCdn, buildCdnChecks,
    runManifestVerify, runPackageTests,
    runLinked, LinkedAbort,
};
