'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SITE, loadTool } = require('./helpers');

const TIMESTAMP_FILE = path.join(SITE, 'tools/developer/timestamp-converter.html');
const COLOR_FILE = path.join(SITE, 'tools/developer/color-converter.html');
const SCIENTIFIC_FILE = path.join(SITE, 'tools/math/scientific-notation.html');
const STATISTICS_FILE = path.join(SITE, 'tools/math/statistics-calculator.html');
const UNIT_FILE = path.join(SITE, 'tools/math/unit-converter.html');
const BASE64_FILE = path.join(SITE, 'tools/developer/base64.html');

test('timestamp auto mode distinguishes seconds from milliseconds', () => {
  const { context, get } = loadTool(TIMESTAMP_FILE, {
    year: '',
    inputType: 'auto',
    value: '1700000000',
    errorMsg: '',
    results: '',
    live: '',
  });

  context.convert();
  assert.match(get('results').innerHTML, /2023-11-14T22:13:20\.000Z/);

  get('value').value = '1700000000000';
  context.convert();
  assert.match(get('results').innerHTML, /2023-11-14T22:13:20\.000Z/);

  assert.equal(context.parseInput('-1000000000', 'auto').getTime(), -1000000000);
});

test('timestamp conversion explains date-only and local date-time handling', () => {
  const { context, get } = loadTool(TIMESTAMP_FILE, {
    year: '',
    inputType: 'date',
    value: '2023-11-14',
    errorMsg: '',
    results: '',
    live: '',
  });

  context.convert();
  assert.match(get('results').innerHTML, /interpreted as UTC midnight/);

  get('value').value = '2023-11-14T22:13';
  context.convert();
  assert.match(get('results').innerHTML, /interpreted in your local time zone/);
});

test('relative time rounding promotes 60 minutes to one hour', () => {
  const { context } = loadTool(TIMESTAMP_FILE, {
    year: '', inputType: 's', value: '', errorMsg: '', results: '', live: '',
  });
  assert.equal(context.relative(new Date(Date.now() + 59.8 * 60000)), 'in 1 hour');
});

test('color parser accepts modern syntax and rejects trailing garbage', () => {
  const { context } = loadTool(COLOR_FILE, {
    year: '', value: '', errorMsg: '', results: '', swatch: '', picker: '',
  });

  assert.deepEqual(Array.from(context.parseColor('rgb(255 0 0 / 50%)')), [255, 0, 0]);
  assert.deepEqual(Array.from(context.parseColor('rgba(255,0,0,0.5)')), [255, 0, 0]);
  assert.deepEqual(Array.from(context.parseColor('#ff000080')), [255, 0, 0]);
  assert.deepEqual(Array.from(context.parseColor('rgb(300, -10, 50%)')), [255, 0, 127.5]);
  assert.equal(context.parseColor('rgb(255,0,0)junk'), null);

  const hsl = Array.from(context.parseColor('hsl(400, 150%, 50%)'));
  assert.equal(hsl.length, 3);
  hsl.forEach(channel => assert.ok(channel >= 0 && channel <= 255));
});

