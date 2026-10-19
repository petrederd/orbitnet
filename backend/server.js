const http = require('http');
const https = require('https');
const tls = require('tls');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const maxmind = require('maxmind');

const PORT = process.env.PORT || 3000;
const OUTBOUND_TIMEOUT = 8000;
const DNS_TIMEOUT = 5000;

function positiveIntEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error('Invalid ' + name + ': expected a positive integer, got "' + raw + '"');
    process.exit(1);
  }
  return n;
}
const MAX_CONCURRENT = positiveIntEnv('MAX_CONCURRENT', 24);
const MAX_QUEUE = positiveIntEnv('MAX_QUEUE', 100);
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 60;
const RATE_MAX_ENTRIES = 10000;

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
// Expands a valid IPv6 string into 8 numeric groups (handles "::" and a
// trailing embedded IPv4). Returns null if it cannot be parsed.
function parseIpv6Groups(ip) {
  let s = ip.split('%')[0];
  const dc = s.indexOf('::');
  const head = dc === -1 ? s : s.slice(0, dc);
  const tail = dc === -1 ? '' : s.slice(dc + 2);
  const toGroups = (part) => {
    if (!part) return [];
    const arr = part.split(':');
    const last = arr[arr.length - 1];
    if (last.includes('.')) {
      const v4 = last.split('.').map(Number);
      if (v4.length !== 4 || v4.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      arr.pop();
      arr.push(((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16));
    }
    const groups = arr.map(g => parseInt(g, 16));
    if (groups.some(n => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
    return groups;
  };
  const h = toGroups(head);
  const t = toGroups(tail);
  if (h === null || t === null) return null;
  if (dc === -1) return h.length === 8 ? h : null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  return h.concat(new Array(fill).fill(0), t);
}

function normalizeIp(input) {
  if (!input || typeof input !== 'string') return '';
  let s = input.trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    s = end === -1 ? s.slice(1) : s.slice(1, end);
  }
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (m) return m[1];
  if (net.isIPv6(s)) {
    const g = parseIpv6Groups(s);
    // IPv4-mapped ::ffff:0:0/96 — collapse to plain IPv4 in any notation
    if (g && g.length === 8 && g[0] === 0 && g[1] === 0 && g[2] === 0 &&
        g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
    }
    return s;
  }
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
  ['::', 96],            // unspecified, loopback, IPv4-compatible
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

// ---------- GeoIP (MaxMind GeoLite2) ----------
// Databases live outside the image (mounted read-only) so they can be kept
// fresh by the geoipupdate service without rebuilding the backend.
const GEOIP_DIR = process.env.GEOIP_DIR || path.join(__dirname, '..', 'data', 'geoip');
const CITY_DB_PATH = process.env.GEOIP_CITY_DB || path.join(GEOIP_DIR, 'GeoLite2-City.mmdb');
const ASN_DB_PATH = process.env.GEOIP_ASN_DB || path.join(GEOIP_DIR, 'GeoLite2-ASN.mmdb');
// How often to stat the databases for a fresh copy written by the updater.
const GEO_RECHECK_MS = 60 * 1000;

// Wraps an .mmdb file: opens it lazily and transparently reloads when the file
// on disk changes (the updater replaces the database atomically in place).
function createGeoDatabase(file) {
  let reader = null;
  let loadedMtime = -1;
  let lastCheck = 0;

  async function refresh() {
    const now = Date.now();
    if (now - lastCheck < GEO_RECHECK_MS) return;
    lastCheck = now;
    try {
      const stat = await fs.promises.stat(file);
      if (stat.mtimeMs === loadedMtime) return;
      reader = await maxmind.open(file);
      loadedMtime = stat.mtimeMs;
      console.log('geoip: loaded ' + file);
    } catch (e) {
      if (reader) {
        console.warn('geoip: keeping previously loaded ' + file + ' (' + e.message + ')');
      } else if (!refresh.warned) {
        refresh.warned = true;
        console.warn('geoip: ' + file + ' unavailable (' + e.message + ')');
      }
    }
  }

  async function lookup(ip) {
    await refresh();
    if (!reader) return null;
    try {
      return reader.get(ip) || null;
    } catch (e) {
      return null;
    }
  }

  return { lookup };
}

const cityDb = createGeoDatabase(CITY_DB_PATH);
const asnDb = createGeoDatabase(ASN_DB_PATH);

function pickName(obj) {
  if (!obj || !obj.names) return { en: '', ru: '' };
  return { en: obj.names.en || '', ru: obj.names.ru || '' };
}

// Normalises the raw MaxMind city/asn records into a stable, flatter shape.
function buildGeo(city, asn) {
  if (!city && !asn) return null;

  const geo = {
    continent: '', countryCode: '', country: '', countryLocal: '',
    regionCode: '', region: '', regionLocal: '',
    city: '', cityLocal: '', postal: '', timezone: '',
    latitude: null, longitude: null, accuracyRadius: null,
    asn: null, asnOrganization: ''
  };

  if (city) {
    geo.continent = (city.continent && city.continent.code) || '';
    const country = city.country || city.registered_country || {};
    const countryNames = pickName(country);
    geo.countryCode = country.iso_code || '';
    geo.country = countryNames.en || geo.countryCode;
    geo.countryLocal = countryNames.ru || geo.country;

    const sub = (city.subdivisions && city.subdivisions[0]) || null;
    if (sub) {
      const subNames = pickName(sub);
      geo.regionCode = sub.iso_code || '';
      geo.region = subNames.en || geo.regionCode;
      geo.regionLocal = subNames.ru || geo.region;
    }

    if (city.city) {
      const cityNames = pickName(city.city);
      geo.city = cityNames.en;
      geo.cityLocal = cityNames.ru || cityNames.en;
    }

    geo.postal = (city.postal && city.postal.code) || '';

    if (city.location) {
      geo.timezone = city.location.time_zone || '';
      geo.latitude = typeof city.location.latitude === 'number' ? city.location.latitude : null;
      geo.longitude = typeof city.location.longitude === 'number' ? city.location.longitude : null;
      geo.accuracyRadius = typeof city.location.accuracy_radius === 'number' ? city.location.accuracy_radius : null;
    }
  }

  if (asn) {
    geo.asn = asn.autonomous_system_number || null;
    geo.asnOrganization = asn.autonomous_system_organization || '';
  }

  return geo;
}

async function geoLookup(ip) {
  const [city, asn] = await Promise.all([cityDb.lookup(ip), asnDb.lookup(ip)]);
  return buildGeo(city, asn);
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
let lastRatePrune = Date.now();
function isRateLimited(ip) {
  const now = Date.now();
  if (now - lastRatePrune > RATE_WINDOW_MS || rateHits.size > RATE_MAX_ENTRIES) {
    for (const [key, rec] of rateHits) {
      if (now - rec.start > RATE_WINDOW_MS) rateHits.delete(key);
    }
    lastRatePrune = now;
  }
  let rec = rateHits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    // Keep the table bounded: once it is full of active clients, shed new ones
    // instead of wiping every counter at once.
    if (!rec && rateHits.size >= RATE_MAX_ENTRIES) return true;
    rec = { start: now, count: 0 };
    rateHits.set(ip, rec);
  }
  rec.count++;
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
  const version = net.isIPv6(ip) ? 6 : 4;
  const [hostname, geo] = await Promise.all([
    withTimeout(dns.reverse(ip), DNS_TIMEOUT, 'timeout')
      .then(names => (names && names[0]) || '')
      .catch(() => ''),
    geoLookup(ip)
  ]);
  return { ip, version, hostname, geo };
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
          headers,
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

// ---------- /api/headers ----------
async function headersInfo(host) {
  const ips = await resolvePublic(host);
  const ip = pickAddress(ips);
  let result = await outbound(() => fetchOnce(ip, host, '/', true));
  let protocol = 'https';
  if (result.error) {
    const httpResult = await outbound(() => fetchOnce(ip, host, '/', false));
    if (!httpResult.error) { result = httpResult; protocol = 'http'; }
  }
  const headers = [];
  if (result.headers) {
    for (const [name, value] of Object.entries(result.headers)) {
      headers.push({ name, value: Array.isArray(value) ? value.join(', ') : String(value) });
    }
  }
  return {
    host,
    ip,
    protocol,
    status: result.status || null,
    responseMs: result.ms,
    headers,
    redirect: result.redirect || '',
    error: result.error || null
  };
}

// ---------- /api/tls ----------
// Deliberately connects with rejectUnauthorized:false so invalid/expired
// certificates can still be inspected; validity is then reported explicitly.
async function tlsInfo(host, port) {
  const ips = await resolvePublic(host);
  const ip = pickAddress(ips);
  return outbound(() => new Promise((resolve) => {
    const socket = tls.connect({
      host: ip,
      servername: host,
      port: port || 443,
      rejectUnauthorized: false,
      timeout: OUTBOUND_TIMEOUT
    }, () => {
      const cert = socket.getPeerCertificate(true);
      const chain = [];
      let node = cert;
      const seen = new Set();
      while (node && node.subject && !seen.has(node.fingerprint256)) {
        seen.add(node.fingerprint256);
        chain.push({
          subject: node.subject,
          issuer: node.issuer,
          valid_from: node.valid_from,
          valid_to: node.valid_to,
          fingerprint256: node.fingerprint256,
          selfSigned: node.subject && node.issuer &&
            node.subject.CN === node.issuer.CN && node.subject.O === node.issuer.O
        });
        node = node.issuerCertificate;
      }
      let hostnameMatch = true;
      let hostnameError = '';
      try {
        const e = tls.checkServerIdentity(host, cert);
        if (e) { hostnameMatch = false; hostnameError = e.message; }
      } catch (e) { hostnameMatch = false; hostnameError = e.message; }

      const validTo = new Date(cert.valid_to);
      const daysRemaining = isNaN(validTo.getTime()) ? null :
        Math.floor((validTo.getTime() - Date.now()) / 86400000);

      const out = {
        host,
        ip,
        port: port || 443,
        protocol: socket.getProtocol(),
        cipher: (socket.getCipher() || {}).name || '',
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : '',
        subject: cert.subject || {},
        issuer: cert.issuer || {},
        valid_from: cert.valid_from || '',
        valid_to: cert.valid_to || '',
        daysRemaining,
        serialNumber: cert.serialNumber || '',
        fingerprint256: cert.fingerprint256 || '',
        subjectaltname: cert.subjectaltname || '',
        hostnameMatch,
        hostnameError,
        chain
      };
      socket.end();
      resolve(out);
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ host, ip, error: 'timeout' }); });
    socket.on('error', (e) => resolve({ host, ip, error: e.code || e.message }));
  }));
}

// ---------- /api/email ----------
async function emailInfo(host, selector) {
  const result = { host, mx: [], spf: null, dmarc: null, dkim: null, errors: {} };
  try {
    const mx = await withTimeout(dns.resolveMx(host), DNS_TIMEOUT, 'timeout');
    result.mx = mx.map(r => ({ priority: r.priority, host: r.exchange }))
      .sort((a, b) => a.priority - b.priority);
  } catch (e) { result.errors.mx = e.code || e.message; }

  try {
    const txt = await withTimeout(dns.resolveTxt(host), DNS_TIMEOUT, 'timeout');
    const flat = txt.map(r => r.join(''));
    result.spf = flat.find(t => /^v=spf1/i.test(t)) || null;
  } catch (e) { result.errors.spf = e.code || e.message; }

  try {
    const txt = await withTimeout(dns.resolveTxt('_dmarc.' + host), DNS_TIMEOUT, 'timeout');
    const flat = txt.map(r => r.join(''));
    result.dmarc = flat.find(t => /^v=DMARC1/i.test(t)) || null;
  } catch (e) { result.errors.dmarc = e.code || e.message; }

  if (selector) {
    try {
      const txt = await withTimeout(dns.resolveTxt(selector + '._domainkey.' + host), DNS_TIMEOUT, 'timeout');
      result.dkim = txt.map(r => r.join(''));
    } catch (e) { result.errors.dkim = e.code || e.message; }
  }

  if (result.mx.length) {
    try {
      const ips = await withTimeout(dns.resolve(result.mx[0].host, 'A'), DNS_TIMEOUT, 'timeout');
      if (ips.length) {
        const names = await withTimeout(dns.reverse(ips[0]), DNS_TIMEOUT, 'timeout');
        result.mxPtr = { ip: ips[0], hostnames: names };
      }
    } catch (e) { /* optional */ }
  }
  return result;
}

// ---------- /api/propagation ----------
const PUBLIC_RESOLVERS = [
  '1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4',
  '9.9.9.9', '208.67.222.222', '77.88.8.8'
];

async function propagation(host, type) {
  const tasks = PUBLIC_RESOLVERS.map(async (server) => {
    const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });
    resolver.setServers([server]);
    try {
      let records;
      if (type === 'MX') records = (await resolver.resolveMx(host)).map(r => r.priority + ' ' + r.exchange);
      else if (type === 'TXT') records = (await resolver.resolveTxt(host)).map(r => r.join(''));
      else if (type === 'NS') records = await resolver.resolveNs(host);
      else if (type === 'CNAME') records = await resolver.resolveCname(host);
      else if (type === 'SOA') records = [JSON.stringify(await resolver.resolveSoa(host))];
      else if (type === 'CAA') records = (await resolver.resolveCaa(host)).map(r => r.flag + ' ' + r.tag + ' ' + r.value);
      else records = await resolver.resolve(host, type === 'AAAA' ? 'AAAA' : 'A');
      return { server, records: records.slice().sort() };
    } catch (e) {
      return { server, error: e.code || e.message };
    }
  });
  return Promise.all(tasks);
}

// ---------- /api/redirect ----------
const MAX_REDIRECTS = 10;

async function redirectChain(startHost) {
  const chain = [];
  let url = new URL('https://' + startHost + '/');
  let finalUrl = url.href;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') break;
    const secure = url.protocol === 'https:';
    const host = url.hostname;
    const path = url.pathname + url.search;
    let result;
    try {
      const ips = await resolvePublic(host);
      const ip = pickAddress(ips);
      result = await outbound(() => fetchOnce(ip, host, path, secure));
    } catch (e) {
      chain.push({ url: url.href, status: null, location: '', blocked: true, error: e.message });
      break;
    }
    chain.push({
      url: url.href,
      status: result.status || null,
      location: result.redirect || '',
      ms: result.ms,
      error: result.error || null
    });
    if (!result.redirect) { finalUrl = url.href; break; }
    try {
      url = new URL(result.redirect, url);
    } catch (e) { break; }
    finalUrl = url.href;
  }
  return { host: startHost, chain, finalUrl, hops: chain.length };
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
  const limited = path === '/api/ip' || path === '/api/geo' || path === '/api/dns' ||
    path === '/api/port' || path === '/api/whois' || path === '/api/site' ||
    path === '/api/tls' || path === '/api/headers' || path === '/api/email' ||
    path === '/api/propagation' || path === '/api/redirect';

  try {
    if (path === '/health') return send(res, 200, { ok: true });

    if (limited && isRateLimited(ip)) {
      return send(res, 429, { error: 'Too many requests, slow down' });
    }

    if (path === '/api/ip') {
      return send(res, 200, await ipInfo(req));
    }

    if (path === '/api/geo') {
      const ipParam = normalizeIp(query.get('ip') || '');
      const hostParam = (query.get('host') || '').trim();
      let target = ipParam;
      if (!net.isIP(target)) {
        if (!isValidHost(hostParam)) return bad(res, 'Provide a valid IP address or hostname');
        const ips = await resolvePublic(hostParam);
        target = pickAddress(ips);
      }
      return send(res, 200, { ip: target, geo: await geoLookup(target) });
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

    if (path === '/api/headers') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      return send(res, 200, await headersInfo(host));
    }

    if (path === '/api/tls') {
      const host = query.get('host') || '';
      const portStr = query.get('port') || '443';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      if (!/^\d{1,5}$/.test(portStr)) return bad(res, 'Port must be 1-65535');
      const port = parseInt(portStr, 10);
      if (port < 1 || port > 65535) return bad(res, 'Port must be 1-65535');
      return send(res, 200, await tlsInfo(host, port));
    }

    if (path === '/api/email') {
      const host = query.get('host') || '';
      const selector = (query.get('selector') || '').trim();
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      if (selector && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(selector)) {
        return bad(res, 'Invalid DKIM selector');
      }
      return send(res, 200, await emailInfo(host, selector));
    }

    if (path === '/api/propagation') {
      const host = query.get('host') || '';
      const type = sanitizeType(query.get('type'));
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      return send(res, 200, { host, type, resolvers: await propagation(host, type) });
    }

    if (path === '/api/redirect') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      return send(res, 200, await redirectChain(host));
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

module.exports = { normalizeIp, isPublicIp, clientIp, server, tlsInfo, headersInfo, emailInfo, propagation, redirectChain };
