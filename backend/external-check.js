'use strict';

// Client for the OrbitNet Cloudflare Worker.
//
// The worker has four check types:
//   http         - fetch a site and return status, headers and an optional
//                  redirect chain;
//   dns          - resolve one record through DNS-over-HTTPS;
//   propagation  - compare the same record across several DoH resolvers;
//   email        - MX/SPF/DMARC/DKIM/PTR for a domain.
//
// It is a fallback only: local checks run first and the worker is called when
// the local server cannot complete them (DNS filtering, RKN blocking, an
// unreachable route). Targets rejected by the local SSRF guard are never sent.
//
// Worker contract:
//   POST /  {"type":"http","host":"example.com","follow":false}
//   Authorization: Bearer <CHECKER_SECRET>
//   -> {ok:true,...} or {ok:false,error}
//
// The secret lives in the server-side .env (gitignored) and in a Cloudflare
// Worker secret. It is sent only to the worker over HTTPS and never returned.

const http = require('http');
const https = require('https');
const net = require('net');

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 512 * 1024;

const SECURITY_HEADERS = {
  strictTransportSecurity: 'strict-transport-security',
  contentSecurityPolicy: 'content-security-policy',
  xContentTypeOptions: 'x-content-type-options',
  xFrameOptions: 'x-frame-options',
  referrerPolicy: 'referrer-policy',
  permissionsPolicy: 'permissions-policy'
};

