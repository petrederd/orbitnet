'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join('..', 'backend', 'server.js'));

const {
  parseSubjectAltName, classifyCipher, summarizeTlsVersions, normalizeCaaRecord,
  TLS_VERSION_PROBES, TLS_CIPHER_PROBES, domainSuffixes
} = api;

test('parseSubjectAltName splits OpenSSL name lists by type', () => {
  const names = parseSubjectAltName('DNS:example.com, DNS:*.example.com, IP Address:1.2.3.4');
  assert.deepEqual(names, [
    { type: 'DNS', value: 'example.com' },
    { type: 'DNS', value: '*.example.com' },
    { type: 'IP ADDRESS', value: '1.2.3.4' }
  ]);
  assert.deepEqual(parseSubjectAltName(''), []);
});

test('parseSubjectAltName keeps colons inside a value', () => {
  const names = parseSubjectAltName('URI:https://example.com/a, DNS:example.com');
  assert.deepEqual(names, [
    { type: 'URI', value: 'https://example.com/a' },
    { type: 'DNS', value: 'example.com' }
  ]);
});

test('classifyCipher rates AEAD as strong and legacy primitives as weak', () => {
  assert.equal(classifyCipher('TLS_AES_256_GCM_SHA384').strength, 'strong');
  assert.equal(classifyCipher('ECDHE-RSA-CHACHA20-POLY1305').strength, 'strong');
  assert.equal(classifyCipher('RC4-SHA').strength, 'weak');
  assert.equal(classifyCipher('DES-CBC3-SHA').strength, 'weak');
  assert.equal(classifyCipher('ECDHE-RSA-DES-CBC-SHA').strength, 'weak');
  assert.equal(classifyCipher('ECDHE-RSA-AES128-GCM-SHA256').strength, 'strong');
  assert.equal(classifyCipher('').strength, 'legacy');
});

test('classifyCipher flags the reasons a suite is weak', () => {
  assert.ok(classifyCipher('RC4-SHA').notes.some(n => /RC4/.test(n)));
  assert.ok(classifyCipher('DES-CBC3-SHA').notes.some(n => /3DES/.test(n)));
  assert.deepEqual(classifyCipher('TLS_AES_128_GCM_SHA256').notes, []);
});

test('summarizeTlsVersions separates supported, unknown and weak versions', () => {
  const summary = summarizeTlsVersions([
    { version: 'TLSv1.3', supported: true },
    { version: 'TLSv1.2', supported: true },
    { version: 'TLSv1.1', supported: null },
    { version: 'TLSv1', supported: true }
  ]);
  assert.deepEqual(summary.supported, ['TLSv1.3', 'TLSv1.2', 'TLSv1']);
  assert.deepEqual(summary.unknown, ['TLSv1.1']);
  assert.deepEqual(summary.weak, ['TLSv1']);
  assert.ok(summary.issues.some(i => /TLSv1/.test(i)));
});

test('summarizeTlsVersions notes a missing TLS 1.3', () => {
  const summary = summarizeTlsVersions([{ version: 'TLSv1.2', supported: true }]);
  assert.ok(summary.issues.some(i => /TLS 1.3/.test(i)));
  assert.deepEqual(summary.weak, []);
});

test('normalizeCaaRecord handles both Node record shapes', () => {
  assert.deepEqual(normalizeCaaRecord({ critical: 0, type: 'CAA', issue: 'pki.goog' }),
    { flag: 0, tag: 'issue', value: 'pki.goog' });
  assert.deepEqual(normalizeCaaRecord({ critical: 128, issuewild: 'ca.example' }),
    { flag: 128, tag: 'issuewild', value: 'ca.example' });
  assert.deepEqual(normalizeCaaRecord({ flag: 0, tag: 'iodef', value: 'mailto:x@y.z' }),
    { flag: 0, tag: 'iodef', value: 'mailto:x@y.z' });
  assert.deepEqual(normalizeCaaRecord(null), { flag: 0, tag: '', value: '' });
});

test('probe tables cover the expected versions and a weak cipher slate', () => {
  assert.ok(TLS_VERSION_PROBES.includes('TLSv1.3'));
  assert.ok(TLS_VERSION_PROBES.includes('TLSv1'));
  assert.ok(TLS_CIPHER_PROBES.some(c => c.weak && /RC4/.test(c.name)));
  assert.ok(TLS_CIPHER_PROBES.some(c => !c.weak && /GCM/.test(c.name)));
});

test('probe classification matches classifyCipher for CBC suites', () => {
  const cbc = TLS_CIPHER_PROBES.find(c => c.name === 'ECDHE-RSA-AES128-SHA');
  assert.equal(classifyCipher(cbc.name).strength, 'legacy');
  assert.equal(cbc.strength, 'legacy');
  assert.equal(cbc.weak, false);
});

test('CAA lookup stops at the registrable domain', () => {
  assert.deepEqual(domainSuffixes('example.co.uk'), ['example.co.uk']);
  assert.deepEqual(domainSuffixes('www.example.co.uk'), ['www.example.co.uk', 'example.co.uk']);
});
