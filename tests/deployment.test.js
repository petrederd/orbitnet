'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { ROOT } = require('./helpers');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('every compose service is hardened and images are digest-pinned', () => {
  const compose = yaml.load(read('docker-compose.yml'));

  for (const [name, service] of Object.entries(compose.services)) {
    if (service.image) {
      assert.match(service.image, /@sha256:[a-f0-9]{64}$/, name + ' image must be digest-pinned');
    }
    assert.equal(service.read_only, true, name + ' must use a read-only root filesystem');
    assert.ok((service.security_opt || []).includes('no-new-privileges:true'), name + ' must set no-new-privileges');
    assert.ok((service.cap_drop || []).includes('ALL'), name + ' must drop all capabilities');
    assert.ok(service.mem_limit, name + ' must set mem_limit');
    assert.ok(service.pids_limit, name + ' must set pids_limit');
  }
});

test('the Node base image is digest-pinned', () => {
  assert.match(read('backend/Dockerfile'), /^FROM node:22-alpine@sha256:[a-f0-9]{64}$/m);
});

test('the private resolver keeps the capabilities its entrypoint needs', () => {
  const compose = yaml.load(read('docker-compose.yml'));
  const caps = compose.services['orbitnet-unbound'].cap_add || [];
  for (const cap of ['NET_BIND_SERVICE', 'SETGID', 'SETUID', 'CHOWN', 'MKNOD', 'SYS_CHROOT']) {
    assert.ok(caps.includes(cap), 'orbitnet-unbound must keep ' + cap);
  }
});

test('tmpfs mounts are bounded and the geoip updater can write its volume', () => {
  const compose = yaml.load(read('docker-compose.yml'));
  for (const [name, service] of Object.entries(compose.services)) {
    for (const mount of service.tmpfs || []) {
      assert.match(mount, /(^|[:,])size=\d+[kmg]?$/, name + ' tmpfs must set an explicit size: ' + mount);
    }
  }
  const caps = compose.services['geoip-updater'].cap_add || [];
  assert.ok(caps.includes('DAC_OVERRIDE'), 'geoip-updater must be able to write a volume owned by another UID');
});

test('Dependabot keeps pinned Docker images and actions updated', () => {
  const config = yaml.load(read('.github/dependabot.yml'));
  assert.equal(config.version, 2);
  const updates = config.updates.map(item => item['package-ecosystem'] + ':' + item.directory);
  for (const expected of ['docker:/', 'docker:/backend', 'github-actions:/']) {
    assert.ok(updates.includes(expected), 'missing Dependabot update for ' + expected);
  }
});
