/**
 * Tests for src/linked.js (linked-group deploy) and the src/deploy.js CLI guards.
 *
 *   npm test        (node --test test/)
 *
 * Everything runs against throwaway fixtures: ONE temp git repo (like MindAttic.Web) holding a `Shared/`
 * package folder and the site folders, with a local bare "origin"; a local http server standing in for
 * jsDelivr that serves each file from the PUBLISHED tag in origin (`git show <tag>:Shared/<path>`); and an
 * injected fake FTP. No test touches the real MindAttic.Web repo, the real CDN, or a real FTP server.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const L = require('../src/linked');

const SCRATCH = process.env.TEST_SCRATCH || os.tmpdir();
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Linked Test';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'linked@test.invalid';

const REPO = 'mindattic/Test.Web';
const SUB = 'Shared';
const SPEC = { repo: REPO, subpath: SUB };
const CDN = `https://cdn.jsdelivr.net/gh/${REPO}`;
const PKG_SLUG = 'Test.Web.Shared';
const FAST_RETRY = { totalMs: 250, baseMs: 20, maxMs: 40 };
const MEMBERS = ['a.test', 'b.test', 'c.test'];

// --- helpers ----------------------------------------------------------------

function git(cwd, ...args) {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function walk(dir, base = dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p, base));
        else out.push(path.relative(base, p).replace(/\\/g, '/'));
    }
    return out;
}

function writeManifest(shared) {
    const files = [];
    for (const root of [...MEMBERS, 'fonts']) {
        for (const rel of walk(path.join(shared, root), shared)) {
            files.push({ path: rel, bytes: fs.statSync(path.join(shared, rel)).size });
        }
    }
    write(path.join(shared, 'assets-manifest.json'), JSON.stringify({ count: files.length, files }, null, 2));
}

const PIN = (tag) => `${CDN}@${tag}/${SUB}`;

function siteHtml(slug, tag) {
    return [
        '<!doctype html><html><head>',
        `<link rel="preload" as="font" crossorigin href="${PIN(tag)}/fonts/f.woff2">`,
        `<link rel="icon" href="${PIN(tag)}/${slug}/logos/logo.png">`,
        '</head><body>',
        // a base prefix: files under it are built at runtime (like ryandebraal.com's themes)
        `<script>const ASSET_BASE = '${PIN(tag)}/${slug}/'; const x = ASSET_BASE + 'themes/x/x-01.jpg';</script>`,
        // other jsDelivr URLs must never be touched by the pin rewrite
        '<script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></script>',
        `</body></html>`,
    ].join('\n');
}

/**
 * One monorepo `web/` (Shared/ package + site folders a.test, b.test, c.test) + a bare origin; a non-member
 * site outside the repo. Pages pinned to `pin`; with `tag` set, HEAD is tagged and pushed (like a finished deploy).
 */
function makeWorld({ tag = 'V1', pin = tag || 'V1', firstTag } = {}) {
    const root = fs.mkdtempSync(path.join(SCRATCH, 'linked-test-'));
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'web');
    const shared = path.join(repo, SUB);
    fs.mkdirSync(origin);
    spawnSync('git', ['init', '--bare', '-b', 'main', origin]);
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-b', 'main', repo]);
    write(path.join(shared, 'fonts', 'f.woff2'), 'wOF2-font-bytes-0123456789');
    for (const slug of MEMBERS) {
        write(path.join(shared, slug, 'logos', 'logo.png'), `png-${slug}-` + 'x'.repeat(40));
        write(path.join(shared, slug, 'themes', 'x', 'x-01.jpg'), `jpg-${slug}-` + 'y'.repeat(70));
    }
    writeManifest(shared);

    const sites = [];
    for (const slug of [...MEMBERS, 'other.test']) {
        const rel = slug === 'other.test' ? 'site-other.test' : path.join('web', slug);
        const dir = path.join(root, rel);
        write(path.join(dir, 'index.htm'), siteHtml(slug, pin));
        const site = { slug, sourceDir: rel.replace(/\\/g, '/'), files: ['index.htm'], stampFile: 'index.htm', ftpRemotePath: '/' + slug };
        if (slug === 'a.test') {
            // like mindattic.com: a generated README.htm is uploaded too; its body is DOCUMENTATION with example URLs
            write(path.join(dir, 'README.htm'), `<p>Pattern: ${PIN(pin)}/&lt;path&gt; and an example ${PIN(pin)}/not-a-real-file.png</p>`);
            site.files = ['index.htm', 'README.htm'];
        }
        // c.test mimics mindattic.com: package-pull + a sync hook that takes the tag
        if (slug === 'c.test') site.preDeploy = [{ kind: 'package-pull' }, { kind: 'powershell', file: 'sync.ps1', tagArg: '-CyberspaceCdnTag' }];
        sites.push(site);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'initial monorepo');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', 'origin', 'main');
    if (tag) {
        git(repo, 'tag', '-a', tag, '-m', tag);
        git(repo, 'push', 'origin', tag);
    }
    const pkg = { slug: PKG_SLUG, sourceDir: 'web', repo: REPO, cdnSubpath: SUB };
    if (firstTag) pkg.firstTag = firstTag;
    const config = { linkedGroups: { grp: { package: pkg, sites: [...MEMBERS] } }, sites };
    const siteFile = (slug) => path.join(root, slug === 'other.test' ? 'site-other.test' : path.join('web', slug), 'index.htm');
    return { root, origin, repo, shared, config, siteFile };
}

