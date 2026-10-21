'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const checker = require('../backend/external-check');

function startWorker(secret, handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + secret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        let payload = null;
        try { payload = JSON.parse(body); } catch (e) { payload = null; }
        handler(payload, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

function respond(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function okResponse(host, status = 200) {
  return {
    host,
    reachable: true,
    httpOk: status >= 200 && status < 400,
    protocol: 'https',
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    responseMs: 42,
    redirect: null,
    contentType: 'text/html; charset=utf-8',
    contentLength: 1234,
    title: 'Example',
    server: 'test-server',
    securityHeaders: {
      strictTransportSecurity: 'present',
      contentSecurityPolicy: 'missing',
      xContentTypeOptions: 'present',
      xFrameOptions: 'missing',
      referrerPolicy: 'present',
      permissionsPolicy: 'missing'
    },
    source: 'Cloudflare Worker'
  };
}

function workerHttpResponse(host, overrides = {}) {
  return Object.assign({
    ok: true,
    type: 'http',
    host,
    reachable: true,
    httpOk: true,
    protocol: 'https',
    status: 200,
    statusText: 'OK',
    responseMs: 42,
    redirect: null,
    finalUrl: 'https://' + host + '/',
    redirects: [{ url: 'https://' + host + '/', status: 200, location: '', ms: 42 }],
    contentType: 'text/html; charset=utf-8',
    contentLength: 1234,
    title: 'Example',
    server: 'test-server',
    headers: [
      { name: 'server', value: 'test-server' },
      { name: 'strict-transport-security', value: 'max-age=31536000' },
      { name: 'x-content-type-options', value: 'nosniff' }
    ],
    headerMap: {
      server: 'test-server',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff'
    },
    source: 'Cloudflare Worker'
  }, overrides);
}

function failureResponse(host, error) {
  return {
    host,
    reachable: false,
    httpOk: false,
    status: null,
    responseMs: 50,
    error,
    source: 'Cloudflare Worker'
  };
}

test('normalizes a working site response', () => {
  const result = checker.normalizeResponse(okResponse('example.com'));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 200);
  assert.equal(result.protocol, 'https');
  assert.equal(result.finalUrl, 'https://example.com/');
  assert.equal(result.title, 'Example');
  assert.equal(result.source, 'worker');
  assert.deepEqual(result.headers, [
    { name: 'server', value: 'test-server' },
    { name: 'content-type', value: 'text/html; charset=utf-8' },
    { name: 'content-length', value: '1234' },
    { name: 'strict-transport-security', value: 'present' },
    { name: 'x-content-type-options', value: 'present' },
    { name: 'referrer-policy', value: 'present' }
  ]);
});

test('keeps a 404 as a successful check, not an error', () => {
  const result = checker.normalizeResponse(okResponse('example.com', 404));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 404);
  assert.equal(result.source, 'worker');
});

test('normalizes an unreachable target', () => {
  const result = checker.normalizeResponse(failureResponse('example.com', 'Connection failed'));
  assert.equal(result.error, 'Connection failed');
});

test('normalizes a timeout response', () => {
  const result = checker.normalizeResponse(failureResponse('example.com', 'Connection timed out'));
  assert.equal(result.error, 'Connection timed out');
});

test('rejects malformed and statusless worker responses', () => {
  assert.match(checker.normalizeResponse({ nope: true }).error, /External check failed/);
  assert.match(checker.normalizeResponse(null).error, /invalid response/);
});

test('normalizes the current worker HTTP contract with real header values', () => {
  const result = checker.normalizeHttpResponse(workerHttpResponse('example.com'), 'example.com');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, 'https://example.com/');
  assert.deepEqual(result.headers, [
    { name: 'server', value: 'test-server' },
    { name: 'strict-transport-security', value: 'max-age=31536000' },
    { name: 'x-content-type-options', value: 'nosniff' }
  ]);
  assert.deepEqual(result.redirects, [
    { url: 'https://example.com/', status: 200, location: '', error: '', blocked: false, ms: 42 }
  ]);
});

