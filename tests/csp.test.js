'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SITE, ROOT } = require('./helpers');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function htmlFiles() {
  return walk(SITE).filter(file => file.endsWith('.html'));
}

function cspFromNginx() {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx.conf'), 'utf8');
  const match = conf.match(/add_header Content-Security-Policy "([^"]+)"/);
  assert.ok(match, 'CSP must be defined in nginx.conf');
  return match[1];
}

test('production CSP does not allow inline or evaluated scripts', () => {
  const csp = cspFromNginx();
  const scriptSrc = /(?:^|;)\s*script-src([^;]*)/.exec(csp);
  assert.ok(scriptSrc, 'script-src must be present');
  assert.match(scriptSrc[1], /'self'/);
  assert.doesNotMatch(scriptSrc[1], /'unsafe-inline'/);
  assert.doesNotMatch(scriptSrc[1], /'unsafe-eval'/);
  assert.doesNotMatch(scriptSrc[1], /blob:/);

  const workerSrc = /(?:^|;)\s*worker-src([^;]*)/.exec(csp);
  assert.ok(workerSrc, 'worker-src must be present');
  assert.match(workerSrc[1], /'self'/);
  assert.doesNotMatch(workerSrc[1], /blob:/);
});

test('pages have no inline scripts or inline event handlers', () => {
  const failures = [];

  for (const file of htmlFiles()) {
    const relative = path.relative(SITE, file);
    const html = fs.readFileSync(file, 'utf8');

    for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = match[1];
      if (/\bsrc\s*=/i.test(attrs)) continue;
      if (/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) continue;
      failures.push(relative + ': inline <script>');
    }

    for (const match of html.matchAll(/\bon(?:click|input|change|submit|load|error|keydown|keyup|keypress|focus|blur|mouseover|mouseout|mousedown|mouseup|dblclick|paste|drop|dragstart|dragover|scroll|reset)\s*=/gi)) {
      failures.push(relative + ': inline event handler ' + match[0].trim());
    }
  }

  assert.deepEqual(failures, []);
});

test('tool scripts use the shared clipboard helper', () => {
  const jsRoot = path.join(SITE, 'assets', 'js');
  const failures = [];

  for (const file of walk(jsRoot).filter(file => file.endsWith('.js'))) {
    const relative = path.relative(SITE, file);
    if (relative === path.join('assets', 'js', 'site.js')) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/navigator\s*\.\s*clipboard/.test(source)) failures.push(relative);
  }

  assert.deepEqual(failures, []);

  const shared = fs.readFileSync(path.join(jsRoot, 'site.js'), 'utf8');
  assert.match(shared, /globalThis\.copyText\s*=/);
  assert.match(shared, /execCommand\(['"]copy['"]\)/);
});

test('external scripts referenced by pages exist', () => {
  const missing = [];

  for (const file of htmlFiles()) {
    const relative = path.relative(SITE, file);
    const html = fs.readFileSync(file, 'utf8');

    for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const src = match[1];
      if (/^(?:https?:)?\/\//i.test(src)) continue;
      const clean = src.split('?')[0].split('#')[0];
      const target = clean.startsWith('/')
        ? path.join(SITE, clean)
        : path.resolve(path.dirname(file), clean);
      if (!fs.existsSync(target)) missing.push(relative + ': ' + src);
    }
  }

  assert.deepEqual(missing, []);
});