/** Put the package ahead of the latest tag (a new committed asset) so the release tag becomes the next one. */
function addCommit(world, name = 'new') {
    write(path.join(world.shared, 'a.test', 'logos', `${name}.png`), `png-${name}-` + 'z'.repeat(30));
    writeManifest(world.shared);
    git(world.repo, 'add', '-A');
    git(world.repo, 'commit', '-m', `add ${name}`);
}

/** Commit a change to a site page (so preflight stays clean). */
function commitPage(world, slug, html) {
    write(world.siteFile(slug), html);
    git(world.repo, 'add', '-A');
    git(world.repo, 'commit', '-m', `edit ${slug}`);
}

/** Local http server standing in for jsDelivr: serves /gh/<repo>@<tag>/Shared/<path> from the tag PUBLISHED in origin. */
function startCdn(world) {
    const state = { missing: new Set(), wrongLen: new Set(), noCors: new Set(), hits: [] };
    const re = new RegExp(`^/gh/${REPO.replace(/[.]/g, '\\.')}@([^/]+)/${SUB}/(.*)$`);
    const srv = http.createServer((req, res) => {
        state.hits.push(`${req.method} ${req.url}`);
        const m = re.exec(req.url.split('?')[0]);
        if (!m) { res.writeHead(404); return res.end(); }
        const rel = decodeURIComponent(m[2]);
        const show = spawnSync('git', ['-C', world.origin, 'show', `${m[1]}:${SUB}/${rel}`]);
        if (state.missing.has(rel) || show.status !== 0) { res.writeHead(404); return res.end(); }
        const body = show.stdout;
        const headers = { 'content-type': 'application/octet-stream', 'content-length': body.length + (state.wrongLen.has(rel) ? 1 : 0) };
        if (!state.noCors.has(rel)) headers['access-control-allow-origin'] = '*';
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : body);
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        resolve({
            state, port,
            rewriteUrl: (u) => u.replace('https://cdn.jsdelivr.net', `http://127.0.0.1:${port}`),
            close: () => new Promise((r) => srv.close(r)),
        });
    }));
}

let stampCounter = 0;
function fakeStamp(abs) {
    const when = `T${++stampCounter}`;
    const text = fs.readFileSync(abs, 'utf8').replace(/^<!-- Last Updated: .*? -->\n/, '');
    fs.writeFileSync(abs, `<!-- Last Updated: ${when} -->\n${text}`);
    return when;
}

function makeDeps(world, cdn, extra = {}) {
    const calls = { deploy: [], hooks: [], accessed: 0, closed: 0 };
    const logs = [];
    const deps = {
        log: (s) => logs.push(s),
        expandFiles: (dir, pats) => pats.filter((p) => fs.existsSync(path.join(dir, p))),
        deployOneSite: async (client, site, opts) => {
            calls.deploy.push({ slug: site.slug, client, opts });
            if (extra.failSite === site.slug) throw new Error('simulated FTP failure');
            return { uploaded: 1, failed: 0 };
        },
        executeHooks: async (site, opts) => { calls.hooks.push({ slug: site.slug, opts }); if (extra.hook) extra.hook(site, opts); },
        stamp: fakeStamp,
        createClient: () => ({ close() { calls.closed++; } }),
        accessFtp: async () => { calls.accessed++; },
        loadFtpSettings: () => ({ host: 'fake' }),
        rewriteUrl: cdn ? cdn.rewriteUrl : undefined,
        retry: FAST_RETRY,
    };
    return { deps, calls, logs, text: () => logs.join('') };
}

function plan(world) { return L.planTargets(world.config, { siteSlug: 'a.test' }); }

function snapshotSites(world) {
    const h = {};
    for (const s of world.config.sites) h[s.slug] = crypto.createHash('sha256').update(fs.readFileSync(world.siteFile(s.slug))).digest('hex');
    return h;
}

function repoState(world) {
    return {
        head: git(world.repo, 'rev-parse', 'HEAD'),
        status: git(world.repo, 'status', '--porcelain', '--untracked-files=all'),
        tags: git(world.repo, 'tag', '--list'),
        origin: git(world.origin, 'for-each-ref'),
        sites: snapshotSites(world),
    };
}

const run = (world, deps, o = {}) => L.runLinked({ config: world.config, plan: plan(world), dryRun: !!o.dryRun, withTests: false, repoRoot: world.root }, deps);

