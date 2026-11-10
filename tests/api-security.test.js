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
