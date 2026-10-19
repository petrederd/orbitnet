'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

function scriptsFrom(file) {
  const html = fs.readFileSync(file, 'utf8');
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .join('\n');
}

function createDom(values = {}) {
  const elements = new Map();

  function get(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: values[id] ?? '',
        textContent: '',
        innerHTML: '',
        className: '',
        checked: Boolean(values[id]),
        style: {},
        addEventListener() {},
        focus() {},
        blur() {},
      });
    }
    return elements.get(id);
  }

  return {
    elements,
    get,
    document: {
      getElementById: get,
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
  };
}

function loadTool(file, values = {}, globals = {}) {
  const dom = createDom(values);
  const sandbox = {
    document: dom.document,
    crypto: webcrypto,
    performance,
    console,
    setTimeout,
    clearTimeout,
    ...globals,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(scriptsFrom(file), context, { filename: file });
  return { context, ...dom };
}

function run(context, code) {
  return vm.runInContext(code, context);
}

module.exports = { ROOT, SITE, loadTool, run };