// --- tag math ---------------------------------------------------------------

test('tags: whole numbers sort numerically (V10 > V9), junk is ignored; firstTag is the floor', () => {
    assert.equal(L.parseTag('V9'), 9);
    assert.equal(L.parseTag('v9'), null);
    assert.equal(L.parseTag('V1.2'), null);
    assert.deepEqual(L.sortTags(['V10', 'V2', 'V9', 'beta', 'v3']), ['V2', 'V9', 'V10']);
    assert.equal(L.latestTag(['V9', 'V10', 'V2', 'main']), 'V10');
    assert.equal(L.latestTag(['nope']), null);
    assert.equal(L.nextTag('V9'), 'V10');
    assert.equal(L.nextTag('V99'), 'V100');
    assert.throws(() => L.nextTag('main'));
    assert.equal(L.releaseTagAfter(null, 'V12'), 'V12');
    assert.equal(L.releaseTagAfter(null, undefined), 'V1');
    assert.equal(L.releaseTagAfter('V12', 'V12'), 'V13');
    assert.equal(L.releaseTagAfter('V3', 'V12'), 'V12');
});

// --- expansion rules --------------------------------------------------------

test('expansion: --site <member>, --sites and --uiux all mean the whole group; --no-link is the escape hatch', () => {
    const { config } = makeWorld();
    const order = (p) => p.sites.map((s) => s.slug).join(',');

    let p = L.planTargets(config, { siteSlug: 'b.test' });
    assert.equal(p.kind, 'linked');
    assert.equal(order(p), 'a.test,b.test,c.test');

    p = L.planTargets(config, { allSites: true });
    assert.equal(p.kind, 'linked');
    assert.equal(order(p), 'a.test,b.test,c.test');
    assert.deepEqual(p.others.map((s) => s.slug), ['other.test']);

    p = L.planTargets(config, { uiux: true });
    assert.equal(p.kind, 'linked');
    assert.equal(order(p), 'a.test,b.test,c.test');

    p = L.planTargets(config, { siteSlug: 'other.test' });          // not a member -> plain
    assert.equal(p.kind, 'plain');
    assert.equal(order(p), 'other.test');

    p = L.planTargets(config, { siteSlug: 'c.test', noLink: true }); // escape hatch + loud warning
    assert.equal(p.kind, 'plain');
    assert.equal(order(p), 'c.test');
    assert.equal(p.warnings.length, 1);
    assert.match(p.warnings[0], /ALONE/);

    assert.throws(() => L.planTargets(config, { uiux: true, noLink: true }), /cannot be combined/);
    assert.throws(() => L.planTargets(config, { siteSlug: 'nope.test' }), /No site with slug/);
});

