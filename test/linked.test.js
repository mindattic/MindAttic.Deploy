/**
 * Tests for src/linked.js (linked-group deploy, DEP-A3).
 *
 *   npm test        (node --test test/)
 *
 * Everything runs against throwaway fixtures: temp git repos with a local bare "origin", fake site
 * folders, a local http server standing in for jsDelivr, and an injected fake FTP. No test touches the
 * real MindAttic.UiUx / site repos, the real CDN, or a real FTP server.
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

const CDN = 'https://cdn.jsdelivr.net/gh/mindattic/MindAttic.UiUx';
const FAST_RETRY = { totalMs: 250, baseMs: 20, maxMs: 40 };

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

function writeManifest(pkg) {
    const files = [];
    for (const root of ['a.test', 'b.test', 'c.test', 'fonts']) {
        for (const rel of walk(path.join(pkg, root), pkg)) {
            files.push({ path: rel, bytes: fs.statSync(path.join(pkg, rel)).size });
        }
    }
    write(path.join(pkg, 'assets-manifest.json'), JSON.stringify({ count: files.length, files }, null, 2));
}

const PIN = (tag) => `${CDN}@${tag}`;

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

/** A package repo + bare origin + three fake sites, all pinned to V1, HEAD tagged V1 and pushed. */
function makeWorld() {
    const root = fs.mkdtempSync(path.join(SCRATCH, 'linked-test-'));
    const origin = path.join(root, 'origin.git');
    const pkg = path.join(root, 'UiUx');
    fs.mkdirSync(origin);
    spawnSync('git', ['init', '--bare', '-b', 'main', origin]);
    fs.mkdirSync(pkg);
    spawnSync('git', ['init', '-b', 'main', pkg]);
    write(path.join(pkg, 'fonts', 'f.woff2'), 'wOF2-font-bytes-0123456789');
    for (const slug of ['a.test', 'b.test', 'c.test']) {
        write(path.join(pkg, slug, 'logos', 'logo.png'), `png-${slug}-` + 'x'.repeat(40));
        write(path.join(pkg, slug, 'themes', 'x', 'x-01.jpg'), `jpg-${slug}-` + 'y'.repeat(70));
    }
    writeManifest(pkg);
    git(pkg, 'add', '-A');
    git(pkg, 'commit', '-m', 'initial package');
    git(pkg, 'tag', '-a', 'V1', '-m', 'V1');
    git(pkg, 'remote', 'add', 'origin', origin);
    git(pkg, 'push', 'origin', 'main');
    git(pkg, 'push', 'origin', 'V1');

    const sites = [];
    for (const slug of ['a.test', 'b.test', 'c.test', 'other.test']) {
        const dir = path.join(root, 'site-' + slug);
        write(path.join(dir, 'index.htm'), siteHtml(slug, 'V1'));
        const site = { slug, sourceDir: 'site-' + slug, files: ['index.htm'], stampFile: 'index.htm', ftpRemotePath: '/' + slug };
        if (slug === 'a.test') {
            // like mindattic.com: a generated README.htm is uploaded too; its body is DOCUMENTATION with example URLs
            write(path.join(dir, 'README.htm'), `<p>Pattern: ${CDN}@V1/&lt;path&gt; and an example ${CDN}@V1/not-a-real-file.png</p>`);
            site.files = ['index.htm', 'README.htm'];
        }
        // c.test mimics mindattic.com: it has a preDeploy hook list (uiux-pull + a sync hook that takes the tag)
        if (slug === 'c.test') site.preDeploy = [{ kind: 'uiux-pull' }, { kind: 'powershell', file: 'sync.ps1', tagArg: '-CyberspaceCdnTag' }];
        sites.push(site);
    }
    const config = {
        linkedGroups: { grp: { package: { slug: 'UiUx', sourceDir: 'UiUx' }, sites: ['a.test', 'b.test', 'c.test'] } },
        sites,
    };
    return { root, origin, pkg, config, siteFile: (slug) => path.join(root, 'site-' + slug, 'index.htm') };
}

