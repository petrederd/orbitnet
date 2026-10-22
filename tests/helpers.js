'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

function scriptsFrom(file) {
  const html = fs.readFileSync(file, 'utf8');
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/type\s*=\s*["']?application\/ld\+json/i.test(match[1]))
    .map(match => match[2])
    .join('\n');
}

function createElement(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    checked: false,
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.children.push(child); this.innerHTML += child.textContent || child.innerHTML || ''; return child; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); return child; },
    addEventListener() {},
    focus() {},
    blur() {},
    select() {},
  };
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
        options: [],
        selectedIndex: -1,
        children: [],
        add(option) {
          this.options.push(option);
          if (this.selectedIndex === -1) {
            this.selectedIndex = 0;
            this.value = option.value;
          }
        },
        appendChild(child) { this.children.push(child); this.innerHTML += child.textContent || child.innerHTML || ''; return child; },
        removeChild(child) { this.children = this.children.filter(item => item !== child); return child; },
        addEventListener() {},
        focus() {},
        blur() {},
        select() {},
      });
    }
    return elements.get(id);
  }

  function Option(text, value) {
    this.text = text;
    this.value = value === undefined ? text : value;
    this.label = text;
  }

  return {
    elements,
    get,
    Option,
    document: {
      body: createElement('body'),
      getElementById: get,
      createElement,
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
  };
}

function loadTool(file, values = {}, globals = {}) {
  const dom = createDom(values);
  function unrefInterval(fn, ms) {
    const timer = setInterval(fn, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  const sandbox = {
    document: dom.document,
    crypto: webcrypto,
    performance,
    console,
    setTimeout,
    clearTimeout,
    setInterval: unrefInterval,
    clearInterval,
    btoa,
    atob,
    TextEncoder,
    TextDecoder,
    URL,
    Blob,
    Option: dom.Option,
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
