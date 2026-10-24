'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');
const http2 = require('node:http2');

const api = require(path.join(__dirname, '..', 'backend', 'server.js'));

const {
  parseSubjectAltName, classifyCipher, summarizeTlsVersions, normalizeCaaRecord,
  TLS_VERSION_PROBES, TLS_CIPHER_PROBES, domainSuffixes,
  validityLimitFor, certificateValidityInfo, evaluatePublicKey, hasEmbeddedSct,
  parseInfoAccess, parseAltSvc, analyzeCertificateChain, incompleteChainReason,
  checkCertificateHostname, inspectCertificate, buildTlsReport,
  readAltSvcOnSocket, SCT_OID_DER, TLS_GRADE_RULES
} = api;

const FIXTURES = path.join(__dirname, 'fixtures');
function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name));
}
const ROOT_CA = fixture('test-only-root-ca.crt.pem');
const VALID_KEY = fixture('test-only-valid.key.pem');
const VALID_CHAIN = fixture('test-only-chain.crt.pem');
const CHAIN_WITH_ROOT = fixture('test-only-chain-with-root.crt.pem');

function certFile(name) {
  return fixture('test-only-' + name + '.crt.pem');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function probe(port, options) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(Object.assign({
      host: '127.0.0.1',
      port,
      ca: ROOT_CA,
      rejectUnauthorized: true,
      ALPNProtocols: ['h2', 'http/1.1']
    }, options), () => {
      const cert = socket.getPeerCertificate(true);
      resolve({
        socket,
        cert,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError,
        alpn: socket.alpnProtocol
      });
    });
    socket.once('error', reject);
  });
}

async function withTlsServer(options, fn) {
  const server = tls.createServer(options, socket => socket.end());
  const port = await listen(server);
  try {
    return await fn(port);
  } finally {
    await close(server);
  }
}

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


test('parseInfoAccess extracts OCSP and CA Issuers URLs', () => {
  const entries = parseInfoAccess('OCSP - URI:http://ocsp.example.test\nCA Issuers - URI:http://ca.example.test/ca.crt');
  assert.deepEqual(entries, [
    { method: 'OCSP', type: 'URI', value: 'http://ocsp.example.test' },
    { method: 'CA Issuers', type: 'URI', value: 'http://ca.example.test/ca.crt' }
  ]);
  assert.deepEqual(parseInfoAccess(''), []);
});

test('parseAltSvc detects HTTP/3 and ignores clear', () => {
  const alt = parseAltSvc('h3=":443"; ma=86400, h3-29=":443"; ma=86400');
  assert.equal(alt.checked, true);
  assert.equal(alt.http3, true);
  assert.equal(alt.services.length, 2);
  assert.deepEqual(alt.services[0], { protocol: 'h3', authority: ':443', ma: 86400, persist: false });
  assert.equal(parseAltSvc('clear').http3, false);
  assert.equal(parseAltSvc('').http3, false);
});

test('hasEmbeddedSct finds the DER-encoded SCT OID', () => {
  const raw = Buffer.concat([Buffer.from('3000', 'hex'), SCT_OID_DER, Buffer.from('0400', 'hex'), SCT_OID_DER]);
  assert.deepEqual(hasEmbeddedSct(raw), { present: true, count: 2 });
  assert.deepEqual(hasEmbeddedSct(Buffer.from('3000', 'hex')), { present: false, count: 0 });
  assert.equal(hasEmbeddedSct(Buffer.from('1.3.6.1.4.1.11129.2.4.2')).present, true);
  const valid = new crypto.X509Certificate(certFile('valid'));
  assert.equal(hasEmbeddedSct(valid.raw).present, false);
});

test('evaluatePublicKey rejects RSA below 2048 and old curves', () => {
  const weak = new crypto.X509Certificate(certFile('weak-key'));
  const weakInfo = evaluatePublicKey(weak.publicKey);
  assert.equal(weakInfo.type, 'rsa');
  assert.equal(weakInfo.bits, 1024);
  assert.equal(weakInfo.weak, true);

  const good = evaluatePublicKey(new crypto.X509Certificate(certFile('valid')).publicKey);
  assert.equal(good.bits, 2048);
  assert.equal(good.weak, false);

  const oldCurve = evaluatePublicKey({
    asymmetricKeyType: 'ec',
    asymmetricKeyDetails: { namedCurve: 'secp192r1' }
  });
  assert.equal(oldCurve.weak, true);
  assert.match(oldCurve.reason, /Deprecated elliptic curve/);
});

