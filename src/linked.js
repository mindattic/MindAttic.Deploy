/**
 * linked.js -- linked-group deploy.
 *
 * The MindAttic.Web monorepo holds the shared jsDelivr asset package (the MindAttic.Web.Shared folder, the
 * group's `package.cdnSubpath`) AND the sites that consume it (ryandebraal.com, mindatticcares.com, Hyperspace,
 * mindattic.com) as sibling folders of ONE git repo. They are PERMANENTLY linked: deploying any one of them
 * deploys all of them, in this order:
 *
 *   1. preflight   repo clean, on main, not behind origin, tags sane, manifest current,
 *                  site sources present (inside the repo), FTP secrets resolvable
 *   2. tag         compute the release tag: the next V<n> (or package.firstTag when the repo has no
 *                  whole-number tag yet). If HEAD already carries the latest tag and every site page is
 *                  already pinned to it, that tag is REUSED and steps 3-5 are skipped.
 *   3. prepare     rewrite every package pin in the site pages to the release tag, run each site's
 *                  preDeploy hooks (the sync splice gets the tag), stamp each site's stampFile
 *   4. commit      commit those site changes: "Pin <package slug> V<n>" (only files inside the sites' folders)
 *   5. tag         annotate-tag that commit
 *   6. push        push main and the tag (never force; tags are immutable)
 *   7. CDN gate    every asset the sites use must be live on jsDelivr at that tag with the exact bytes --
 *                  aborts BEFORE any FTP upload if anything is missing
 *   8. FTP         upload the sites in order, continue past a failed site, report a table
 *
 * A dry run changes nothing: no fetch, no hook, no write, no commit, no tag, no push, no FTP connect.
 *
 * Everything with a side effect is injected through `deps`, so the orchestration is testable against
 * throwaway git repos, a local http server and a fake FTP client. deploy.js wires the real implementations.
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

/** The tag a new release gets: latest+1, never below `firstTag` (the repo's starting number). */
function releaseTagAfter(latest, firstTag) {
    const floor = firstTag && parseTag(firstTag) !== null ? parseTag(firstTag) : 1;
    const n = latest ? parseTag(latest) + 1 : floor;
    return `V${Math.max(n, floor)}`;
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
            warnings.push(`--no-link: deploying '${siteSlug}' ALONE. It is permanently linked to ${g.group.package.slug} and ${g.group.sites.filter((s) => s !== siteSlug).join(', ')}; their pinned asset tag may now disagree with this page, and the stamp it writes is left uncommitted.`);
        }
        return { kind: 'plain', sites: [site], warnings };
    }

    if (allSites) {
        const g = firstPackageGroup(config);
        if (g && !noLink) {
            const inGroup = new Set(g.group.sites);
            return { kind: 'linked', groupName: g.name, group: g.group, sites: groupSites(g.group), others: sites.filter((s) => !inGroup.has(s.slug)), warnings };
        }
        if (g && noLink) warnings.push('--no-link: deploying every site WITHOUT the linked-group pin/commit/tag/CDN gate.');
        return { kind: 'plain', sites, warnings };
    }

    throw new Error('planTargets called without a site-mode flag.');
}

// --- CDN spec / pins --------------------------------------------------------

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Where the package lives on jsDelivr: `https://cdn.jsdelivr.net/gh/<repo>@<tag>/<subpath>/<file>`.
 * `pkg` is a linkedGroups package entry ({ repo, cdnSubpath }) or an already-built spec ({ repo, subpath }).
 */
