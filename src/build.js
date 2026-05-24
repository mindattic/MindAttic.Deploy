#!/usr/bin/env node
/*
 * build.js -- render every project's README into out/<slug>.htm.
 *
 * Source order for each README:
 *   1. --from-github    : always fetch from raw.githubusercontent.com/<repo>/<ref>/README.md
 *   2. sibling dir      : D:\Projects\MindAttic\<repo>\README.md (default fast path on dev box)
 *   3. raw.githubusercontent fallback if the sibling is missing
 *
 * Theme bundle (theme.css + body-prelude.html + deps.json) is loaded from:
 *   1. sibling dir      : D:\Projects\MindAttic\MindAttic.UiUx\Themes\<Theme>\* (default)
 *   2. --themes-root    : override path
 * (CI: GitHub Actions checks out MindAttic.UiUx into a sibling and sets --themes-root.)
 *
 * Flags:
 *   --only <slug>        : build a single project
 *   --ref <branch|tag>   : git ref for README fetch (default: main)
 *   --from-github        : skip sibling-dir README lookup; force network fetch
 *   --siblings-root <p>  : override sibling lookup root
 *   --themes-root <p>    : path to MindAttic.UiUx/Themes (default: ../MindAttic.UiUx/Themes)
 *   --components <ref>   : override the MindAttic.UiUx CDN ref pinned in projects.json
 *
 * Run: node src/build.js [flags]
 */

'use strict';

const fs            = require('fs');
const fsp           = require('fs/promises');
const path          = require('path');
const https         = require('https');
const { marked }    = require('marked');
const hljs          = require('highlight.js');

const repoRoot      = path.resolve(__dirname, '..');
const templatePath  = path.join(repoRoot, 'template', 'index.template.htm');
const projectsPath  = path.join(repoRoot, 'projects.json');
const outRoot       = path.join(repoRoot, 'out');

// Normalize argv: split `--foo=bar` into `--foo` `bar`.
const argv = process.argv.slice(2).flatMap((a) => {
    if (a.startsWith('--') && a.includes('=')) {
        const eq = a.indexOf('=');
        return [a.slice(0, eq), a.slice(eq + 1)];
    }
    return [a];
});

const USAGE = `\
build.js -- render every project's README into out/<slug>.htm.

Flags:
  --only <slug>        build a single project (repeatable)
  --ref <branch|tag>   git ref for README fetch (default: main)
  --from-github        skip sibling-dir README lookup; force network fetch
  --siblings-root <p>  override sibling lookup root
  --themes-root <p>    path to MindAttic.UiUx/Themes
  --components <ref>   override the MindAttic.UiUx CDN ref pinned in projects.json
  --help, -h           show this help and exit

Run: node src/build.js [flags]
`;

if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
}

// Reject unknown flags up front so a typo (e.g. --hlep) does not silently
// trigger a full build of every catalog project.
const KNOWN_FLAGS = new Set([
    'only', 'ref', 'from-github', 'siblings-root', 'themes-root', 'components', 'help',
]);
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
        const name = a.slice(2);
        if (!KNOWN_FLAGS.has(name)) {
            process.stderr.write(`build.js: unknown flag --${name}\n\n${USAGE}`);
            process.exit(2);
        }
        // Skip the value slot for flags that consume one, so we don't try to
        // validate the value itself (it never starts with -- because the
        // string/flagAll parsers reject that).
        const takesValue = name === 'only' || name === 'ref'
            || name === 'siblings-root' || name === 'themes-root' || name === 'components';
        if (takesValue) i++;
    } else if (a.startsWith('-') && a !== '-') {
        process.stderr.write(`build.js: unknown flag ${a}\n\n${USAGE}`);
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
        throw new Error(`Flag --${name} requires a value.`);
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

const onlySlugs     = flagAll('only');
const refOverride   = stringFlag('ref');
const forceGithub   = boolFlag('from-github');
const siblingsRoot  = stringFlag('siblings-root') || path.resolve(repoRoot, '..');
const themesRoot    = stringFlag('themes-root') || path.resolve(repoRoot, '..', 'MindAttic.UiUx', 'Themes');
const componentsRef = stringFlag('components');

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/mindattic/MindAttic.UiUx';

function slugifyAnchor(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: true,
    mangle: false,
    highlight(code, lang) {
        try {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
        } catch (_) {}
        return hljs.highlightAuto(code).value;
    },
});

const renderer = new marked.Renderer();
renderer.heading = function (text, level, raw) {
    const id = slugifyAnchor(raw);
    const anchor = level >= 2 && level <= 4
        ? ` <a class="heading-anchor" href="#${id}" aria-label="link to this section">#</a>`
        : '';
    return `<h${level} id="${id}">${text}${anchor}</h${level}>\n`;
};

function htmlAttrEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fetchRaw(url, token) {
    return new Promise((resolve, reject) => {
        const headers = { 'User-Agent': 'MindAttic.Deploy/1.0' };
        if (token) headers['Authorization'] = 'token ' + token;
        const req = https.get(url, { headers }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return fetchRaw(res.headers.location, token).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}

async function loadReadme(project, ref) {
    if (!forceGithub) {
        const local = path.join(siblingsRoot, project.repo, 'README.md');
        if (fs.existsSync(local)) {
            const md = await fsp.readFile(local, 'utf8');
            return { md, source: local };
        }
    }
    const url = `https://raw.githubusercontent.com/mindattic/${project.repo}/${ref}/README.md`;
    const token = process.env.SUBSCRIBER_REPO_TOKEN || process.env.GITHUB_TOKEN;
    const md = await fetchRaw(url, token);
    return { md, source: url };
}

const themeCache = new Map();
async function loadTheme(themeName, componentsVersion) {
    const cacheKey = `${themeName}@${componentsVersion}`;
    if (themeCache.has(cacheKey)) return themeCache.get(cacheKey);

    const themeDir = path.join(themesRoot, themeName);
    if (!fs.existsSync(themeDir)) {
        throw new Error(`Theme '${themeName}' not found at ${themeDir}. Add it under MindAttic.UiUx/Themes/${themeName}/, or pass --themes-root.`);
    }
    const depsPath    = path.join(themeDir, 'deps.json');
    const preludePath = path.join(themeDir, 'body-prelude.html');
    if (!fs.existsSync(depsPath)) throw new Error(`Theme '${themeName}' missing deps.json at ${depsPath}.`);

    const deps    = JSON.parse(await fsp.readFile(depsPath, 'utf8'));
    const prelude = fs.existsSync(preludePath) ? await fsp.readFile(preludePath, 'utf8') : '';

    const cssPaths    = Array.isArray(deps.css)     ? deps.css     : [];
    const scriptPaths = Array.isArray(deps.scripts) ? deps.scripts : [];

    const themeCssUrl = `${CDN_BASE}@${componentsVersion}/Themes/${themeName}/theme.css`;
    const linkTags = [
        ...cssPaths.map((p) => `<link rel="stylesheet" href="${CDN_BASE}@${componentsVersion}/${p}">`),
        `<link rel="stylesheet" href="${themeCssUrl}">`,
    ].join('\n');
    const scriptTags = scriptPaths
        .map((p) => `<script src="${CDN_BASE}@${componentsVersion}/${p}" defer></script>`)
        .join('\n');

    const bundle = { links: linkTags, prelude: prelude.trimEnd(), scripts: scriptTags };
    themeCache.set(cacheKey, bundle);
    return bundle;
}

function substitute(template, vars) {
    return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
        if (!(key in vars)) throw new Error(`Template references {{${key}}} but no value provided.`);
        return vars[key];
    });
}

async function buildOne(project, template, defaultRef, defaultComponentsRef) {
    const ref = refOverride || defaultRef;
    const componentsVersion = componentsRef || defaultComponentsRef;
    const themeName = project.theme || 'Cyberspace';

    const [{ md, source }, theme] = await Promise.all([
        loadReadme(project, ref),
        loadTheme(themeName, componentsVersion),
    ]);
    const readmeHtml = marked.parse(md, { renderer }).trim();

    const openUrl = `https://mindattic.com/${project.slug}.htm`;
    const lastUpdated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const html = substitute(template, {
        TITLE:              project.title,
        TAGLINE:            project.tagline,
        TAGLINE_ATTR:       htmlAttrEscape(project.tagline),
        SLUG:               project.slug,
        REPO:               project.repo,
        OPEN_URL:           openUrl,
        COMPONENTS_VERSION: componentsVersion,
        THEME:              themeName,
        THEME_LINKS:        theme.links,
        THEME_BODY_PRELUDE: theme.prelude,
        THEME_SCRIPTS:      theme.scripts,
        README_HTML:        readmeHtml,
        LAST_UPDATED:       lastUpdated,
    });

    const outFile = path.join(outRoot, `${project.slug}.htm`);
    await fsp.mkdir(outRoot, { recursive: true });
    await fsp.writeFile(outFile, html, 'utf8');

    const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
    return { slug: project.slug, theme: themeName, outFile, kb, source };
}

async function main() {
    const template = await fsp.readFile(templatePath, 'utf8');
    const config   = JSON.parse(await fsp.readFile(projectsPath, 'utf8'));
    const defaultRef           = 'main';
    const defaultComponentsRef = config.componentsVersion || 'main';

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

    process.stdout.write(`Building ${projects.length} landing page(s) -> ${outRoot}\n`);
    const failed = [];
    for (const project of projects) {
        try {
            const r = await buildOne(project, template, defaultRef, defaultComponentsRef);
            process.stdout.write(`  [ok]  ${r.slug.padEnd(18)} ${r.theme.padEnd(10)} ${r.kb.padStart(7)} KB  (README from ${r.source})\n`);
        } catch (e) {
            failed.push({ slug: project.slug, error: e.message });
            process.stdout.write(`  [FAIL] ${project.slug.padEnd(18)} ${e.message}\n`);
        }
    }
    if (failed.length) {
        process.stderr.write(`\n${failed.length} project(s) failed to build.\n`);
        process.exit(1);
    }
}

main().catch((e) => {
    process.stderr.write(`build.js: ${e.message}\n`);
    process.exit(1);
});