test('certificateValidityInfo applies the CA/B Forum schedule', () => {
  assert.equal(validityLimitFor('2025-01-01T00:00:00Z').maxDays, 398);
  assert.equal(validityLimitFor('2026-03-15T00:00:00Z').maxDays, 200);
  assert.equal(validityLimitFor('2027-03-15T00:00:00Z').maxDays, 100);
  assert.equal(validityLimitFor('2029-03-15T00:00:00Z').maxDays, 47);

  const now = Date.parse('2026-10-01T00:00:00Z');
  const warning = certificateValidityInfo({
    valid_from: '2026-09-01T00:00:00Z',
    valid_to: '2026-10-20T00:00:00Z'
  }, now);
  assert.equal(warning.expiryStatus, 'warning');
  assert.equal(warning.daysRemaining, 19);
  assert.equal(certificateValidityInfo({
    valid_from: '2026-09-01T00:00:00Z',
    valid_to: '2026-10-20T00:00:00Z'
  }, '2026-10-01T00:00:00Z').daysRemaining, 19);

  const error = certificateValidityInfo({
    valid_from: '2026-09-01T00:00:00Z',
    valid_to: '2026-10-10T00:00:00Z'
  }, now);
  assert.equal(error.expiryStatus, 'error');

  const expired = certificateValidityInfo(new crypto.X509Certificate(certFile('expired')), now);
  assert.equal(expired.expiryStatus, 'expired');

  const long = certificateValidityInfo(new crypto.X509Certificate(certFile('long-validity')));
  assert.equal(long.validityTooLong, true);
  assert.equal(long.exceeds398Days, true);
  assert.equal(long.maxValidityDays, 200);

  const longUntrusted = certificateValidityInfo(new crypto.X509Certificate(certFile('long-validity')), null, {
    trusted: false
  });
  assert.equal(longUntrusted.validityTooLong, false);
  assert.doesNotMatch(longUntrusted.message, /exceeds/);
});

