const http = require('http');
const https = require('https');
const tls = require('tls');
const dns = require('dns').promises;
const net = require('net');

const PORT = process.env.PORT || 3000;
const OUTBOUND_TIMEOUT = 8000;
const DNS_TIMEOUT = 5000;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '24', 10);
const MAX_QUEUE = parseInt(process.env.MAX_QUEUE || '100', 10);
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 60;

// Simple JSON helpers
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function bad(res, message) {
  send(res, 400, { error: message });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------- IP helpers ----------
function normalizeIp(input) {
  if (!input || typeof input !== 'string') return '';
  let s = input.trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    s = end === -1 ? s.slice(1) : s.slice(1, end);
  }
  // hex-form IPv4-mapped, e.g. ::ffff:7f00:1 or ::ffff:808:808
  const mapped = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  s = s.replace(/^::ffff:/i, '');
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (m) return m[1];
  return s;
}

// Single deny-list of non-public IPv4 and IPv6 ranges. net.BlockList handles
// prefix matching and address parsing for both families.
const BLOCKED = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([ip, bits]) => BLOCKED.addSubnet(ip, bits, 'ipv4'));
[
  ['::', 96],            // unspecified, loopback, IPv4-compatible and IPv4-mapped
  ['64:ff9b::', 96],     // NAT64
  ['64:ff9b:1::', 48],   // NAT64 local-use
  ['100::', 64],         // discard-only
  ['2001::', 32],        // Teredo
  ['2001:2::', 48],      // benchmarking
  ['2001:db8::', 32],    // documentation
  ['2001:10::', 28],     // ORCHID
  ['2001:20::', 28],     // ORCHIDv2
  ['2002::', 16],        // 6to4
  ['3fff::', 20],        // documentation (RFC 9637)
  ['5f00::', 16],        // segment routing
  ['fc00::', 7],         // unique local
  ['fe80::', 10],        // link-local
  ['ff00::', 8]          // multicast
].forEach(([ip, bits]) => BLOCKED.addSubnet(ip, bits, 'ipv6'));

function isPublicIp(ip) {
  const norm = normalizeIp(ip).toLowerCase();
  if (net.isIPv4(norm)) return !BLOCKED.check(norm, 'ipv4');
  if (net.isIPv6(norm)) return !BLOCKED.check(norm, 'ipv6');
  return false;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]);
}

// Resolves a host to IPs and rejects the request unless every address is public.
async function resolvePublic(host) {
  const literal = normalizeIp(host);
  if (net.isIP(literal)) {
    if (!isPublicIp(literal)) throw httpError(400, 'Only public IP addresses are allowed');
    return [literal];
  }
  let addrs = null;
  for (let attempt = 0; attempt < 2 && !addrs; attempt++) {
    try {
      addrs = await withTimeout(dns.lookup(host, { all: true }), DNS_TIMEOUT, 'DNS resolution timeout');
    } catch (e) {
      if (e.status) throw e;
    }
  }
  if (!addrs) throw httpError(400, 'Cannot resolve ' + host);
  const ips = addrs.map(a => normalizeIp(a.address)).filter(ip => net.isIP(ip));
  if (!ips.length) throw httpError(400, 'Cannot resolve ' + host);
  for (const ip of ips) {
    if (!isPublicIp(ip)) throw httpError(400, 'Blocked: ' + host + ' resolves to a non-public address');
  }
  return ips;
}

function pickAddress(ips) {
  return ips.find(net.isIPv4) || ips[0];
}

// ---------- client IP (behind trusted reverse proxies) ----------
// nginx (the only allowed caller of this service) sets X-Real-IP to the client
// address after resolving the trusted proxy chain, so that header is preferred.
// X-Forwarded-For is only used as a fallback, picking the nearest hop that is a
// public address and ignoring client-supplied (spoofable) entries.
function clientIp(req) {
  const real = normalizeIp(String(req.headers['x-real-ip'] || ''));
  if (net.isIP(real)) return real;

  const chain = [];
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') chain.push(...xff.split(','));
  chain.push(req.socket.remoteAddress || '');
  const norm = chain.map(normalizeIp).filter(ip => net.isIP(ip));
  for (let i = norm.length - 1; i >= 0; i--) {
    if (isPublicIp(norm[i])) return norm[i];
  }
  return norm[norm.length - 1] || '';
}

// ---------- concurrency + rate limiting ----------
function createLimiter(max, maxQueue) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const job = queue.shift();
    Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    if (queue.length >= maxQueue) { reject(httpError(503, 'Server busy, try again later')); return; }
    queue.push({ fn, resolve, reject });
    next();
  });
}
const outbound = createLimiter(MAX_CONCURRENT, MAX_QUEUE);

const rateHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  let rec = rateHits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    rec = { start: now, count: 0 };
    rateHits.set(ip, rec);
  }
  rec.count++;
  if (rateHits.size > 10000) rateHits.clear();
  return rec.count > RATE_MAX;
}

// ---------- validation ----------
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
function isValidHost(host) {
  return typeof host === 'string' && host.length <= 253 && HOSTNAME_RE.test(host);
}
function sanitizeType(t) {
  return /^[A-Z]{1,6}$/.test(t || '') ? t.toUpperCase() : 'A';
}

// ---------- /api/ip ----------
async function ipInfo(req) {
  const ip = clientIp(req);
  let hostname = '';
  try {
    const names = await withTimeout(dns.reverse(ip), DNS_TIMEOUT, 'timeout');
    hostname = (names && names[0]) || '';
  } catch (e) { hostname = ''; }

  const version = net.isIPv6(ip) ? 6 : 4;
  return { ip, version, hostname };
}

// ---------- /api/dns ----------
async function dnsLookup(host, type) {
  try {
    if (type === 'A' || type === 'AAAA') {
      return await dns.resolve(host, type);
    }
    if (type === 'CNAME') {
      return await dns.resolveCname(host);
    }
    if (type === 'MX') {
      const records = await dns.resolveMx(host);
      return records.map(r => ({ priority: r.priority, host: r.exchange }));
    }
    if (type === 'TXT') {
      const records = await dns.resolveTxt(host);
      return records.map(r => r.join(' '));
    }
    if (type === 'NS') {
      return await dns.resolveNs(host);
    }
    if (type === 'SOA') {
      return await dns.resolveSoa(host);
    }
    if (type === 'CAA') {
      const records = await dns.resolveCaa(host);
      return records.map(r => ({ flag: r.flag, tag: r.tag, value: r.value }));
    }
    // default: A
    return await dns.resolve(host, 'A');
  } catch (e) {
    throw new Error(e.code === 'ENODATA' ? 'No records found for ' + type : e.code + ': ' + e.message);
  }
}

// ---------- /api/port ----------
function checkPort(ip, port, timeout) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const to = timeout || 3000;
    let done = false;
    const finish = (open, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ ip, port, open, error: err || null });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), to);
    sock.setTimeout(to);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false, 'timeout'));
    sock.once('error', (e) => finish(false, e.code || 'error'));
    sock.connect(port, ip);
  });
}

// ---------- /api/whois ----------
function queryWhois(host, server, port) {
  return new Promise((resolvePort, rejectPort) => {
    const sock = net.connect(port, server);
    let data = '';
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) {} rejectPort(new Error('whois timeout')); }, 8000);
    sock.on('connect', () => sock.write(host + '\r\n'));
    sock.on('data', (d) => {
      data += d.toString('utf8');
      if (data.length > 200000) { try { sock.destroy(); } catch (e) {} }
      // whois servers may indicate referral; bail after enough data
    });
    sock.on('end', () => { clearTimeout(timer); resolvePort(data); });
    sock.on('close', () => { clearTimeout(timer); if (data) resolvePort(data); });
    sock.on('error', (e) => { clearTimeout(timer); rejectPort(new Error(e.message)); });
  });
}

const WHOIS_SERVERS = {
  com: 'whois.verisign-grs.com', net: 'whois.verisign-grs.com', org: 'whois.pir.org',
  info: 'whois.afilias.net', io: 'whois.nic.io', co: 'whois.nic.co',
  ru: 'whois.tcinet.ru', su: 'whois.tcinet.ru', by: 'whois.cctld.by',
  de: 'whois.denic.de', uk: 'whois.nic.uk', us: 'whois.nic.us',
  biz: 'whois.nic.biz', me: 'whois.nic.me', app: 'whois.nic.google',
  dev: 'whois.nic.google', page: 'whois.nic.google', site: 'whois.nic.google',
  cloud: 'whois.nic.cloud', club: 'whois.nic.club', online: 'whois.nic.online',
};

async function whoisLookup(host) {
  const tld = host.split('.').pop().toLowerCase();
  const server = WHOIS_SERVERS[tld] || 'whois.iana.org';
  try {
    return await queryWhois(host, server, 43);
  } catch (e) {
    // fallback to iana
    return await queryWhois(host, 'whois.iana.org', 43);
  }
}

