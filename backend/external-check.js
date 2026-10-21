'use strict';

// Client for the Cloudflare Worker reachability checker.
//
// The worker is only used as a fallback when the local server cannot reach a
// site at the network level (DNS, TCP, TLS or timeout). It is never used for a
// normal HTTP response, and it is never called when the target was blocked by
// the local SSRF guard.
//
// Worker contract (already deployed):
//   POST /  {"host":"example.com"}
//   Authorization: Bearer <CHECKER_SECRET>
//   -> 200 {reachable:true, status, protocol, title, headers flags, ...}
//   -> 502 {reachable:false, status:null, error}
//
// Configuration comes from the environment, which docker compose reads from
// the server-side .env. The secret is sent only to the worker over HTTPS and
// is never returned to clients.

const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 256 * 1024;

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

// The deployed worker accepts a public domain, not an arbitrary URL. Mirrors
// its basic checks so obvious junk is rejected before a subrequest is made.
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
  const forbidden = ['localhost', 'local', 'internal', 'test', 'invalid'];
  if (forbidden.some(suffix => host === suffix || host.endsWith('.' + suffix))) return '';
  return host;
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

// Converts the worker payload into the same shape the local checks use.
// A non-2xx target response is a successful check: only transport failures
// produce an `error`.
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
    // The worker reads only the first response (`redirect: "manual"`), so the
    // chain has one hop. It is not used for /api/redirect.
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
        'User-Agent': 'OrbitNet-Backend/1.0',
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
          finish({ error: 'External checker authentication failed' });
          return;
        }

        // 502/504 from the worker means the target was unreachable or timed
        // out. That is a valid target result and is normalized like the rest.
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

// Returns { error } when the checker is unavailable or the target fails, and
// the normalized result otherwise.
async function checkHost(host) {
  const config = getConfig();
  if (!config.url || !config.secret) {
    return { error: 'External checker is not configured', unavailable: true };
  }

  const workerUrl = parseWorkerUrl(config.url);
  if (!workerUrl) {
    return { error: 'External checker URL must use HTTPS' };
  }

  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return { error: 'Invalid host for the external checker' };

  const response = await postJson(workerUrl, config.secret, { host: normalizedHost }, config.timeout);
  if (response.error) return { error: response.error, timeout: response.timeout === true };
  return normalizeResponse(response.raw);
}

// A local result is worth retrying externally only when it never produced an
// HTTP status. 404/500 responses and redirects are valid answers, and blocked
// targets must not be forwarded to the worker.
function shouldUseExternal(result) {
  if (!result || result.blocked) return false;
  if (result.status) return false;
  return Boolean(result.error);
}

module.exports = {
  getConfig,
  isLoopbackHost,
  parseWorkerUrl,
  normalizeHost,
  normalizeResponse,
  shouldUseExternal,
  checkHost
};
