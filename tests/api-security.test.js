'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  server, isRateLimited, rateLimitKey, RATE_MAX_ENTRIES,
  isTargetRateLimited, targetHits, TARGET_RATE_MAX,
  acquireClientSlot, releaseClientSlot, CLIENT_CONCURRENT_MAX,
  createCaptcha, captchas, captchaIdsByKey, CAPTCHA_PER_KEY_MAX
} = require('../backend/server');

function listen() {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close() {
  return new Promise(resolve => server.close(resolve));
}

function get(port, pathname, clientIp) {
  return new Promise((resolve, reject) => {
    const headers = clientIp ? { 'X-Real-IP': clientIp } : {};
    http.get({ host: '127.0.0.1', port, path: pathname, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        resolve({ status: response.statusCode, body: JSON.parse(body) });
      });
    }).on('error', reject);
  });
}

test('DNS and email endpoints reject single-label and private targets', async () => {
  const port = await listen();
  try {
    const clientIp = '93.184.216.34';
    const dnsName = await get(port, '/api/dns?host=orbitnet-unbound&type=A', clientIp);
    assert.equal(dnsName.status, 400);

    const dnsPtr = await get(port, '/api/dns?host=172.18.0.2&type=PTR', clientIp);
    assert.equal(dnsPtr.status, 400);

    const email = await get(port, '/api/email?host=orbitnet-unbound', clientIp);
    assert.equal(email.status, 400);
  } finally {
    await close();
  }
});

test('IPv6 rate limiting is shared by the whole /64 instead of per address', async () => {
  const port = await listen();
  try {
    const first = '2a01:4f8:1:2::1';
    const sameSubnet = '2a01:4f8:1:2::abcd';
    const otherSubnet = '2a01:4f8:1:3::1';

    for (let i = 0; i < 60; i++) {
      const response = await get(port, '/api/dns', first);
      assert.equal(response.status, 400);
    }
    const blocked = await get(port, '/api/dns', sameSubnet);
    assert.equal(blocked.status, 429);

    const allowed = await get(port, '/api/dns', otherSubnet);
    assert.equal(allowed.status, 400);
  } finally {
    await close();
  }
});

test('a full rate-limit table evicts the oldest client instead of rejecting new ones', () => {
  const now = Date.now();
  const store = new Map();
  for (let i = 0; i < RATE_MAX_ENTRIES; i++) {
    store.set('old-client-' + i, { start: now, count: 1 });
  }

  const limited = isRateLimited('203.0.113.77', store);

  assert.equal(limited, false);
  assert.equal(store.size, RATE_MAX_ENTRIES);
  assert.equal(store.has(rateLimitKey('203.0.113.77')), true);
  assert.equal(store.has('old-client-0'), false);
});

test('per-target checks and per-client concurrency are bounded', () => {
  targetHits.clear();
  try {
    for (let i = 0; i < TARGET_RATE_MAX; i++) {
      assert.equal(isTargetRateLimited('Example.COM.'), false);
    }
    assert.equal(isTargetRateLimited('example.com'), true);
    assert.equal(isTargetRateLimited('other.example.com'), false);
  } finally {
    targetHits.clear();
  }

  const ip = '2a01:4f8:abcd:1::1';
  const held = [];
  try {
    for (let i = 0; i < CLIENT_CONCURRENT_MAX; i++) {
      const slot = acquireClientSlot(ip);
      assert.ok(slot);
      held.push(slot);
    }
    assert.equal(acquireClientSlot(ip), null);

    const other = acquireClientSlot('2a01:4f8:abcd:2::1');
    assert.ok(other);
    releaseClientSlot(other);

    releaseClientSlot(held.pop());
    const reacquired = acquireClientSlot(ip);
    assert.ok(reacquired);
    held.push(reacquired);
  } finally {
    for (const slot of held) releaseClientSlot(slot);
  }
});

test('captcha storage is capped per /64 so one prefix cannot evict every challenge', () => {
  captchas.clear();
  captchaIdsByKey.clear();
  try {
    const ids = [];
    for (let i = 1; i <= CAPTCHA_PER_KEY_MAX + 5; i++) {
      ids.push(createCaptcha('2001:db8:abcd:1234::' + i.toString(16)).id);
    }

    const key = rateLimitKey('2001:db8:abcd:1234::1');
    assert.equal(captchaIdsByKey.get(key).size, CAPTCHA_PER_KEY_MAX);
    assert.equal(captchas.size, CAPTCHA_PER_KEY_MAX);
    for (const id of ids.slice(0, 5)) {
      assert.equal(captchas.has(id), false);
    }
    assert.equal(captchas.has(ids[ids.length - 1]), true);
  } finally {
    captchas.clear();
    captchaIdsByKey.clear();
  }
});