// ---------- /api/site ----------
// Connects to the pre-resolved public IP, keeps the original Host/SNI, verifies TLS.
function fetchOnce(ip, host, path, secure, timeout) {
  return new Promise((resolve) => {
    const lib = secure ? https : http;
    const start = Date.now();
    const options = {
      hostname: ip,
      path: path || '/',
      method: 'GET',
      headers: {
        'Host': host,
        'User-Agent': 'OrbitNet/1.0 (+https://orbitnet.ru)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: timeout || OUTBOUND_TIMEOUT
    };
    if (secure) {
      options.servername = host;
      options.checkServerIdentity = (servername, cert) => tls.checkServerIdentity(host, cert);
    }
    const req = lib.request(options, (res) => {
      const status = res.statusCode;
      const headers = res.headers;
      if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
        res.resume();
        return resolve({ status, redirect: safeRedirect(headers.location), ms: Date.now() - start, headers });
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 200000) body += chunk;
      });
      res.on('end', () => {
        const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
        resolve({
          status,
          ms: Date.now() - start,
          server: headers['server'] || '',
          contentType: headers['content-type'] || '',
          title,
          finalUrl: (secure ? 'https://' : 'http://') + host + path
        });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - start }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - start }));
    req.end();
  });
}

// Only expose http(s) redirect targets; the target is never followed.
function safeRedirect(location) {
  if (typeof location !== 'string') return '';
  const trimmed = location.trim();
  if (/^https?:\/\//i.test(trimmed) || /^\//.test(trimmed)) return trimmed.slice(0, 2048);
  return '';
}

async function siteInfo(host) {
  const ips = await resolvePublic(host);
  const ip = pickAddress(ips);
  // Try HTTPS first (with certificate verification), fall back to HTTP.
  let result = await outbound(() => fetchOnce(ip, host, '/', true));
  let protocol = 'https';
  if (result.error || (result.status && result.status >= 400 && !result.redirect)) {
    const httpResult = await outbound(() => fetchOnce(ip, host, '/', false));
    if (!httpResult.error) { result = httpResult; protocol = 'http'; }
  }
  return {
    host,
    ip,
    protocol,
    status: result.status || null,
    responseMs: result.ms,
    server: result.server || '',
    title: result.title || '',
    redirect: result.redirect || '',
    error: result.error || null
  };
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const path = parsed.pathname;
  const query = parsed.searchParams;

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const ip = clientIp(req);
  const limited = path === '/api/ip' || path === '/api/dns' || path === '/api/port' ||
    path === '/api/whois' || path === '/api/site';

  try {
    if (path === '/health') return send(res, 200, { ok: true });

    if (limited && isRateLimited(ip)) {
      return send(res, 429, { error: 'Too many requests, slow down' });
    }

    if (path === '/api/ip') {
      return send(res, 200, await ipInfo(req));
    }

    if (path === '/api/dns') {
      const host = query.get('host') || '';
      const type = sanitizeType(query.get('type'));
      const literal = normalizeIp(host);
      // allow IP lookups too (IPv4 and IPv6)
      if (net.isIPv4(literal) && type === 'A') {
        return send(res, 200, { host, type: 'A', records: [literal] });
      }
      if (net.isIP(literal) && type === 'PTR') {
        let records = [];
        let err = null;
        try { records = await withTimeout(dns.reverse(literal), DNS_TIMEOUT, 'timeout'); } catch (e) { err = e.code || 'error'; }
        return send(res, 200, { host, type: 'PTR', records, error: err });
      }
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      const records = await outbound(() => dnsLookup(host, type));
      return send(res, 200, { host, type, records });
    }

    if (path === '/api/port') {
      const host = query.get('host') || '';
      const portStr = query.get('port') || '';
      if (!/^\d{1,5}$/.test(portStr)) return bad(res, 'Port must be 1-65535');
      const port = parseInt(portStr, 10);
      if (!isValidHost(host) && !net.isIP(normalizeIp(host))) return bad(res, 'Invalid hostname');
      if (port < 1 || port > 65535) return bad(res, 'Port must be 1-65535');
      const ips = await resolvePublic(host);
      const target = pickAddress(ips);
      const result = await outbound(() => checkPort(target, port));
      return send(res, 200, Object.assign({ host }, result));
    }

    if (path === '/api/whois') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      const raw = await outbound(() => whoisLookup(host));
      return send(res, 200, { host, raw });
    }

    if (path === '/api/site') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      const result = await siteInfo(host);
      return send(res, 200, result);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('OrbitNet backend listening on :' + PORT);
  });
}

module.exports = { normalizeIp, isPublicIp, clientIp, server };