test('cli: unknown flags still exit 2; --help documents the new flags', () => {
    const node = process.execPath;
    const script = path.join(__dirname, '..', 'src', 'deploy.js');
    let r = spawnSync(node, [script, '--bogus'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown flag --bogus/);
    r = spawnSync(node, [script, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    for (const f of ['--uiux', '--package', '--no-link', '--with-tests', 'MindAttic.Web.Shared']) assert.ok(r.stdout.includes(f), `help mentions ${f}`);
});

// --- pins / urls ------------------------------------------------------------

test('pins: rewrite is idempotent, only touches <repo>@V<n>/<subpath>/ pins, reports lines', () => {
    const html = siteHtml('a.test', 'V1');
    const r1 = L.rewritePins(html, 'V8', SPEC);
    assert.ok(r1.changes.length >= 3);
    assert.ok(r1.changes.every((c) => c.from === 'V1' && c.to === 'V8' && c.line > 0));
    assert.ok(!r1.text.includes('Test.Web@V1/'));
    assert.ok(r1.text.includes('html2pdf.js@0.10.2'), 'npm package URL untouched');
    const r2 = L.rewritePins(r1.text, 'V8', SPEC);
    assert.equal(r2.changes.length, 0);
    assert.equal(r2.text, r1.text);
    // another repo's pin on the same CDN is not ours
    const other = '<script src="https://cdn.jsdelivr.net/gh/someone/Else@V3/Shared/x.js"></script>';
    assert.equal(L.rewritePins(other, 'V8', SPEC).text, other);
    // the same repo outside the package subpath is not a package pin
    const sibling = `<img src="${CDN}@V3/a.test/x.png">`;
    assert.equal(L.rewritePins(sibling, 'V8', SPEC).text, sibling);
    // @main is not a V-pin: never rewritten (the gate rejects it instead)
    const main = `<script src="${CDN}@main/${SUB}/x.js"></script>`;
    assert.equal(L.rewritePins(main, 'V8', SPEC).text, main);
});

test('urls: CDN URLs carry the subpath; base prefixes are prefixes, files are files', () => {
    assert.equal(L.cdnUrl(L.cdnSpec({ repo: REPO, cdnSubpath: '/Shared/' }), 'V3', 'fonts/a b.woff2'), `${CDN}@V3/Shared/fonts/a%20b.woff2`);
    const urls = L.collectPackageUrls(siteHtml('b.test', 'V3'), SPEC);
    const prefix = urls.find((u) => u.path === 'b.test/');
    assert.ok(prefix && prefix.isPrefix, 'base prefix flagged');
    const font = urls.find((u) => u.path === 'fonts/f.woff2');
    assert.ok(font && !font.isPrefix);
    assert.equal(font.url, `${CDN}@V3/Shared/fonts/f.woff2`);
    assert.ok(!urls.some((u) => u.url.includes('html2pdf')), 'npm URL ignored');
});

// --- preflight --------------------------------------------------------------

test('preflight: a dirty tree aborts BEFORE anything is pinned, committed, tagged, pushed, or uploaded', async () => {
    const w = makeWorld();
    addCommit(w);
    write(path.join(w.shared, 'a.test', 'logos', 'dirty.png'), 'uncommitted');
    const head = git(w.repo, 'rev-parse', 'HEAD');
    const sites = snapshotSites(w);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /uncommitted change/);
    assert.equal(d.calls.deploy.length, 0, 'no FTP');
    assert.equal(git(w.repo, 'rev-parse', 'HEAD'), head, 'no commit');
    assert.deepEqual(snapshotSites(w), sites, 'no pin edits');
    assert.equal(git(w.repo, 'tag', '--list', 'V2'), '', 'no tag created');
    assert.equal(git(w.origin, 'tag', '--list'), 'V1', 'nothing pushed');
});

test('preflight: local main behind origin aborts', async () => {
    const w = makeWorld();
    const other = path.join(w.root, 'other-clone');
    spawnSync('git', ['clone', w.origin, other]);
    write(path.join(other, 'README.md'), 'someone else pushed');
    git(other, 'add', '-A'); git(other, 'commit', '-m', 'upstream change'); git(other, 'push', 'origin', 'main');
    addCommit(w);                       // local also moved -> diverged
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /BEHIND or has DIVERGED/);
    assert.equal(d.calls.deploy.length, 0);
});

test('preflight: a tag that already exists on origin pointing elsewhere is never moved/reused', async () => {
    const w = makeWorld();
    const other = path.join(w.root, 'other-clone');
    spawnSync('git', ['clone', w.origin, other]);
    write(path.join(other, 'x.txt'), 'diverge');
    git(other, 'add', '-A'); git(other, 'commit', '-m', 'other');
    git(other, 'tag', '-f', '-a', 'V1', '-m', 'moved');
    git(other, 'push', '-f', 'origin', 'refs/tags/V1');
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /tag V1 already exists on origin and points at/);
    assert.match(d.text(), /immutable/);
    assert.equal(d.calls.deploy.length, 0);
});

test('preflight: a page pinned to a tag NEWER than the release tag aborts before anything is written', async () => {
    const w = makeWorld();
    commitPage(w, 'b.test', siteHtml('b.test', 'V9'));       // release would be V2, but a page already pins V9
    const before = repoState(w);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /pins V9 but the release tag would be V2/);
    assert.deepEqual(repoState(w), before, 'nothing written, committed, tagged or pushed');
});

test('preflight: a linked site outside the package repo aborts', async () => {
    const w = makeWorld();
    w.config.sites.find((s) => s.slug === 'b.test').sourceDir = 'site-other.test';
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /is not inside the package repo/);
});

// --- happy path -------------------------------------------------------------

