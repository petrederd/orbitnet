'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SITE, loadTool } = require('./helpers');

const FILE = path.join(SITE, 'tools/math/prime-checker.html');

function load() {
  return loadTool(FILE, {
    value: '97',
    errorMsg: '',
    results: '',
    year: '',
  });
}

test('small and edge-case numbers', () => {
  const { context } = load();

  assert.equal(context.isPrime(0n), false);
  assert.equal(context.isPrime(1n), false);
  assert.equal(context.isPrime(2n), true);
  assert.equal(context.isPrime(97n), true);
  assert.equal(context.isPrime(561n), false);
});

test('a large prime is reported as prime', () => {
  const { context } = load();
  const largePrime = 2n ** 127n - 1n;

  assert.equal(context.isPrime(largePrime), true);
});

test('a large composite is reported as composite', () => {
  const { context } = load();
  const largeComposite = (2n ** 127n - 1n) * (2n ** 61n - 1n);

  assert.equal(context.isPrime(largeComposite), false);
});

test('factorisation handles a Carmichael number and a semiprime', () => {
  const { context } = load();

  const carmichael = context.factorize(561n);
  assert.equal(carmichael.capped, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(carmichael.factors.map(f => [f.p.toString(), f.count]))),
    [['3', 1], ['11', 1], ['17', 1]]
  );

  const semiprime = context.factorize(1000003n * 1000033n);
  assert.equal(semiprime.capped, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(semiprime.factors.map(f => [f.p.toString(), f.count]))),
    [['1000003', 1], ['1000033', 1]]
  );
});

test('the UI renders 97 with neighbouring primes', () => {
  const { context, get } = load();

  context.run();
  const html = get('results').innerHTML;

  assert.match(html, /Is 97 prime\?/);
  assert.match(html, /Previous prime<\/div><div class="result-value">89</);
  assert.match(html, /Next prime<\/div><div class="result-value">101</);
  assert.equal(get('errorMsg').innerHTML, '');
});