test('normalizes external DNS records, including SOA and PTR', () => {
  const a = checker.normalizeDnsResponse({
    ok: true,
    host: 'example.com',
    recordType: 'A',
    records: ['192.0.2.1'],
    resolver: 'Cloudflare 1.1.1.1'
  }, 'example.com', 'A');
  assert.deepEqual(a.records, ['192.0.2.1']);
  assert.equal(a.source, 'worker');

  const soa = checker.normalizeDnsResponse({
    ok: true,
    host: 'example.com',
    recordType: 'SOA',
    records: { nsname: 'ns1.example.com', serial: 1 }
  }, 'example.com', 'SOA');
  assert.deepEqual(soa.records, { nsname: 'ns1.example.com', serial: 1 });

  const ptr = checker.normalizeDnsResponse({
    ok: true,
    host: '1.1.1.1',
    recordType: 'PTR',
    records: ['one.one.one.one']
  }, '1.1.1.1', 'PTR');
  assert.deepEqual(ptr.records, ['one.one.one.one']);
});

test('normalizes external propagation and email results', () => {
  const propagation = checker.normalizePropagationResponse({
    ok: true,
    host: 'example.com',
    recordType: 'A',
    resolvers: [
      { server: 'Cloudflare 1.1.1.1', records: ['192.0.2.1'] },
      { server: 'Google 8.8.8.8', error: 'DNS timeout' }
    ]
  }, 'example.com', 'A');
  assert.equal(propagation.resolvers.length, 2);
  assert.deepEqual(propagation.resolvers[0], {
    server: 'Cloudflare 1.1.1.1',
    records: ['192.0.2.1']
  });

  const email = checker.normalizeEmailResponse({
    ok: true,
    host: 'example.com',
    mx: [{ priority: 10, host: 'mail.example.com' }],
    spf: 'v=spf1 -all',
    dmarc: 'v=DMARC1; p=none',
    dkim: null,
    errors: { dkim: 'ENODATA' }
  }, 'example.com');
  assert.equal(email.host, 'example.com');
  assert.deepEqual(email.mx, [{ priority: 10, host: 'mail.example.com' }]);
  assert.equal(email.spf, 'v=spf1 -all');
  assert.equal(email.errors.dkim, 'ENODATA');
});

test('only falls back when no HTTP status was received', () => {
  assert.equal(checker.shouldUseExternal({ status: null, error: 'timeout' }), true);
  assert.equal(checker.shouldUseExternal({ status: null, error: 'Cannot resolve' }), true);
  assert.equal(checker.shouldUseExternal({ status: 200, error: null }), false);
  assert.equal(checker.shouldUseExternal({ status: 404, error: null }), false);
  assert.equal(checker.shouldUseExternal({ status: null, error: 'blocked', blocked: true }), false);
});

test('accepts domains and rejects URLs, IPs and single labels', () => {
  assert.equal(checker.normalizeHost('Example.COM.'), 'example.com');
  assert.equal(checker.normalizeHost('sub.example.co.uk'), 'sub.example.co.uk');
  assert.equal(checker.normalizeHost('https://example.com/'), '');
  assert.equal(checker.normalizeHost('1.2.3.4'), '');
  assert.equal(checker.normalizeHost('localhost'), '');
  assert.equal(checker.normalizeHost('foo.invalid'), '');
  assert.equal(checker.normalizeHost('example'), '');
});

test('worker URL must be HTTPS except on loopback', () => {
  assert.ok(checker.parseWorkerUrl('https://checker.example.workers.dev/'));
  assert.ok(checker.parseWorkerUrl('http://127.0.0.1:8787/'));
  assert.equal(checker.parseWorkerUrl('http://checker.example.com/'), null);
  assert.equal(checker.parseWorkerUrl('ftp://checker.example.com/'), null);
});

