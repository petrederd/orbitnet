'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SITE, loadTool } = require('./helpers');

function tool(category, slug) {
  return path.join(SITE, 'tools', category, slug + '.html');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function recordingFetch(payload) {
  const state = { active: 0, max: 0, calls: 0 };
  const fetch = async url => {
    state.active++;
    state.calls++;
    state.max = Math.max(state.max, state.active);
    await delay(5);
    state.active--;
    return { json: async () => payload(url) };
  };
  return { state, fetch };
}

test('website health batches its six checks instead of opening six requests', async () => {
  const { state, fetch } = recordingFetch(url => {
    if (url.includes('type=MX')) return { records: [{ priority: 10, host: 'mail.example.com' }] };
    if (url.includes('/api/dns')) return { records: ['203.0.113.1'] };
    if (url.includes('/api/tls')) {
      return { authorized: true, hostnameMatch: true, daysRemaining: 90, protocol: 'TLSv1.3' };
    }
    if (url.includes('/api/headers')) return { headers: [], protocol: 'https', source: 'local' };
    return { status: 200, source: 'local' };
  });
  const { context } = loadTool(tool('networks', 'website-health'), {
    host: 'example.com', checks: '', details: '', errorMsg: ''
  }, { fetch });

  context.run();
  await delay(150);

  assert.equal(state.calls, 6);
  assert.ok(state.max <= 3, 'expected at most three concurrent requests, saw ' + state.max);
});

test('ip info batches its five DNS record lookups in threes', async () => {
  const { state, fetch } = recordingFetch(url => {
    if (url.includes('type=TXT')) return { records: ['v=spf1 -all'] };
    return { records: ['203.0.113.1'] };
  });
  const { context } = loadTool(tool('networks', 'ip-info'), {
    query: '', dnsResults: '', whoisResults: '', geoResults: '', errorMsg: ''
  }, { fetch });

  context.loadDns('example.com');
  await delay(100);

  assert.equal(state.calls, 5);
  assert.ok(state.max <= 3, 'expected at most three concurrent DNS lookups, saw ' + state.max);
});
