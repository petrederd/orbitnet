'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { server } = require('../backend/server');

function listen() {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        resolve({ status: response.statusCode, body: JSON.parse(body) });
      });
    }).on('error', reject);
  });
}

test('/health exposes operational metrics while /api/health stays minimal', async () => {
  const port = await listen();
  try {
    const first = await get(port, '/health');
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.service, 'orbitnet-api');
    assert.ok(Number.isInteger(first.body.uptimeSeconds));
    assert.ok(first.body.metrics.external);
    assert.deepEqual(first.body.metrics.sources, { local: 0, worker: 0 });

    await get(port, '/api/does-not-exist');

    const alias = await get(port, '/api/health');
    assert.equal(alias.status, 200);
    assert.deepEqual(alias.body, { ok: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