test('returns not-configured when the environment is empty', async () => {
  const savedUrl = process.env.CHECKER_URL;
  const savedSecret = process.env.CHECKER_SECRET;
  delete process.env.CHECKER_URL;
  delete process.env.CHECKER_SECRET;
  try {
    const result = await checker.checkHost('example.com');
    assert.equal(result.unavailable, true);
    assert.match(result.error, /not configured/);
  } finally {
    if (savedUrl !== undefined) process.env.CHECKER_URL = savedUrl;
    if (savedSecret !== undefined) process.env.CHECKER_SECRET = savedSecret;
  }
});

test('calls the worker and normalizes 200, 404, unreachable and timeout', async (t) => {
  const secret = 'test-secret';
  const { server, url } = await startWorker(secret, (payload, res) => {
    const host = payload && payload.host ? payload.host : '';
    if (host.startsWith('timeout.')) {
      setTimeout(() => respond(res, okResponse(host)), 1500);
      return;
    }
    if (host.startsWith('unreachable.')) {
      respond(res, failureResponse(host, 'Connection failed'), 502);
      return;
    }
    if (host.startsWith('missing.')) {
      respond(res, okResponse(host, 404));
      return;
    }
    respond(res, okResponse(host));
  });
  t.after(() => server.close());

  process.env.CHECKER_URL = url;
  process.env.CHECKER_SECRET = secret;
  process.env.CHECKER_TIMEOUT = '1000';

  const working = await checker.checkHost('example.com');
  assert.equal(working.status, 200);
  assert.equal(working.source, 'worker');

  const missing = await checker.checkHost('missing.example.com');
  assert.equal(missing.status, 404);
  assert.equal(missing.error, undefined);

  const unreachable = await checker.checkHost('unreachable.example.com');
  assert.match(unreachable.error, /Connection failed/);

  const timedOut = await checker.checkHost('timeout.example.com');
  assert.equal(timedOut.error, 'External checker timed out');
  assert.equal(timedOut.timeout, true);
});

test('reports worker authentication failure without exposing the secret', async (t) => {
  const { server, url } = await startWorker('the-real-secret', (payload, res) => {
    respond(res, okResponse(payload.host));
  });
  t.after(() => server.close());

  process.env.CHECKER_URL = url;
  process.env.CHECKER_SECRET = 'wrong-secret';
  process.env.CHECKER_TIMEOUT = '1000';

  const result = await checker.checkHost('example.com');
  assert.equal(result.error, 'External checker authentication failed');
  assert.equal(JSON.stringify(result).includes('wrong-secret'), false);
});

