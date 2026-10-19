'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SITE, loadTool, run } = require('./helpers');

const FILE = path.join(SITE, 'tools/networks/anonymity-check.html');

function load() {
  return loadTool(FILE, {}, {
    fetch: () => Promise.reject(new Error('offline test stub'))
  }).context;
}

const emptyReport = {
  ip: '198.51.100.7',
  hostname: '',
  geo: { timezone: '' },
  proxyHeaders: [],
  tor: { available: true, listed: false },
  hosting: { score: 0, reasons: [], providers: [], organization: '' },
  hostnameSignals: { score: 0, reasons: [] }
};

test('timezone offsets are calculated in minutes east of UTC', () => {
  const context = load();
  assert.equal(run(context, "timezoneOffset('UTC')"), 0);
  assert.equal(run(context, "timezoneOffset('Asia/Kolkata')"), 330);
  assert.equal(run(context, "timezoneOffset('Not/AZone')"), null);
});

test('private and public WebRTC addresses are classified', () => {
  const context = load();
  assert.equal(run(context, "isPrivateAddress('192.168.1.10')"), true);
  assert.equal(run(context, "isPrivateAddress('10.0.0.5')"), true);
  assert.equal(run(context, "isPrivateAddress('172.20.1.1')"), true);
  assert.equal(run(context, "isPrivateAddress('fe80::1')"), true);
  assert.equal(run(context, "isPrivateAddress('::ffff:192.168.1.20')"), true);
  assert.equal(run(context, "isPrivateAddress('8.8.8.8')"), false);
  assert.equal(run(context, "isPrivateAddress('2001:4860:4860::8888')"), false);
});

test('the score adds independent proxy, Tor and leak signals', () => {
  const context = load();

  assert.equal(run(context, `calcScore(${JSON.stringify(emptyReport)}, null, null, null).score`), 0);

  const proxyReport = { ...emptyReport, proxyHeaders: [{ name: 'via', strength: 'high' }] };
  assert.equal(run(context, `calcScore(${JSON.stringify(proxyReport)}, null, null, null).score`), 30);

  const torReport = { ...emptyReport, tor: { available: true, listed: true } };
  assert.equal(run(context, `calcScore(${JSON.stringify(torReport)}, null, null, null).score`), 100);

  const webrtc = { public: ['8.8.8.8'], local: [] };
  assert.equal(run(context, `calcScore(${JSON.stringify(emptyReport)}, ${JSON.stringify(webrtc)}, null, null).score`), 35);

  const ports = { groups: { httpProxy: [{ open: true }], webProxy: [], vpn: [] } };
  assert.equal(run(context, `calcScore(${JSON.stringify(emptyReport)}, null, null, ${JSON.stringify(ports)}).score`), 25);
});

test('WebRTC collection resolves safely when WebRTC is unavailable', async () => {
  const context = load();
  const result = await run(context, 'collectWebRTC(10)');
  assert.equal(result.supported, false);
  assert.equal(result.public.length, 0);
});

test('the full report renders with passive and active signals', () => {
  const context = load();
  const report = {
    ip: '198.51.100.7',
    version: 4,
    hostname: 'vps-198-51-100-7.example.net',
    geo: {
      city: 'Frankfurt', region: 'Hesse', country: 'Germany',
      timezone: 'Europe/Berlin', asn: 64500,
      asnOrganization: 'Example Hosting GmbH'
    },
    proxyHeaders: [{ name: 'via', value: '1.1 proxy', strength: 'high', reason: 'test' }],
    tor: { available: true, listed: false },
    hosting: {
      score: 65, likely: true, providers: ['Example Hosting'],
      reasons: ['ASN or PTR matches Example Hosting'],
      organization: 'Example Hosting GmbH', asn: 64500
    },
    hostnameSignals: { score: 20, reasons: ['Hosting/server keyword in PTR'], matches: ['vps'] }
  };
  const webrtc = { supported: true, public: ['8.8.8.8'], local: ['192.168.1.2'], candidates: [] };
  const timing = { samples: [40, 55, 80], median: 55, jitter: 40 };
  const ports = {
    groups: {
      httpProxy: [{ port: 3128, open: false }, { port: 8080, open: true }],
      webProxy: [{ port: 80, open: false }, { port: 443, open: true }],
      vpn: [{ port: 1194, open: false }]
    }
  };

  run(context, `state.report = ${JSON.stringify(report)}; state.webrtc = ${JSON.stringify(webrtc)}; state.timing = ${JSON.stringify(timing)}; state.ports = ${JSON.stringify(ports)}; render();`);

  assert.match(context.document.getElementById('summaryBox').innerHTML, /Anonymity signal score/);
  assert.match(context.document.getElementById('checks').innerHTML, /HTTP proxy headers/);
  assert.match(context.document.getElementById('checks').innerHTML, /Open ports: HTTP proxy/);
  assert.match(context.document.getElementById('checks').innerHTML, /VPN fingerprint/);
});

let backend = null;
try {
  backend = require('../backend/server.js');
} catch (error) {
  backend = null;
}

test('backend anonymity heuristics classify hosting and proxy signals', t => {
  if (!backend) {
    t.skip('backend dependencies are not installed');
    return;
  }

  const hosting = backend.hostingSignals({ asnOrganization: 'Hetzner Online GmbH' }, '');
  assert.equal(hosting.likely, true);
  assert.ok(hosting.providers.includes('Hetzner'));

  const residential = backend.hostingSignals({ asnOrganization: 'Comcast Cable Communications, LLC' }, 'ppp-203-0-113-7.dial.example.net');
  assert.equal(residential.likely, false);

  const hostname = backend.hostnameSignals('static.203.0.113.7.clients.your-server.de');
  assert.ok(hostname.score > 0);
  assert.equal(backend.hostnameSignals('').reasons[0], 'No PTR record for this address');

  const headers = backend.proxyHeaderSignals({
    headers: {
      via: '1.1 example-proxy',
      'proxy-connection': 'keep-alive',
      'x-forwarded-for': '203.0.113.7',
      cookie: 'session=secret',
      'user-agent': 'test'
    }
  });
  assert.deepEqual(headers.map(h => h.name).sort(), ['proxy-connection', 'via']);
});