test('analyzeCertificateChain flags incomplete, unordered and extra-root chains', () => {
  const incomplete = analyzeCertificateChain([
    { subject: { CN: 'leaf.example' }, issuer: { CN: 'Intermediate CA' } }
  ], 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
  assert.equal(incomplete.incomplete, true);
  assert.match(incomplete.incompleteReason, /intermediate certificate/);

  const unordered = analyzeCertificateChain([
    { subject: { CN: 'leaf.example' }, issuer: { CN: 'Intermediate CA' } },
    { subject: { CN: 'Other CA' }, issuer: { CN: 'Root CA' } }
  ], '');
  assert.equal(unordered.ordered, false);
  assert.equal(unordered.orderIssues.length, 1);

  const rootChain = [
    { subject: { CN: 'leaf.example' }, issuer: { CN: 'Intermediate CA' } },
    { subject: { CN: 'Intermediate CA' }, issuer: { CN: 'Root CA' } },
    { subject: { CN: 'Root CA' }, issuer: { CN: 'Root CA' }, selfSigned: true }
  ];
  const extraRoot = analyzeCertificateChain(rootChain, '', { rootTrusted: false });
  assert.equal(extraRoot.rootIncluded, true);
  assert.equal(extraRoot.extraRoot, true);
  assert.equal(extraRoot.ordered, true);
  assert.equal(analyzeCertificateChain(rootChain).extraRoot, true);

  const trustedRoot = analyzeCertificateChain(rootChain, '', { rootTrusted: true });
  assert.equal(trustedRoot.rootIncluded, true);
  assert.equal(trustedRoot.extraRoot, false);
});

test('incompleteChainReason accepts OpenSSL strings and error codes', () => {
  assert.match(incompleteChainReason('unable to get local issuer certificate'), /intermediate/);
  assert.match(incompleteChainReason('UNABLE_TO_GET_ISSUER_CERT_LOCALLY'), /intermediate/);
  assert.match(incompleteChainReason('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), /incomplete/);
  assert.equal(incompleteChainReason('CERT_HAS_EXPIRED'), '');
});

test('checkCertificateHostname lists SAN entries on a mismatch', () => {
  const cert = new crypto.X509Certificate(certFile('wrong-name')).toLegacyObject();
  const result = checkCertificateHostname('valid.example', cert);
  assert.equal(result.match, false);
  assert.deepEqual(result.san, ['wrong.example']);
  assert.match(result.message, /does not match valid\.example/);
  assert.match(result.message, /wrong\.example/);
});

test('buildTlsReport grades a good scan A and caps weak ciphers at C', () => {
  const base = {
    host: 'example.com',
    authorized: true,
    hostnameMatch: true,
    validity: {
      expiryStatus: 'ok', status: 'ok', validityDays: 90,
      maxValidityDays: 200, validityTooLong: false, message: ''
    },
    publicKey: { type: 'rsa', bits: 2048, weak: false },
    sct: { present: true, count: 2 },
    ocsp: { applicable: false, stapled: false },
    alpn: 'h2',
    altSvc: { checked: true, raw: 'h3=":443"', http3: true },
    chainAnalysis: { incomplete: false, extraRoot: false, ordered: true, orderIssues: [] },
    protocols: [{ version: 'TLSv1.3', supported: true }, { version: 'TLSv1.2', supported: true }],
    ciphers: [{ name: 'TLS_AES_256_GCM_SHA384', supported: true, weak: false, strength: 'strong' }]
  };
  const good = buildTlsReport(base);
  assert.equal(good.grade, 'A');
  assert.equal(good.score, 100);
  assert.ok(good.rules.length >= TLS_GRADE_RULES.length - 1);

  const weakCipher = buildTlsReport(Object.assign({}, base, {
    ciphers: [{ name: 'RC4-SHA', supported: true, weak: true, strength: 'weak' }]
  }));
  assert.equal(weakCipher.grade, 'C');

  const expired = buildTlsReport(Object.assign({}, base, {
    validity: { expiryStatus: 'expired', status: 'expired', validityDays: 90, maxValidityDays: 200, validityTooLong: false, message: '' }
  }));
  assert.equal(expired.grade, 'F');

  const mail = buildTlsReport(Object.assign({}, base, {
    port: 993,
    alpn: '',
    altSvc: { checked: false, raw: '', http3: false }
  }));
  assert.equal(mail.grade, 'A');
});

test('buildTlsReport keeps hygiene warnings out of the B ceiling', () => {
  const good = {
    host: 'example.com',
    authorized: true,
    hostnameMatch: true,
    validity: {
      expiryStatus: 'ok', status: 'ok', validityDays: 90,
      maxValidityDays: 200, validityTooLong: false, message: ''
    },
    publicKey: { type: 'rsa', bits: 2048, weak: false },
    sct: { present: true, count: 2 },
    ocsp: { applicable: false, stapled: false },
    alpn: 'h2',
    altSvc: { checked: true, raw: 'h3=":443"', http3: true },
    chainAnalysis: { incomplete: false, extraRoot: false, ordered: true, orderIssues: [] },
    protocols: [{ version: 'TLSv1.3', supported: true }, { version: 'TLSv1.2', supported: true }],
    ciphers: [{ name: 'TLS_AES_256_GCM_SHA384', supported: true, weak: false, strength: 'strong' }]
  };

  const hygiene = buildTlsReport(Object.assign({}, good, {
    sct: { present: false, count: 0 },
    ocsp: { applicable: true, stapled: false },
    alpn: 'http/1.1',
    altSvc: { checked: true, raw: '', services: [], http3: false }
  }));
  assert.equal(hygiene.grade, 'A');
  assert.equal(hygiene.cappedBy, '');
  assert.equal(hygiene.checks.find(c => c.id === 'sct').status, 'warn');
  assert.equal(hygiene.checks.find(c => c.id === 'http3').status, 'warn');

  const expiring = buildTlsReport(Object.assign({}, good, {
    validity: {
      expiryStatus: 'warning', status: 'warning', validityDays: 90,
      maxValidityDays: 200, validityTooLong: false, message: 'Certificate expires in 20 day(s)'
    }
  }));
  assert.equal(expiring.grade, 'A');
  assert.equal(expiring.cappedBy, '');

  const rootSent = buildTlsReport(Object.assign({}, good, {
    chainAnalysis: { incomplete: false, extraRoot: true, ordered: true, orderIssues: [] }
  }));
  assert.equal(rootSent.grade, 'A');
  assert.equal(rootSent.cappedBy, '');
  assert.equal(rootSent.checks.find(c => c.id === 'chain').status, 'info');

  const trustedLong = buildTlsReport(Object.assign({}, good, {
    validity: {
      expiryStatus: 'ok', status: 'ok', validityDays: 400,
      maxValidityDays: 200, validityTooLong: true, message: 'too long'
    }
  }));
  assert.equal(trustedLong.grade, 'B');
  assert.match(trustedLong.cappedBy, /validity/);

  const unordered = buildTlsReport(Object.assign({}, good, {
    chainAnalysis: {
      incomplete: false, extraRoot: false, ordered: false,
      orderIssues: ['Certificate 2 is not issued by certificate 3.']
    }
  }));
  assert.equal(unordered.grade, 'B');
  assert.match(unordered.cappedBy, /order/);
});

test('local TLS server: valid chain, ALPN and certificate key details', async () => {
  await withTlsServer({
    key: VALID_KEY,
    cert: VALID_CHAIN,
    ca: ROOT_CA,
    ALPNProtocols: ['h2', 'http/1.1']
  }, async port => {
    const result = await probe(port, { servername: 'valid.example' });
    const info = inspectCertificate('valid.example', result.cert, result.authorizationError);
    result.socket.destroy();

    assert.equal(result.authorized, true);
    assert.equal(result.alpn, 'h2');
    assert.equal(info.hostnameMatch, true);
    assert.equal(info.key.type, 'rsa');
    assert.equal(info.key.bits, 2048);
    assert.equal(info.validity.expiryStatus, 'ok');
    // Node appends the trusted root from its CA store even though the server
    // sent only leaf + intermediate.
    assert.equal(info.chain.length, 3);
    assert.equal(info.chainAnalysis.incomplete, false);
    assert.equal(info.chainAnalysis.ordered, true);
    assert.equal(info.chainAnalysis.rootIncluded, true);
    assert.equal(info.chainAnalysis.rootTrusted, true);
    assert.equal(info.chainAnalysis.extraRoot, false);
  });
});

test('local TLS server: wrong name and expired certificates are reported', async () => {
  await withTlsServer({
    key: fixture('test-only-wrong-name.key.pem'),
    cert: certFile('wrong-name'),
    ca: ROOT_CA
  }, async port => {
    const result = await probe(port, { servername: 'valid.example', rejectUnauthorized: false });
    const info = inspectCertificate('valid.example', result.cert, result.authorizationError);
    result.socket.destroy();
    assert.equal(info.hostnameMatch, false);
    assert.deepEqual(info.hostnameCheck.san, ['wrong.example']);
    assert.match(info.hostnameMessage, /does not match valid\.example/);
  });

  await withTlsServer({
    key: fixture('test-only-expired.key.pem'),
    cert: certFile('expired'),
    ca: ROOT_CA
  }, async port => {
    const result = await probe(port, { servername: 'expired.example', rejectUnauthorized: false });
    const info = inspectCertificate('expired.example', result.cert, result.authorizationError);
    result.socket.destroy();
    assert.equal(info.validity.expiryStatus, 'expired');
    assert.ok(info.validity.daysRemaining < 0);
  });
});

test('local TLS server: incomplete chain and an extra root are detected', async () => {
  await withTlsServer({
    key: fixture('test-only-incomplete.key.pem'),
    cert: certFile('incomplete'),
    ca: ROOT_CA
  }, async port => {
    const result = await probe(port, { servername: 'incomplete.example', rejectUnauthorized: false });
    const info = inspectCertificate('incomplete.example', result.cert, result.authorizationError);
    result.socket.destroy();
    assert.equal(info.chain.length, 1);
    assert.equal(info.chainAnalysis.incomplete, true);
    assert.match(info.chainAnalysis.incompleteReason, /incomplete/);
  });

  await withTlsServer({
    key: VALID_KEY,
    cert: CHAIN_WITH_ROOT
  }, async port => {
    const result = await probe(port, { servername: 'valid.example', rejectUnauthorized: false, ca: [] });
    const info = inspectCertificate('valid.example', result.cert, result.authorizationError);
    result.socket.destroy();
    assert.equal(result.authorized, false);
    assert.equal(info.chain.length, 3);
    assert.equal(info.chainAnalysis.rootIncluded, true);
    assert.equal(info.chainAnalysis.extraRoot, true);
  });
});

test('local TLS server: Alt-Svc is read over the same TLS socket', async () => {
  const server = tls.createServer({
    key: VALID_KEY,
    cert: VALID_CHAIN,
    ALPNProtocols: ['http/1.1']
  }, socket => {
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nAlt-Svc: h3=":443"; ma=86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.end();
    });
  });
  const port = await listen(server);
  try {
    const result = await probe(port, { servername: 'valid.example' });
    assert.equal(result.alpn, 'http/1.1');
    const header = await readAltSvcOnSocket(result.socket, 'valid.example', port, result.alpn, 2000);
    result.socket.destroy();
    assert.match(header, /h3=/);
    assert.equal(parseAltSvc(header).http3, true);
  } finally {
    await close(server);
  }
});

test('local HTTP/2 server: Alt-Svc is read from response headers', async () => {
  const server = http2.createSecureServer({
    key: VALID_KEY,
    cert: VALID_CHAIN
  }, (req, res) => {
    res.setHeader('alt-svc', 'h3=":443"');
    res.writeHead(200);
    res.end();
  });
  server.on('error', () => {});
  const port = await listen(server);
  try {
    const result = await probe(port, { servername: 'valid.example' });
    assert.equal(result.alpn, 'h2');
    const header = await readAltSvcOnSocket(result.socket, 'valid.example', port, result.alpn, 2000);
    result.socket.destroy();
    assert.match(header, /h3=/);
  } finally {
    await close(server);
  }
});

test('readAltSvcOnSocket stops at the header and ignores a large HEAD body', async () => {
  const server = tls.createServer({
    key: VALID_KEY,
    cert: VALID_CHAIN,
    ALPNProtocols: ['http/1.1']
  }, socket => {
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nAlt-Svc: h3=":443"\r\n\r\n' + 'x'.repeat(20000));
      socket.end();
    });
  });
  const port = await listen(server);
  try {
    const result = await probe(port, { servername: 'valid.example' });
    const header = await readAltSvcOnSocket(result.socket, 'valid.example', port, result.alpn, 2000);
    result.socket.destroy();
    assert.match(header, /h3=/);
  } finally {
    await close(server);
  }
});

