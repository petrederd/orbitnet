'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  server, isRateLimited, rateLimitKey, RATE_MAX_ENTRIES,
  isTargetRateLimited, targetForRequest, targetHits, clientTargetHits,
  TARGET_RATE_MAX, TARGET_GLOBAL_RATE_MAX,
  acquireClientSlot, releaseClientSlot, CLIENT_CONCURRENT_MAX,
  whoisCacheKey, whoisCache, whoisCacheGet, storeWhoisResult,
  WHOIS_CLIENT_MAX, WHOIS_TEXT_MAX, whoisHits,
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

    const siteIp = await get(port, '/api/site?host=93.184.216.34', clientIp);
    assert.equal(siteIp.status, 400);
    assert.match(siteIp.body.error, /hostname, not an IP address/);
  } finally {
    await close();
  }
});

test('DNS hides whether a private-only name exists', async () => {
  const dns = require('node:dns').promises;
  const originalResolve = dns.resolve;
  const port = await listen();
  try {
    dns.resolve = async (host, type) => {
      if (host === 'private.orbitnet-test.example') return ['10.0.0.5'];
      const error = new Error('not found');
      error.code = 'ENOTFOUND';
      throw error;
    };
    const clientIp = '93.184.216.35';
    const privateOnly = await get(port, '/api/dns?host=private.orbitnet-test.example&type=A', clientIp);
    const missing = await get(port, '/api/dns?host=missing.orbitnet-test.example&type=A', clientIp);

    assert.equal(privateOnly.status, 200);
    assert.deepEqual(privateOnly.body.records, []);
    assert.equal(privateOnly.body.nxdomain, true);
    assert.equal(missing.body.nxdomain, true);
  } finally {
    dns.resolve = originalResolve;
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

test('a flood of one-request keys evicts itself before active clients', () => {
  const now = Date.now();
  const store = new Map();
  store.set('active-client', { start: now, count: 5 });
  for (let i = 0; i < RATE_MAX_ENTRIES - 1; i++) {
    store.set('flood-' + i, { start: now, count: 1 });
  }

  assert.equal(isRateLimited('203.0.113.78', store), false);
  assert.equal(store.has('active-client'), true);
  assert.equal(store.has('flood-0'), false);
  assert.equal(store.has(rateLimitKey('203.0.113.78')), true);
});

test('per-target checks and per-client concurrency are bounded', () => {
  targetHits.clear();
  clientTargetHits.clear();
  try {
    const clientA = '203.0.113.10';
    const clientB = '203.0.113.11';
    for (let i = 0; i < TARGET_RATE_MAX; i++) {
      assert.equal(isTargetRateLimited('Example.COM.', clientA), false);
    }
    assert.equal(isTargetRateLimited('example.com', clientA), true);
    assert.equal(isTargetRateLimited('example.com', clientB), false);
    assert.equal(isTargetRateLimited('other.example.com', clientA), false);

    for (let i = 0; i < TARGET_GLOBAL_RATE_MAX; i++) {
      isTargetRateLimited('global.example', '2001:db8:' + i.toString(16) + '::1');
    }
    assert.equal(isTargetRateLimited('global.example', clientB), true);
  } finally {
    targetHits.clear();
    clientTargetHits.clear();
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

    const other = acquireClientSlot('2a01:4f8:abce:1::1');
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

test('target selection follows the endpoint instead of query parameter order', () => {
  const query = values => new URLSearchParams(values);
  assert.equal(targetForRequest('/api/spam', query({ target: 'user@example.com' })), 'example.com');
  assert.equal(targetForRequest('/api/spam', query({ target: '203.0.113.9' })), '203.0.113.9');
  assert.equal(targetForRequest('/api/geo', query({ host: 'example.com', ip: '203.0.113.9' })), '203.0.113.9');
  assert.equal(targetForRequest('/api/geo', query({ host: 'example.com', ip: 'not-an-ip' })), 'example.com');
  assert.equal(targetForRequest('/api/anonymity/ports', query({ host: 'example.com', ip: '203.0.113.9' })), '203.0.113.9');
  assert.equal(targetForRequest('/api/site', query({ host: 'example.com', ip: '203.0.113.9' })), 'example.com');
});

test('WHOIS caches by registrable domain, accepts public IPs and bounds stored text', () => {
  whoisCache.clear();
  try {
    assert.equal(whoisCacheKey('x1.example.com.'), 'example.com');
    assert.equal(whoisCacheKey('93.184.216.34'), '93.184.216.34');

    assert.equal(storeWhoisResult('empty.example', ''), '');
    assert.equal(whoisCacheGet('empty.example'), null);

    const long = 'x'.repeat(WHOIS_TEXT_MAX + 16);
    const stored = storeWhoisResult('long.example', long);
    assert.equal(stored.length, WHOIS_TEXT_MAX);
    assert.equal(whoisCacheGet('long.example').length, WHOIS_TEXT_MAX);
  } finally {
    whoisCache.clear();
  }
});

test('WHOIS accepts a cached public IP and rejects private addresses', async () => {
  whoisCache.clear();
  const port = await listen();
  try {
    const ip = '93.184.216.34';
    whoisCache.set(whoisCacheKey(ip), { value: 'NetRange: 93.184.216.0/24', expires: Date.now() + 60000 });
    const publicIp = await get(port, '/api/whois?host=' + encodeURIComponent(ip), '93.184.216.40');
    assert.equal(publicIp.status, 200);
    assert.equal(publicIp.body.cached, true);
    assert.match(publicIp.body.raw, /NetRange/);

    const privateIp = await get(port, '/api/whois?host=10.0.0.5', '93.184.216.41');
    assert.equal(privateIp.status, 400);
  } finally {
    whoisCache.clear();
    await close();
  }
});

test('WHOIS has a per-client budget before hitting the registry', async () => {
  whoisCache.clear();
  whoisHits.clear();
  const port = await listen();
  try {
    const clientIp = '93.184.216.42';
    whoisHits.set(rateLimitKey(clientIp), { start: Date.now(), count: WHOIS_CLIENT_MAX });
    const result = await get(port, '/api/whois?host=93.184.216.88', clientIp);
    assert.equal(result.status, 429);
    assert.match(result.body.error, /Too many WHOIS/);
  } finally {
    whoisHits.clear();
    whoisCache.clear();
    await close();
  }
});

test('unhandled API errors return a generic message instead of internal details', async () => {
  const dns = require('node:dns').promises;
  const originalResolve = dns.resolve;
  const port = await listen();
  try {
    dns.resolve = async () => { throw new Error('leak-secret-resolver.internal'); };
    const result = await get(port, '/api/dns?host=leak.orbitnet-test.example&type=A', '93.184.216.43');
    assert.equal(result.status, 500);
    assert.equal(result.body.error, 'Internal server error');
    assert.equal(JSON.stringify(result.body).includes('leak-secret'), false);
  } finally {
    dns.resolve = originalResolve;
    await close();
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