test('happy path: pins + hooks + stamps -> commit "Pin <pkg> V2" -> tag -> push -> CDN gate -> FTP in group order', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w);
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();

    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2');
    assert.equal(res.reused, false);
    // one pin commit, tagged, pushed
    const head = git(w.repo, 'rev-parse', 'HEAD');
    assert.equal(res.commit, head);
    assert.equal(git(w.repo, 'log', '-1', '--pretty=%s'), `Pin ${PKG_SLUG} V2`);
    assert.equal(git(w.repo, 'rev-parse', 'V2^{commit}'), head);
    assert.equal(git(w.origin, 'rev-parse', 'refs/heads/main'), head);
    assert.equal(git(w.origin, 'rev-parse', 'V2^{commit}'), head);
    assert.match(git(w.repo, 'tag', '-n5', '--list', 'V2'), /add new/);   // tag message lists the commits
    // the commit touches only site folders
    const touched = git(w.repo, 'show', '--name-only', '--pretty=', 'HEAD').split('\n');
    assert.deepEqual(touched.sort(), MEMBERS.map((s) => `${s}/index.htm`));
    // pins rewritten + stamped everywhere; npm URL untouched; tree clean
    for (const slug of MEMBERS) {
        const t = fs.readFileSync(w.siteFile(slug), 'utf8');
        assert.ok(t.includes('Test.Web@V2/Shared/') && !t.includes('Test.Web@V1/'), `${slug} pinned to V2`);
        assert.match(t, /^<!-- Last Updated: T\d+ -->/, `${slug} stamped`);
        assert.ok(t.includes('html2pdf.js@0.10.2'));
    }
    assert.equal(git(w.repo, 'status', '--porcelain', '--untracked-files=all'), '', 'repo clean after the deploy');
    assert.match(d.text(), /working tree clean, main in sync with origin/);
    assert.ok(fs.readFileSync(w.siteFile('other.test'), 'utf8').includes('Test.Web@V1/'), 'non-member site untouched');
    // hooks ran with the tag, FTP in order with hooks + stamp skipped (both happened before the commit)
    assert.deepEqual(d.calls.hooks.map((h) => [h.slug, h.opts.tag, h.opts.skipPackagePull]), [['c.test', 'V2', true]]);
    assert.deepEqual(d.calls.deploy.map((c) => c.slug), MEMBERS);
    assert.ok(d.calls.deploy.every((c) => c.opts.skipHooks === true && c.opts.skipStamp === true));
    assert.equal(d.calls.accessed, 1);
    assert.equal(d.calls.closed, 1);
    assert.match(d.text(), /Done\. All 3 site\(s\) deployed/);
    // the runtime-built theme file under the base prefix was verified via the manifest, the prefix itself never fetched
    const hits = cdn.state.hits.map((h) => h.split(' ')[1]);
    assert.ok(hits.some((u) => u.endsWith('/Shared/b.test/themes/x/x-01.jpg')), 'manifest file under the domain folder checked');
    assert.ok(!hits.some((u) => u.endsWith('/b.test/')), 'base prefix never requested as a file');
});

test('re-running with nothing new reuses the tag: no commit, no tag, no push, no pin edits, still deploys', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w);
    let d = makeDeps(w, cdn);
    await run(w, d.deps);                                   // first run publishes V2
    const before = repoState(w);
    d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2');
    assert.equal(res.reused, true);
    assert.deepEqual(repoState(w), before, 'nothing written, committed, tagged or pushed');
    assert.equal(d.calls.hooks.length, 0, 'hooks not re-run on a reused tag');
    assert.match(d.text(), /REUSED/);
    assert.match(d.text(), /already on origin; nothing to push/);
    assert.equal(d.calls.deploy.length, 3);
});

test('firstTag: a repo with no whole-number tag yet releases package.firstTag', async () => {
    const w = makeWorld({ tag: null, pin: 'V11', firstTag: 'V12' });
    const cdn = await startCdn(w);
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V12');
    assert.equal(git(w.origin, 'tag', '--list'), 'V12');
    assert.ok(fs.readFileSync(w.siteFile('a.test'), 'utf8').includes('Test.Web@V12/Shared/'));
    assert.match(d.text(), /V11 -> V12/);
});

test('a hook that changes a file outside the site folders aborts and restores the tree', async () => {
    const w = makeWorld();
    addCommit(w);
    const before = repoState(w);
    const d = makeDeps(w, null, { hook: () => write(path.join(w.shared, 'stray.txt'), 'hook output') });
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /outside the group's site folders/);
    assert.match(d.text(), /Shared\/stray\.txt/);
    assert.deepEqual(repoState(w), before, 'pins, stamps and hook output rolled back; nothing committed or tagged');
    assert.equal(d.calls.deploy.length, 0);
});

test('a failing hook aborts and restores the tree', async () => {
    const w = makeWorld();
    addCommit(w);
    const before = repoState(w);
    const d = makeDeps(w, null);
    d.deps.executeHooks = async () => { throw new L.LinkedAbort('hook exited 1'); };
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.deepEqual(repoState(w), before);
});

// --- CDN gate ---------------------------------------------------------------

for (const [name, mutate, expect] of [
    ['404 on a runtime-built file only the manifest knows about', (s) => s.missing.add('b.test/themes/x/x-01.jpg'), /HTTP 404/],
    ['wrong content-length', (s) => s.wrongLen.add('fonts/f.woff2'), /content-length \d+ != expected \d+/],
    ['missing access-control-allow-origin', (s) => s.noCors.add('a.test/logos/logo.png'), /access-control-allow-origin is missing/],
]) {
    test(`CDN gate: ${name} aborts before any FTP`, async () => {
        const w = makeWorld();
        addCommit(w);
        const cdn = await startCdn(w);
        mutate(cdn.state);
        const d = makeDeps(w, cdn);
        const res = await run(w, d.deps);
        await cdn.close();
        assert.equal(res.ok, false);
        assert.equal(res.aborted, true);
        assert.match(d.text(), expect);
        assert.match(d.text(), /\[ABORT\].*CDN URL\(s\) failed verification/s);
        assert.equal(d.calls.deploy.length, 0, 'FTP never reached');
        assert.equal(d.calls.accessed, 0, 'FTP never connected');
    });
}

