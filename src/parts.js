'use strict';
/*
 * parts.js -- optional README augmentation for hardware/parts-driven projects.
 *
 * When a project's source repo carries a `config/parts.json`, this module
 * turns three author-placed markers in the rendered README HTML into live UI:
 *
 *   <!-- CONFIG-WIDGET -->   ->  interactive build configurator (from configAxes)
 *   <!-- PARTS-GALLERY -->   ->  parts gallery cards + live cost total
 *   <!-- when: k=v;... -->   ->  conditional blocks shown/hidden by the configurator
 *   ...                          (matched up to the closing <!-- end -->)
 *
 * Per-part preview images named in parts.json (`imageFile`, rooted at the
 * project's config/ dir) are base64-inlined into the emitted CSS so the page
 * stays a single self-contained .htm with no asset-upload step.
 *
 * Projects without a config/parts.json (every Cyberspace project, Claudia)
 * are a no-op: augment() returns the HTML untouched and empty extras.
 *
 * This is the successor to ChiMesh's retired scripts/cli/build-html.js -- the
 * generation moved into the deploy pipeline so /deploy alone produces the page.
 */

const fs   = require('fs');
const path = require('path');

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ──────────────────────────────────────────────────────────────────────
// Conditional blocks: <!-- when: deployment=rooftop; role=!client -->...<!-- end -->
//   -> <div class="when" data-when-deployment="rooftop" data-when-role="!client">...</div>
// Comments survive marked unchanged (HTML blocks pass through), so this runs
// on the already-rendered HTML.
// ──────────────────────────────────────────────────────────────────────
function condToAttrs(cond) {
    return cond.split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
        const m = c.match(/^([a-z][a-z0-9_-]*)\s*=\s*(.+)$/i);
        if (!m) return '';
        return ` data-when-${m[1].toLowerCase()}="${escapeHtml(m[2].trim())}"`;
    }).join('');
}
// Stack-based scanner (not a lazy regex) so nested when/end pairs wrap
// correctly, e.g. an inner `<!-- when: smarthome=kasa -->` inside an outer
// `<!-- when: smarthome=kasa,shelly,sonoff -->`. Walks the markers in order,
// pushing a frame per open and wrapping the buffered body on its matching
// close. Degrades safely: a stray `<!-- end -->` is kept literal, and any
// still-open frames at EOF are unwound back to their original markers + text
// so no content is ever swallowed.
function wrapConditionals(html) {
    const TOKEN = /<!--\s*when:\s*([^>]+?)\s*-->|<!--\s*end\s*-->/g;
    const root = { attrs: null, openMarker: null, buf: '' };
    const stack = [root];
    let lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(html)) !== null) {
        const top = stack[stack.length - 1];
        top.buf += html.slice(lastIndex, m.index);
        lastIndex = TOKEN.lastIndex;
        if (m[1] !== undefined) {
            // <!-- when: COND -->
            stack.push({ attrs: condToAttrs(m[1]), openMarker: m[0], buf: '' });
        } else if (stack.length > 1) {
            // <!-- end --> closing the innermost open frame
            const frame = stack.pop();
            stack[stack.length - 1].buf += `<div class="when"${frame.attrs}>${frame.buf}</div>`;
        } else {
            // stray close with no matching open — preserve verbatim
            top.buf += m[0];
        }
    }
    stack[stack.length - 1].buf += html.slice(lastIndex);
    // Unbalanced opens: unwind innermost-first, restoring each open marker so
    // the original (inert) comment + its content survive intact.
    while (stack.length > 1) {
        const frame = stack.pop();
        stack[stack.length - 1].buf += frame.openMarker + frame.buf;
    }
    return root.buf;
}

function partWhenAttrs(part) {
    if (!part || !part.when) return '';
    return Object.keys(part.when).map((k) =>
        ` data-when-${k}="${escapeHtml(String(part.when[k]))}"`
    ).join('');
}

// Union of `when` fields across every part in a category, so a category
// section hides itself when none of its members can be visible. If any part
// is unrestricted (no `when`), the category is always shown.
function categoryWhenAttrs(parts) {
    if (!parts || !parts.length) return '';
    if (parts.some((p) => !p.when || !Object.keys(p.when).length)) return '';
    const byKey = {};
    for (const p of parts) {
        for (const key of Object.keys(p.when)) {
            byKey[key] = byKey[key] || new Set();
            String(p.when[key]).split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => byKey[key].add(v));
        }
    }
    return Object.keys(byKey).map((k) =>
        ` data-when-${k}="${escapeHtml([...byKey[k]].join(','))}"`
    ).join('');
}

