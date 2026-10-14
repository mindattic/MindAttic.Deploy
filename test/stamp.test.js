'use strict';
// stampIndex: the Last Updated line keeps the file's own line endings, so a later rebuild of the
// page (MindAttic.Components' build-sites.mjs normalises to the dominant ending) doesn't flip it.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { stampIndex } = require('../src/stamp.js');

function stamped(content) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-')), 'index.htm');
    fs.writeFileSync(file, content);
    const date = stampIndex(file);
    return { date, out: fs.readFileSync(file, 'utf8') };
}

test('an LF page gets an LF stamp line', () => {
    const { date, out } = stamped('<!-- Last Updated: 2000-01-01T00:00:00Z -->\n<!DOCTYPE html>\n<p>x</p>\n');
    assert.equal(out, `<!-- Last Updated: ${date} -->\n<!DOCTYPE html>\n<p>x</p>\n`);
});

test('a CRLF page gets a CRLF stamp line', () => {
    const { date, out } = stamped('<!-- Last Updated: 2000-01-01T00:00:00Z -->\r\n<!DOCTYPE html>\r\n<p>x</p>\r\n');
    assert.equal(out, `<!-- Last Updated: ${date} -->\r\n<!DOCTYPE html>\r\n<p>x</p>\r\n`);
});

test('an unstamped LF page gets a stamp prepended with LF', () => {
    const { date, out } = stamped('<!DOCTYPE html>\n<p>x</p>\n');
    assert.equal(out, `<!-- Last Updated: ${date} -->\n<!DOCTYPE html>\n<p>x</p>\n`);
});

test('a BOM is kept', () => {
    const { date, out } = stamped('﻿<!DOCTYPE html>\r\n');
    assert.equal(out, `﻿<!-- Last Updated: ${date} -->\r\n<!DOCTYPE html>\r\n`);
});
