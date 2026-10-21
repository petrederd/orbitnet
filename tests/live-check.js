'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SITE = path.resolve(__dirname, '..', 'site');
const BASE = 'https://orbitnet.ru';
const OG_IMAGE = BASE + '/assets/og-image.png';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const NON_PAGE = new Set(['tools/_template.html', '404.html']);

function pages() {
  return walk(SITE)
    .filter(file => file.endsWith('.html'))
    .filter(file => !NON_PAGE.has(path.relative(SITE, file).split(path.sep).join('/')));
}

function urlFor(file) {
  const rel = path.relative(SITE, file).split(path.sep).join('/');
  return rel === 'index.html' ? BASE + '/' : BASE + '/' + rel;
}

async function fetchStatus(url, attempt = 1, method = 'GET') {
  const maxAttempts = 5;

  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { 'User-Agent': 'OrbitNet-live-check/1.0' },
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        type: response.headers.get('content-type') || '',
        length: response.headers.get('content-length') || '',
      };
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return fetchStatus(url, attempt + 1, method);
    }
    return { ok: false, status: response.status, type: '', length: '' };
  } catch (error) {
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return fetchStatus(url, attempt + 1, method);
    }
    return { ok: false, status: error.message, type: '', length: '' };
  }
}

async function main() {
  const home = await fetchStatus(BASE + '/', 1, 'HEAD');
  if (!home.ok) {
    console.error(`Live site is not reachable: ${BASE}/ — ${home.status}`);
    process.exitCode = 1;
    return;
  }

  const urls = [...new Set(pages().map(urlFor))];
  const failures = [];

  for (const url of urls) {
    const result = await fetchStatus(url, 1, 'HEAD');
    if (!result.ok) failures.push(`${url} — ${result.status}`);
    console.log(`${result.ok ? 'OK ' : 'FAIL'} ${url} [${result.status}]`);
  }

  const image = await fetchStatus(OG_IMAGE);
  if (!image.ok) {
    failures.push(`${OG_IMAGE} — ${image.status}`);
  } else if (!image.type.startsWith('image/png')) {
    failures.push(`${OG_IMAGE} — unexpected content-type: ${image.type}`);
  } else if (image.length === '0') {
    failures.push(`${OG_IMAGE} — empty response`);
  }
  console.log(`${image.ok ? 'OK ' : 'FAIL'} ${OG_IMAGE} [${image.status}]${image.type ? ' ' + image.type : ''}`);

  if (failures.length) {
    console.error('\nLive site check failed:\n' + failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`\nLive site check passed: ${urls.length} pages + OG image.`);
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