/** Put the package ahead of V1 (unpushed commit) so the release tag becomes V2. */
function addCommit(world, name = 'new') {
    write(path.join(world.pkg, 'a.test', 'logos', `${name}.png`), `png-${name}-` + 'z'.repeat(30));
    writeManifest(world.pkg);
    git(world.pkg, 'add', '-A');
    git(world.pkg, 'commit', '-m', `add ${name}`);
}

/** Local http server standing in for jsDelivr, serving files straight from the package working tree. */
function startCdn(rootDir) {
    const state = { missing: new Set(), wrongLen: new Set(), noCors: new Set(), hits: [] };
    const srv = http.createServer((req, res) => {
        state.hits.push(`${req.method} ${req.url}`);
        const m = /^\/gh\/mindattic\/MindAttic\.UiUx@([^/]+)\/(.*)$/.exec(req.url.split('?')[0]);
        if (!m) { res.writeHead(404); return res.end(); }
        const rel = decodeURIComponent(m[2]);
        const abs = path.join(rootDir, rel);
        if (state.missing.has(rel) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); return res.end(); }
        const body = fs.readFileSync(abs);
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
        executeHooks: async (site, opts) => { calls.hooks.push({ slug: site.slug, opts }); },
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

const run = (world, deps, o = {}) => L.runLinked({ config: world.config, plan: plan(world), dryRun: !!o.dryRun, withTests: false, repoRoot: world.root }, deps);

// --- tag math ---------------------------------------------------------------

test('tags: whole numbers sort numerically (V10 > V9), junk is ignored', () => {
    assert.equal(L.parseTag('V9'), 9);
    assert.equal(L.parseTag('v9'), null);
    assert.equal(L.parseTag('V1.2'), null);
    assert.deepEqual(L.sortTags(['V10', 'V2', 'V9', 'beta', 'v3']), ['V2', 'V9', 'V10']);
    assert.equal(L.latestTag(['V9', 'V10', 'V2', 'main']), 'V10');
    assert.equal(L.latestTag(['nope']), null);
    assert.equal(L.nextTag('V9'), 'V10');
    assert.equal(L.nextTag('V99'), 'V100');
    assert.throws(() => L.nextTag('main'));
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
    for (const f of ['--uiux', '--package', '--no-link', '--with-tests']) assert.ok(r.stdout.includes(f), `help mentions ${f}`);
});

// --- pins / urls ------------------------------------------------------------

test('pins: rewrite is idempotent, only touches UiUx pins, reports lines', () => {
    const html = siteHtml('a.test', 'V1');
    const r1 = L.rewritePins(html, 'V8');
    assert.ok(r1.changes.length >= 3);
    assert.ok(r1.changes.every((c) => c.from === 'V1' && c.to === 'V8' && c.line > 0));
    assert.ok(!r1.text.includes('UiUx@V1'));
    assert.ok(r1.text.includes('html2pdf.js@0.10.2'), 'npm package URL untouched');
    const r2 = L.rewritePins(r1.text, 'V8');
    assert.equal(r2.changes.length, 0);
    assert.equal(r2.text, r1.text);
    // another repo's pin on the same CDN is not ours
    const other = '<script src="https://cdn.jsdelivr.net/gh/someone/Else@V3/x.js"></script>';
    assert.equal(L.rewritePins(other, 'V8').text, other);
    // @main is not a V-pin: never rewritten (the gate rejects it instead)
    const main = `<script src="${CDN}@main/x.js"></script>`;
    assert.equal(L.rewritePins(main, 'V8').text, main);
});

test('urls: directory-like base prefixes are detected as prefixes, files as files', () => {
    const urls = L.collectUiuxUrls(siteHtml('b.test', 'V3'));
    const prefix = urls.find((u) => u.path === 'b.test/');
    assert.ok(prefix && prefix.isPrefix, 'base prefix flagged');
    const font = urls.find((u) => u.path === 'fonts/f.woff2');
    assert.ok(font && !font.isPrefix);
    assert.ok(!urls.some((u) => u.url.includes('html2pdf')), 'npm URL ignored');
});

// --- preflight --------------------------------------------------------------

test('preflight: a dirty package tree aborts BEFORE anything is tagged, pushed, or uploaded', async () => {
    const w = makeWorld();
    addCommit(w);
    write(path.join(w.pkg, 'a.test', 'logos', 'dirty.png'), 'uncommitted');
    const cdn = await startCdn(w.pkg);
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /uncommitted change/);
    assert.equal(d.calls.deploy.length, 0, 'no FTP');
    assert.equal(git(w.pkg, 'tag', '--list', 'V2'), '', 'no tag created');
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
    // origin's V1 gets re-pointed at a different commit by someone else
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

test('preflight: a page pinned to a tag NEWER than the release tag aborts before publishing', async () => {
    const w = makeWorld();
    addCommit(w);                                           // release would be V2
    write(w.siteFile('b.test'), siteHtml('b.test', 'V9'));  // but a page already pins V9
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /pins V9 but the release tag would be V2/);
    assert.equal(git(w.pkg, 'tag', '--list', 'V2'), '', 'no tag created');
    assert.equal(git(w.origin, 'tag', '--list'), 'V1');
});

// --- happy path -------------------------------------------------------------

test('happy path: tags V2, pushes main + tag, pins every site, hooks get the tag, FTP in group order', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w.pkg);
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();

    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2');
    // package published
    assert.match(git(w.origin, 'tag', '--list'), /V2/);
    assert.equal(git(w.origin, 'rev-parse', 'refs/heads/main'), git(w.pkg, 'rev-parse', 'HEAD'));
    assert.equal(git(w.pkg, 'rev-parse', 'V2^{commit}'), git(w.pkg, 'rev-parse', 'HEAD'));
    assert.match(git(w.pkg, 'tag', '-n5', '--list', 'V2'), /add new/);   // tag message lists the commits
    // pins rewritten everywhere; npm URL untouched
    for (const slug of ['a.test', 'b.test', 'c.test']) {
        const t = fs.readFileSync(w.siteFile(slug), 'utf8');
        assert.ok(t.includes('UiUx@V2/') && !t.includes('UiUx@V1/'), `${slug} pinned to V2`);
        assert.ok(t.includes('html2pdf.js@0.10.2'));
    }
    assert.ok(fs.readFileSync(w.siteFile('other.test'), 'utf8').includes('UiUx@V1/'), 'non-member site untouched');
    // hooks ran with the tag, FTP in order with hooks skipped (they already ran before the CDN gate)
    assert.deepEqual(d.calls.hooks.map((h) => [h.slug, h.opts.tag, h.opts.skipUiuxPull]), [['c.test', 'V2', true]], 'only sites with hooks run them, with the release tag');
    assert.deepEqual(d.calls.deploy.map((c) => c.slug), ['a.test', 'b.test', 'c.test']);
    assert.ok(d.calls.deploy.every((c) => c.opts.skipHooks === true));
    assert.equal(d.calls.accessed, 1);
    assert.equal(d.calls.closed, 1);
    assert.match(d.text(), /Done\. All 3 site\(s\) deployed/);
    // the runtime-built theme file under the base prefix was verified via the manifest, the prefix itself never fetched
    const hits = cdn.state.hits.map((h) => h.split(' ')[1]);
    assert.ok(hits.some((u) => u.endsWith('/b.test/themes/x/x-01.jpg')), 'manifest file under the domain folder checked');
    assert.ok(!hits.some((u) => u.endsWith('/b.test/')), 'base prefix never requested as a file');
});