test('readAltSvcOnSocket rejects an oversized HTTP header', async () => {
  const server = tls.createServer({
    key: VALID_KEY,
    cert: VALID_CHAIN,
    ALPNProtocols: ['http/1.1']
  }, socket => {
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nX-Fill: ' + 'a'.repeat(20000) +
        '\r\nAlt-Svc: h3=":443"\r\n\r\n');
      socket.end();
    });
  });
  const port = await listen(server);
  try {
    const result = await probe(port, { servername: 'valid.example' });
    const header = await readAltSvcOnSocket(result.socket, 'valid.example', port, result.alpn, 2000);
    result.socket.destroy();
    assert.equal(header, null);
  } finally {
    await close(server);
  }
});

test('TLS name resolution falls back to the Worker when local DNS is filtered', async (t) => {
  const http = require('node:http');

  const secret = 'tls-resolve-secret';
  const seen = [];
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
      const payload = JSON.parse(body);
      seen.push(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        type: 'dns',
        host: payload.host,
        recordType: payload.recordType,
        records: payload.recordType === 'A' ? ['93.184.216.34'] : [],
        resolver: 'Cloudflare 1.1.1.1',
        source: 'Cloudflare Worker'
      }));
    });
  });
  const port = await listen(server);

  const savedUrl = process.env.CHECKER_URL;
  const savedSecret = process.env.CHECKER_SECRET;
  const savedTimeout = process.env.CHECKER_TIMEOUT;
  process.env.CHECKER_URL = 'http://127.0.0.1:' + port + '/';
  process.env.CHECKER_SECRET = secret;
  process.env.CHECKER_TIMEOUT = '2000';

  t.after(async () => {
    await close(server);
    if (savedUrl === undefined) delete process.env.CHECKER_URL;
    else process.env.CHECKER_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.CHECKER_SECRET;
    else process.env.CHECKER_SECRET = savedSecret;
    if (savedTimeout === undefined) delete process.env.CHECKER_TIMEOUT;
    else process.env.CHECKER_TIMEOUT = savedTimeout;
  });

  const resolved = await api.resolvePublicWithWorker(
    'no-such-subdomain.orbitnet-tls-test.example.com',
    { clientIp: '198.51.100.77', deadline: Date.now() + 5000 }
  );

  assert.equal(resolved.source, 'worker');
  assert.deepEqual(resolved.ips, ['93.184.216.34']);
  assert.ok(seen.some(item => item.type === 'dns' && item.recordType === 'A'));
});
