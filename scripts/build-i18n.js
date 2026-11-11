'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const I18N = path.join(ROOT, 'i18n');
const LOCALES_FILE = path.join(I18N, 'locales.json');
const RU_DIR = path.join(I18N, 'ru');

const locales = readJson(LOCALES_FILE);
const BASE = locales.baseUrl || 'https://orbitnet.ru';
const DEFAULT_LOCALE = locales.default || 'en';
const TRANSLATED = new Set(locales.translatedPages || []);
const SPECIAL = locales.specialPages || {};

const common = readJson(path.join(RU_DIR, 'common.json'), {});
const pagesCatalog = readJson(path.join(RU_DIR, 'pages.json'), {});
const jsCatalog = readJson(path.join(RU_DIR, 'js.json'), {});

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'SVG', 'PATH']);
const FORCE_RECURSE = new Set([
  'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE', 'ASIDE',
  'UL', 'OL', 'DL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'FORM',
  'SELECT', 'OPTGROUP', 'DETAILS', 'FIELDSET',
]);
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'UL',
]);
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'data-name'];
const META_TRANSLATIONS = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:image:alt"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sourcePages() {
  return walk(SITE)
    .filter(file => file.endsWith('.html'))
    .map(file => path.relative(SITE, file).split(path.sep).join('/'))
    .filter(rel => rel !== '404.html' && rel !== 'tools/_template.html')
    .filter(rel => !rel.startsWith('ru/'))
    .sort();
}

function normalizeKey(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function hasLetters(value) {
  return /[A-Za-z\u0400-\u04ff]/.test(value);
}

function lookup(rel, key) {
  const page = pagesCatalog[rel] || {};
  if (Object.prototype.hasOwnProperty.call(page, key)) return page[key];
  if (Object.prototype.hasOwnProperty.call(common, key)) return common[key];
  return null;
}

function localePath(rel, locale) {
  if (rel === 'index.html') return locale === 'ru' ? '/ru/' : '/';
  if (rel.endsWith('/index.html')) {
    const dir = rel.slice(0, -'index.html'.length);
    return (locale === 'ru' ? '/ru/' : '/') + dir;
  }
  return (locale === 'ru' ? '/ru/' : '/') + rel;
}

function pageUrl(rel, locale) {
  return BASE + localePath(rel, locale);
}

function hrefForPage(rel, locale) {
  if (locale === 'ru') {
    if (SPECIAL[rel] && SPECIAL[rel].ru) return SPECIAL[rel].ru;
    if (TRANSLATED.has(rel)) return localePath(rel, 'ru');
    return localePath(rel, 'en');
  }
  if (SPECIAL[rel] && SPECIAL[rel].en) return SPECIAL[rel].en;
  return localePath(rel, 'en');
}

function hasBlockChild(element) {
  return [...element.children].some(child => BLOCK_TAGS.has(child.tagName));
}

function makeTextUnit(element) {
  const key = normalizeKey(element.children.length ? element.innerHTML : element.textContent);
  if (!key || !hasLetters(key)) return null;
  return {
    kind: 'text',
    element,
    key,
    html: element.children.length > 0,
  };
}

function collectUnits(document) {
  const units = [];

  function add(unit) {
    if (!unit) return;
    units.push(unit);
  }

  function addDirectText(element) {
    for (const node of element.childNodes) {
      if (node.nodeType !== 3) continue;
      const key = normalizeKey(node.textContent);
      if (!key || !hasLetters(key)) continue;
      units.push({ kind: 'textnode', node, key, html: false });
    }
  }

  function walkElement(element) {
    if (!element || !element.tagName) return;
    const tag = element.tagName;
    if (SKIP_TAGS.has(tag)) return;

    if (FORCE_RECURSE.has(tag) || tag === 'DIV') {
      if ((tag === 'DIV') && element.children.length === 0) {
        add(makeTextUnit(element));
        return;
      }
      for (const child of element.children) walkElement(child);
      addDirectText(element);
      return;
    }

    if (hasBlockChild(element)) {
      for (const child of element.children) walkElement(child);
      return;
    }

    add(makeTextUnit(element));
  }

  const title = document.querySelector('title');
  if (title) add(makeTextUnit(title));

  for (const selector of META_TRANSLATIONS) {
    const meta = document.querySelector(selector);
    if (!meta) continue;
    const key = normalizeKey(meta.getAttribute('content'));
    if (!key || !hasLetters(key)) continue;
    units.push({ kind: 'meta', element: meta, key, html: false });
  }

  for (const element of document.querySelectorAll('[' + ATTRS.join('],[') + ']')) {
    for (const attr of ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      const key = normalizeKey(element.getAttribute(attr));
      if (!key || !hasLetters(key)) continue;
      units.push({ kind: 'attr', element, attr, key, html: false });
    }
  }

  if (document.body) {
    for (const child of document.body.children) walkElement(child);
  }

  return units;
}

function applyUnits(document, rel, missing) {
  for (const unit of collectUnits(document)) {
    const translated = lookup(rel, unit.key);
    if (translated == null) {
      missing.add(unit.key);
      continue;
    }
    if (unit.kind === 'text') {
      if (unit.html) unit.element.innerHTML = translated;
      else unit.element.textContent = translated;
    } else if (unit.kind === 'textnode') {
      unit.node.textContent = translated;
    } else if (unit.kind === 'meta') {
      unit.element.setAttribute('content', translated);
    } else if (unit.kind === 'attr') {
      unit.element.setAttribute(unit.attr, translated);
    }
  }
}

function isExternalHref(href) {
  return !href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href);
}

