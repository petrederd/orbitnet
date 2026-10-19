'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SITE, loadTool, run } = require('./helpers');

const FILE = path.join(SITE, 'tools/networks/subnet-calculator.html');

function load() {
  return loadTool(FILE, {
    ipAddress: '192.168.1.100',
    cidr: '24',
    subnetMask: '255.255.255.0',
    subnetType: 'cidr',
    year: '',
  });
}

function field(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    '<div class="result-label">' + escaped + '</div><div class="result-value[^"]*">([^<]*)</div>'
  ).exec(html);
  return match ? match[1] : null;
}

function digits(value) {
  return String(value).replace(/\D/g, '');
}

function calculate(dom, { ip = '192.168.1.100', type = 'cidr', cidr = '24', mask = '255.255.255.0' }) {
  dom.get('ipAddress').value = ip;
  dom.get('subnetType').value = type;
  dom.get('cidr').value = cidr;
  dom.get('subnetMask').value = mask;
  run(dom.context, 'calculate()');
  return dom.get('results').innerHTML;
}

test('CIDR prefix converts to the expected subnet mask', () => {
  const { context } = load();
  assert.equal(run(context, 'cidrToMask(0)'), '0.0.0.0');
  assert.equal(run(context, 'cidrToMask(24)'), '255.255.255.0');
  assert.equal(run(context, 'cidrToMask(31)'), '255.255.255.254');
  assert.equal(run(context, 'cidrToMask(32)'), '255.255.255.255');
  assert.equal(run(context, 'maskToCidr("255.255.255.0")'), 24);
});

test('subnet mask input 255.255.255.0 is valid', () => {
  const { context } = load();
  assert.equal(run(context, 'validateMask("255.255.255.0")'), true);
  assert.equal(run(context, 'validateMask("255.255.0.0")'), true);
  assert.equal(run(context, 'validateMask("255.0.255.0")'), false);
  assert.equal(run(context, 'validateIP("192.168.1.100")'), true);
});

test('/0, /24, /31 and /32 produce correct network details', () => {
  const cases = [
    {
      name: '/0',
      cidr: '0',
      network: '0.0.0.0/0',
      broadcast: '255.255.255.255',
      first: '0.0.0.1',
      last: '255.255.255.254',
      usable: '4294967294',
    },
    {
      name: '/24',
      cidr: '24',
      network: '192.168.1.0/24',
      broadcast: '192.168.1.255',
      first: '192.168.1.1',
      last: '192.168.1.254',
      usable: '254',
    },
    {
      name: '/31',
      cidr: '31',
      network: '192.168.1.100/31',
      broadcast: '192.168.1.101',
      first: '192.168.1.100',
      last: '192.168.1.101',
      usable: '2',
    },
    {
      name: '/32',
      cidr: '32',
      network: '192.168.1.100/32',
      broadcast: '192.168.1.100',
      first: '192.168.1.100',
      last: '192.168.1.100',
      usable: '1',
    },
  ];

  for (const item of cases) {
    const dom = load();
    const html = calculate(dom, { cidr: item.cidr });
    assert.equal(field(html, 'Network Address'), item.network, item.name + ' network');
    assert.equal(field(html, 'Broadcast Address'), item.broadcast, item.name + ' broadcast');
    assert.equal(field(html, 'First Usable Host'), item.first, item.name + ' first host');
    assert.equal(field(html, 'Last Usable Host'), item.last, item.name + ' last host');
    assert.equal(digits(field(html, 'Usable Hosts')), item.usable, item.name + ' usable hosts');
    assert.equal(dom.get('errorMsg').innerHTML, '', item.name + ' error message');
  }
});

test('mask mode 255.255.255.0 behaves like /24', () => {
  const dom = load();
  const html = calculate(dom, { type: 'mask', mask: '255.255.255.0' });
  assert.equal(field(html, 'Network Address'), '192.168.1.0/24');
  assert.equal(field(html, 'Subnet Mask'), '255.255.255.0');
  assert.equal(field(html, 'Broadcast Address'), '192.168.1.255');
  assert.equal(dom.get('errorMsg').innerHTML, '');
});