test('CDN gate: a literal reference to a file that is not in the package tree aborts locally (before any write)', async () => {
    const w = makeWorld();
    commitPage(w, 'c.test', siteHtml('c.test', 'V1') + `<img src="${PIN('V1')}/c.test/logos/does-not-exist.png">`);
    const before = repoState(w);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /does-not-exist\.png', which is not in the package tree/);
    assert.deepEqual(repoState(w), before, 'aborted before pinning or tagging');
});

test('CDN gate: @main references are rejected', async () => {
    const w = makeWorld();
    commitPage(w, 'a.test', siteHtml('a.test', 'V1') + `<script src="${CDN}@main/${SUB}/fonts/f.woff2"></script>`);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /pinned to 'main', expected release tag V2/);
});

test('buildCdnChecks: manifest + literal URLs deduplicate, prefixes are not fetched, URLs carry the subpath', () => {
    const w = makeWorld();
    const { checks, prefixes, local } = L.buildCdnChecks({
        siteTexts: [{ slug: 'b.test', text: siteHtml('b.test', 'V1') }], pkgRoot: w.shared, spec: SPEC, tag: 'V1',
    });
    assert.equal(local.length, 0, local.join('; '));
    assert.equal(prefixes.length, 1);
    const urls = checks.map((c) => c.url);
    assert.equal(new Set(urls).size, urls.length, 'no duplicates');
    assert.ok(urls.includes(`${PIN('V1')}/fonts/f.woff2`));
    assert.ok(urls.includes(`${PIN('V1')}/b.test/logos/logo.png`));
    assert.ok(urls.includes(`${PIN('V1')}/b.test/themes/x/x-01.jpg`));
    assert.ok(!urls.some((u) => u.includes('/a.test/')), 'other sites\' folders not checked for b.test');
});

// --- dry-run ----------------------------------------------------------------

test('dry-run changes nothing: HEAD, status, tags, origin refs and files identical; no hooks, no FTP connect', async () => {
    const w = makeWorld();
    addCommit(w);
    const before = repoState(w);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps, { dryRun: true });
    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2');
    assert.deepEqual(repoState(w), before);
    assert.equal(d.calls.hooks.length, 0, 'mutating hooks are not executed in a dry-run');
    assert.equal(d.calls.accessed, 0);
    assert.ok(d.calls.deploy.every((c) => c.client === null), 'no FTP client in a dry-run');
    assert.match(d.text(), /V1 -> V2/);
    assert.match(d.text(), /dry-run: not written/);
    assert.match(d.text(), /would commit the site changes: "Pin Test\.Web\.Shared V2"/);
    assert.match(d.text(), /would tag -a V2/);
    assert.match(d.text(), /would push origin main; would push origin V2/);
    assert.match(d.text(), /not published yet -- the live CDN check would run after the push/);
});

test('dry-run reports gates that WOULD abort (dirty tree) but still prints the whole plan and writes nothing', async () => {
    const w = makeWorld();
    addCommit(w);
    write(path.join(w.repo, 'junk.txt'), 'dirty');
    const before = repoState(w);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps, { dryRun: true });
    assert.equal(res.ok, true);
    assert.equal(res.aborted, false);
    assert.ok(res.wouldAbort.length >= 1);
    assert.match(d.text(), /\[WOULD ABORT\].*uncommitted/s);
    assert.match(d.text(), /\[8\/8\] FTP deploy/);
    assert.deepEqual(repoState(w), before);
});

// --- partial FTP failure ----------------------------------------------------

test('a failed site does not stop the rest; the run reports it and is not ok', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w);
    const d = makeDeps(w, cdn, { failSite: 'b.test' });
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, false);
    assert.equal(res.aborted, false);
    assert.deepEqual(d.calls.deploy.map((c) => c.slug), MEMBERS, 'continued past the failure');
    assert.deepEqual(res.sites.map((s) => [s.slug, !!s.error]), [['a.test', false], ['b.test', true], ['c.test', false]]);
    assert.match(d.text(), /SITE FAIL\] b\.test: simulated FTP failure/);
    assert.match(d.text(), /Done with 1 failed site/);
    assert.equal(d.calls.closed, 1, 'FTP connection closed');
});

test('--sites: non-member sites deploy after the group over the same connection', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w);
    const d = makeDeps(w, cdn);
    const p = L.planTargets(w.config, { allSites: true });
    const res = await L.runLinked({ config: w.config, plan: p, dryRun: false, withTests: false, repoRoot: w.root }, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.deepEqual(d.calls.deploy.map((c) => c.slug), [...MEMBERS, 'other.test']);
    assert.equal(d.calls.deploy[3].opts.skipHooks, undefined, 'non-member keeps its own hooks');
    assert.equal(d.calls.deploy[3].opts.skipStamp, undefined, 'non-member stamps on upload');
    assert.equal(d.calls.accessed, 1);
});