function isAssetPath(value) {
  return value === 'favicon.ico' ||
    value === 'site.webmanifest' ||
    value === 'robots.txt' ||
    value === 'sitemap.xml' ||
    value.startsWith('assets/') ||
    value.startsWith('icons/') ||
    value.startsWith('api/');
}

function normalizePageRel(value) {
  if (!value || value.endsWith('/')) return value + 'index.html';
  if (!path.posix.extname(value)) return value + '/index.html';
  return value;
}

function resolveHref(href, fromRel) {
  const url = new URL(href, 'https://orbitnet.invalid/' + fromRel);
  return {
    pathname: decodeURIComponent(url.pathname).replace(/^\/+/, ''),
    search: url.search,
    hash: url.hash,
  };
}

function rewritePageHref(href, fromRel, locale) {
  if (isExternalHref(href)) return null;
  const resolved = resolveHref(href, fromRel);
  if (isAssetPath(resolved.pathname)) {
    return '/' + resolved.pathname + resolved.search + resolved.hash;
  }
  const targetRel = normalizePageRel(resolved.pathname);
  let target = hrefForPage(targetRel, locale);
  if (!target) return null;
  if (resolved.search && !target.includes('?')) target += resolved.search;
  if (resolved.hash && !target.includes('#')) target += resolved.hash;
  return target;
}

function rewriteLinks(document, rel) {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (/^mailto:|^tel:|^javascript:/i.test(href || '')) continue;
    const next = rewritePageHref(href, rel, 'ru');
    if (next) anchor.setAttribute('href', next);
  }

  for (const form of document.querySelectorAll('form[action]')) {
    const href = form.getAttribute('action');
    if (isExternalHref(href)) continue;
    const resolved = resolveHref(href, rel);
    form.setAttribute('action', '/' + resolved.pathname + resolved.search + resolved.hash);
  }

  const assetSelectors = [
    'script[src]',
    'img[src]',
    'source[src]',
    'link[rel="stylesheet"][href]',
    'link[rel="icon"][href]',
    'link[rel="apple-touch-icon"][href]',
    'link[rel="manifest"][href]',
  ];

  for (const selector of assetSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      const attr = element.hasAttribute('src') ? 'src' : 'href';
      const href = element.getAttribute(attr);
      if (isExternalHref(href)) continue;
      const resolved = resolveHref(href, rel);
      element.setAttribute(attr, '/' + resolved.pathname + resolved.search + resolved.hash);
    }
  }

  for (const link of document.querySelectorAll('link[rel="alternate"][hreflang]')) {
    link.remove();
  }
}

function rewriteJsonUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(BASE + '/')) return value;
  try {
    const url = new URL(value);
    const rel = normalizePageRel(url.pathname.replace(/^\/+/, ''));
    const target = hrefForPage(rel, 'ru');
    if (!target) return value;
    return BASE + target + url.search + url.hash;
  } catch (error) {
    return value;
  }
}

function translateJsonLd(value, rel) {
  if (typeof value === 'string') {
    const key = normalizeKey(value);
    const translated = lookup(rel, key);
    if (translated != null) return translated;
    return rewriteJsonUrl(value);
  }
  if (Array.isArray(value)) return value.map(item => translateJsonLd(item, rel));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = key === 'inLanguage' ? 'ru' : translateJsonLd(item, rel);
    }
    return result;
  }
  return value;
}