test('re-running with nothing new: no tag, no push, no pin edits, still deploys', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w.pkg);
    let d = makeDeps(w, cdn);
    await run(w, d.deps);                                   // first run publishes V2
    const before = snapshotSites(w);
    const tagsBefore = git(w.origin, 'tag', '--list');
    d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2');
    assert.deepEqual(snapshotSites(w), before, 'no pin edits');
    assert.equal(git(w.origin, 'tag', '--list'), tagsBefore, 'no new tag');
    assert.match(d.text(), /already on origin; nothing to push/);
    assert.equal(d.calls.deploy.length, 3);
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
        const cdn = await startCdn(w.pkg);
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

test('CDN gate: a literal reference to a file that is not in the package tree aborts locally (before publish)', async () => {
    const w = makeWorld();
    addCommit(w);
    write(w.siteFile('c.test'), siteHtml('c.test', 'V1') + `<img src="${PIN('V1')}/c.test/logos/does-not-exist.png">`);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /does-not-exist\.png', which is not in the package tree/);
    assert.equal(git(w.pkg, 'tag', '--list', 'V2'), '', 'aborted before tagging');
});

test('CDN gate: @main references are rejected', async () => {
    const w = makeWorld();
    addCommit(w);
    write(w.siteFile('a.test'), siteHtml('a.test', 'V1') + `<script src="${CDN}@main/fonts/f.woff2"></script>`);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps);
    assert.equal(res.aborted, true);
    assert.match(d.text(), /pinned to 'main', expected release tag V2/);
});

