'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Caddy trusted proxy ranges match the nginx Cloudflare list', () => {
  const nginx = read('cloudflare-ips.conf');
  const nginxRanges = [...nginx.matchAll(/^set_real_ip_from\s+([0-9a-f:.\/]+);$/gim)]
    .map(match => match[1].toLowerCase());
  assert.ok(nginxRanges.length > 0, 'cloudflare-ips.conf must contain ranges');

  const snippet = read('deploy/cloudflare-trusted-proxies.caddy');
  assert.match(snippet, /^trusted_proxies static \\$/m);
  const caddyRanges = snippet
    .split('\n')
    .map(line => line.replace(/\\\s*$/, '').trim())
    .filter(line => /^[0-9a-f:.\/]+$/i.test(line))
    .map(line => line.toLowerCase());

  assert.deepEqual(caddyRanges, nginxRanges);
  assert.ok(caddyRanges.some(range => range.includes('.')), 'IPv4 ranges are required');
  assert.ok(caddyRanges.some(range => range.includes(':')), 'IPv6 ranges are required');
});

test('the Caddy example imports the generated range snippet', () => {
  const caddyfile = read('deploy/Caddyfile.example');
  assert.match(caddyfile, /^\s*import cloudflare-trusted-proxies\.caddy$/m);
  assert.equal(caddyfile.includes('173.245.48.0/20'), false);
});

test('deploy resets both generated files and reloads Caddy', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(
    workflow,
    /git checkout -- cloudflare-ips\.conf deploy\/cloudflare-trusted-proxies\.caddy/
  );

  const script = read('scripts/update-cloudflare-ips.sh');
  assert.match(script, /install -m 0644/);
  assert.match(script, /sha256sum/);
  assert.match(script, /docker cp/);
  assert.match(script, /caddy reload/);
});