function translateDocument(document, rel, missing) {
  document.documentElement.setAttribute('lang', 'ru');
  applyUnits(document, rel, missing);

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      script.textContent = JSON.stringify(translateJsonLd(data, rel), null, 2);
    } catch (error) {
      // Leave malformed JSON-LD untouched; the SEO test will report it.
    }
  }

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', pageUrl(rel, 'ru'));

  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute('content', pageUrl(rel, 'ru'));

  const ogLocale = document.querySelector('meta[property="og:locale"]');
  if (ogLocale) ogLocale.setAttribute('content', 'ru_RU');

  const ogLocaleAlt = document.querySelector('meta[property="og:locale:alternate"]');
  if (!ogLocaleAlt) {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:locale:alternate');
    meta.setAttribute('content', 'en_US');
    const head = document.querySelector('head');
    if (head) head.appendChild(meta);
  }

  rewriteLinks(document, rel);
}

function alternatesBlock(rel) {
  const enUrl = pageUrl(rel, 'en');
  const ruUrl = TRANSLATED.has(rel) ? pageUrl(rel, 'ru') : null;
  const lines = ['<!-- orbitnet:i18n:alternates -->'];
  lines.push('<link rel="alternate" hreflang="en" href="' + enUrl + '">');
  if (ruUrl) lines.push('<link rel="alternate" hreflang="ru" href="' + ruUrl + '">');
  lines.push('<link rel="alternate" hreflang="x-default" href="' + enUrl + '">');
  lines.push('<!-- /orbitnet:i18n:alternates -->');
  return lines.join('\n');
}

function scriptsBlock(locale) {
  const lines = ['<!-- orbitnet:i18n:scripts -->'];
  if (locale === 'ru') lines.push('<script src="/assets/i18n/ru.js"></script>');
  lines.push('<script src="/assets/i18n/manifest.js"></script>');
  lines.push('<script src="/assets/js/i18n.js?v=1"></script>');
  lines.push('<script src="/assets/js/lang.js?v=1"></script>');
  lines.push('<!-- /orbitnet:i18n:scripts -->');
  return lines.join('\n');
}

function replaceManaged(html, name, block) {
  const pattern = new RegExp('<!-- orbitnet:i18n:' + name + ' -->[\\s\\S]*?<!-- /orbitnet:i18n:' + name + ' -->');
  if (pattern.test(html)) return html.replace(pattern, block);
  return null;
}

function updateSourcePage(rel) {
  const file = path.join(SITE, rel);
  let html = fs.readFileSync(file, 'utf8');

  const alternates = alternatesBlock(rel);
  const scripts = scriptsBlock('en');

  const replacedAlternates = replaceManaged(html, 'alternates', alternates);
  if (replacedAlternates != null) {
    html = replacedAlternates;
  } else {
    const canonical = /<link\s+rel="canonical"[^>]*>\s*/i.exec(html);
    if (canonical) {
      html = html.slice(0, canonical.index + canonical[0].length) +
        alternates + '\n' + html.slice(canonical.index + canonical[0].length);
    } else {
      html = html.replace(/<\/head>/i, alternates + '\n</head>');
    }
  }

  const replacedScripts = replaceManaged(html, 'scripts', scripts);
  if (replacedScripts != null) {
    html = replacedScripts;
  } else {
    html = html.replace(/<\/head>/i, scripts + '\n</head>');
  }

  fs.writeFileSync(file, html);
}

function buildLocale(locale, missingByPage) {
  const targetDir = path.join(SITE, locale);
  fs.rmSync(targetDir, { recursive: true, force: true });

  for (const rel of TRANSLATED) {
    const source = fs.readFileSync(path.join(SITE, rel), 'utf8');
    const { document } = parseHTML(source);
    const missing = new Set();
    translateDocument(document, rel, missing);
    missingByPage.set(rel, [...missing]);

    let html = document.toString().replace(/^<!DOCTYPE html>/i, '<!doctype html>');
    html = html.replace(/<!-- orbitnet:i18n:alternates -->[\s\S]*?<!-- \/orbitnet:i18n:alternates -->/, alternatesBlock(rel));
    html = html.replace(/<!-- orbitnet:i18n:scripts -->[\s\S]*?<!-- \/orbitnet:i18n:scripts -->/, scriptsBlock(locale));

    const out = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
  }
}