function getConfig() {
  const url = (process.env.CHECKER_URL || '').trim();
  const secret = (process.env.CHECKER_SECRET || '').trim();
  const rawTimeout = Number(process.env.CHECKER_TIMEOUT || '');
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(Math.max(Math.round(rawTimeout), 1000), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  return { url, secret, timeout };
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// The checker must be HTTPS in production. Plain HTTP is accepted only for a
// loopback address, which keeps local development and tests possible without
// weakening the deployed configuration.
function parseWorkerUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    return null;
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url;
  return null;
}

function isForbiddenName(host) {
  const forbidden = ['localhost', 'local', 'internal', 'home.arpa', 'test', 'invalid'];
  return forbidden.some(suffix => host === suffix || host.endsWith('.' + suffix));
}

// The worker accepts a public domain, not an arbitrary URL. Mirrors its basic
// checks so obvious junk is rejected before a subrequest is made.
function normalizeHost(raw) {
  if (typeof raw !== 'string') return '';
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return '';
  if (host.includes('/') || host.includes('@') || host.includes(':')) return '';
  if (!host.includes('.')) return '';
  const labels = host.split('.');
  if (labels.length < 2) return '';
  if (!labels.every(label =>
    label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return '';
  if (isForbiddenName(host)) return '';
  return host;
}

// DNS names may contain underscores (`_dmarc`, `selector._domainkey`), unlike
// HTTP hostnames.
function normalizeDnsName(raw) {
  if (typeof raw !== 'string') return '';
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return '';
  if (host.includes('/') || host.includes('@')) return '';
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return '';
  const labels = host.split('.');
  if (labels.length < 2) return '';
  if (!labels.every(label =>
    label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(label)
  )) return '';
  if (isForbiddenName(host)) return '';
  return host;
}

// HTTP checks may target a public IP literal as well as a domain. The worker
// performs the private-address check; the local SSRF guard already rejected
// blocked targets before we get here.
function normalizeTargetHost(raw) {
  if (typeof raw !== 'string') return '';
  const host = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (net.isIP(host)) return host;
  return normalizeHost(host);
}

function limitString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function validStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function resolveUrl(location, base) {
  if (typeof location !== 'string' || !location || location.length > 2048) return '';
  try {
    const url = new URL(location, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch (e) {
    return '';
  }
}

function headersFromPayload(raw) {
  const out = [];
  const seen = new Set();

  const push = (name, value) => {
    const key = limitString(name, 100).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: key, value: String(value == null ? '' : value).slice(0, 2048) });
  };

  if (raw.server) push('server', raw.server);
  if (raw.contentType) push('content-type', raw.contentType);
  if (Number.isFinite(raw.contentLength) && raw.contentLength >= 0) {
    push('content-length', raw.contentLength);
  }

  const flags = raw.securityHeaders;
  if (flags && typeof flags === 'object') {
    for (const [key, headerName] of Object.entries(SECURITY_HEADERS)) {
      if (flags[key] === 'present') push(headerName, 'present');
    }
  }

  return out;
}

function normalizeHeaders(raw) {
  if (Array.isArray(raw.headers)) {
    const out = [];
    const seen = new Set();
    for (const header of raw.headers) {
      if (!header || typeof header !== 'object') continue;
      const name = limitString(header.name, 100).toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, value: limitString(String(header.value == null ? '' : header.value), 2048) });
      if (out.length >= 100) break;
    }
    if (out.length) return out;
  }

  if (raw.headerMap && typeof raw.headerMap === 'object' && !Array.isArray(raw.headerMap)) {
    return Object.entries(raw.headerMap).slice(0, 100).map(([name, value]) => ({
      name: limitString(name, 100).toLowerCase(),
      value: limitString(String(value == null ? '' : value), 2048)
    })).filter(header => header.name);
  }

  return headersFromPayload(raw);
}

function normalizeRedirects(raw, fallbackUrl) {
  if (!Array.isArray(raw)) {
    return fallbackUrl ? [{
      url: fallbackUrl,
      status: null,
      location: '',
      error: '',
      blocked: false,
      ms: null
    }] : [];
  }

  return raw.slice(0, 20).map(entry => {
    if (!entry || typeof entry !== 'object') return null;
    const url = limitString(entry.url, 2048);
    if (!url) return null;
    const status = validStatus(entry.status);
    return {
      url,
      status,
      location: limitString(entry.location, 2048),
      error: limitString(entry.error, 300),
      blocked: entry.blocked === true,
      ms: Number.isFinite(entry.ms) && entry.ms >= 0 ? entry.ms : null
    };
  }).filter(Boolean);
}

function normalizeHttpResponse(raw, fallbackHost) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'External checker returned an invalid response' };
  }

  const status = validStatus(raw.status);
  const redirects = normalizeRedirects(raw.redirects, '');
  if (raw.ok === false || raw.reachable === false || raw.error || status == null) {
    return {
      error: limitString(raw.error, 300) || 'External check failed',
      redirects,
      timeout: /timed out/i.test(String(raw.error || ''))
    };
  }

  const host = normalizeTargetHost(raw.host) || normalizeTargetHost(fallbackHost) || '';
  const protocol = raw.protocol === 'http' ? 'http' : 'https';
  const authority = host.includes(':') ? '[' + host + ']' : host;
  const baseUrl = host ? protocol + '://' + authority + '/' : '';
  const redirect = limitString(raw.redirect, 2048);
  const finalUrl = limitString(raw.finalUrl, 2048) ||
    (redirect ? (resolveUrl(redirect, baseUrl) || baseUrl) : baseUrl);
  const responseMs = Number.isFinite(raw.responseMs) && raw.responseMs >= 0 ? raw.responseMs : null;

  return {
    ok: true,
    status,
    protocol,
    host,
    finalUrl,
    redirect,
    redirects: redirects.length ? redirects : [{
      url: finalUrl || baseUrl,
      status,
      location: redirect,
      error: '',
      blocked: false,
      ms: responseMs
    }],
    responseMs,
    server: limitString(raw.server, 200),
    contentType: limitString(raw.contentType, 200),
    contentLength: Number.isFinite(raw.contentLength) && raw.contentLength >= 0
      ? raw.contentLength
      : null,
    title: limitString(raw.title, 300).replace(/\s+/g, ' ').trim(),
    headers: normalizeHeaders(raw),
    source: 'worker'
  };
}

// Legacy normalizer for the first (single-purpose) worker contract. Kept for
// compatibility with older tests and callers; new code should use checkHttp.
function normalizeResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'External checker returned an invalid response' };
  }

  if (raw.reachable === false || raw.error || raw.status == null) {
    return { error: limitString(raw.error, 300) || 'External check failed' };
  }

  const status = validStatus(raw.status);
  if (status == null) return { error: 'External checker returned an invalid HTTP status' };

  const protocol = raw.protocol === 'http' ? 'http' : 'https';
  const host = normalizeHost(raw.host) || '';
  const baseUrl = host ? protocol + '://' + host + '/' : '';
  const redirect = limitString(raw.redirect, 2048);
  const finalUrl = redirect ? (resolveUrl(redirect, baseUrl) || baseUrl) : baseUrl;
  const responseMs = Number.isFinite(raw.responseMs) && raw.responseMs >= 0 ? raw.responseMs : null;

  return {
    ok: true,
    status,
    protocol,
    host,
    finalUrl,
    redirect,
    redirects: [{
      url: baseUrl,
      status,
      location: redirect,
      error: '',
      blocked: false,
      ms: responseMs
    }],
    responseMs,
    server: limitString(raw.server, 200),
    contentType: limitString(raw.contentType, 200),
    title: limitString(raw.title, 300).replace(/\s+/g, ' ').trim(),
    headers: headersFromPayload(raw),
    source: 'worker'
  };
}

