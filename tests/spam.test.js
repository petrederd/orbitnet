'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join('..', 'backend', 'server.js'));

const {
  parseSpamTarget, parseDnsblRecords, reverseIpName, spamCheck,
  SPAM_IP_LISTS, SPAM_CACHE_TTL, SPAM_BLOCKED_CACHE_TTL, domainSuffixes
} = api;

function nxdomain() {
  return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
}

test('reverseIpName reverses an IPv4 address into labels', () => {
  assert.equal(reverseIpName('1.2.3.4'), '4.3.2.1');
  assert.equal(reverseIpName('203.0.113.7'), '7.113.0.203');
  assert.equal(reverseIpName('::1'), '');
  assert.equal(reverseIpName('not-an-ip'), '');
});

test('parseDnsblRecords classifies listed, blocked and clean answers', () => {
  assert.deepEqual(parseDnsblRecords(['127.0.0.2']), {
    listed: true, blocked: false, code: '127.0.0.2', reason: ''
  });
  assert.deepEqual(parseDnsblRecords(['127.0.0.4', '127.0.0.2']), {
    listed: true, blocked: false, code: '127.0.0.4', reason: ''
  });

  const blocked = parseDnsblRecords(['127.255.255.254']);
  assert.equal(blocked.listed, false);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.code, '127.255.255.254');
  assert.match(blocked.reason, /resolver/i);

  assert.deepEqual(parseDnsblRecords([]), { listed: false, blocked: false, code: '', reason: '' });
  assert.deepEqual(parseDnsblRecords(['203.0.113.1']), { listed: false, blocked: false, code: '', reason: '' });
  assert.deepEqual(parseDnsblRecords(null), { listed: false, blocked: false, code: '', reason: '' });
});

test('Spamhaus PBL and Mailspike reputation codes are not spam listings', () => {
  const zen = SPAM_IP_LISTS.find(item => item.zone === 'zen.spamhaus.org');
  const pbl = parseDnsblRecords(['127.0.0.10'], zen);
  assert.equal(pbl.listed, true);
  assert.equal(pbl.spam, false);
  assert.equal(pbl.category, 'pbl');
  assert.equal(pbl.label, 'PBL: dynamic IP range');

  const mailspike = SPAM_IP_LISTS.find(item => item.zone === 'bl.mailspike.net');
  const reputation = parseDnsblRecords(['127.9.0.1'], mailspike);
  assert.equal(reputation.listed, true);
  assert.equal(reputation.spam, false);
  assert.equal(reputation.category, 'reputation');
  assert.match(reputation.label, /Mailspike reputation/);
});

test('domain checks use the registrable parent and never a public suffix', () => {
  assert.deepEqual(domainSuffixes('mail.example.com'), ['mail.example.com', 'example.com']);
  assert.deepEqual(domainSuffixes('example.co.uk'), ['example.co.uk']);
  assert.deepEqual(domainSuffixes('mail.example.co.uk'), ['mail.example.co.uk', 'example.co.uk']);
});

test('blocked answers use a much shorter cache TTL than clean answers', () => {
  assert.equal(SPAM_CACHE_TTL, 10 * 60 * 1000);
  assert.ok(SPAM_BLOCKED_CACHE_TTL >= 30 * 1000);
  assert.ok(SPAM_BLOCKED_CACHE_TTL <= 60 * 1000);
});

test('spamCheck queries the parent domain for a subdomain target', async () => {
  const resolve = (name, type) => {
    if (type === 'A' && name === 'example.com.dbl.spamhaus.org') return Promise.resolve(['127.0.1.168']);
    if (type === 'A' && name === 'mail.example.com') return Promise.resolve(['93.184.216.34']);
    return nxdomain();
  };

  const result = await spamCheck('mail.example.com', { resolve });
  const dbl = result.domains[0].lists.find(item =>
    item.name === 'Spamhaus DBL' && item.lookup === 'example.com');
  assert.equal(dbl.listed, true);
});

test('parseSpamTarget detects IP, domain and email; rejects junk', () => {
  assert.deepEqual(parseSpamTarget('1.2.3.4'), { kind: 'ip', ip: '1.2.3.4' });
  assert.deepEqual(parseSpamTarget('Example.COM'), { kind: 'domain', host: 'example.com' });
  assert.deepEqual(parseSpamTarget('user@example.com'), { kind: 'email', host: 'example.com' });
  assert.equal(parseSpamTarget('localhost'), null);
  assert.equal(parseSpamTarget('foo.local'), null);
  assert.equal(parseSpamTarget('has space.com'), null);
  assert.equal(parseSpamTarget(''), null);
});