function cdnSpec(pkg) {
    if (!pkg || !pkg.repo) throw new Error('linked package needs a `repo` (owner/name) to build CDN URLs.');
    const raw = pkg.subpath !== undefined ? pkg.subpath : (pkg.cdnSubpath || '');
    return { repo: pkg.repo, subpath: String(raw).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') };
}

function cdnBase(spec, tag) {
    return `https://cdn.jsdelivr.net/gh/${spec.repo}@${tag}/${spec.subpath ? spec.subpath + '/' : ''}`;
}

function pinRegex(spec) {
    const sub = spec.subpath ? esc(spec.subpath) + '\\/' : '';
    return new RegExp(`(cdn\\.jsdelivr\\.net\\/gh\\/${esc(spec.repo)}@)(V\\d+)(?=\\/${sub})`, 'g');
}

function urlRegex(spec) {
    const sub = spec.subpath ? esc(spec.subpath) + '\\/' : '';
    return new RegExp(`https:\\/\\/cdn\\.jsdelivr\\.net\\/gh\\/${esc(spec.repo)}@([A-Za-z0-9._-]+)\\/${sub}([^\\s"'\`)<>\\\\]*)`, 'g');
}

/** Rewrite every package tag pin (`gh/<repo>@V<n>/<subpath>/`) to `tag`. Idempotent; leaves other jsDelivr URLs alone. */
function rewritePins(text, tag, spec) {
    const changes = [];
    const out = text.replace(pinRegex(spec), (m, pre, old, offset) => {
        if (old !== tag) {
            const line = text.slice(0, offset).split('\n').length;
            changes.push({ from: old, to: tag, line });
        }
        return pre + tag;
    });
    return { text: out, changes };
}

/** Every package URL in a text. `isPrefix` = the URL is a directory-like base (ends in '/'), not a file. */
function collectPackageUrls(text, spec) {
    const seen = new Map();
    const re = urlRegex(spec);
    let m;
    while ((m = re.exec(text)) !== null) {
        const tag = m[1];
        let rel = m[2];
        // A trailing sentence/JS punctuation char is never part of a path here.
        rel = rel.replace(/[;,]+$/, '');
        let decoded;
        try { decoded = decodeURIComponent(rel); } catch (_) { decoded = rel; }
        const url = cdnBase(spec, tag) + rel;
        if (!seen.has(url)) {
            // `@<tag>/<path>`, `{{x}}`, `${x}`, `*` ... are examples/templates, not references to a real file.
            const isTemplate = /[<>{}$*]|&lt;|&gt;|%3C|%3E|%7B/i.test(rel) || /[<>{}$*]|&lt;|&gt;/i.test(tag);
            seen.set(url, { url, tag, path: decoded, isTemplate, isPrefix: decoded === '' || decoded.endsWith('/') });
        }
    }
    return [...seen.values()];
}

function cdnUrl(spec, tag, relPath) {
    return cdnBase(spec, tag) + relPath.split('/').map(encodeURIComponent).join('/');
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

function remoteTags(repoDir, remote) {
    // { 'V7': { sha, peeled } } -- peeled = the commit an annotated tag points at.
    const r = git(repoDir, ['ls-remote', '--tags', remote], { allowFail: true });
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

function buildTagMessage(repoDir, tag, prev) {
    const range = prev ? `${prev}..HEAD` : 'HEAD';
    const r = git(repoDir, ['log', '--pretty=%s', range], { allowFail: true });
    const subjects = r.status === 0 && r.stdout ? r.stdout.split('\n') : [];
    const shown = subjects.slice(0, 20).map((s) => `- ${s}`);
    if (subjects.length > 20) shown.push(`- ...and ${subjects.length - 20} more`);
    return `${tag} -- published by MindAttic.Deploy\n\n${shown.join('\n') || '(no commits listed)'}`;
}

/** Paths reported by `git status --porcelain` (repo-relative, forward slashes; rename targets). */
function porcelainPaths(repoDir) {
    const out = git(repoDir, ['status', '--porcelain', '--untracked-files=all'], { raw: true }).stdout;
    if (!out) return [];
    return out.split('\n').filter(Boolean).map((l) => {
        let p = l.slice(3);
        if (p.includes(' -> ')) p = p.split(' -> ')[1];
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        return p;
    });
}

// --- preflight --------------------------------------------------------------

/**
 * Inspect the monorepo. Never mutates anything unless `fetch` is true (real runs fetch tags so
 * "behind origin" is judged against fresh data; dry-runs use ls-remote only so they write nothing).
 * Returns { problems: [string], info: {...} }. The release tag is decided later (it depends on the pins).
 */
function inspectRepo({ repoDir, branch = 'main', remote = 'origin', fetch = false, firstTag = null }) {
    const problems = [];
    const info = { repoDir, branch, remote };

    if (!fs.existsSync(repoDir) || git(repoDir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).stdout !== 'true') {
        problems.push(`package repo dir is not a git repo: ${repoDir}`);
        return { problems, info };
    }

    info.head = git(repoDir, ['rev-parse', 'HEAD']).stdout;
    info.currentBranch = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    if (info.currentBranch !== branch) {
        problems.push(`repo is on '${info.currentBranch}', not '${branch}' -- switch to ${branch} before a linked deploy.`);
    }

    const dirty = git(repoDir, ['status', '--porcelain'], { raw: true }).stdout;
    info.dirty = dirty ? dirty.split('\n') : [];
    if (info.dirty.length) {
        const shown = info.dirty.slice(0, 15).join('\n    ');
        problems.push(`repo has ${info.dirty.length} uncommitted change(s) (deploy commits only its own pin/stamp changes -- commit or discard these first):\n    ${shown}${info.dirty.length > 15 ? `\n    ...and ${info.dirty.length - 15} more` : ''}`);
    }

    const rtags = remoteTags(repoDir, remote);
    if (rtags === null) {
        problems.push(`cannot reach '${remote}' (git ls-remote failed) -- the repo must be pushed to GitHub for jsDelivr to serve it.`);
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
        const lc = git(repoDir, ['rev-parse', '--verify', '--quiet', `refs/tags/${name}^{commit}`], { allowFail: true });
        if (lc.status === 0 && lc.stdout !== rt.commit) tagMismatch.push({ name, local: lc.stdout, remote: rt.commit });
    }
    for (const m of tagMismatch) {
        problems.push(`tag ${m.name} already exists on ${remote} and points at ${m.remote.slice(0, 8)}, but locally it points at ${m.local.slice(0, 8)} -- published tags are immutable; refusing to move or reuse it.`);
    }

    if (fetch && tagMismatch.length === 0) {
        const f = git(repoDir, ['fetch', remote, '--tags'], { allowFail: true });
        if (f.status !== 0) problems.push(`git fetch ${remote} --tags failed: ${f.stderr || f.stdout || '(no output)'}`);
    }

    // Remote main vs local HEAD.
    const rm = git(repoDir, ['ls-remote', remote, `refs/heads/${branch}`], { allowFail: true });
    const remoteMain = rm.status === 0 && rm.stdout ? rm.stdout.split(/\s+/)[0] : null;
    info.remoteMain = remoteMain;
    info.ahead = 0;
    if (remoteMain && remoteMain !== info.head) {
        const haveObj = git(repoDir, ['cat-file', '-e', `${remoteMain}^{commit}`], { allowFail: true }).status === 0;
        const isAncestor = haveObj && git(repoDir, ['merge-base', '--is-ancestor', remoteMain, 'HEAD'], { allowFail: true }).status === 0;
        if (!isAncestor) {
            problems.push(`local ${branch} is BEHIND or has DIVERGED from ${remote}/${branch} (${remoteMain.slice(0, 8)}${haveObj ? '' : ', not present locally'}) -- pull/merge first.`);
        } else {
            info.ahead = parseInt(git(repoDir, ['rev-list', '--count', `${remoteMain}..HEAD`]).stdout, 10);
        }
    } else if (!remoteMain) {
        // Remote has no main yet: everything is "ahead".
        info.ahead = parseInt(git(repoDir, ['rev-list', '--count', 'HEAD']).stdout, 10);
    }

    // Tags: union of local and remote whole-number tags.
    const localTags = git(repoDir, ['tag', '--list']).stdout.split('\n').filter(Boolean);
    const all = [...new Set([...localTags, ...Object.keys(rtags)])];
    info.latest = latestTag(all);
    const atHead = git(repoDir, ['tag', '--points-at', 'HEAD']).stdout.split('\n').filter(Boolean);
    info.headTag = latestTag(atHead);
    info.nextTag = releaseTagAfter(info.latest, firstTag);

    // A whole-number tag that exists only locally and is NOT at HEAD was created by an earlier run whose push
    // failed (or by hand). Publishing past it would leave a permanent gap in the tag sequence (that tag would
    // never reach origin), so stop and let a human publish or delete it. A local-only tag AT HEAD is fine: it is
    // an earlier run's release and gets pushed when it is reused.
    for (const t of sortTags(localTags)) {
        if (rtags[t] || t === info.headTag) continue;
        problems.push(`tag ${t} exists locally but not on ${remote}, and is not at HEAD -- an earlier publish never reached ${remote}. Push it (git push ${remote} ${t}) or delete it (git tag -d ${t}) before a linked deploy.`);
    }

    if (info.latest) {
        const tagCommit = git(repoDir, ['rev-parse', '--verify', '--quiet', `refs/tags/${info.latest}^{commit}`], { allowFail: true });
        info.latestCommit = tagCommit.status === 0 ? tagCommit.stdout : (rtags[info.latest] && rtags[info.latest].commit);
        const isAnc = tagCommit.status === 0 && git(repoDir, ['merge-base', '--is-ancestor', tagCommit.stdout, 'HEAD'], { allowFail: true }).status === 0;
        if (!isAnc) {
            problems.push(`latest tag ${info.latest} is not an ancestor of HEAD${tagCommit.status === 0 ? '' : ' (and not present locally)'} -- tags are immutable; reconcile ${branch} with ${info.latest} first.`);
        }
    }

    return { problems, info };
}

function runManifestVerify(pkgRoot) {
    const script = path.join(pkgRoot, 'tools', 'build-asset-manifest.ps1');
    if (!fs.existsSync(script)) return { skipped: true, ok: true };
    const r = child_process.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Verify'], { encoding: 'utf8' });
    if (r.error) return { ok: false, message: `could not launch powershell: ${r.error.message}` };
    return { ok: r.status === 0, message: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function runPackageTests(pkgRoot) {
    const dir = path.join(pkgRoot, 'tests');
    if (!fs.existsSync(path.join(dir, 'package.json'))) return { skipped: true, ok: true };
    // A fixed command string (no args array): npm is npm.cmd on Windows so a shell is needed, and passing
    // an args array together with `shell: true` is deprecated in Node (DEP0190) because args are not escaped.
    const r = child_process.spawnSync('npm run test:local', { cwd: dir, shell: true, encoding: 'utf8', stdio: 'inherit' });
    return { ok: r.status === 0, message: `npm run test:local exited ${r.status}` };
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
 * Work out everything the CDN must serve for these site texts at `tag`. `pkgRoot` is the package folder
 * (<repo>/<cdnSubpath>); every path is relative to it, exactly as jsDelivr serves it under the subpath.
 *  - literal package URLs (files): bytes from the local package tree (cross-checked against the manifest)
 *  - literal URLs ending in '/' are BASE PREFIXES (the page builds file URLs from them at runtime): not fetched
 *  - every manifest file under each site's domain folder (`<slug>/...`) -- covers runtime-built URLs
 * Returns { checks, local: [string] (problems found without the network), prefixes, templates, usedManifest }.
 */
function buildCdnChecks({ siteTexts, pkgRoot, spec, tag }) {
    const local = [];
    const prefixes = [];
    const templates = [];
    const wanted = new Map(); // path -> { expectBytes, labels }

    let manifest = null;
    const mpath = path.join(pkgRoot, 'assets-manifest.json');
    if (fs.existsSync(mpath)) {
        try { manifest = JSON.parse(fs.readFileSync(mpath, 'utf8').replace(/^﻿/, '')); }
        catch (e) { local.push(`assets-manifest.json is not valid JSON: ${e.message}`); }
    }
    const mfiles = new Map(((manifest && manifest.files) || []).map((f) => [f.path, f]));

    const add = (relPath, label) => {
        if (wanted.has(relPath)) { wanted.get(relPath).labels.add(label); return; }
        const abs = path.join(pkgRoot, relPath);
        const m = mfiles.get(relPath);
        let bytes;
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) bytes = fs.statSync(abs).size;
        if (bytes === undefined) {
            local.push(`${label}: references '${relPath}', which is not in the package tree (${spec.subpath || '.'}) at HEAD`);
            return;
        }
        if (m && m.bytes !== bytes) {
            local.push(`${label}: assets-manifest.json says ${relPath} is ${m.bytes} bytes but the file on disk is ${bytes} (manifest is stale)`);
            return;
        }
        wanted.set(relPath, { expectBytes: bytes, labels: new Set([label]) });
    };

    for (const { slug, text } of siteTexts) {
        for (const u of collectPackageUrls(text, spec)) {
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
        url: cdnUrl(spec, tag, p),
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
function siteHtmlFiles(site, deployRoot, expandFiles) {
    const dir = path.resolve(deployRoot, site.sourceDir);
    if (!fs.existsSync(dir)) return { dir, files: [] };
    const wanted = site.pinFiles || [site.stampFile || 'index.htm'];
    const uploaded = new Set(expandFiles(dir, site.files || ['index.htm']));
    const files = wanted.filter((f) => uploaded.has(f) && /\.html?$/i.test(f));
    return { dir, files };
}

/** Repo-relative folder of a site ('mindattic.com'), or null when the site lives outside the repo. */
function siteRelDir(repoDir, siteDir) {
    const rel = path.relative(repoDir, siteDir).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel;
}

// --- orchestration ----------------------------------------------------------

class LinkedAbort extends Error {}

/**
 * opts: { config, plan, dryRun, withTests, repoRoot }   (repoRoot = the MindAttic.Deploy folder; sourceDirs resolve from it)
 * deps: { log, expandFiles, deployOneSite(client, site, {skipHooks, skipStamp}), executeHooks(site, {tag}),
 *         stamp(absFile), createClient(), accessFtp(client, cfg), loadFtpSettings(), probe, rewriteUrl, retry,
 *         verifyManifest(pkgRoot), runTests(pkgRoot) }
 */
async function runLinked(opts, deps) {
    const { plan, dryRun, withTests, repoRoot } = opts;
    const log = deps.log || ((s) => process.stdout.write(s));
    const group = plan.group;
    const pkg = group.package;
    const spec = cdnSpec(pkg);
    const repoDir = path.resolve(repoRoot, pkg.sourceDir);
    const pkgRoot = spec.subpath ? path.join(repoDir, spec.subpath) : repoDir;
    const branch = pkg.branch || 'main';
    const remote = pkg.remote || 'origin';
    const wouldAbort = [];     // dry-run: gates that would stop a real run
    const result = { ok: true, aborted: false, tag: null, reused: false, commit: null, sites: [], wouldAbort };

    const gateFail = (msg) => {
        if (dryRun) { wouldAbort.push(msg); log(`  [WOULD ABORT] ${msg}\n`); }
        else throw new LinkedAbort(msg);
    };

    try {
        log(`\nLinked deploy: group '${plan.groupName}'${dryRun ? '  [DRY-RUN -- nothing is written, committed, tagged, pushed or uploaded]' : ''}\n`);
        log(`  package : ${pkg.slug} (${pkgRoot})  ->  ${cdnBase(spec, '<tag>')}\n`);
        log(`  repo    : ${pkg.repo} (${repoDir})\n`);
        log(`  sites   : ${plan.sites.map((s) => s.slug).join(' -> ')}   (FTP order)\n`);
        for (const w of plan.warnings || []) log(`  [warn] ${w}\n`);

        // 1. preflight ------------------------------------------------------
        log(`\n[1/8] preflight\n`);
        const { problems, info } = inspectRepo({ repoDir, branch, remote, fetch: !dryRun, firstTag: pkg.firstTag });
        for (const p of problems) gateFail(p);
        if (!info.head || !info.remoteReachable) throw new LinkedAbort('cannot continue without the package git repo and its remote.');

        const mv = (deps.verifyManifest || runManifestVerify)(pkgRoot);
        if (mv.skipped) log(`  [ok]   (no tools/build-asset-manifest.ps1 in ${spec.subpath || 'the package'} -- manifest gate skipped)\n`);
        else if (mv.ok) log(`  [ok]   assets-manifest.json is current\n`);
        else gateFail(`assets-manifest.json is stale or invalid -- run ${spec.subpath ? spec.subpath + '\\' : ''}tools\\build-asset-manifest.ps1 and commit it.\n    ${mv.message || ''}`);

        if (withTests) {
            const t = (deps.runTests || runPackageTests)(pkgRoot);
            if (t.skipped) log(`  [warn] --with-tests: no tests/ package found in ${pkg.slug}; skipped\n`);
            else if (t.ok) log(`  [ok]   package tests passed\n`);
            else gateFail(`package tests failed (${t.message})`);
        }

        const siteDirs = [];
        for (const site of plan.sites) {
            const { dir, files } = siteHtmlFiles(site, repoRoot, deps.expandFiles);
            if (!fs.existsSync(dir)) { gateFail(`site '${site.slug}': sourceDir not found: ${dir}`); continue; }
            if (files.length === 0) gateFail(`site '${site.slug}': no .htm/.html files matched ${JSON.stringify(site.files)} in ${dir}`);
            const rel = siteRelDir(repoDir, dir);
            if (rel === null) gateFail(`site '${site.slug}': ${dir} is not inside the package repo ${repoDir} -- a linked site must live in the same repo.`);
            else siteDirs.push(rel);
        }

        let ftpOk = true;
        try { deps.loadFtpSettings(); } catch (e) { ftpOk = false; if (dryRun) log(`  [warn] FTP secrets not resolvable (${e.message}) -- not needed for a dry-run\n`); else gateFail(`FTP secrets: ${e.message}`); }
        if (ftpOk) log(`  [ok]   FTP secrets resolvable\n`);

        log(`  [ok]   repo: HEAD ${info.head.slice(0, 8)} on ${info.currentBranch}, latest tag ${info.latest || '(none)'}${info.headTag ? ` (HEAD is ${info.headTag})` : ''}, ${info.ahead} commit(s) ahead of ${remote}/${branch}\n`);

        // Read the site pages now (before anything is written) so every "this can never work" condition
        // aborts BEFORE anything is committed or published.
        const readSites = () => plan.sites.map((site) => {
            const { dir, files } = siteHtmlFiles(site, repoRoot, deps.expandFiles);
            return { site, dir, files: files.map((f) => {
                const abs = path.join(dir, f);
                return { file: f, abs, text: fs.readFileSync(abs, 'utf8') };
            }) };
        });
        const siteState = readSites();

        // 2. release tag ----------------------------------------------------
        const pinsMatch = (tag) => siteState.every((st) => st.files.every((f) => rewritePins(f.text, tag, spec).changes.length === 0));
        const reuse = !!(info.latest && info.headTag === info.latest && pinsMatch(info.latest));
        const tag = reuse ? info.latest : info.nextTag;
        result.tag = tag;
        result.reused = reuse;
        const tagOnRemote = info.remoteTags[tag];
        if (reuse && tagOnRemote && tagOnRemote.commit !== info.head) {
            gateFail(`tag ${tag} already exists on ${remote} and points at ${tagOnRemote.commit.slice(0, 8)}, not HEAD (${info.head.slice(0, 8)}) -- published tags are immutable; refusing to move or reuse it.`);
        } else if (!reuse && tagOnRemote) {
            gateFail(`tag ${tag} already exists on ${remote} (${tagOnRemote.commit.slice(0, 8)}) -- published tags are immutable; refusing to reuse it.`);
        }
        log(`\n[2/8] release tag  ->  ${tag}${reuse ? '  (REUSED: HEAD already carries it and every page is pinned to it)' : `  (NEW${info.latest ? `, after ${info.latest}` : `, first tag ${pkg.firstTag || 'V1'}`})`}\n`);

        for (const st of siteState) for (const f of st.files) {
            const rw = rewritePins(f.text, tag, spec);
            f.rewritten = rw.text;
            f.changes = rw.changes;
        }
        // A pin NEWER than the release tag means the page references package work that was never tagged.
        for (const st of siteState) for (const f of st.files) {
            const newer = f.changes.filter((c) => parseTag(c.from) > parseTag(tag));
            if (newer.length) gateFail(`${st.site.slug}/${f.file} pins ${[...new Set(newer.map((c) => c.from))].join(', ')} but the release tag would be ${tag} -- the page references a package version that has not been tagged.`);
        }
        // Local-only asset checks (path exists in the package tree, manifest not stale, one tag everywhere).
        const early = buildCdnChecks({ siteTexts: siteState.flatMap((st) => st.files.map((f) => ({ slug: st.site.slug, text: f.rewritten }))), pkgRoot, spec, tag });
        for (const p of early.local) gateFail(p);

        // 3-5. prepare, commit, tag -----------------------------------------
        if (reuse) {
            log(`\n[3/8] prepare sites  -- skipped: the tagged commit already holds the pinned, spliced and stamped pages\n`);
            log(`[4/8] commit         -- skipped (reused tag)\n`);
            log(`[5/8] tag            -- skipped (${tag} already at HEAD)\n`);
        } else {
            log(`\n[3/8] prepare sites  (pin ${tag}, preDeploy hooks, stamp)\n`);
            for (const st of siteState) for (const f of st.files) {
                if (f.changes.length === 0) { log(`  [ok]   ${st.site.slug}/${f.file}: already pinned to ${tag}\n`); continue; }
                const froms = [...new Set(f.changes.map((c) => c.from))].join(', ');
                log(`  [pin]  ${st.site.slug}/${f.file}: ${froms} -> ${tag}  (${f.changes.length} pin(s), line(s) ${f.changes.slice(0, 8).map((c) => c.line).join(', ')}${f.changes.length > 8 ? ', ...' : ''})${dryRun ? '  [dry-run: not written]' : ''}\n`);
            }
            if (dryRun) {
                for (const site of plan.sites) {
                    for (const h of site.preDeploy || []) log(`  [hook] (dry-run) ${site.slug}: would run ${h.kind}${h.file ? ' ' + h.file : ''}${h.tagArg ? ` ${h.tagArg} ${tag}` : ''}${h.required === false ? ' (optional)' : ''}\n`);
                    if (site.stampFile) log(`  [stamp] (dry-run) ${site.slug}: would stamp ${site.stampFile}\n`);
                }
                log(`\n[4/8] commit  (dry-run) would commit the site changes: "Pin ${pkg.slug} ${tag}"\n`);
                log(`[5/8] tag     (dry-run) would tag -a ${tag} on that commit\n`);
            } else {
                // From here until the commit, any failure restores the tree preflight found clean.
                try {
                    for (const st of siteState) for (const f of st.files) if (f.changes.length) fs.writeFileSync(f.abs, f.rewritten, 'utf8');
                    for (const site of plan.sites) {
                        if ((site.preDeploy || []).length === 0) { log(`  [ok]   ${site.slug}: no hooks\n`); continue; }
                        log(`  ${site.slug}:\n`);
                        await deps.executeHooks(site, { tag, skipPackagePull: true });
                    }
                    for (const site of plan.sites) {
                        if (!site.stampFile) continue;
                        const abs = path.join(path.resolve(repoRoot, site.sourceDir), site.stampFile);
                        if (!fs.existsSync(abs)) { log(`  [stamp] ${site.slug}: skipped (${site.stampFile} not found)\n`); continue; }
                        if (!deps.stamp) { log(`  [stamp] ${site.slug}: skipped (no stamp function wired)\n`); continue; }
                        const when = deps.stamp(abs);
                        log(`  [stamp] ${site.slug}/${site.stampFile} <- ${when}\n`);
                    }
                    const changed = porcelainPaths(repoDir);
                    const outside = changed.filter((p) => !siteDirs.some((d) => p === d || p.startsWith(d + '/')));
                    if (outside.length) {
                        throw new LinkedAbort(`a preDeploy hook changed ${outside.length} file(s) outside the group's site folders (${siteDirs.join(', ')}); refusing to commit them:\n    ${outside.slice(0, 15).join('\n    ')}`);
                    }

                    log(`\n[4/8] commit\n`);
                    if (changed.length === 0) {
                        log(`  [git]  nothing changed; tagging HEAD as is\n`);
                    } else {
                        git(repoDir, ['add', '-A', '--', ...siteDirs]);
                        const msg = `Pin ${pkg.slug} ${tag}`;
                        const c = git(repoDir, ['commit', '-m', msg], { allowFail: true });
                        if (c.status !== 0) throw new LinkedAbort(`git commit failed: ${c.stderr || c.stdout}`);
                        log(`  [git]  commit "${msg}"  (${changed.length} file(s))\n`);
                    }
                } catch (e) {
                    log(`  [git]  restoring the working tree (reset --hard HEAD, clean -fd)\n`);
                    git(repoDir, ['reset', '--hard', 'HEAD'], { allowFail: true });
                    git(repoDir, ['clean', '-fd'], { allowFail: true });
                    throw e;
                }
                result.commit = git(repoDir, ['rev-parse', 'HEAD']).stdout;

                log(`\n[5/8] tag\n`);
                const tmsg = buildTagMessage(repoDir, tag, info.latest);
                const t = git(repoDir, ['tag', '-a', tag, '-m', tmsg], { allowFail: true });
                if (t.status !== 0) throw new LinkedAbort(`git tag -a ${tag} failed: ${t.stderr || t.stdout}\n        The pin commit ${result.commit.slice(0, 8)} is local only.`);
                log(`  [git]  tag -a ${tag} -> ${result.commit.slice(0, 8)}\n`);
            }
        }

        // 6. push -----------------------------------------------------------
        log(`\n[6/8] push\n`);
        const head = dryRun ? info.head : git(repoDir, ['rev-parse', 'HEAD']).stdout;
        const mainNeedsPush = !dryRun ? head !== info.remoteMain : (!reuse || info.ahead > 0);
        const tagNeedsPush = !tagOnRemote;
        if (dryRun) {
            log(`  [git]  (dry-run) ${mainNeedsPush ? `would push ${remote} ${branch}` : `${branch} already on ${remote}`}; ${tagNeedsPush ? `would push ${remote} ${tag}` : `${tag} already on ${remote}`}\n`);
        } else {
            if (mainNeedsPush) {
                log(`  [git]  push ${remote} ${branch}\n`);
                const p = git(repoDir, ['push', remote, branch], { allowFail: true });
                if (p.status !== 0) throw new LinkedAbort(`git push ${remote} ${branch} was rejected: ${p.stderr}\n        The commit and tag ${tag} exist locally only; the next run reuses them and pushes again.`);
            } else {
                log(`  [git]  ${branch} already on ${remote}; nothing to push\n`);
            }
            if (tagNeedsPush) {
                log(`  [git]  push ${remote} ${tag}\n`);
                const p = git(repoDir, ['push', remote, `refs/tags/${tag}`], { allowFail: true });
                if (p.status !== 0) throw new LinkedAbort(`git push ${remote} ${tag} was rejected: ${p.stderr}\n        The next run reuses the local tag and pushes again.`);
            } else {
                log(`  [git]  ${tag} already on ${remote} at HEAD; nothing to push\n`);
            }
        }

        // 7. CDN gate -------------------------------------------------------
        log(`\n[7/8] CDN gate  (every asset the sites use must be live on jsDelivr at ${tag}, byte-exact)\n`);
        const siteTexts = [];
        for (const st of siteState) {
            for (const f of st.files) {
                // After hooks (real run) the committed file is the truth; in a dry-run use the would-be text.
                const text = dryRun ? f.rewritten : fs.readFileSync(f.abs, 'utf8');
                siteTexts.push({ slug: st.site.slug, text });
            }
        }
        const gate = buildCdnChecks({ siteTexts, pkgRoot, spec, tag });
        for (const p of gate.local) gateFail(p);
        for (const p of gate.templates) log(`  [info] ${p.site}: ignoring template/example URL ${p.url}\n`);
        for (const p of gate.prefixes) log(`  [info] ${p.site}: base prefix ${p.url} (files under it are built at runtime; covered by the manifest)\n`);
        if (!gate.usedManifest) log(`  [warn] no assets-manifest.json in the package -- only literal URLs can be verified\n`);
        log(`  [cdn]  ${gate.checks.length} URL(s) to verify\n`);

        const tagPublished = !dryRun || !!tagOnRemote;
        if (!tagPublished) {
            log(`  [cdn]  (dry-run) ${tag} is not published yet -- the live CDN check would run after the push\n`);
        } else if (gate.checks.length) {
            const v = await verifyCdn({
                checks: gate.checks, rewriteUrl: deps.rewriteUrl, probe: deps.probe || httpProbe,
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
                gateFail(`${v.failures.length} of ${gate.checks.length} CDN URL(s) failed verification at ${tag}:\n${lines}`);
            } else {
                log(`  [ok]   all ${gate.checks.length} URL(s) live at ${tag} with matching bytes\n`);
            }
        }

        // 8. FTP ------------------------------------------------------------
        log(`\n[8/8] FTP deploy${dryRun ? '  [DRY-RUN]' : ''}\n`);
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
                    // Hooks ran and the stamp was committed in step 3; the upload sends the committed page as is.
                    const r = await deps.deployOneSite(client, site, { skipHooks: true, skipStamp: true });
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
        log(`\nLinked deploy summary  (${pkg.slug} @ ${tag}${reuse ? ', reused' : ''})\n`);
        for (const s of result.sites) {
            const status = dryRun ? 'dry-run' : (s.error || s.failed ? 'FAILED' : 'ok');
            log(`  ${s.slug.padEnd(22)} ${String(s.uploaded).padStart(3)} uploaded  ${String(s.failed).padStart(2)} failed  ${status}${s.error ? '  (' + s.error + ')' : ''}\n`);
        }
        if (!dryRun) {
            const dirty = porcelainPaths(repoDir);
            const rm = git(repoDir, ['ls-remote', remote, `refs/heads/${branch}`], { allowFail: true });
            const remoteMain = rm.status === 0 && rm.stdout ? rm.stdout.split(/\s+/)[0] : null;
            const localHead = git(repoDir, ['rev-parse', 'HEAD']).stdout;
            if (dirty.length === 0 && remoteMain === localHead) log(`  [ok]   ${pkg.repo}: working tree clean, ${branch} in sync with ${remote} at ${localHead.slice(0, 8)} (${tag})\n`);
            else {
                const notes = [];
                if (dirty.length) notes.push(`${dirty.length} uncommitted change(s)`);
                if (remoteMain !== localHead) notes.push(`${branch} differs from ${remote}/${branch}`);
                log(`  [note] ${pkg.repo}: ${notes.join(', ')} after the deploy\n`);
            }
        }
        const bad = result.sites.filter((s) => s.error || s.failed);
        result.ok = dryRun ? true : bad.length === 0;
        if (dryRun && wouldAbort.length) log(`\nDry-run complete: ${wouldAbort.length} gate(s) WOULD ABORT a real run (see [WOULD ABORT] lines).\n`);
        else if (dryRun) log(`\nDry-run complete: a real run would pass every gate and upload ${plan.sites.length} site(s).\n`);
        else log(bad.length ? `\nDone with ${bad.length} failed site(s).\n` : `\nDone. All ${result.sites.length} site(s) deployed against ${pkg.slug}@${tag}.\n`);
    } catch (e) {
        if (!(e instanceof LinkedAbort)) throw e;
        result.ok = false;
        result.aborted = true;
        log(`\n[ABORT] ${e.message}\n        Nothing was uploaded.\n`);
    }
    return result;
}

module.exports = {
    parseTag, sortTags, latestTag, nextTag, releaseTagAfter,
    planTargets, findGroupOfSite,
    cdnSpec, cdnBase, rewritePins, collectPackageUrls, cdnUrl,
    inspectRepo, remoteTags, buildTagMessage,
    httpProbe, verifyCdn, buildCdnChecks,
    runManifestVerify, runPackageTests,
    runLinked, LinkedAbort,
};
