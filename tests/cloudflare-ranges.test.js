'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  assert.match(workflow, /envs:.*CADDY_CONTAINER.*CADDY_CONFIG_PATH/);
  assert.doesNotMatch(workflow, /could not refresh cloudflare-ips\.conf/);

  const script = read('scripts/update-cloudflare-ips.sh');
  assert.match(script, /cat "\$caddy_out" > "\$dest"/);
  assert.doesNotMatch(script, /^\s*docker cp/m);
  assert.match(script, /sha256sum/);
  assert.match(script, /caddy reload/);
  assert.match(script, /not mounted from the host/);
});

function caddyFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbitnet-caddy-'));
  const bin = path.join(tmp, 'bin');
  const config = path.join(tmp, 'caddy');
  const scripts = path.join(tmp, 'scripts');
  fs.mkdirSync(bin);
  fs.mkdirSync(config);
  fs.mkdirSync(scripts);
  fs.mkdirSync(path.join(tmp, 'deploy'));

  const fragment = path.join(config, 'cloudflare-trusted-proxies.caddy');
  const caddyfile = path.join(config, 'Caddyfile');
  fs.writeFileSync(fragment, 'old fragment\n');
  fs.writeFileSync(caddyfile, 'import cloudflare-trusted-proxies.caddy\n');
  fs.writeFileSync(path.join(tmp, 'cloudflare-ips.conf'), 'old ranges\n');
  fs.writeFileSync(path.join(tmp, 'deploy', 'cloudflare-trusted-proxies.caddy'), 'old fragment\n');
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'update-cloudflare-ips.sh'),
    path.join(scripts, 'update-cloudflare-ips.sh')
  );
  fs.chmodSync(path.join(scripts, 'update-cloudflare-ips.sh'), 0o755);

  const v4 = path.join(tmp, 'v4');
  const v6 = path.join(tmp, 'v6');
  const reloadLog = path.join(tmp, 'reload.log');
  fs.writeFileSync(v4, '198.51.100.0/24\n');
  fs.writeFileSync(v6, '2001:db8::/32\n');

  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *ips-v4*) cat "$TEST_V4" ;;
  *ips-v6*) cat "$TEST_V6" ;;
  *) exit 22 ;;
esac
`, { mode: 0o755 });

  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  inspect)
    fmt="$3"
    if [[ "$fmt" == *cloudflare-trusted-proxies.caddy* && "\${TEST_MOUNTED:-1}" == "1" ]]; then
      printf '%s\n' "$TEST_FRAGMENT"
    elif [[ "$fmt" == *"/etc/caddy/Caddyfile"* && "\${TEST_MOUNTED:-1}" == "1" ]]; then
      printf '%s\n' "$TEST_CADDYFILE"
    else
      printf '\n'
    fi
    ;;
  exec)
    shift
    container="$1"
    shift
    case "$1" in
      test) exit 0 ;;
      grep) exit 0 ;;
      sha256sum) sha256sum "$TEST_FRAGMENT" ;;
      caddy) echo reload >> "$TEST_RELOAD_LOG" ;;
      *) echo "unexpected docker exec in $container: $*" >&2; exit 1 ;;
    esac
    ;;
  *) echo "unexpected docker command: $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });

  function run(extraEnv = {}) {
    return spawnSync(path.join(scripts, 'update-cloudflare-ips.sh'), [], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TEST_V4: v4,
        TEST_V6: v6,
        TEST_FRAGMENT: fragment,
        TEST_CADDYFILE: caddyfile,
        TEST_RELOAD_LOG: reloadLog,
        CADDY_CONTAINER: 'test-caddy',
        ...extraEnv
      }
    });
  }

  return { tmp, fragment, v4, reloadLog, run };
}

test('Caddy publishes into a single-file mount without replacing its inode', t => {
  const fixture = caddyFixture();
  t.after(() => fs.rmSync(fixture.tmp, { recursive: true, force: true }));
  const inode = fs.statSync(fixture.fragment).ino;

  let result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(fixture.fragment).ino, inode, 'inode must be preserved');
  assert.match(fs.readFileSync(fixture.fragment, 'utf8'), /198\.51\.100\.0\/24/);
  assert.equal(fs.readFileSync(fixture.reloadLog, 'utf8').trim(), 'reload');

  result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(fixture.fragment).ino, inode);
  assert.equal(fs.readFileSync(fixture.reloadLog, 'utf8').trim(), 'reload', 'unchanged fragment must not reload');

  fs.writeFileSync(fixture.v4, '198.51.100.0/24\n203.0.113.0/24\n');
  result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(fixture.fragment).ino, inode);
  assert.match(fs.readFileSync(fixture.fragment, 'utf8'), /203\.0\.113\.0\/24/);
  assert.equal(fs.readFileSync(fixture.reloadLog, 'utf8').trim(), 'reload\nreload');
});

test('Caddy refuses to publish an imported fragment that is not mounted', t => {
  const fixture = caddyFixture();
  t.after(() => fs.rmSync(fixture.tmp, { recursive: true, force: true }));

  const result = fixture.run({ TEST_MOUNTED: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not mounted from the host/);
  assert.equal(fs.readFileSync(fixture.fragment, 'utf8'), 'old fragment\n');
  assert.equal(fs.existsSync(fixture.reloadLog), false);
});