test('spamCheck reports a listed and a blocked IP', async () => {
  const resolve = (name, type) => {
    if (type === 'A' && name === '8.8.8.8.zen.spamhaus.org') return Promise.resolve(['127.0.0.2']);
    if (type === 'A' && name === '9.9.9.9.zen.spamhaus.org') return Promise.resolve(['127.255.255.254']);
    return nxdomain();
  };

  const listed = await spamCheck('8.8.8.8', { resolve });
  assert.equal(listed.kind, 'ip');
  assert.equal(listed.ips.length, 1);
  const zen = listed.ips[0].lists.find(item => item.name === 'Spamhaus ZEN');
  assert.equal(zen.listed, true);
  assert.equal(zen.code, '127.0.0.2');

  const blocked = await spamCheck('9.9.9.9', { resolve });
  const blockedZen = blocked.ips[0].lists.find(item => item.name === 'Spamhaus ZEN');
  assert.equal(blockedZen.listed, false);
  assert.equal(blockedZen.blocked, true);
});

test('spamCheck flags a blocked resolver with the Spamhaus canary', async () => {
  const resolve = (name, type) => {
    if (type === 'A' && name === '2.0.0.127.zen.spamhaus.org') {
      return Promise.resolve(['127.255.255.254']);
    }
    return nxdomain();
  };

  const result = await spamCheck('8.8.8.8', { resolve });
  assert.equal(result.resolver.blocked, true);
  assert.equal(result.resolver.code, '127.255.255.254');
});

test('healthy Spamhaus canary answers mean the resolver is healthy', async () => {
  for (const code of ['127.0.0.2', '127.0.0.4', '127.0.0.10']) {
    const resolve = (name, type) => {
      if (type === 'A' && name === '2.0.0.127.zen.spamhaus.org') {
        return Promise.resolve([code]);
      }
      return nxdomain();
    };

    const result = await spamCheck('8.8.8.8', { resolve });
    assert.equal(result.resolver.checked, true, code);
    assert.equal(result.resolver.blocked, false, code);
    assert.equal(result.resolver.code, code);
  }
});

test('an NXDOMAIN canary answer leaves the resolver status unknown', async () => {
  const result = await spamCheck('8.8.8.8', { resolve: nxdomain });
  assert.equal(result.resolver.checked, false);
  assert.equal(result.resolver.blocked, null);
  assert.match(result.resolver.error, /NXDOMAIN/);
});

test('spamCheck keeps query errors separate from clean answers', async () => {
  const resolve = (name, type) => {
    if (type === 'A' && name === '1.1.1.1.zen.spamhaus.org') {
      return Promise.reject(Object.assign(new Error('servfail'), { code: 'ESERVFAIL' }));
    }
    return nxdomain();
  };

  const result = await spamCheck('1.1.1.1', { resolve });
  const zen = result.ips[0].lists.find(item => item.name === 'Spamhaus ZEN');
  assert.equal(zen.listed, null);
  assert.equal(zen.error, 'ESERVFAIL');
  const clean = result.ips[0].lists.find(item => item.name === 'DroneBL');
  assert.equal(clean.listed, false);
});

test('spamCheck covers domain lists and the A record', async () => {
  const resolve = (name, type) => {
    if (type === 'A' && name === 'example.com') return Promise.resolve(['93.184.216.34']);
    if (type === 'A' && name === 'example.com.dbl.spamhaus.org') return Promise.resolve(['127.0.1.168']);
    return nxdomain();
  };

  const result = await spamCheck('example.com', { resolve });
  assert.equal(result.kind, 'domain');
  assert.equal(result.host, 'example.com');
  assert.equal(result.domains.length, 1);
  const dbl = result.domains[0].lists.find(item => item.name === 'Spamhaus DBL');
  assert.equal(dbl.listed, true);

  assert.equal(result.ips.length, 1);
  assert.equal(result.ips[0].ip, '93.184.216.34');
  assert.equal(result.ips[0].lists.length, SPAM_IP_LISTS.length);
});

test('spamCheck uses MX hosts for an email address', async () => {
  const resolve = (name, type) => {
    if (type === 'MX' && name === 'example.org') {
      return Promise.resolve([{ priority: 10, exchange: 'mx.example.org' }]);
    }
    if (type === 'A' && name === 'mx.example.org') return Promise.resolve(['93.184.216.34']);
    return nxdomain();
  };

  const result = await spamCheck('user@example.org', { resolve });
  assert.equal(result.kind, 'email');
  assert.equal(result.host, 'example.org');
  assert.equal(result.ips.length, 1);
  assert.equal(result.ips[0].ip, '93.184.216.34');
});

test('spamCheck refuses private addresses and invalid targets', async () => {
  await assert.rejects(() => spamCheck('10.0.0.1', { resolve: nxdomain }), /public IP/);
  assert.equal(await spamCheck('not valid', { resolve: nxdomain }), null);
});