test('buildCdnChecks: manifest + literal URLs deduplicate and prefixes are not fetched', () => {
    const w = makeWorld();
    const { checks, prefixes, local } = L.buildCdnChecks({
        siteTexts: [{ slug: 'b.test', text: siteHtml('b.test', 'V1') }], pkgDir: w.pkg, tag: 'V1',
    });
    assert.equal(local.length, 0, local.join('; '));
    assert.equal(prefixes.length, 1);
    const urls = checks.map((c) => c.url);
    assert.equal(new Set(urls).size, urls.length, 'no duplicates');
    assert.ok(urls.includes(`${CDN}@V1/fonts/f.woff2`));
    assert.ok(urls.includes(`${CDN}@V1/b.test/logos/logo.png`));
    assert.ok(urls.includes(`${CDN}@V1/b.test/themes/x/x-01.jpg`));
    assert.ok(!urls.some((u) => u.includes('/a.test/')), 'other sites\' folders not checked for b.test');
});

// --- dry-run ----------------------------------------------------------------

test('dry-run writes nothing: no tag, no push, no pin edits, no hooks, no FTP connect', async () => {
    const w = makeWorld();
    addCommit(w);
    const sitesBefore = snapshotSites(w);
    const tagsBefore = git(w.pkg, 'tag', '--list');
    const originBefore = git(w.origin, 'for-each-ref');
    const statusBefore = git(w.pkg, 'status', '--porcelain');
    const d = makeDeps(w, null);
    const res = await run(w, d.deps, { dryRun: true });
    assert.equal(res.ok, true, d.text());
    assert.equal(res.tag, 'V2');
    assert.deepEqual(snapshotSites(w), sitesBefore);
    assert.equal(git(w.pkg, 'tag', '--list'), tagsBefore);
    assert.equal(git(w.origin, 'for-each-ref'), originBefore);
    assert.equal(git(w.pkg, 'status', '--porcelain'), statusBefore);
    assert.equal(d.calls.hooks.length, 0, 'mutating hooks are not executed in a dry-run');
    assert.equal(d.calls.accessed, 0);
    assert.ok(d.calls.deploy.every((c) => c.client === null), 'no FTP client in a dry-run');
    assert.match(d.text(), /would tag -a V2/);
    assert.match(d.text(), /V1 -> V2/);
    assert.match(d.text(), /dry-run: not written/);
    assert.match(d.text(), /not published yet -- the live CDN check would run after the push/);
});

test('dry-run reports gates that WOULD abort (dirty tree) but still prints the whole plan and writes nothing', async () => {
    const w = makeWorld();
    addCommit(w);
    write(path.join(w.pkg, 'junk.txt'), 'dirty');
    const sitesBefore = snapshotSites(w);
    const d = makeDeps(w, null);
    const res = await run(w, d.deps, { dryRun: true });
    assert.equal(res.ok, true);
    assert.equal(res.aborted, false);
    assert.ok(res.wouldAbort.length >= 1);
    assert.match(d.text(), /\[WOULD ABORT\].*uncommitted/s);
    assert.match(d.text(), /\[6\/6\] FTP deploy/);
    assert.deepEqual(snapshotSites(w), sitesBefore);
    assert.equal(git(w.origin, 'tag', '--list'), 'V1');
});