// --- pinFiles / templates ---------------------------------------------------

test('only the pages that load assets are pinned: a generated README.htm (docs with example URLs) is deployed but never touched or scanned', async () => {
    const w = makeWorld();
    addCommit(w);
    const readme = path.join(w.repo, 'a.test', 'README.htm');
    const readmeBefore = fs.readFileSync(readme, 'utf8');
    const cdn = await startCdn(w);
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.equal(fs.readFileSync(readme, 'utf8'), readmeBefore, 'README.htm untouched');
    assert.ok(fs.readFileSync(w.siteFile('a.test'), 'utf8').includes('Test.Web@V2/'), 'index.htm pinned');
    assert.ok(!cdn.state.hits.some((h) => h.includes('not-a-real-file')), 'doc example never requested');
});

test('urls: template/example URLs (@<tag>/<path>, ${x}, *) are flagged as templates and ignored by the gate', () => {
    const text = [
        `${PIN('V1')}/&lt;path&gt;`,
        `${PIN('V1')}/<path>`,
        `${PIN('V1')}/${'$'}{name}.png`,
        `${PIN('V1')}/real/file.png`,
    ].join(' ');
    const urls = L.collectPackageUrls(text, SPEC);
    const byPath = Object.fromEntries(urls.map((u) => [u.path, u.isTemplate]));
    assert.equal(byPath['real/file.png'], false);
    assert.ok(urls.filter((u) => u.isTemplate).length >= 2);
    const w = makeWorld();
    const r = L.buildCdnChecks({ siteTexts: [{ slug: 'a.test', text: text.replace('real/file.png', 'a.test/logos/logo.png') }], pkgRoot: w.shared, spec: SPEC, tag: 'V1' });
    assert.equal(r.local.length, 0, r.local.join('; '));
    assert.ok(r.templates.length >= 2);
});

test('CDN failures are grouped by reason and capped (a wall of 404s stays readable)', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w);
    for (const slug of MEMBERS) {
        cdn.state.missing.add(`${slug}/logos/logo.png`);
        cdn.state.missing.add(`${slug}/themes/x/x-01.jpg`);
    }
    cdn.state.missing.add('fonts/f.woff2');
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.aborted, true);
    assert.match(d.text(), /7 x HTTP 404/);
    assert.match(d.text(), /\.\.\.and 1 more/);
});

// --- preflight / publish / FTP edge cases ------------------------------------

test('preflight: a stray local-only tag that is not at HEAD aborts (it would leave a gap in the sequence)', async () => {
    const w = makeWorld();
    addCommit(w, 'first');
    git(w.repo, 'tag', '-a', 'V2', '-m', 'never pushed');   // an earlier publish whose push failed...
    addCommit(w, 'second');                                 // ...and then HEAD moved on
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /tag V2 exists locally but not on origin, and is not at HEAD/);
    assert.equal(git(w.repo, 'tag', '--list', 'V3'), '', 'did not skip ahead to V3');
    assert.equal(git(w.origin, 'tag', '--list'), 'V1');
    assert.equal(d.calls.deploy.length, 0);
});

test('push: a rejected push aborts cleanly (nothing uploaded); the next run reuses the local commit + tag and pushes', async () => {
    const w = makeWorld();
    addCommit(w);
    // origin refuses every push
    const hook = path.join(w.origin, 'hooks', 'pre-receive');
    write(hook, '#!/bin/sh\necho "push refused by test" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const cdn = await startCdn(w);
    let d = makeDeps(w, cdn);
    let res = await run(w, d.deps);
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true, 'a clean LinkedAbort, not a crash');
    assert.match(d.text(), /\[ABORT\] git push origin main was rejected/);
    assert.match(d.text(), /Nothing was uploaded/);
    assert.equal(d.calls.deploy.length, 0);
    const pinCommit = git(w.repo, 'rev-parse', 'HEAD');
    assert.equal(git(w.repo, 'log', '-1', '--pretty=%s'), `Pin ${PKG_SLUG} V2`, 'pin commit kept locally');
    assert.equal(git(w.repo, 'tag', '--list', 'V2'), 'V2', 'tag kept locally');
    assert.equal(git(w.origin, 'tag', '--list'), 'V1', 'nothing reached origin');

    fs.rmSync(hook);                                        // origin accepts pushes again
    d = makeDeps(w, cdn);
    res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2', 'resumed with the same tag, did not skip to V3');
    assert.equal(res.reused, true);
    assert.equal(git(w.repo, 'rev-parse', 'HEAD'), pinCommit, 'no second pin commit');
    assert.ok(!/tag -a V2/.test(d.text()), 'did not try to re-create the tag');
    assert.equal(git(w.origin, 'rev-parse', 'refs/heads/main'), pinCommit);
    assert.match(git(w.origin, 'tag', '--list'), /V2/);
    assert.equal(git(w.repo, 'tag', '--list', 'V3'), '');
});

