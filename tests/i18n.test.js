'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SITE, ROOT } = require('./helpers');

const BASE = 'https://orbitnet.ru';
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales.json'), 'utf8'));

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function attr(html, pattern) {
  const match = pattern.exec(html);
  return match ? match[1] : null;
}

function ruFile(page) {
  return page === 'index.html'
    ? path.join(SITE, 'ru/index.html')
    : path.join(SITE, 'ru', page);
}

function urlFor(page, locale) {
  const pathname = page === 'index.html' ? '' : page.replace(/index\.html$/, '');
  return BASE + '/' + (locale === 'ru' ? 'ru/' : '') + pathname;
}

test('generated Russian pages exist for every configured page', () => {
  for (const page of config.translatedPages) {
    assert.ok(fs.existsSync(path.join(SITE, page)), page + ' English source exists');
    const file = ruFile(page);
    assert.ok(fs.existsSync(file), page + ' Russian page exists');
    assert.match(read(file), /<html lang="ru">/i, page + ' Russian lang');
  }
});

test('localized pages declare reciprocal canonical and hreflang links', () => {
  for (const page of config.translatedPages) {
    for (const locale of config.locales) {
      const file = locale === 'ru' ? ruFile(page) : path.join(SITE, page);
      const html = read(file);
      const expected = urlFor(page, locale);
      assert.equal(attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i), expected, page + ' ' + locale + ' canonical');
      assert.equal(attr(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i), expected, page + ' ' + locale + ' og:url');
      assert.equal(attr(html, /<link\s+rel="alternate"\s+hreflang="en"\s+href="([^"]+)"/i), urlFor(page, 'en'), page + ' ' + locale + ' en alternate');
      assert.equal(attr(html, /<link\s+rel="alternate"\s+hreflang="ru"\s+href="([^"]+)"/i), urlFor(page, 'ru'), page + ' ' + locale + ' ru alternate');
      assert.equal(attr(html, /<link\s+rel="alternate"\s+hreflang="x-default"\s+href="([^"]+)"/i), urlFor(page, 'en'), page + ' ' + locale + ' x-default');
    }
  }
});

test('localized pages load the shared language runtime', () => {
  for (const page of config.translatedPages) {
    for (const file of [path.join(SITE, page), ruFile(page)]) {
      const html = read(file);
      assert.match(html, /<script\s+src="\/assets\/js\/i18n\.js(?:\?[^"]*)?"><\/script>/i, page + ' i18n runtime');
      assert.match(html, /<script\s+src="\/assets\/js\/lang\.js(?:\?[^"]*)?"><\/script>/i, page + ' lang runtime');
    }
  }
});

test('sitemap contains both locales with xhtml alternates', () => {
  const sitemap = read(path.join(SITE, 'sitemap.xml'));
  for (const page of config.translatedPages) {
    for (const locale of config.locales) {
      const url = urlFor(page, locale);
      assert.ok(sitemap.includes('<loc>' + url + '</loc>'), url + ' in sitemap');
    }
    const en = urlFor(page, 'en');
    const ru = urlFor(page, 'ru');
    assert.ok(sitemap.includes(`<xhtml:link rel="alternate" hreflang="en" href="${en}"/>`), page + ' sitemap en alternate');
    assert.ok(sitemap.includes(`<xhtml:link rel="alternate" hreflang="ru" href="${ru}"/>`), page + ' sitemap ru alternate');
    assert.ok(sitemap.includes(`<xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`), page + ' sitemap x-default');
  }
});

test('translation catalogs are valid JSON and cover shared UI strings', () => {
  const common = JSON.parse(read(path.join(ROOT, 'i18n/ru/common.json')));
  const pages = JSON.parse(read(path.join(ROOT, 'i18n/ru/pages.json')));
  const js = JSON.parse(read(path.join(ROOT, 'i18n/ru/js.json')));

  assert.ok(Object.keys(common).length > 50, 'common catalog is populated');
  assert.ok(Object.keys(js).length > 0, 'JS catalog is populated');
  for (const page of config.translatedPages) {
    assert.ok(pages[page] && typeof pages[page] === 'object', page + ' has a page catalog');
  }
  for (const [page, entries] of Object.entries(pages)) {
    for (const [key, value] of Object.entries(entries)) {
      assert.equal(typeof value, 'string', page + ' translation type');
      assert.ok(value.length > 0, 'empty translation for ' + JSON.stringify(key));
    }
  }
  for (const [key, value] of [...Object.entries(common), ...Object.entries(js)]) {
    assert.equal(typeof value, 'string');
    assert.ok(value.length > 0, 'empty translation for ' + JSON.stringify(key));
  }
});

test('Russian pilot tool pages keep expected structure', () => {
  const tools = [
    'tools/text/word-counter.html',
    'tools/networks/subnet-calculator.html',
  ];
  for (const page of tools) {
    const html = read(ruFile(page));
    assert.match(html, /<script\s+src="\/assets\/js\/tools\//, page + ' tool script rewritten to root');
    assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/orbitnet\.ru\/ru\//, page + ' canonical');
  }
});