// Read a per-part image off the local filesystem, base64-encode it, and return
// { mime, b64 } for inlining into CSS. Returns null if the part has no
// imageFile or the file is missing. Only local paths rooted at config/ are
// accepted -- never remote URLs (the CDN-rot lesson from the old build code:
// remote asset URLs can't be trusted across years).
function loadPartImageLocal(configDir, part) {
    if (!part || !part.imageFile) return null;
    const rel = String(part.imageFile);
    if (/^[a-z]+:\/\//i.test(rel) || rel.indexOf('..') !== -1) return null;
    const full = path.join(configDir, rel);
    if (!fs.existsSync(full)) {
        process.stderr.write('  ! parts image missing for ' + part.id + ': ' + rel + '\n');
        return null;
    }
    const ext = path.extname(full).toLowerCase();
    const mime = ({
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    })[ext] || 'application/octet-stream';
    const buf = fs.readFileSync(full);
    return { mime, b64: buf.toString('base64') };
}

// ──────────────────────────────────────────────────────────────────────
// Config widget — built from parts.json `configAxes`. Emits inner content
// only; the parent section + H2 heading come from the README.
// ──────────────────────────────────────────────────────────────────────
function buildConfigWidget(axes) {
    const rows = axes.map((a) => {
        const opts = (a.options || []).map(([v, lbl]) =>
            `<option value="${escapeHtml(v)}">${escapeHtml(lbl)}</option>`
        ).join('');
        return `<label class="config-row">
      <span class="config-label">${escapeHtml(a.label)}</span>
      <select data-config="${escapeHtml(a.key)}" aria-label="${escapeHtml(a.label)}">${opts}</select>
    </label>`;
    }).join('\n    ');
    return `<div class="config-widget" id="config-widget">
  <p>Pick what you have or plan to buy and the guide below adapts. Choices save automatically.</p>
  <div class="config-grid">
    ${rows}
  </div>
  <button type="button" class="config-reset" id="config-reset">Reset to defaults</button>
</div>`;
}

// ──────────────────────────────────────────────────────────────────────
// Parts gallery — cards grouped by category, each carrying data-price /
// data-in-total / data-when-* so the page JS can hide non-matching cards and
// sum a live total over the visible ones. Returns { galleryHtml, imageCss }.
// ──────────────────────────────────────────────────────────────────────
function buildGallery(parts, configDir) {
    const imageCss = [];
    if (!parts || !Array.isArray(parts.parts) || !parts.parts.length) {
        return { galleryHtml: '', imageCss: '' };
    }
    const grouped = {};
    for (const p of parts.parts) {
        (grouped[p.category] = grouped[p.category] || []).push(p);
    }
    const categoryLabels = parts.categories || {};
    const sections = Object.keys(grouped).map((cat) => {
        const cards = grouped[cat].map((p) => {
            const note = p.note ? `<div class="part-note">${escapeHtml(p.note)}</div>` : '';
            const whenAttrs = partWhenAttrs(p);
            const priceAttr = (typeof p.price === 'number') ? ` data-price="${p.price}"` : '';
            const inTotalAttr = (p.inTotal === false) ? ' data-in-total="false"' : '';
            const priceHtml = (typeof p.price === 'number')
                ? `<div class="part-price">~$${p.price}</div>` : '';
            // Per-part spec table rendered into a 4-column grid (label · value ·
            // label · value). Interleave the array so visual flow is column-major:
            // first half top-to-bottom on the left, second half on the right.
            let specsHtml = '';
            if (Array.isArray(p.specs) && p.specs.length) {
                const half = Math.ceil(p.specs.length / 2);
                const pairs = [];
                for (let i = 0; i < half; i++) {
                    pairs.push(p.specs[i]);
                    if (p.specs[i + half]) pairs.push(p.specs[i + half]);
                }
                specsHtml = `<dl class="part-specs">${pairs.map((s) => (
                    `<dt>${escapeHtml(s.label)}</dt><dd>${escapeHtml(s.value)}</dd>`
                )).join('')}</dl>`;
            }
            const img = loadPartImageLocal(configDir, p);
            let imageDiv = '';
            let cls = whenAttrs ? 'part-card when' : 'part-card';
            if (img) {
                cls += ' has-image';
                imageCss.push(`.part-card[data-pid="${p.id}"] .part-image { background-image: url("data:${img.mime};base64,${img.b64}"); }`);
                imageDiv = '<div class="part-image" aria-hidden="true"></div>';
            }
            // Vertical "Buy:" list: Official (first official tier), Google (the
            // searchFor query), then each reputable tier numbered in order.
            const officialTier   = (p.tiers || []).find((t) => t.tier === 'official');
            const reputableTiers = (p.tiers || []).filter((t) => t.tier === 'reputable');
            const linkRows = [];
            if (officialTier && officialTier.url) {
                linkRows.push(`<a class="part-link" href="${escapeHtml(officialTier.url)}" target="_blank" rel="noopener noreferrer">Official</a>`);
            }
            if (p.searchFor) {
                linkRows.push(`<a class="part-link" href="${escapeHtml(p.searchFor)}" target="_blank" rel="noopener noreferrer">Google</a>`);
            }
            reputableTiers.forEach((t, i) => {
                if (t.url) {
                    linkRows.push(`<a class="part-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">Reputable #${i + 1}</a>`);
                }
            });
            const linksHtml = linkRows.length
                ? `<div class="part-links"><span class="part-links-label">Buy:</span>${linkRows.join('')}</div>` : '';
            return `<div class="${cls}" data-pid="${p.id}"${whenAttrs}${priceAttr}${inTotalAttr}>
        ${imageDiv}
        <div class="part-body">
          <div class="part-name">${escapeHtml(p.name)}</div>
          ${priceHtml}
          ${specsHtml}
          ${linksHtml}
          ${note}
        </div>
      </div>`;
        }).join('\n');
        const heading = categoryLabels[cat] || cat;
        const catWhen = categoryWhenAttrs(grouped[cat]);
        const catCls = catWhen ? 'parts-category when' : 'parts-category';
        return `<div class="${catCls}"${catWhen}>
<h3 id="gallery-${cat}">${escapeHtml(cat)} <span class="part-cat-blurb">— ${escapeHtml(heading)}</span></h3>
<div class="parts-grid">
${cards}
</div>
</div>`;
    }).join('\n');

    const asOf = parts.pricesAsOf || '';
    const asOfHtml = asOf ? `<span class="parts-total-asof">prices estimated ${escapeHtml(asOf)}</span>` : '';
    const galleryHtml = `<div class="parts-gallery-wrap" id="parts-gallery">
<p>Each card opens its Google Shopping search in a new tab so you can verify current prices. Cards that don't apply to your configuration are hidden, and the total below updates live.</p>
${sections}
<div class="parts-total" id="parts-total" aria-live="polite">
  <span class="parts-total-label">Your build estimate</span>
  <span class="parts-total-value" id="parts-total-value">~$0</span>
  ${asOfHtml}
</div>
</div>`;
    return { galleryHtml, imageCss: imageCss.join('\n') };
}

// ──────────────────────────────────────────────────────────────────────
// Static CSS for the widgets. Theme-agnostic: the surface/muted2/shadow that
// not every theme defines are resolved through a fallback layer (--pp-*) at
// the top, so the picker looks right under any theme (Cyberspace maps the
// card surface to --card-bg). --fg / --muted / --accent / --border are common
// to every theme and used directly.
// ──────────────────────────────────────────────────────────────────────
const PARTS_CSS = `/* Parts configurator + gallery (generated by MindAttic.Deploy/src/parts.js) */
:root {
  --pp-surface: var(--bg2, var(--card-bg, rgba(127, 127, 127, 0.10)));
  --pp-muted2:  var(--muted2, var(--muted, #8a949c));
  --pp-shadow:  var(--shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
}
.config-widget {
  background: var(--pp-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px 22px;
  margin: 0 0 2em;
  box-shadow: var(--pp-shadow);
}
.config-widget p { margin: 0 0 16px; color: var(--muted); font-size: 0.92em; }
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px 16px;
  margin-bottom: 14px;
}
.config-row { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; color: var(--muted); }
.config-label {
  font-weight: 600; font-size: 0.82em; letter-spacing: 0.02em;
  text-transform: uppercase; color: var(--pp-muted2);
}
.config-row select {
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 7px 10px; font-size: 0.95em; font-family: inherit; cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.config-row select:hover { border-color: var(--accent); }
.config-row select:focus-visible {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(107, 163, 232, 0.25);
}
.config-reset {
  background: transparent; color: var(--pp-muted2);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 5px 12px; font-size: 0.82em; font-family: inherit; cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.config-reset:hover { color: var(--accent); border-color: var(--accent); }

/* Conditional content blocks (auto-hidden when config doesn't match). */
.when[hidden] { display: none !important; }

#parts-gallery h3 { margin-top: 1.6em; }
.part-cat-blurb { color: var(--pp-muted2); font-weight: 400; font-size: 0.8em; }
.parts-grid { display: flex; flex-direction: column; gap: 14px; margin: 0.8em 0 2em; }
.part-card {
  display: flex; flex-direction: row; align-items: stretch;
  background: var(--pp-surface); border: 1px solid var(--border); border-radius: 10px;
  overflow: hidden; text-decoration: none; color: inherit;
  transition: box-shadow 0.18s; box-shadow: var(--pp-shadow);
}
.part-card:hover { text-decoration: none; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10); }
.part-body { flex: 1 1 auto; min-width: 0; padding: 14px 18px 16px; display: flex; flex-direction: column; }
.part-name { font-weight: 600; color: var(--fg); font-size: 1em; line-height: 1.3; }
.part-price { color: var(--accent); font-weight: 600; font-size: 0.95em; margin-top: 4px; font-variant-numeric: tabular-nums; }
.part-note { color: var(--muted); font-size: 0.82em; margin-top: 10px; line-height: 1.45; font-style: italic; }
.part-specs {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
  gap: 6px 32px; margin: 10px 0 0; padding-top: 10px;
  border-top: 1px solid var(--border); font-size: 0.8em; line-height: 1.4;
}
.part-specs > dt { color: var(--pp-muted2); font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; margin: 0; }
.part-specs > dd { color: var(--muted); margin: 0; }
.part-links { display: flex; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin-top: 12px; }
.part-links-label {
  font-size: 0.74em; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--pp-muted2);
}
.part-link { color: var(--accent); text-decoration: none; font-size: 0.88em; line-height: 1.45; }
.part-link:hover { text-decoration: underline; }
.part-image {
  flex: 0 0 200px; align-self: stretch; min-height: 150px;
  background-color: white; background-size: contain; background-position: center;
  background-repeat: no-repeat; border-right: 1px solid var(--border);
}
@media (max-width: 720px) {
  .part-card { flex-direction: column; }
  .part-image {
    flex: 0 0 auto; width: 100%; aspect-ratio: 4 / 3; min-height: 0;
    border-right: none; border-bottom: 1px solid var(--border);
  }
  .part-specs { grid-template-columns: max-content minmax(0, 1fr); }
}
.parts-gallery-wrap { margin: 0.5em 0 0; }
.parts-total {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 18px;
  margin: 1.4em 0 0.6em; padding: 18px 22px;
  background: var(--pp-surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--pp-shadow);
}
.parts-total-label { font-size: 0.78em; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pp-muted2); font-weight: 700; }
.parts-total-value { font-size: 1.6em; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
.parts-total-asof { margin-left: auto; color: var(--pp-muted2); font-size: 0.82em; font-style: italic; }`;

// ──────────────────────────────────────────────────────────────────────
// Page-side JS. Drives the configurator selects against a localStorage
// entry, shows/hides .when blocks, and sums data-price over visible cards.
// No theme toggle / TOC / scroll-spy here — the catalog template has none.
// ──────────────────────────────────────────────────────────────────────
function buildConfigScript(axesJson, savedKey) {
    return `(function () {
  var AXES = ${axesJson};
  var SAVED_KEY = ${JSON.stringify(savedKey)};

  function loadConfig() {
    var cfg = {};
    AXES.forEach(function (a) { cfg[a.key] = a.default; });
    try {
      var raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        AXES.forEach(function (a) {
          if (parsed && Object.prototype.hasOwnProperty.call(parsed, a.key)) cfg[a.key] = parsed[a.key];
        });
      }
    } catch (_) {}
    return cfg;
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(cfg)); } catch (_) {}
  }
  function matches(attrValue, current) {
    var values = String(attrValue).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var positives = [], negatives = [];
    values.forEach(function (v) {
      if (v.charAt(0) === '!') negatives.push(v.slice(1));
      else positives.push(v);
    });
    if (positives.length && positives.indexOf(current) === -1) return false;
    if (negatives.length && negatives.indexOf(current) !== -1) return false;
    return true;
  }
  function applyVisibility(cfg) {
    var nodes = document.querySelectorAll('.when');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], visible = true, attrs = el.attributes;
      for (var j = 0; j < attrs.length; j++) {
        var a = attrs[j];
        if (a.name.indexOf('data-when-') !== 0) continue;
        var key = a.name.slice('data-when-'.length);
        if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
        if (!matches(a.value, cfg[key])) { visible = false; break; }
      }
      if (visible) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    }
    // Recompute the visible-parts total: sum data-price on every part-card
    // that is not hidden and not marked data-in-total="false".
    var totalEl = document.getElementById('parts-total-value');
    if (totalEl) {
      var cards = document.querySelectorAll('.part-card[data-price]'), sum = 0;
      for (var m = 0; m < cards.length; m++) {
        var c = cards[m];
        if (c.hasAttribute('hidden')) continue;
        if (c.getAttribute('data-in-total') === 'false') continue;
        var v = parseFloat(c.getAttribute('data-price'));
        if (!isNaN(v)) sum += v;
      }
      totalEl.textContent = '~$' + sum;
    }
  }
  function hydrate(cfg) {
    AXES.forEach(function (a) {
      var sel = document.querySelector('select[data-config="' + a.key + '"]');
      if (!sel) return;
      sel.value = cfg[a.key];
      sel.addEventListener('change', function () {
        cfg[a.key] = sel.value;
        saveConfig(cfg);
        applyVisibility(cfg);
      });
    });
    var reset = document.getElementById('config-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        AXES.forEach(function (a) { cfg[a.key] = a.default; });
        saveConfig(cfg);
        AXES.forEach(function (a) {
          var sel = document.querySelector('select[data-config="' + a.key + '"]');
          if (sel) sel.value = cfg[a.key];
        });
        applyVisibility(cfg);
      });
    }
  }

  var cfg = loadConfig();
  try { if (!localStorage.getItem(SAVED_KEY)) saveConfig(cfg); } catch (_) {}
  hydrate(cfg);
  applyVisibility(cfg);
}());`;
}

// ──────────────────────────────────────────────────────────────────────
// Public entry. Given the project's source dir, slug, and rendered README
// HTML, returns { html, extraStyle, extraScripts }. No-op (empty extras,
// untouched html) when the project has no config/parts.json.
// ──────────────────────────────────────────────────────────────────────
function augment({ sourceDir, slug, html }) {
    const empty = { html, extraStyle: '', extraScripts: '' };
    if (!sourceDir) return empty;
    const configDir = path.join(sourceDir, 'config');
    const partsPath  = path.join(configDir, 'parts.json');
    if (!fs.existsSync(partsPath)) return empty;

    let parts;
    try {
        parts = JSON.parse(fs.readFileSync(partsPath, 'utf8'));
    } catch (e) {
        process.stderr.write(`  ! ${slug}: config/parts.json invalid: ${e.message} -- skipping parts augmentation\n`);
        return empty;
    }
    if (!parts || !Array.isArray(parts.parts) || !parts.parts.length) return empty;

    let body = wrapConditionals(html);

    const { galleryHtml, imageCss } = buildGallery(parts, configDir);
    if (galleryHtml && body.indexOf('<!-- PARTS-GALLERY -->') !== -1) {
        body = body.replace('<!-- PARTS-GALLERY -->', galleryHtml);
    }

    const axes = Array.isArray(parts.configAxes) ? parts.configAxes : [];
    if (axes.length && body.indexOf('<!-- CONFIG-WIDGET -->') !== -1) {
        body = body.replace('<!-- CONFIG-WIDGET -->', buildConfigWidget(axes));
    }

    const extraStyle = `<style>\n${PARTS_CSS}\n${imageCss}\n</style>`;
    // Emit the configurator JS even with no axes: it computes the initial
    // (static) cost total over the visible cards.
    const axesJson = JSON.stringify(axes.map((a) => ({ key: a.key, default: a.default })));
    const extraScripts = `<script>\n${buildConfigScript(axesJson, `${slug}-build-config`)}\n</script>`;

    return { html: body, extraStyle, extraScripts };
}

module.exports = { augment };