function writeRuntimeAssets() {
  const dir = path.join(SITE, 'assets', 'i18n');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ru.js'),
    'window.__ORBITNET_I18N__ = ' + JSON.stringify(jsCatalog, null, 2) + ';\n');
  fs.writeFileSync(path.join(dir, 'manifest.js'),
    'window.__ORBITNET_I18N_MANIFEST__ = ' + JSON.stringify({
      default: DEFAULT_LOCALE,
      locales: locales.locales,
      ruPages: [...TRANSLATED],
      specialPages: SPECIAL,
    }, null, 2) + ';\n');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseExistingSitemap() {
  const file = path.join(SITE, 'sitemap.xml');
  if (!fs.existsSync(file)) return { order: [], meta: new Map() };
  const xml = fs.readFileSync(file, 'utf8');
  const order = [];
  const meta = new Map();

  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const body = match[1];
    const loc = /<loc>([^<]+)<\/loc>/.exec(body);
    if (!loc) continue;
    const entry = {};
    for (const field of ['lastmod', 'changefreq', 'priority']) {
      const value = new RegExp('<' + field + '>([^<]+)</' + field + '>').exec(body);
      if (value) entry[field] = value[1];
    }
    order.push(loc[1]);
    meta.set(loc[1], entry);
  }

  return { order, meta };
}

function sitemapEntry(rel, locale, meta) {
  const loc = pageUrl(rel, locale);
  const existing = meta.get(pageUrl(rel, 'en')) || {};
  const lines = ['  <url>', '    <loc>' + escapeXml(loc) + '</loc>'];
  if (existing.lastmod) lines.push('    <lastmod>' + existing.lastmod + '</lastmod>');
  if (existing.changefreq) lines.push('    <changefreq>' + existing.changefreq + '</changefreq>');
  if (existing.priority) lines.push('    <priority>' + existing.priority + '</priority>');

  const alternates = [['en', pageUrl(rel, 'en')]];
  if (TRANSLATED.has(rel)) alternates.push(['ru', pageUrl(rel, 'ru')]);
  alternates.push(['x-default', pageUrl(rel, 'en')]);
  for (const [lang, href] of alternates) {
    lines.push('    <xhtml:link rel="alternate" hreflang="' + lang + '" href="' + escapeXml(href) + '"/>');
  }

  lines.push('  </url>');
  return lines.join('\n');
}

function writeSitemap() {
  const pages = sourcePages();
  const { order, meta } = parseExistingSitemap();
  const enUrlToRel = new Map(pages.map(rel => [pageUrl(rel, 'en'), rel]));
  const ordered = [];

  for (const loc of order) {
    const rel = enUrlToRel.get(loc);
    if (rel && !ordered.includes(rel)) ordered.push(rel);
  }
  for (const rel of pages) {
    if (!ordered.includes(rel)) ordered.push(rel);
  }

  const blocks = [];
  for (const rel of ordered) {
    blocks.push(sitemapEntry(rel, 'en', meta));
    if (TRANSLATED.has(rel)) blocks.push(sitemapEntry(rel, 'ru', meta));
  }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    blocks.join('\n') + '\n</urlset>\n';
  fs.writeFileSync(path.join(SITE, 'sitemap.xml'), xml);
}

function extract() {
  const missing = {};
  for (const rel of sourcePages()) {
    if (!TRANSLATED.has(rel)) continue;
    const { document } = parseHTML(fs.readFileSync(path.join(SITE, rel), 'utf8'));
    const keys = new Set();
    for (const unit of collectUnits(document)) {
      if (lookup(rel, unit.key) == null) keys.add(unit.key);
    }
    if (keys.size) missing[rel] = Object.fromEntries([...keys].sort().map(key => [key, '']));
  }
  const out = path.join(RU_DIR, 'pages.missing.json');
  fs.writeFileSync(out, JSON.stringify(missing, null, 2) + '\n');
  const total = Object.values(missing).reduce((sum, page) => sum + Object.keys(page).length, 0);
  console.log('Missing translations: ' + total + ' keys across ' + Object.keys(missing).length + ' pages');
  console.log('Wrote ' + path.relative(ROOT, out));
}

function build() {
  for (const rel of sourcePages()) updateSourcePage(rel);
  const missingByPage = new Map();
  buildLocale('ru', missingByPage);
  writeRuntimeAssets();
  writeSitemap();
  for (const [rel, keys] of missingByPage) {
    if (keys.length) console.log('Missing on ' + rel + ': ' + keys.length + ' strings');
  }
  console.log('Built ' + TRANSLATED.size + ' Russian pages');
}

const command = process.argv[2] || 'build';
if (command === 'extract') extract();
else if (command === 'build') build();
else {
  console.error('Usage: node scripts/build-i18n.js [build|extract]');
  process.exit(1);
}