test('color UI clears stale output when input is invalid', () => {
  const { context, get } = loadTool(COLOR_FILE, {
    year: '', value: 'not-a-color', errorMsg: '', results: '', swatch: '', picker: '',
  });

  context.fromText();
  assert.match(get('errorMsg').innerHTML, /Unrecognised color format/);
  assert.match(get('results').innerHTML, /Enter a valid color/);

  get('value').value = '#abc';
  context.fromText();
  assert.match(get('results').innerHTML, /#aabbcc/);
});

test('scientific notation handles decimal commas and thousands groups', () => {
  const { context, get } = loadTool(SCIENTIFIC_FILE, {
    year: '', value: '', errorMsg: '', results: '',
  });

  assert.equal(context.parseInput('1,5').n, 1.5);
  assert.equal(context.parseInput('1,234').n, 1234);
  assert.equal(context.parseInput('6.02 × 10^23').n, 6.02e23);
  assert.equal(context.parseInput('1,2,3'), null);
  assert.equal(context.parseInput('9007199254740993').warning, true);
  assert.equal(context.parseInput('123').warning, false);

  get('value').value = '1,5';
  context.convert();
  assert.match(get('results').innerHTML, /1\.5 × 10\^0/);
});

test('statistics rejects hex literals and formats tiny values without collapsing', () => {
  const { context, get } = loadTool(STATISTICS_FILE, {
    year: '', data: '', errorMsg: '', results: '',
  });

  assert.equal(context.num('0x10'), null);
  assert.equal(context.num('0b11'), null);
  assert.equal(context.num('1e3'), 1000);
  assert.equal(context.fmt(1e-10), '1e-10');
  assert.match(context.fmt(1e21), /e\+21/);
  assert.deepEqual(Array.from(context.parseTokens('1,5')), ['1.5']);
  assert.deepEqual(Array.from(context.parseTokens('1,2,3')), ['1', '2', '3']);

  get('data').value = '0x10 5';
  context.calculate();
  assert.match(get('errorMsg').innerHTML, /Ignored non-numeric/);
  assert.match(get('results').innerHTML, /Count<\/div><div class="result-value">1/);
});

test('unit converter rejects temperatures below absolute zero', () => {
  const { context, get } = loadTool(UNIT_FILE, {
    year: '',
    inputValue: '100',
    fromUnit: 'Celsius (°C)',
    toUnit: 'Fahrenheit (°F)',
    errorMsg: '',
    results: '',
  });

  context.setCategory('temperature', null);
  get('fromUnit').value = 'Celsius (°C)';
  get('toUnit').value = 'Fahrenheit (°F)';
  get('inputValue').value = '100';
  context.convert();
  assert.match(get('results').innerHTML, /212/);
  assert.match(get('results').innerHTML, /→/);

  get('fromUnit').value = 'Celsius (°C)';
  get('toUnit').value = 'Kelvin (K)';
  get('inputValue').value = '-300';
  context.convert();
  assert.match(get('errorMsg').innerHTML, /below absolute zero/);
});

test('base64 round-trips multibyte text', () => {
  const text = 'héllo 🌍';
  const { context, get } = loadTool(BASE64_FILE, {
    year: '',
    plainText: text,
    base64Text: '',
    plainStatus: '',
    base64Status: '',
    plainStats: '',
    base64Stats: '',
  });

  context.encode();
  const expected = Buffer.from(text, 'utf8').toString('base64');
  assert.equal(get('base64Text').value, expected);
  assert.match(get('plainStatus').innerHTML, /Text encoded successfully/);

  get('plainText').value = '';
  context.decode();
  assert.equal(get('plainText').value, text);
  assert.match(get('base64Status').innerHTML, /Base64 decoded successfully/);
});

test('regex worker reports matches and truncates at the limit', () => {
  const source = fs.readFileSync(path.join(SITE, 'assets/js/regex-worker.js'), 'utf8');

  const messages = [];
  const sandbox = { self: { postMessage(message) { messages.push(message); } } };
  sandbox.self.onmessage = null;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'regex-worker.js' });

  sandbox.self.onmessage({ data: { pattern: 'a+', flags: 'g', text: 'aa b aaa', maxMatches: 100 } });
  assert.equal(messages.at(-1).ok, true);
  assert.deepEqual(Array.from(messages.at(-1).matches, m => m.value), ['aa', 'aaa']);
  assert.equal(messages.at(-1).truncated, false);

  sandbox.self.onmessage({ data: { pattern: 'a', flags: 'g', text: 'aaaa', maxMatches: 2 } });
  assert.equal(messages.at(-1).matches.length, 2);
  assert.equal(messages.at(-1).truncated, true);

  sandbox.self.onmessage({ data: { pattern: '(', flags: 'g', text: 'x', maxMatches: 10 } });
  assert.equal(messages.at(-1).ok, false);
  assert.match(messages.at(-1).error, /Unterminated group|Invalid regular expression/);
});