// --- partial FTP failure ----------------------------------------------------

test('a failed site does not stop the rest; the run reports it and is not ok', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w.pkg);
    const d = makeDeps(w, cdn, { failSite: 'b.test' });
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, false);
    assert.equal(res.aborted, false);
    assert.deepEqual(d.calls.deploy.map((c) => c.slug), ['a.test', 'b.test', 'c.test'], 'continued past the failure');
    assert.deepEqual(res.sites.map((s) => [s.slug, !!s.error]), [['a.test', false], ['b.test', true], ['c.test', false]]);
    assert.match(d.text(), /SITE FAIL\] b\.test: simulated FTP failure/);
    assert.match(d.text(), /Done with 1 failed site/);
    assert.equal(d.calls.closed, 1, 'FTP connection closed');
});

test('--sites: non-member sites deploy after the group over the same connection', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w.pkg);
    const d = makeDeps(w, cdn);
    const p = L.planTargets(w.config, { allSites: true });
    const res = await L.runLinked({ config: w.config, plan: p, dryRun: false, withTests: false, repoRoot: w.root }, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.deepEqual(d.calls.deploy.map((c) => c.slug), ['a.test', 'b.test', 'c.test', 'other.test']);
    assert.equal(d.calls.deploy[3].opts.skipHooks, undefined, 'non-member keeps its own hooks');
    assert.equal(d.calls.accessed, 1);
});

// --- pinFiles / templates ---------------------------------------------------

test('only the pages that load assets are pinned: a generated README.htm (docs with example URLs) is deployed but never touched or scanned', async () => {
    const w = makeWorld();
    addCommit(w);
    const readmeBefore = fs.readFileSync(path.join(w.root, 'site-a.test', 'README.htm'), 'utf8');
    const cdn = await startCdn(w.pkg);
    const d = makeDeps(w, cdn);
    const res = await run(w, d.deps);
    await cdn.close();
    assert.equal(res.ok, true, d.text());
    assert.equal(fs.readFileSync(path.join(w.root, 'site-a.test', 'README.htm'), 'utf8'), readmeBefore, 'README.htm untouched');
    assert.ok(fs.readFileSync(w.siteFile('a.test'), 'utf8').includes('UiUx@V2/'), 'index.htm pinned');
    assert.ok(!cdn.state.hits.some((h) => h.includes('not-a-real-file')), 'doc example never requested');
});

test('urls: template/example URLs (@<tag>/<path>, ${x}, *) are flagged as templates and ignored by the gate', () => {
    const text = [
        `${CDN}@V1/&lt;path&gt;`,
        `${CDN}@V1/<path>`,
        `${CDN}@V1/${'$'}{name}.png`,
        `${CDN}@V1/real/file.png`,
    ].join(' ');
    const urls = L.collectUiuxUrls(text);
    const byPath = Object.fromEntries(urls.map((u) => [u.path, u.isTemplate]));
    assert.equal(byPath['real/file.png'], false);
    assert.ok(urls.filter((u) => u.isTemplate).length >= 2);
    const w = makeWorld();
    const r = L.buildCdnChecks({ siteTexts: [{ slug: 'a.test', text: text.replace('real/file.png', 'a.test/logos/logo.png') }], pkgDir: w.pkg, tag: 'V1' });
    assert.equal(r.local.length, 0, r.local.join('; '));
    assert.ok(r.templates.length >= 2);
});

test('CDN failures are grouped by reason and capped (a wall of 404s stays readable)', async () => {
    const w = makeWorld();
    addCommit(w);
    const cdn = await startCdn(w.pkg);
    for (const slug of ['a.test', 'b.test', 'c.test']) {
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