test('FTP: a site failure that closes the connection triggers a reconnect for the next site', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w);
    const d = makeDeps(w, cdn);
    let made = 0;
    d.deps.createClient = () => { made++; return { closed: false, close() { this.closed = true; d.calls.closed++; } }; };
    d.deps.deployOneSite = async (client, site) => {
        d.calls.deploy.push({ slug: site.slug, client });
        if (client.closed) throw new Error('Client is closed');
        if (site.slug === 'b.test') { client.closed = true; throw new Error('connection reset'); }
        return { uploaded: 1, failed: 0 };
    };
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, false, 'b.test failed');
    assert.deepEqual(res.sites.map((s) => [s.slug, !!s.error]), [['a.test', false], ['b.test', true], ['c.test', false]], 'c.test still deployed');
    assert.equal(made, 2, 'a second client was created');
    assert.equal(d.calls.accessed, 2, 'reconnected once');
    assert.notEqual(d.calls.deploy[2].client, d.calls.deploy[1].client);
    assert.match(d.text(), /reconnecting/);
});

test('cli: linked-only modifiers are rejected where they would be silently ignored', () => {
    const node = process.execPath;
    const script = path.join(__dirname, '..', 'src', 'deploy.js');
    let r = spawnSync(node, [script, '--no-link', '--dry-run'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--no-link only applies with --site/);
    r = spawnSync(node, [script, '--with-tests', '--dry-run'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--with-tests only applies to a linked deploy/);
    r = spawnSync(node, [script, '--app', 'prose', '--with-tests', '--dry-run'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
});

test('cli: a bare run, --dry-run alone and unknown flags exit 2; the registry holds only sites/apps/linkedGroups', () => {
    const node = process.execPath;
    const script = path.join(__dirname, '..', 'src', 'deploy.js');
    let r = spawnSync(node, [script], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no mode given/);
    r = spawnSync(node, [script, '--dry-run'], { encoding: 'utf8' });
    assert.equal(r.status, 2, '--dry-run alone is not a mode');
    for (const f of ['--only', '--skip-build', '--from-github']) {
        r = spawnSync(node, [script, f, 'x'], { encoding: 'utf8' });
        assert.equal(r.status, 2, `${f} is rejected`);
        assert.match(r.stderr, /unknown flag/);
    }
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8'));
    for (const k of ['projects', 'componentsVersion', 'ftpRemoteRoot']) assert.equal(cfg[k], undefined, `projects.json has no ${k}`);
    for (const f of ['src/build.js', 'src/parts.js', 'template']) assert.ok(!fs.existsSync(path.join(__dirname, '..', f)), `${f} is gone`);
});

test('registry: the linked group is the MindAttic.Web monorepo and only ships what the pages need', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8'));
    const g = cfg.linkedGroups['mindattic-web'];
    assert.ok(g && g.package, 'group has a package');
    assert.equal(g.package.repo, 'mindattic/MindAttic.Web');
    assert.equal(g.package.sourceDir, '../MindAttic.Web');
    assert.equal(g.package.cdnSubpath, 'MindAttic.Web.Shared');
    assert.equal(g.package.firstTag, 'V12');
    assert.equal(g.package.tagPrefix, undefined, 'no dead tagPrefix (whole-number V tags are hard-coded by law)');
    assert.deepEqual(g.sites, ['ryandebraal.com', 'mindatticcares.com', 'hyperspace', 'mindattic.com']);
    const bySlug = new Map(cfg.sites.map((s) => [s.slug, s]));
    for (const slug of g.sites) {
        const s = bySlug.get(slug);
        assert.ok(s, `${slug} is in sites[]`);
        assert.ok(s.sourceDir.startsWith('../MindAttic.Web/'), `${slug} lives in the monorepo`);
        assert.deepEqual(s.files, ['index.htm'], `${slug} uploads only its page (no generated README.htm in production)`);
        assert.equal(s.stampFile, 'index.htm');
    }
    assert.equal(bySlug.get('hyperspace').ftpRemotePath, '/mindattic.com/hyperspace');
    const mc = bySlug.get('mindattic.com');
    assert.ok(!mc.preDeploy.some((h) => (h.file || '').includes('fetch-descriptions')), 'mindattic.com has no fetch-descriptions hook');
    assert.ok(mc.preDeploy.some((h) => h.tagArg === '-CyberspaceCdnTag' && h.file.startsWith('../MindAttic.Web/MindAttic.Web.Shared/')), 'the Cyberspace splice receives the release tag');
    const kinds = [...cfg.sites, ...cfg.apps].flatMap((p) => (p.preDeploy || []).map((h) => h.kind));
    assert.ok(!kinds.includes('uiux-pull'), 'hook kind is package-pull');
    assert.ok(!JSON.stringify(cfg).includes('MindAttic.UiUx'), 'no MindAttic.UiUx references left in the registry');
});
