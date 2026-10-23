'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join('..', 'backend', 'server.js'));

const {
  parseMaxAge, parseCookies, parseSecurityTxt, findMixedContent,
  gradeFromChecks, buildSecurityReport
} = api;

const GOOD_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=()',
  'cross-origin-opener-policy': 'same-origin'
};

function goodReport(overrides = {}) {
  return buildSecurityReport(Object.assign({
    host: 'example.com',
    ip: '93.184.216.34',
    protocol: 'https',
    status: 200,
    finalUrl: 'https://example.com/',
    headers: GOOD_HEADERS,
    body: '<html></html>',
    cookies: [],
    securityTxt: { found: true, url: 'https://example.com/.well-known/security.txt', contacts: ['mailto:sec@example.com'], expires: '2099-01-01T00:00:00Z', expired: false },
    mixedContent: { checked: true, count: 0, items: [] },
    bodyChecked: true,
    source: 'local'
  }, overrides));
}

test('parseMaxAge reads HSTS max-age', () => {
  assert.equal(parseMaxAge('max-age=31536000; includeSubDomains'), 31536000);
  assert.equal(parseMaxAge('includeSubDomains'), null);
  assert.equal(parseMaxAge(''), null);
});

test('parseCookies reads names and flags', () => {
  const headers = {
    'set-cookie': [
      'sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/'
    ]
  };
  const cookies = parseCookies(headers);
  assert.equal(cookies.length, 2);
  assert.deepEqual(cookies[0], { name: 'sid', secure: true, httpOnly: true, sameSite: 'lax' });
  assert.deepEqual(cookies[1], { name: 'theme', secure: false, httpOnly: false, sameSite: '' });
});

test('parseSecurityTxt reads fields and detects an expired file', () => {
  const current = parseSecurityTxt('Contact: mailto:sec@example.com\nExpires: 2099-12-31T00:00:00Z\n# comment');
  assert.deepEqual(current.contacts, ['mailto:sec@example.com']);
  assert.equal(current.expired, false);

  const expired = parseSecurityTxt('Contact: mailto:sec@example.com\nExpires: 2000-01-01T00:00:00Z');
  assert.equal(expired.expired, true);
});

test('findMixedContent ignores namespaces and only runs over HTTPS', () => {
  const html = '<script src="http://cdn.example.com/a.js"></script>' +
    '<link href="http://www.w3.org/2000/svg">' +
    '<img src="https://ok.example.com/b.png">';
  const result = findMixedContent(html, 'https');
  assert.equal(result.checked, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.items, ['http://cdn.example.com/a.js']);

  assert.deepEqual(findMixedContent(html, 'http'), { checked: false, count: 0, items: [] });
});

test('findMixedContent only counts resource-loading elements, not navigation links', () => {
  const html = '<a href="http://example.com/page">plain link</a>' +
    '<link rel="stylesheet" href="http://cdn.example.com/site.css">' +
    '<link rel="preload" href="http://cdn.example.com/font.woff2" as="font">' +
    '<link rel="alternate" href="http://example.com/feed.xml">' +
    '<img srcset="http://img.example.com/a.png 1x, https://img.example.com/b.png 2x">' +
    '<object data="http://cdn.example.com/movie.swf"></object>' +
    '<form action="http://forms.example.com/submit"></form>' +
    '<script src="https://cdn.example.com/app.js"></script>';
  const result = findMixedContent(html, 'https');
  assert.equal(result.count, 5);
  assert.ok(result.items.includes('http://cdn.example.com/site.css'));
  assert.ok(result.items.includes('http://cdn.example.com/font.woff2'));
  assert.ok(result.items.includes('http://img.example.com/a.png'));
  assert.ok(result.items.includes('http://cdn.example.com/movie.swf'));
  assert.ok(result.items.includes('http://forms.example.com/submit'));
  assert.ok(!result.items.includes('http://example.com/page'));
  assert.ok(!result.items.includes('http://example.com/feed.xml'));
});

test('HSTS max-age=0 is a failure, matching the headers checker', () => {
  const report = goodReport({
    headers: Object.assign({}, GOOD_HEADERS, { 'strict-transport-security': 'max-age=0' })
  });
  const hsts = report.checks.find(item => item.id === 'hsts');
  assert.equal(hsts.status, 'fail');
  assert.equal(hsts.score, 0);
});

test('unsafe-inline with a nonce or strict-dynamic is not penalised', () => {
  const report = goodReport({
    headers: Object.assign({}, GOOD_HEADERS, {
      'content-security-policy': "default-src 'self'; script-src 'nonce-abc123' 'unsafe-inline' 'strict-dynamic'"
    })
  });
  const csp = report.checks.find(item => item.id === 'csp');
  assert.equal(csp.status, 'pass');
});

test('frame-ancestors * is not clickjacking protection', () => {
  const report = goodReport({
    headers: Object.assign({}, GOOD_HEADERS, {
      'content-security-policy': "default-src 'self'; frame-ancestors *"
    })
  });
  const frame = report.checks.find(item => item.id === 'frame');
  assert.equal(frame.status, 'fail');
  assert.match(frame.detail, /does not restrict/);
});

test('gradeFromChecks maps scores to A-F and skips unknown rows', () => {
  assert.equal(gradeFromChecks([{ status: 'pass', weight: 10, score: 1 }]).grade, 'A');
  assert.equal(gradeFromChecks([{ status: 'warn', weight: 10, score: 0.8 }]).grade, 'B');
  assert.equal(gradeFromChecks([{ status: 'warn', weight: 10, score: 0.7 }]).grade, 'C');
  assert.equal(gradeFromChecks([{ status: 'warn', weight: 10, score: 0.6 }]).grade, 'D');
  assert.equal(gradeFromChecks([{ status: 'warn', weight: 10, score: 0.5 }]).grade, 'E');
  assert.equal(gradeFromChecks([{ status: 'fail', weight: 10, score: 0 }]).grade, 'F');
  assert.equal(gradeFromChecks([
    { status: 'pass', weight: 10, score: 1 },
    { status: 'unknown', weight: 90, score: 0 }
  ]).score, 100);
});

test('a well-configured site grades A', () => {
  const report = goodReport();
  assert.equal(report.grade, 'A');
  assert.equal(report.score, 100);
  assert.ok(report.checks.every(item => item.status !== 'unknown'));
});

test('an insecure site grades F', () => {
  const report = goodReport({
    protocol: 'http',
    headers: {},
    cookies: [{ name: 'sid', secure: false, httpOnly: false, sameSite: '' }],
    securityTxt: { found: false },
    mixedContent: { checked: false, count: 0, items: [] }
  });
  assert.equal(report.grade, 'F');
  const https = report.checks.find(item => item.id === 'https');
  assert.equal(https.status, 'fail');
});

test('HSTS without includeSubDomains is only a warning', () => {
  const report = goodReport({
    headers: Object.assign({}, GOOD_HEADERS, { 'strict-transport-security': 'max-age=31536000' })
  });
  const hsts = report.checks.find(item => item.id === 'hsts');
  assert.equal(hsts.status, 'warn');
  const preload = report.checks.find(item => item.id === 'hsts-preload');
  assert.equal(preload.status, 'warn');
});

test('a worker fallback report leaves body checks unknown', () => {
  const report = goodReport({
    source: 'worker',
    bodyChecked: false,
    cookies: null,
    securityTxt: null,
    mixedContent: { checked: false, count: 0, items: [] }
  });
  for (const id of ['security-txt', 'cookies', 'mixed']) {
    assert.equal(report.checks.find(item => item.id === id).status, 'unknown');
  }
  assert.equal(report.grade, 'A');
});