function normalizeDnsResponse(raw, fallbackHost, fallbackType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'External checker returned an invalid response' };
  }
  if (raw.ok === false || raw.error) {
    return { error: limitString(raw.error, 300) || 'External DNS check failed' };
  }
  const records = raw.records;
  if (records !== null && !Array.isArray(records) &&
    !(records && typeof records === 'object')) {
    return { error: 'External checker returned invalid DNS records' };
  }
  return {
    host: normalizeDnsName(raw.host) || fallbackHost,
    type: limitString(raw.recordType, 10).toUpperCase() || fallbackType,
    records,
    resolver: limitString(raw.resolver, 100),
    source: 'worker'
  };
}

function normalizePropagationResponse(raw, fallbackHost, fallbackType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'External checker returned an invalid response' };
  }
  if (raw.ok === false || raw.error) {
    return { error: limitString(raw.error, 300) || 'External DNS check failed' };
  }
  if (!Array.isArray(raw.resolvers)) {
    return { error: 'External checker returned invalid resolver results' };
  }
  const resolvers = raw.resolvers.slice(0, 20).map(entry => {
    const server = limitString(entry && entry.server, 100) || 'resolver';
    if (!entry || typeof entry !== 'object') return { server, error: 'invalid result' };
    if (entry.error) return { server, error: limitString(entry.error, 300) };
    const records = Array.isArray(entry.records)
      ? entry.records.slice(0, 100).map(record => limitString(String(record), 2048))
      : [];
    return { server, records };
  });
  return {
    host: normalizeDnsName(raw.host) || fallbackHost,
    type: limitString(raw.recordType, 10).toUpperCase() || fallbackType,
    resolvers,
    source: 'worker'
  };
}

function normalizeEmailResponse(raw, fallbackHost) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'External checker returned an invalid response' };
  }
  if (raw.ok === false || raw.error) {
    return { error: limitString(raw.error, 300) || 'External email check failed' };
  }

  const mx = Array.isArray(raw.mx) ? raw.mx.slice(0, 50).map(record => ({
    priority: Number.isFinite(record && record.priority) ? record.priority : 0,
    host: limitString(record && record.host, 253)
  })).filter(record => record.host) : [];

  const errors = {};
  if (raw.errors && typeof raw.errors === 'object' && !Array.isArray(raw.errors)) {
    for (const key of ['mx', 'spf', 'dmarc', 'dkim']) {
      if (raw.errors[key]) errors[key] = limitString(String(raw.errors[key]), 300);
    }
  }

  let mxPtr;
  if (raw.mxPtr && typeof raw.mxPtr === 'object') {
    mxPtr = {
      ip: limitString(raw.mxPtr.ip, 100),
      hostnames: Array.isArray(raw.mxPtr.hostnames)
        ? raw.mxPtr.hostnames.slice(0, 50).map(name => limitString(String(name), 253))
        : []
    };
  }

  return {
    host: normalizeHost(raw.host) || fallbackHost,
    mx,
    spf: raw.spf == null ? null : limitString(String(raw.spf), 4096),
    dmarc: raw.dmarc == null ? null : limitString(String(raw.dmarc), 4096),
    dkim: Array.isArray(raw.dkim)
      ? raw.dkim.slice(0, 50).map(record => limitString(String(record), 4096))
      : null,
    mxPtr,
    errors,
    source: 'worker'
  };
}