test('siteInfo falls back to the worker when the local DNS check fails', async (t) => {
  const secret = 'integration-secret';
  const { server, url } = await startWorker(secret, (payload, res) => {
    respond(res, okResponse(payload.host));
  });
  t.after(() => server.close());

  process.env.CHECKER_URL = url;
  process.env.CHECKER_SECRET = secret;
  process.env.CHECKER_TIMEOUT = '2000';

  const { siteInfo } = require('../backend/server');
  const result = await siteInfo('no-such-subdomain.orbitnet-test.example.com');
  assert.equal(result.source, 'worker');
  assert.equal(result.status, 200);
  assert.equal(result.title, 'Example');
  assert.match(result.localError, /Cannot resolve/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});


test('calls the worker for HTTP, DNS, propagation and email checks', async (t) => {
  const secret = 'multi-secret';
  const { server, url } = await startWorker(secret, (payload, res) => {
    if (payload.type === 'dns') {
      respond(res, {
        ok: true,
        type: 'dns',
        host: payload.host,
        recordType: payload.recordType,
        records: payload.recordType === 'PTR' ? ['one.one.one.one'] : ['192.0.2.1'],
        resolver: 'Cloudflare 1.1.1.1',
        source: 'Cloudflare Worker'
      });
      return;
    }
    if (payload.type === 'propagation') {
      respond(res, {
        ok: true,
        type: 'propagation',
        host: payload.host,
        recordType: payload.recordType,
        resolvers: [{ server: 'Cloudflare 1.1.1.1', records: ['192.0.2.1'] }],
        source: 'Cloudflare Worker'
      });
      return;
    }
    if (payload.type === 'email') {
      respond(res, {
        ok: true,
        type: 'email',
        host: payload.host,
        mx: [{ priority: 10, host: 'mail.example.com' }],
        spf: 'v=spf1 -all',
        dmarc: 'v=DMARC1; p=none',
        dkim: null,
        errors: {},
        source: 'Cloudflare Worker'
      });
      return;
    }
    respond(res, workerHttpResponse(payload.host));
  });
  t.after(() => server.close());

  process.env.CHECKER_URL = url;
  process.env.CHECKER_SECRET = secret;
  process.env.CHECKER_TIMEOUT = '2000';

  const http = await checker.checkHttp('example.com', { follow: false });
  assert.equal(http.status, 200);
  assert.equal(http.headers[0].value, 'test-server');

  const dns = await checker.checkDns('example.com', 'A');
  assert.deepEqual(dns.records, ['192.0.2.1']);

  const ptr = await checker.checkDns('1.1.1.1', 'PTR');
  assert.deepEqual(ptr.records, ['one.one.one.one']);

  const propagation = await checker.checkPropagation('example.com', 'A');
  assert.equal(propagation.resolvers[0].records[0], '192.0.2.1');

  const email = await checker.checkEmail('example.com', 'default');
  assert.equal(email.mx[0].host, 'mail.example.com');
  assert.equal(email.spf, 'v=spf1 -all');
});

test('DNS, email and redirect wrappers fall back to the worker', async (t) => {
  const secret = 'fallback-secret';
  const { server: worker, url } = await startWorker(secret, (payload, res) => {
    if (payload.type === 'email') {
      respond(res, {
        ok: true,
        type: 'email',
        host: payload.host,
        mx: [{ priority: 5, host: 'mail.example.com' }],
        spf: 'v=spf1 include:_spf.example.com -all',
        dmarc: 'v=DMARC1; p=reject',
        dkim: null,
        errors: {},
        source: 'Cloudflare Worker'
      });
      return;
    }
    if (payload.type === 'http') {
      respond(res, {
        ok: true,
        type: 'http',
        host: payload.host,
        reachable: true,
        status: 301,
        protocol: 'https',
        finalUrl: 'https://' + payload.host + '/final',
        redirects: [
          { url: 'https://' + payload.host + '/', status: 301, location: '/final', ms: 10 },
          { url: 'https://' + payload.host + '/final', status: 200, location: '', ms: 10 }
        ],
        responseMs: 20,
        headers: [],
        source: 'Cloudflare Worker'
      });
      return;
    }
    respond(res, {
      ok: true,
      type: 'dns',
      host: payload.host,
      recordType: payload.recordType,
      records: ['192.0.2.55'],
      resolver: 'Cloudflare 1.1.1.1',
      source: 'Cloudflare Worker'
    });
  });
  t.after(() => worker.close());

  process.env.CHECKER_URL = url;
  process.env.CHECKER_SECRET = secret;
  process.env.CHECKER_TIMEOUT = '2000';

  const { emailInfo, redirectChain, server } = require('../backend/server');
  const target = 'no-such-subdomain.orbitnet-test.example.com';

  const email = await emailInfo(target, 'default');
  assert.equal(email.source, 'worker');
  assert.equal(email.mx[0].host, 'mail.example.com');

  const redirects = await redirectChain(target);
  assert.equal(redirects.source, 'worker');
  assert.equal(redirects.chain.length, 2);
  assert.equal(redirects.finalUrl, 'https://' + target + '/final');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const apiUrl = 'http://127.0.0.1:' + server.address().port +
    '/api/dns?host=' + encodeURIComponent(target) + '&type=A';
  const response = await fetch(apiUrl);
  const dns = await response.json();
  assert.equal(dns.source, 'worker');
  assert.deepEqual(dns.records, ['192.0.2.55']);
});
