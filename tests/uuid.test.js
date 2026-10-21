'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { SITE, loadTool } = require('./helpers');

const FILE = path.join(SITE, 'tools/developer/uuid-generator.html');

test('bulk generation updates the total without overwriting the count input', () => {
  const { context, get } = loadTool(FILE, {
    year: '',
    singleUUID: '-',
    singleStatus: '',
    bulkCount: '3',
    bulkTotal: '0',
    uuidList: '',
    bulkList: '',
    bulkStatus: '',
    format: 'default',
  });

  context.generateBulk();
  assert.equal(get('bulkCount').value, '3');
  assert.equal(get('bulkTotal').textContent, 3);
  assert.equal((get('uuidList').innerHTML.match(/uuid-item/g) || []).length, 3);
});

test('the fallback UUID generator uses secure random bytes', () => {
  const fallbackCrypto = {
    getRandomValues(array) {
      return webcrypto.getRandomValues(array);
    },
  };
  const { context } = loadTool(FILE, {
    year: '',
    singleUUID: '-',
    singleStatus: '',
  }, { crypto: fallbackCrypto });

  const uuid = context.generateUUID();

  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(!fs.readFileSync(FILE, 'utf8').includes('Math.random'));
});
