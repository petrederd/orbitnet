'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { SITE, ROOT } = require('./helpers');

let playwright = null;
try {
  playwright = require('playwright');
} catch (e) {
  // The smoke test is optional for local runs; CI installs Playwright.
}

const REQUIRE_BROWSER = process.env.REQUIRE_BROWSER_TESTS === '1';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function cspFromNginx() {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx.conf'), 'utf8');
  const match = conf.match(/add_header Content-Security-Policy "([^"]+)"/);
  assert.ok(match, 'CSP must be defined in nginx.conf');
  return match[1];
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function toolPages() {
  return walk(path.join(SITE, 'tools'))
    .filter(file => file.endsWith('.html') && path.basename(file) !== '_template.html')
    .map(file => '/' + path.relative(SITE, file).split(path.sep).join('/'))
    .sort();
}

function startServer() {
  const csp = cspFromNginx();
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(parsed.pathname);

    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
    };

    if (pathname === '/api/ip') {
      const body = JSON.stringify({
        ip: '203.0.113.10',
        version: 4,
        hostname: null,
        geo: {
          city: 'Test City',
          region: 'Test Region',
          country: 'Test Country',
          timezone: 'UTC',
          asn: 64500,
          asnOrganization: 'Test Network',
        },
      });
      res.writeHead(200, { ...headers, 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }

    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { ...headers, 'Content-Type': CONTENT_TYPES['.json'] });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = path.resolve(SITE, '.' + pathname);
    if (!target.startsWith(SITE + path.sep) && target !== SITE) {
      res.writeHead(403, headers);
      res.end('Forbidden');
      return;
    }

    fs.readFile(target, (error, data) => {
      if (error) {
        fs.readFile(path.join(SITE, '404.html'), (notFoundError, notFound) => {
          res.writeHead(404, { ...headers, 'Content-Type': CONTENT_TYPES['.html'] });
          res.end(notFoundError ? 'Not found' : notFound);
        });
        return;
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': CONTENT_TYPES[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': path.extname(target) === '.html' ? 'no-store' : 'public, max-age=60',
      });
      res.end(data);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

let browser = null;
let server = null;
let base = '';
let browserUnavailable = '';

test.before(async () => {
  if (!playwright) {
    if (REQUIRE_BROWSER) throw new Error('Playwright is not installed; run npm install first.');
    browserUnavailable = 'Playwright is not installed';
    return;
  }
  const started = await startServer();
  server = started.server;
  base = started.base;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    if (REQUIRE_BROWSER) throw error;
    browserUnavailable = 'Chromium is not installed; run npx playwright install chromium';
  }
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function open(pathname, errors) {
  const page = await browser.newPage();
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  const response = await page.goto(base + pathname, { waitUntil: 'load' });
  assert.equal(response.status(), 200, pathname + ' should return 200');
  assert.match(response.headers()['content-security-policy'] || '', /worker-src 'self' blob:/);
  await page.waitForTimeout(200);
  return page;
}

test('every tool page loads without console errors or page exceptions', async t => {
  if (!browser) return t.skip(browserUnavailable);

  const failures = [];
  for (const pagePath of toolPages()) {
    const errors = [];
    let page;
    try {
      page = await open(pagePath, errors);
      if (errors.length) failures.push(pagePath + '\n  ' + errors.join('\n  '));
    } catch (error) {
      failures.push(pagePath + '\n  ' + error.message);
    } finally {
      if (page) await page.close();
    }
  }

  assert.equal(failures.length, 0, 'Pages with errors:\n' + failures.join('\n'));
});

test('regex tester starts a real Web Worker under the production CSP', async t => {
  if (!browser) return t.skip(browserUnavailable);

  const errors = [];
  const page = await open('/tools/developer/regex-tester.html', errors);
  try {
    await page.fill('#pattern', 'a+');
    await page.fill('#text', 'aa b aaa');
    await page.waitForFunction(() =>
      document.querySelector('#summary .stats span') &&
      document.querySelector('#summary .stats span').textContent === '2'
    );
    assert.equal(await page.locator('#matches .result-box').count(), 2);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('home search deep link and favorites work together', async t => {
  if (!browser) return t.skip(browserUnavailable);

  const errors = [];
  let page = await open('/?q=subnet', errors);
  try {
    assert.equal(await page.inputValue('#searchInput'), 'subnet');
    const visible = await page.locator('.tool-card:not([hidden])').count();
    assert.ok(visible > 0, 'the subnet query should match at least one tool');
  } finally {
    await page.close();
  }

  page = await open('/', errors);
  try {
    const firstStar = page.locator('.fav-btn').first();
    await firstStar.click();
    assert.equal(await firstStar.getAttribute('aria-pressed'), 'true');

    await page.click('[data-filter="favorites"]');
    await page.waitForFunction(() =>
      document.querySelectorAll('.tool-card:not([hidden])').length === 1
    );
    assert.equal(await page.locator('.tool-card:not([hidden])').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('key pages have no serious or critical axe violations', async t => {
  if (!browser) return t.skip(browserUnavailable);

  const axePath = require.resolve('axe-core/axe.min.js');
  const pages = ['/', '/about.html', '/privacy.html', '/tools/developer/regex-tester.html'];
  const failures = [];

  for (const pagePath of pages) {
    const errors = [];
    const page = await open(pagePath, errors);
    try {
      await page.addScriptTag({ path: axePath });
      const result = await page.evaluate(async () => {
        return await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        });
      });
      const serious = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      if (serious.length) {
        failures.push(pagePath + '\n' + serious.map(v =>
          '  ' + v.id + ' (' + v.impact + '): ' + v.help + '\n    ' +
          v.nodes.slice(0, 3).map(node => node.target.join(' ')).join('\n    ')
        ).join('\n'));
      }
    } finally {
      await page.close();
    }
  }

  assert.equal(failures.length, 0, 'Accessibility violations:\n' + failures.join('\n'));
});
