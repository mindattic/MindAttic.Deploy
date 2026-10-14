'use strict';
// Last Updated stamp for a site's index page. Its own module so tests can load it without
// deploy.js, which parses argv as soon as it loads.
const fs = require('fs');

function stampIndex(absFile) {
    const date  = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const stamp = `<!-- Last Updated: ${date} -->`;
    let content = fs.readFileSync(absFile, 'utf8');
    // Strip the BOM only so the ^ anchor matches, then restore it on write —
    // otherwise every deploy silently rewrites a BOM-prefixed file without one.
    const hadBom = content.charCodeAt(0) === 0xFEFF;
    if (hadBom) content = content.slice(1);
    // Each stamp comment is normally followed by a newline; allow end-of-string
    // too so a file that ends exactly at the comment (no trailing newline) still
    // matches and gets replaced, instead of accumulating an orphan stamp below
    // the fresh one on the next deploy.
    const re = /^(?:﻿?<!--\s*Last Updated:.*?-->(?:\r?\n|$))+/s;
    // The stamp line ends the way the rest of the file does (the same rule as
    // MindAttic.Components' build-sites.mjs), so a later rebuild of the page
    // leaves the stamp line alone instead of flipping its line ending.
    const crlf = (content.match(/\r\n/g) || []).length;
    const lf = (content.match(/(?<!\r)\n/g) || []).length;
    const eol = crlf >= lf ? '\r\n' : '\n';
    if (re.test(content)) {
        content = content.replace(re, `${stamp}${eol}`);
    } else {
        content = `${stamp}${eol}${content}`;
    }
    if (hadBom) content = '﻿' + content;
    fs.writeFileSync(absFile, content, 'utf8');
    return date;
}

module.exports = { stampIndex };
