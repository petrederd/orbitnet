'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { SITE, loadTool } = require('./helpers');

const FILE = path.join(SITE, 'tools/developer/password-generator.html');

function load() {
  return loadTool(FILE, {
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    length: '20',
    password: '',
    pwdMeta: '',
    entropy: '',
    crackTime: '',
    strengthLabel: '',
    checkInput: '',
    checkResult: '',
    year: '',
  });
}

test('a normal password gets a regular entropy score', () => {
  const { context } = load();
  const password = 'Summer2024!';
  const charset = 72;
  const result = context.evaluate(password, charset);

  assert.equal(result.bits, password.length * Math.log2(charset));
  assert.equal(result.label, 'Reasonable');
  assert.ok(result.bits >= 50 && result.bits < 70);
});

test('common passwords are capped and do not throw', () => {
  const { context, get } = load();

  for (const password of ['password', '123456', 'qwerty', 'letmein']) {
    const result = context.evaluate(password, 72);
    assert.ok(result.bits <= 10, password + ' entropy');
    assert.equal(result.label, 'Very weak', password + ' label');
    assert.match(get('strengthLabel').textContent, /common password or pattern/);
  }
});

test('a long random password is rated very strong', () => {
  const { context } = load();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
  const bytes = new Uint8Array(64);
  webcrypto.getRandomValues(bytes);
  const password = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  const result = context.evaluate(password, alphabet.length);

  assert.equal(password.length, 64);
  assert.equal(result.bits, password.length * Math.log2(alphabet.length));
  assert.ok(result.bits > 100);
  assert.equal(result.label, 'Very strong');
});

test('generated passwords use the selected length and character set', () => {
  const { context, get } = load();
  get('length').value = '64';

  context.generate();
  const password = get('password').textContent;

  assert.equal(password.length, 64);
  assert.match(password, /^[A-Za-z0-9!@#$%^&*()\-_=+\[\]{};:,.<>?/~]+$/);
  assert.ok(get('entropy').textContent.endsWith('bits'));
});
