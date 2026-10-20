'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SITE } = require('./helpers');

const BASE = 'https://orbitnet.ru';
const OG_IMAGE = BASE + '/assets/og-image.png';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function pages() {
  return walk(SITE)
    .filter(file => file.endsWith('.html'))
    .filter(file => path.relative(SITE, file).split(path.sep).join('/') !== 'tools/_template.html');
}

function urlFor(file) {
  const rel = path.relative(SITE, file).split(path.sep).join('/');
  return rel === 'index.html' ? BASE + '/' : BASE + '/' + rel;
}

function attr(html, pattern) {
  const match = pattern.exec(html);
  return match ? match[1] : null;
}

function pngSize(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', 'PNG signature');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

test('every page has the correct canonical URL and Open Graph tags', () => {
  const seen = new Set();

  for (const file of pages()) {
    const rel = path.relative(SITE, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'utf8');
    const expected = urlFor(file);

    const canonical = attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
    const ogUrl = attr(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i);
    const ogTitle = attr(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i);
    const ogDescription = attr(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i);
    const ogImage = attr(html, /<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const twitterImage = attr(html, /<meta\s+name="twitter:image"\s+content="([^"]+)"/i);

    assert.equal(canonical, expected, rel + ' canonical');
    assert.equal(ogUrl, expected, rel + ' og:url');
    assert.ok(ogTitle, rel + ' og:title');
    assert.ok(ogDescription, rel + ' og:description');
    assert.equal(ogImage, OG_IMAGE, rel + ' og:image');
    assert.equal(twitterImage, OG_IMAGE, rel + ' twitter:image');
    assert.ok(!seen.has(canonical), 'duplicate canonical: ' + canonical);
    seen.add(canonical);
  }

  assert.ok(seen.size > 0);
});

test('sitemap contains exactly the canonical page URLs', () => {
  const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const expected = pages().map(urlFor).sort();

  assert.deepEqual([...new Set(locs)].sort(), expected);
});

test('robots.txt points to the sitemap', () => {
  const robots = fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/orbitnet\.ru\/sitemap\.xml$/m);
});

test('Open Graph image exists and has the expected dimensions', () => {
  const file = path.join(SITE, 'assets/og-image.png');
  assert.ok(fs.existsSync(file), 'og-image.png exists');
  assert.deepEqual(pngSize(file), { width: 1200, height: 630 });
});

test('favicon and manifest assets exist and are linked from every page', () => {
  const assets = [
    'favicon.ico',
    'icons/favicon-16x16.png',
    'icons/favicon-32x32.png',
    'icons/favicon-48x48.png',
    'icons/favicon-96x96.png',
    'icons/favicon-192x192.png',
    'icons/favicon-512x512.png',
    'icons/apple-touch-icon.png',
    'site.webmanifest',
  ];

  for (const asset of assets) {
    const file = path.join(SITE, asset);
    assert.ok(fs.existsSync(file), asset + ' exists');
    assert.ok(fs.statSync(file).size > 0, asset + ' is not empty');
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'site.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(SITE, icon.src)), icon.src + ' exists');
  }

  for (const file of pages()) {
    const rel = path.relative(SITE, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<link\s+rel="icon"\s+href="\/favicon\.ico"/i, rel + ' favicon.ico');
    assert.match(html, /<link\s+rel="icon"[^>]*sizes="48x48"[^>]*favicon-48x48\.png/i, rel + ' 48x48 icon');
    assert.match(html, /<link\s+rel="apple-touch-icon"/i, rel + ' apple-touch-icon');
    assert.match(html, /<link\s+rel="manifest"\s+href="\/site\.webmanifest"/i, rel + ' manifest');
  }
});
