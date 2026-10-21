'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'worker-test-secret';

let workerPromise;

function loadWorker() {
  if (!workerPromise) workerPromise = import('../worker/src/index.js');
  return workerPromise;
}

function request(body) {
  return new Request('https://checker.test/', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function run(body) {
  const worker = await loadWorker();
  const response = await worker.default.fetch(request(body), { CHECKER_SECRET: SECRET });
  return { response, data: await response.json() };
}

function dohAnswers(name, type) {
  if (type === 'A') {
    return [{ name: name + '.', type: 1, TTL: 300, data: '192.0.2.10' }];
  }
  if (type === 'AAAA') {
    return [{ name: name + '.', type: 28, TTL: 300, data: '2001:db8::10' }];
  }
  if (type === 'MX') {
    return [{ name: name + '.', type: 15, TTL: 300, data: '10 mail.' + name + '.' }];
  }
  if (type === 'TXT') {
    return [{ name: name + '.', type: 16, TTL: 300, data: '"' + (name.startsWith('_dmarc') ? 'v=DMARC1; p=none' : name.includes('_domainkey') ? 'v=DKIM1; k=rsa; p=test' : 'v=spf1 -all') + '"' }];
  }
  if (type === 'SOA') {
    return [{ name: name + '.', type: 6, TTL: 300, data: 'ns1.' + name + '. hostmaster.' + name + '. 1 7200 3600 1209600 3600' }];
  }
  if (type === 'CAA') {
    return [{ name: name + '.', type: 257, TTL: 300, data: '0 issue "letsencrypt.org"' }];
  }
  if (type === 'PTR') {
    return [{ name: name + '.', type: 12, TTL: 300, data: 'one.one.one.one.' }];
  }
  return [];
}

function installFetch(t) {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    const name = parsed.searchParams.get('name') || '';
    const type = (parsed.searchParams.get('type') || '').toUpperCase();

    if (parsed.hostname === 'cloudflare-dns.com' ||
        parsed.hostname === 'dns.google' ||
        parsed.hostname === 'dns.adguard-dns.com') {
      return Response.json({ Status: 0, Answer: dohAnswers(name, type) });
    }

    if (parsed.hostname === 'example.com') {
      return new Response('<html><head><title> Example  Page </title></head><body>ok</body></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Server': 'nginx',
          'Strict-Transport-Security': 'max-age=31536000'
        }
      });
    }

    if (parsed.hostname === 'another-site.org') {
      return new Response(null, { status: 204, headers: { 'Server': 'other-server' } });
    }

    if (parsed.hostname === 'redirect.example.com') {
      if (parsed.pathname === '/') {
        return new Response('', { status: 301, headers: { 'Location': '/final' } });
      }
      return new Response('final', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    if (parsed.hostname === 'private.example.com') {
      return new Response('', { status: 302, headers: { 'Location': 'http://127.0.0.1/' } });
    }

    if (parsed.hostname === 'plain.example.com') {
      if (parsed.protocol === 'https:') throw new TypeError('TLS failed');
      return new Response('plain', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    if (parsed.hostname === 'boom.example.com') {
      throw new TypeError('network failed');
    }

    throw new Error('unexpected fetch ' + parsed.href);
  };
  t.after(() => { global.fetch = original; });
}

test('worker rejects requests without the shared secret', async () => {
  const worker = await loadWorker();
  const response = await worker.default.fetch(
    new Request('https://checker.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'http', host: 'example.com' })
    }),
    { CHECKER_SECRET: SECRET }
  );
  assert.equal(response.status, 401);
});

test('worker performs HTTP checks and exposes real header values', async (t) => {
  installFetch(t);
  const { response, data } = await run({ type: 'http', host: 'example.com', follow: false });
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.status, 200);
  assert.equal(data.title, 'Example Page');
  assert.equal(data.protocol, 'https');
  const headers = Object.fromEntries(data.headers.map(h => [h.name, h.value]));
  assert.equal(headers['strict-transport-security'], 'max-age=31536000');
  assert.equal(data.securityHeaders.strictTransportSecurity, 'present');
});

test('worker accepts any public host, not only example.com', async (t) => {
  installFetch(t);
  const { data } = await run({ type: 'http', host: 'another-site.org', follow: false });
  assert.equal(data.ok, true);
  assert.equal(data.host, 'another-site.org');
  assert.equal(data.status, 204);
  assert.equal(data.server, 'other-server');
});

test('worker follows redirects and refuses private targets', async (t) => {
  installFetch(t);
  const followed = await run({ type: 'http', host: 'redirect.example.com', follow: true });
  assert.equal(followed.data.ok, true);
  assert.equal(followed.data.finalUrl, 'https://redirect.example.com/final');
  assert.equal(followed.data.redirects.length, 2);

  const blocked = await run({ type: 'http', host: 'private.example.com', follow: true });
  assert.equal(blocked.data.ok, false);
  assert.match(blocked.data.error, /not public/i);
});

test('worker retries the first hop over HTTP when HTTPS cannot connect', async (t) => {
  installFetch(t);
  const { data } = await run({ type: 'http', host: 'plain.example.com', follow: false });
  assert.equal(data.ok, true);
  assert.equal(data.status, 200);
  assert.equal(data.protocol, 'http');
  assert.equal(data.finalUrl, 'http://plain.example.com/');
});

test('worker returns a target failure instead of a 5xx for unreachable sites', async (t) => {
  installFetch(t);
  const { response, data } = await run({ type: 'http', host: 'boom.example.com', follow: false });
  assert.equal(response.status, 200);
  assert.equal(data.ok, false);
  assert.match(data.error, /Connection failed/);
});

test('worker resolves DNS records and PTR through DoH', async (t) => {
  installFetch(t);
  const a = await run({ type: 'dns', host: 'example.com', recordType: 'A' });
  assert.equal(a.data.ok, true);
  assert.deepEqual(a.data.records, ['192.0.2.10']);

  const mx = await run({ type: 'dns', host: 'example.com', recordType: 'MX' });
  assert.deepEqual(mx.data.records, [{ priority: 10, host: 'mail.example.com' }]);

  const soa = await run({ type: 'dns', host: 'example.com', recordType: 'SOA' });
  assert.equal(soa.data.records.nsname, 'ns1.example.com');
  assert.equal(soa.data.records.serial, 1);

  const ptr = await run({ type: 'dns', host: '1.1.1.1', recordType: 'PTR' });
  assert.deepEqual(ptr.data.records, ['one.one.one.one']);
});

test('worker compares propagation across resolvers', async (t) => {
  installFetch(t);
  const { data } = await run({ type: 'propagation', host: 'example.com', recordType: 'A' });
  assert.equal(data.ok, true);
  assert.equal(data.resolvers.length, 3);
  assert.ok(data.resolvers.every(r => r.records[0] === '192.0.2.10'));
});

test('worker composes the email check from MX, SPF, DMARC and DKIM', async (t) => {
  installFetch(t);
  const { data } = await run({ type: 'email', host: 'example.com', selector: 'default' });
  assert.equal(data.ok, true);
  assert.deepEqual(data.mx, [{ priority: 10, host: 'mail.example.com' }]);
  assert.equal(data.spf, 'v=spf1 -all');
  assert.equal(data.dmarc, 'v=DMARC1; p=none');
  assert.deepEqual(data.dkim, ['v=DKIM1; k=rsa; p=test']);
});