function postJson(workerUrl, secret, payload, timeoutMs) {
  return new Promise((resolve) => {
    const lib = workerUrl.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const options = {
      protocol: workerUrl.protocol,
      hostname: workerUrl.hostname,
      port: workerUrl.port || (workerUrl.protocol === 'https:' ? 443 : 80),
      path: workerUrl.pathname + workerUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + secret,
        'User-Agent': 'OrbitNet-Backend/1.1',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    };

    let settled = false;
    let req;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      if (req) req.destroy();
      finish({ error: 'External checker timed out', timeout: true });
    }, timeoutMs);

    req = lib.request(options, (res) => {
      const chunks = [];
      let size = 0;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          finish({ error: 'External checker response is too large' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        let raw = null;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (e) {
          raw = null;
        }

        if (res.statusCode === 401 || res.statusCode === 403) {
          finish({ error: 'External checker authentication failed: CHECKER_SECRET does not match the Worker secret' });
          return;
        }

        // 502/504 from the first worker contract means the target was
        // unreachable. The current worker uses {ok:false} with HTTP 200.
        const targetFailure = res.statusCode === 502 || res.statusCode === 504;
        if ((res.statusCode < 200 || res.statusCode >= 300) && !targetFailure) {
          const message = raw && typeof raw.error === 'string'
            ? limitString(raw.error, 300)
            : 'HTTP ' + res.statusCode;
          finish({ error: 'External checker returned ' + message });
          return;
        }
        if (!raw || typeof raw !== 'object') {
          finish({ error: 'External checker returned invalid JSON' });
          return;
        }
        finish({ raw });
      });

      res.on('error', (e) => {
        finish({ error: 'External checker request failed (' + (e.code || 'network error') + ')' });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ error: 'External checker timed out', timeout: true });
    });
    req.on('error', (e) => {
      finish({ error: 'External checker request failed (' + (e.code || 'network error') + ')' });
    });
    req.end(body);
  });
}

async function requestWorker(payload) {
  const config = getConfig();
  if (!config.url || !config.secret) {
    return { error: 'External checker is not configured', unavailable: true };
  }

  const workerUrl = parseWorkerUrl(config.url);
  if (!workerUrl) {
    return { error: 'External checker URL must use HTTPS' };
  }

  const response = await postJson(workerUrl, config.secret, payload, config.timeout);
  if (response.error) return { error: response.error, timeout: response.timeout === true };
  return { raw: response.raw };
}

async function checkHttp(host, options) {
  const normalizedHost = normalizeTargetHost(host);
  if (!normalizedHost) return { error: 'Invalid host for the external checker' };

  const opts = options || {};
  const result = await requestWorker({
    type: 'http',
    host: normalizedHost,
    path: typeof opts.path === 'string' ? opts.path : '/',
    follow: opts.follow !== false
  });
  if (result.error) return result;
  return normalizeHttpResponse(result.raw, normalizedHost);
}

// Backwards-compatible alias for the old single-purpose worker.
async function checkHost(host) {
  return checkHttp(host, { follow: false });
}

async function checkDns(host, type) {
  const recordType = String(type || '').toUpperCase();
  let normalizedHost;
  if (recordType === 'PTR') {
    const literal = String(host || '').trim().replace(/^\[|\]$/g, '');
    if (!net.isIP(literal)) return { error: 'PTR lookup requires an IP address' };
    normalizedHost = literal;
  } else {
    normalizedHost = normalizeDnsName(host);
    if (!normalizedHost) return { error: 'Invalid host for the external checker' };
  }

  const result = await requestWorker({
    type: 'dns',
    host: normalizedHost,
    recordType
  });
  if (result.error) return result;
  return normalizeDnsResponse(result.raw, normalizedHost, recordType);
}

async function checkPropagation(host, type) {
  const normalizedHost = normalizeDnsName(host);
  if (!normalizedHost) return { error: 'Invalid host for the external checker' };
  const recordType = String(type || '').toUpperCase();

  const result = await requestWorker({
    type: 'propagation',
    host: normalizedHost,
    recordType
  });
  if (result.error) return result;
  return normalizePropagationResponse(result.raw, normalizedHost, recordType);
}

async function checkEmail(host, selector) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return { error: 'Invalid host for the external checker' };

  const result = await requestWorker({
    type: 'email',
    host: normalizedHost,
    selector: String(selector || '')
  });
  if (result.error) return result;
  return normalizeEmailResponse(result.raw, normalizedHost);
}

// A local result is worth retrying externally when it never produced an HTTP
// status, or when it looks like an ISP/geo block (403/451). Normal 2xx/3xx/4xx
// answers and blocked targets are not forwarded to the worker.
function shouldUseExternal(result) {
  if (!result || result.blocked) return false;
  if (!result.status) return Boolean(result.error);
  return result.status === 403 || result.status === 451;
}

module.exports = {
  getConfig,
  isLoopbackHost,
  parseWorkerUrl,
  normalizeHost,
  normalizeDnsName,
  normalizeTargetHost,
  normalizeResponse,
  normalizeHttpResponse,
  normalizeDnsResponse,
  normalizePropagationResponse,
  normalizeEmailResponse,
  shouldUseExternal,
  checkHost,
  checkHttp,
  checkDns,
  checkPropagation,
  checkEmail
};
