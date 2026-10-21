'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SITE, loadTool } = require('./helpers');

const JSON_FILE = path.join(SITE, 'tools/developer/json-formatter.html');
const HASH_FILE = path.join(SITE, 'tools/developer/hash-generator.html');
const DIFF_FILE = path.join(SITE, 'tools/text/text-diff-checker.html');
const LOREM_FILE = path.join(SITE, 'tools/text/lorem-ipsum-generator.html');

function values(overrides = {}) {
  return Object.assign({
    year: '',
    inputJSON: '',
    outputJSON: '',
    inputStatus: '',
    outputStatus: '',
    outputStats: '',
    indentSize: '2',
    autoFormat: false,
  }, overrides);
}

test('JSON formatting preserves number lexemes and duplicate keys', () => {
  const input = '{"id":12345678901234567890,"ratio":1.0,"exp":1e3,"dup":1,"dup":2,"nested":{"x":[1,2]}}';
  const { context, get } = loadTool(JSON_FILE, values({ inputJSON: input }), { Blob });

  context.formatJSON();
  const formatted = get('outputJSON').value;
  assert.match(formatted, /12345678901234567890/);
  assert.match(formatted, /1\.0/);
  assert.match(formatted, /1e3/);
  assert.equal((formatted.match(/"dup"/g) || []).length, 2);
  assert.match(formatted, /\n  "id"/);

  context.minifyJSON();
  assert.equal(get('outputJSON').value, input);
  assert.match(get('inputStatus').innerHTML, /Valid JSON/);
});

test('hash results from an older input cannot overwrite newer ones', async () => {
  const calls = [];
  const fakeCrypto = {
    subtle: {
      digest(name, data) {
        return new Promise(resolve => calls.push({ name, data, resolve }));
      },
    },
  };
  const { context, get } = loadTool(HASH_FILE, {
    year: '',
    input: '',
    results: '',
    status: '',
  }, { crypto: fakeCrypto, TextEncoder });

  get('input').value = 'first';
  context.run();
  assert.equal(calls.length, 4);

  get('input').value = 'second';
  context.run();
  assert.equal(calls.length, 8);

  calls.slice(0, 4).forEach(call => call.resolve(new Uint8Array(32).fill(0x11).buffer));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(get('results').innerHTML, /Enter text to compute hashes/);

  calls.slice(4).forEach(call => call.resolve(new Uint8Array(32).fill(0x22).buffer));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(get('results').innerHTML, /2222222222222222222222222222222222222222/);
});

test('text diff treats an empty side as zero lines', () => {
  const { get } = loadTool(DIFF_FILE, {
    year: '',
    left: '',
    right: 'one\ntwo',
    showSame: false,
    ignoreCase: false,
    ignoreSpace: false,
    diff: '',
    summary: '',
  });

  const diff = get('diff').innerHTML;
  assert.match(diff, /\+ one/);
  assert.match(diff, /\+ two/);
  assert.doesNotMatch(diff, /- /);
  assert.match(get('summary').innerHTML, />2<\/span> added/);
  assert.match(get('summary').innerHTML, />0<\/span> removed/);
});

test('lorem count is capped in the UI and has no dead sentence branch', () => {
  const html = fs.readFileSync(LOREM_FILE, 'utf8');
  assert.match(html, /id="count"[^>]*max="100"/);
  assert.match(html, /Up to 100/);
  assert.equal(html.includes('Math.random() < 0.4'), false);
});
