const http = require('http');
const https = require('https');
const http2 = require('http2');
const tls = require('tls');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const maxmind = require('maxmind');
const { getDomain } = require('tldts');
const externalCheck = require('./external-check');
let securityHeaderRules;
try {
  securityHeaderRules = require('./site/assets/js/security-header-rules.js');
} catch (e) {
  securityHeaderRules = require('../site/assets/js/security-header-rules.js');
}

const PORT = process.env.PORT || 3000;
const OUTBOUND_TIMEOUT = 8000;
const DNS_TIMEOUT = 5000;
// Kernel-hardening / max body size for outbound fetches. Reading stops here
// and the socket is destroyed so a slow or endless response cannot pin a slot.
const MAX_BODY_BYTES = 200000;
// TLS can only be inspected on ports that are normally TLS services. This keeps
// /api/tls from becoming an unrestricted TCP port scanner.
const TLS_PORTS = new Set([443, 465, 993, 995, 8443]);

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
// DNS queries do not hold sockets, so DNSBL lookups get their own larger
// process-wide pool instead of competing with whois/port/TLS jobs.
const DNSBL_MAX_CONCURRENT = positiveIntEnv('DNSBL_MAX_CONCURRENT', 48);
const DNSBL_MAX_QUEUE = positiveIntEnv('DNSBL_MAX_QUEUE', 200);
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 60;
const RATE_MAX_ENTRIES = 10000;
// Fallback calls are expensive and share one Cloudflare quota. Keep them much
// rarer than ordinary API requests and cap the whole process as well.
const EXTERNAL_RATE_MAX = positiveIntEnv('EXTERNAL_RATE_MAX', 10);
const EXTERNAL_GLOBAL_MAX = positiveIntEnv('EXTERNAL_GLOBAL_MAX', 60);
// ENOTFOUND is ambiguous and can be triggered by arbitrary typo domains, so it
// gets a smaller independent budget. This leaves the main fallback budget free
// for real censorship/transport failures.
const EXTERNAL_NXDOMAIN_RATE_MAX = positiveIntEnv('EXTERNAL_NXDOMAIN_RATE_MAX', 3);
const EXTERNAL_NXDOMAIN_GLOBAL_MAX = positiveIntEnv('EXTERNAL_NXDOMAIN_GLOBAL_MAX', 15);
// Leave room under nginx proxy_read_timeout (25s) for JSON serialisation and
// network jitter. Local checks and the Worker share this deadline.
const REQUEST_BUDGET_MS = positiveIntEnv('REQUEST_BUDGET_MS', 22000);
const EXTERNAL_UNAVAILABLE = 'External check unavailable';

// Lightweight, in-process counters for /health. They reset on restart and are
// deliberately not persisted: the goal is to spot trends and failures in the
// current container, not to build a long-term analytics store.
const STARTED_AT = Date.now();
const metrics = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
  totalResponseMs: 0,
  maxResponseMs: 0,
  sources: { local: 0, worker: 0 },
  external: {
    attempts: 0, successes: 0, failures: 0, limited: 0, timeouts: 0, totalMs: 0
  }
};

function healthPayload() {
  return {
    ok: true,
    service: 'orbitnet-api',
    startedAt: new Date(STARTED_AT).toISOString(),
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    metrics: {
      requests: metrics.requests,
      errors: metrics.errors,
      rateLimited: metrics.rateLimited,
      averageResponseMs: metrics.requests
        ? Math.round(metrics.totalResponseMs / metrics.requests)
        : 0,
      maxResponseMs: metrics.maxResponseMs,
      sources: { ...metrics.sources },
      external: {
        ...metrics.external,
        averageMs: metrics.external.attempts
          ? Math.round(metrics.external.totalMs / metrics.external.attempts)
          : 0
      }
    }
  };
}

// Simple JSON helpers
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  const now = Date.now();
  const started = res._orbitStarted || now;
  const duration = Math.max(0, now - started);

  metrics.requests++;
  metrics.totalResponseMs += duration;
  if (duration > metrics.maxResponseMs) metrics.maxResponseMs = duration;
  if (code >= 500) metrics.errors++;
  if (code === 429) metrics.rateLimited++;
  if (obj && typeof obj === 'object' &&
      (obj.source === 'local' || obj.source === 'worker')) {
    metrics.sources[obj.source]++;
  }

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

// Reads and parses a small JSON request body. Used by POST endpoints so
// sensitive values (captcha answers) never appear in URLs or access logs.
function readJsonBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];

    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        req.resume();
        reject(httpError(413, 'Payload too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      if (!size) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(httpError(400, 'Invalid JSON body'));
        }
        resolve(parsed);
      } catch (e) {
        reject(httpError(400, 'Invalid JSON body'));
      }
    });

    req.on('error', err => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
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
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'ETIMEOUT';
        reject(error);
      }, ms);
    })
  ]);
}

// Resolves a host to IPs and rejects the request unless every address is public.
async function resolvePublic(host) {
  const literal = normalizeIp(host);
  if (net.isIP(literal)) {
    if (!isPublicIp(literal)) {
      throw Object.assign(httpError(400, 'Only public IP addresses are allowed'), { blocked: true });
    }
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
  if (!addrs) {
    throw Object.assign(httpError(400, 'Cannot resolve ' + host), { unresolved: true });
  }
  const ips = addrs.map(a => normalizeIp(a.address)).filter(ip => net.isIP(ip));
  if (!ips.length) {
    throw Object.assign(httpError(400, 'Cannot resolve ' + host), { unresolved: true });
  }
  for (const ip of ips) {
    if (!isPublicIp(ip)) {
      throw Object.assign(
        httpError(400, 'Blocked: ' + host + ' resolves to a non-public address'),
        { blocked: true }
      );
    }
  }
  return ips;
}

function pickAddress(ips) {
  return ips.find(net.isIPv4) || ips[0];
}

// Round-robin over resolver answer lists so one resolver cannot fill the whole
// candidate list with addresses that are blocked from this network.
function interleaveAnswers(lists) {
  const out = [];
  const max = lists.reduce((value, list) => Math.max(value, list.length), 0);
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

async function workerPropagationIps(host, type, context) {
  const cacheKey = externalCacheKey('propagation', host, type);
  let external = getExternalCache(cacheKey);
  if (!external) {
    external = await callExternal(
      opts => externalCheck.checkPropagation(host, type, opts),
      context
    );
    if (!external.error) setExternalCache(cacheKey, external);
  }
  if (external.error) {
    logExternalFailure(external.error);
    return [];
  }
  const lists = (Array.isArray(external.resolvers) ? external.resolvers : [])
    .map(item => Array.isArray(item.records) ? item.records : []);
  return interleaveAnswers(lists).filter(ip => net.isIP(ip) && isPublicIp(ip));
}

async function workerResolvedIps(host, context) {
  const v4 = await workerPropagationIps(host, 'A', context);
  // Most dual-stack hosts return several IPv4 addresses, which is enough for
  // the parallel attempt below. Ask for AAAA only when the IPv4 set is too
  // small, to keep the Worker fallback budget for real failures.
  const v6 = v4.length < 4
    ? await workerPropagationIps(host, 'AAAA', context)
    : [];
  return [...new Set([...v4, ...v6])];
}

// Checks that need a public address for a domain (geo, TLS) can ask the Worker
// for A/AAAA when the local resolver cannot see the name (DNS filtering, RKN).
// The Worker answer is still filtered through the local public-IP guard, and
// targets the local resolver already marked as private are never forwarded.
// TLS asks all DoH resolvers for every address so it can try more than one.
async function resolvePublicWithWorker(host, context, options) {
  try {
    return { ips: await resolvePublic(host), source: 'local' };
  } catch (e) {
    if (e.blocked || !e.unresolved) throw e;
    if (options && options.all) {
      const ips = await workerResolvedIps(host, context);
      if (ips.length) return { ips, source: 'worker' };
    }
    for (const type of ['A', 'AAAA']) {
      const cacheKey = externalCacheKey('dns', host, type);
      let external = getExternalCache(cacheKey);
      if (!external) {
        external = await callExternal(
          opts => externalCheck.checkDns(host, type, opts),
          context
        );
        if (!external.error) setExternalCache(cacheKey, external);
      }
      if (external.error) {
        logExternalFailure(external.error);
        continue;
      }
      const ips = (Array.isArray(external.records) ? external.records : [])
        .filter(ip => net.isIP(ip) && isPublicIp(ip));
      if (ips.length) return { ips, source: 'worker' };
    }
    throw e;
  }
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

// ---------- anonymity helpers ----------
// Proxy-related request headers that are not part of OrbitNet's own
// Cloudflare -> Caddy -> nginx chain. Infrastructure headers are ignored so
// the report does not flag our own proxies as the visitor's proxy.
const IGNORED_PROXY_HEADERS = new Set([
  'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host',
  'x-forwarded-port', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray',
  'cf-visitor', 'cf-cache-status', 'cdn-loop', 'true-client-ip',
  'proxy-authorization', 'cookie', 'authorization'
]);

function proxyHeaderSignals(req) {
  const signals = [];
  for (const [rawName, rawValue] of Object.entries(req.headers)) {
    const name = rawName.toLowerCase();
    if (IGNORED_PROXY_HEADERS.has(name)) continue;

    let strength = '';
    let reason = '';
    if (name === 'proxy-connection' || name === 'proxy-agent' ||
        name.startsWith('x-proxy-') || name === 'x-squid-error' ||
        name === 'x-bluecoat-via') {
      strength = 'high';
      reason = 'Header is commonly added by an explicit HTTP proxy.';
    } else if (name === 'via' || name === 'forwarded' ||
               name === 'x-forwarded-server' || name === 'x-cache' ||
               name === 'x-cache-lookup' || name === 'x-varnish') {
      strength = 'medium';
      reason = 'Header may come from a proxy or CDN intermediary.';
    } else if (name === 'x-client-ip' || name === 'x-originating-ip' ||
               name === 'x-remote-ip' || name === 'client-ip') {
      strength = 'medium';
      reason = 'Header suggests an intermediary forwarded the client address.';
    }

    if (strength) {
      signals.push({
        name,
        value: String(rawValue).slice(0, 200),
        strength,
        reason
      });
    }
  }
  return signals;
}

const HOSTING_PROVIDERS = [
  { name: 'Amazon AWS', re: /\b(amazon|aws)\b/i },
  { name: 'Google Cloud', re: /\b(google cloud|google llc)\b/i },
  { name: 'Microsoft Azure', re: /\b(microsoft|azure)\b/i },
  { name: 'Oracle Cloud', re: /\b(oracle cloud|oracle corporation)\b/i },
  { name: 'Cloudflare', re: /\bcloudflare\b/i },
  { name: 'DigitalOcean', re: /\bdigitalocean\b/i },
  { name: 'Linode / Akamai', re: /\b(linode|akamai)\b/i },
  { name: 'Vultr', re: /\bvultr\b/i },
  { name: 'Hetzner', re: /\bhetzner\b/i },
  { name: 'OVH', re: /\bovh\b/i },
  { name: 'Scaleway', re: /\bscaleway\b/i },
  { name: 'Contabo', re: /\bcontabo\b/i },
  { name: 'Leaseweb', re: /\bleaseweb\b/i },
  { name: 'M247', re: /\bm247\b/i },
  { name: 'Choopa / Vultr', re: /\bchoopa\b/i },
  { name: 'Psychz Networks', re: /\bpsychz\b/i },
  { name: 'QuadraNet', re: /\bquadranet\b/i },
  { name: 'ColoCrossing', re: /\bcolocrossing\b/i },
  { name: 'Mullvad VPN', re: /\bmullvad\b/i },
  { name: 'NordVPN', re: /\bnordvpn\b/i },
  { name: 'ExpressVPN', re: /\bexpressvpn\b/i },
  { name: 'Surfshark', re: /\bsurfshark\b/i },
  { name: 'CyberGhost', re: /\bcyberghost\b/i },
  { name: 'Private Internet Access', re: /\bprivate internet access\b/i },
  { name: 'Proton VPN', re: /\bproton\s*vpn\b/i },
  { name: 'Windscribe', re: /\bwindscribe\b/i },
  { name: 'IPVanish', re: /\bipvanish\b/i },
  { name: 'TorGuard', re: /\btorguard\b/i },
  { name: 'PureVPN', re: /\bpurevpn\b/i }
];

const HOSTING_GENERIC = [
  { re: /\b(hosting|datacenter|data center|colocation|colo|vps|virtual server|dedicated server)\b/i, label: 'Hosting or datacenter keyword in ASN/PTR', score: 25 },
  { re: /\b(cloud|server)\b/i, label: 'Cloud/server keyword in ASN/PTR', score: 15 },
  { re: /\b(vpn|proxy|privacy|anonymous|tor exit|tor relay)\b/i, label: 'VPN, proxy or privacy keyword in ASN/PTR', score: 35 }
];

const HOSTNAME_PATTERNS = [
  { re: /\b(vpn|proxy|tor|exit|relay|anonym)\b/i, label: 'VPN, proxy, Tor or anonymity keyword in PTR', score: 35 },
  { re: /\b(host|hosting|server|vps|dedicated|cloud|datacenter|data-center|colo)\b/i, label: 'Hosting/server keyword in PTR', score: 20 },
  { re: /(amazonaws|cloudfront|googleusercontent|azure|digitalocean|linode|vultr|hetzner|ovh|contabo|scaleway|leaseweb|m247|choopa|psychz|quadranet|colocrossing)/i, label: 'Known provider name in PTR', score: 35 }
];

function hostingSignals(geo, hostname) {
  const organization = (geo && geo.asnOrganization) || '';
  const text = (organization + ' ' + hostname).toLowerCase();
  const providers = [];
  const reasons = [];
  let score = 0;

  for (const provider of HOSTING_PROVIDERS) {
    if (provider.re.test(text)) {
      providers.push(provider.name);
      score += 40;
      reasons.push('ASN or PTR matches ' + provider.name);
    }
  }
  for (const generic of HOSTING_GENERIC) {
    if (generic.re.test(text)) {
      score += generic.score;
      reasons.push(generic.label);
    }
  }

  return {
    score: Math.min(100, score),
    likely: score >= 30,
    providers: [...new Set(providers)],
    reasons: [...new Set(reasons)],
    organization,
    asn: (geo && geo.asn) || null
  };
}

function hostnameSignals(hostname) {
  if (!hostname) {
    return { score: 0, matches: [], reasons: ['No PTR record for this address'] };
  }

  const matches = [];
  const reasons = [];
  let score = 0;
  for (const pattern of HOSTNAME_PATTERNS) {
    if (pattern.re.test(hostname)) {
      score += pattern.score;
      matches.push(hostname);
      reasons.push(pattern.label);
    }
  }
  return {
    score: Math.min(100, score),
    matches: [...new Set(matches)],
    reasons: [...new Set(reasons)]
  };
}

const TOR_LIST_URL = 'https://check.torproject.org/torbulkexitlist';
const TOR_CACHE_MS = 60 * 60 * 1000;
// After a failed download, stop retrying for a while. Without this every
// /api/anonymity request would wait for the 8s external timeout when the list
// is unreachable.
const TOR_RETRY_MS = 2 * 60 * 1000;
let torCache = { set: null, fetchedAt: 0, loading: null, nextAttemptAt: 0 };

function fetchText(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'OrbitNet/1.0 (+https://orbitnet.ru)' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        try {
          resolve(fetchText(new URL(res.headers.location, url).href, timeout));
        } catch (e) {
          reject(e);
        }
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 5000000) body += chunk;
      });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function torExitSet() {
  const now = Date.now();
  if (torCache.set && now - torCache.fetchedAt < TOR_CACHE_MS) return torCache.set;
  if (torCache.loading) return torCache.loading;
  // Negative cache: return the previous list (or null) immediately instead of
  // hammering the external service on every request.
  if (now < torCache.nextAttemptAt) return torCache.set;

  torCache.loading = (async () => {
    try {
      const text = await fetchText(TOR_LIST_URL, 8000);
      const set = new Set(
        text.split(/\s+/).map(normalizeIp).filter(ip => net.isIP(ip))
      );
      if (!set.size) throw new Error('empty Tor exit list');
      torCache = { set, fetchedAt: Date.now(), loading: null, nextAttemptAt: 0 };
      return set;
    } catch (e) {
      torCache.loading = null;
      torCache.nextAttemptAt = Date.now() + TOR_RETRY_MS;
      return torCache.set;
    }
  })();

  return torCache.loading;
}

async function torStatus(ip) {
  const set = await torExitSet();
  if (!set) return { available: false, listed: null, error: 'Tor exit list unavailable' };
  return {
    available: true,
    listed: set.has(normalizeIp(ip)),
    updatedAt: new Date(torCache.fetchedAt).toISOString()
  };
}

async function anonymityInfo(req) {
  const ip = clientIp(req);
  const version = net.isIPv6(ip) ? 6 : 4;
  const [hostname, geo] = await Promise.all([
    withTimeout(dns.reverse(ip), DNS_TIMEOUT, 'timeout')
      .then(names => (names && names[0]) || '')
      .catch(() => ''),
    geoLookup(ip)
  ]);
  let tor;
  try {
    tor = await withTimeout(torStatus(ip), 9000, 'timeout');
  } catch (e) {
    tor = { available: false, listed: null, error: 'Tor exit list unavailable' };
  }

  return {
    ip,
    version,
    hostname,
    geo,
    tor,
    proxyHeaders: proxyHeaderSignals(req),
    hosting: hostingSignals(geo, hostname),
    hostnameSignals: hostnameSignals(hostname),
    checkedAt: new Date().toISOString()
  };
}

// Active checks are deliberately limited to the visitor's own public IP.
const ANONYMITY_PORT_GROUPS = {
  httpProxy: [3128, 8080, 8000, 8118, 8888, 8889, 8123],
  webProxy: [80, 443, 8080, 8443, 3128],
  vpn: [1194, 1723, 443, 4443, 51820]
};

async function anonymityPorts(ip) {
  const uniquePorts = [...new Set(Object.values(ANONYMITY_PORT_GROUPS).flat())];
  const checks = await Promise.all(uniquePorts.map(port =>
    outbound(() => checkPort(ip, port, 1800))
  ));
  const byPort = new Map(checks.map(item => [item.port, item]));

  const groups = {};
  for (const [name, ports] of Object.entries(ANONYMITY_PORT_GROUPS)) {
    groups[name] = ports.map(port => byPort.get(port));
  }

  return {
    ip,
    ports: checks,
    groups,
    note: 'TCP only. UDP services (including WireGuard and most IPsec VPNs) cannot be detected this way.'
  };
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
    if (queue.length >= maxQueue) {
      const error = httpError(503, 'Server busy, try again later');
      error.busy = true;
      reject(error);
      return;
    }
    queue.push({ fn, resolve, reject });
    next();
  });
}
const outbound = createLimiter(MAX_CONCURRENT, MAX_QUEUE);
const dnsbl = createLimiter(DNSBL_MAX_CONCURRENT, DNSBL_MAX_QUEUE);
// A deep scan costs 16 handshakes. Cap how many scans run at once across the
// whole process so one client cannot fill the shared outbound queue.
const TLS_DEEP_GLOBAL_MAX = positiveIntEnv('TLS_DEEP_GLOBAL_MAX', 2);
const tlsDeepGate = createLimiter(TLS_DEEP_GLOBAL_MAX, 8);

const rateHits = new Map();
const portHits = new Map();
const tlsDeepHits = new Map();
const securityHits = new Map();
const PORT_RATE_MAX = 3;
const TLS_DEEP_RATE_MAX = 8;
const SECURITY_RATE_MAX = 10;
let lastRatePrune = Date.now();
function isRateLimited(ip, store = rateHits, max = RATE_MAX) {
  const now = Date.now();
  if (now - lastRatePrune > RATE_WINDOW_MS) {
    for (const map of [rateHits, portHits, tlsDeepHits, securityHits, spamHits]) {
      for (const [key, rec] of map) {
        if (now - rec.start > RATE_WINDOW_MS) map.delete(key);
      }
    }
    lastRatePrune = now;
  }
  if (store.size > RATE_MAX_ENTRIES) {
    for (const [key, rec] of store) {
      if (now - rec.start > RATE_WINDOW_MS) store.delete(key);
    }
  }
  let rec = store.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    // Keep the table bounded: once it is full of active clients, shed new ones
    // instead of wiping every counter at once.
    if (!rec && store.size >= RATE_MAX_ENTRIES) return true;
    rec = { start: now, count: 0 };
    store.set(ip, rec);
  }
  rec.count++;
  return rec.count > max;
}

// Separate rolling-window limit for Cloudflare Worker calls. A single client
// can trigger at most EXTERNAL_RATE_MAX fallbacks per minute, and the process
// as a whole at most EXTERNAL_GLOBAL_MAX. Without this a DNS-blocked site can
// burn the Worker's free-plan quota with nonexistent names.
const externalHits = new Map();
let externalGlobal = { start: Date.now(), count: 0 };
const externalNxHits = new Map();
let externalNxGlobal = { start: Date.now(), count: 0 };
let lastExternalPrune = Date.now();

function takeExternalToken(clientIp, nxdomain = false) {
  const key = clientIp || 'unknown';
  const now = Date.now();
  if (now - lastExternalPrune > RATE_WINDOW_MS) {
    for (const [itemKey, rec] of externalHits) {
      if (now - rec.start > RATE_WINDOW_MS) externalHits.delete(itemKey);
    }
    for (const [itemKey, rec] of externalNxHits) {
      if (now - rec.start > RATE_WINDOW_MS) externalNxHits.delete(itemKey);
    }
    lastExternalPrune = now;
  }

  if (nxdomain) {
    if (now - externalNxGlobal.start > RATE_WINDOW_MS) {
      externalNxGlobal = { start: now, count: 0 };
    }
    if (externalNxGlobal.count >= EXTERNAL_NXDOMAIN_GLOBAL_MAX) return false;

    let rec = externalNxHits.get(key);
    if (!rec || now - rec.start > RATE_WINDOW_MS) {
      if (!rec && externalNxHits.size >= RATE_MAX_ENTRIES) return false;
      rec = { start: now, count: 0 };
      externalNxHits.set(key, rec);
    }
    if (rec.count >= EXTERNAL_NXDOMAIN_RATE_MAX) return false;
    rec.count++;
    externalNxGlobal.count++;
    return true;
  }

  if (now - externalGlobal.start > RATE_WINDOW_MS) {
    externalGlobal = { start: now, count: 0 };
  }
  if (externalGlobal.count >= EXTERNAL_GLOBAL_MAX) return false;

  let rec = externalHits.get(key);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    if (!rec && externalHits.size >= RATE_MAX_ENTRIES) return false;
    rec = { start: now, count: 0 };
    externalHits.set(key, rec);
  }
  if (rec.count >= EXTERNAL_RATE_MAX) return false;
  rec.count++;
  externalGlobal.count++;
  return true;
}

let lastExternalLog = { message: '', at: 0 };
function logExternalFailure(message) {
  const text = String(message || 'unknown error');
  const now = Date.now();
  if (text === lastExternalLog.message && now - lastExternalLog.at < RATE_WINDOW_MS) return;
  lastExternalLog = { message: text, at: now };
  console.warn('[external-check] ' + text);
}

// The Worker receives only what is left of the request budget, not a fixed
// 20 seconds. If less than a second is left, skip it: the client would get a
// proxy timeout before the Worker finished anyway.
function externalCallOptions(context, options) {
  if (!externalCheck.isConfigured()) return null;
  const opts = {};
  if (context && context.deadline) {
    const remaining = context.deadline - Date.now();
    if (remaining < 1000) return null;
    opts.timeoutMs = remaining;
  }
  const nxdomain = Boolean(options && options.nxdomain);
  if (!takeExternalToken(context && context.clientIp, nxdomain)) return null;
  return opts;
}

async function callExternal(build, context, options) {
  const opts = externalCallOptions(context, options);
  if (!opts) {
    metrics.external.limited++;
    return { error: EXTERNAL_UNAVAILABLE, unavailable: true, limited: true };
  }

  const started = Date.now();
  metrics.external.attempts++;
  try {
    const result = await outbound(() => build(opts));
    metrics.external.totalMs += Date.now() - started;
    if (result && result.error) {
      metrics.external.failures++;
      if (result.timeout) metrics.external.timeouts++;
    } else {
      metrics.external.successes++;
    }
    return result;
  } catch (e) {
    metrics.external.failures++;
    return {
      error: EXTERNAL_UNAVAILABLE,
      unavailable: true,
      busy: e && e.busy === true
    };
  }
}

// Successful Worker answers are cached briefly. NXDOMAIN/NODATA results from
// a poisoned local resolver are stable for a while, and caching them stops the
// same blocked domain from consuming every fallback token on each page refresh.
const EXTERNAL_CACHE_TTL = 60000;
const EXTERNAL_CACHE_MAX = 2000;
const externalCache = new Map();

function externalCacheKey(prefix, host, type) {
  return prefix + ':' + String(host || '').toLowerCase() + ':' + String(type || '').toLowerCase();
}

function getExternalCache(key) {
  const record = externalCache.get(key);
  if (!record) return null;
  if (Date.now() > record.expires) {
    externalCache.delete(key);
    return null;
  }
  return record.value;
}

function setExternalCache(key, value) {
  if (externalCache.size >= EXTERNAL_CACHE_MAX) {
    const oldest = externalCache.keys().next().value;
    if (oldest !== undefined) externalCache.delete(oldest);
  }
  externalCache.set(key, { value, expires: Date.now() + EXTERNAL_CACHE_TTL });
}

function requestContext(ip) {
  return { clientIp: ip, deadline: Date.now() + REQUEST_BUDGET_MS };
}

function externalFailure(local, error) {
  logExternalFailure(error);
  return Object.assign(local, { source: 'local', workerError: EXTERNAL_UNAVAILABLE });
}

// ---------- captcha ----------
// A self-contained numeric captcha. The answer never leaves the server: the
// client only receives an image and an opaque id. Answers are single-use,
// expire after five minutes and are tied to the requesting IP.
const CAPTCHA_TTL = 5 * 60 * 1000;
const CAPTCHA_MAX_ENTRIES = 5000;
const captchas = new Map();
let lastCaptchaPrune = Date.now();

// Every third port check requires a captcha. The counter only advances after
// a check is allowed to run, so a failed captcha cannot be used to skip it.
const portAttempts = new Map();
const PORT_ATTEMPT_EVERY = 3;
const PORT_ATTEMPT_TTL = 60 * 60 * 1000;

function getPortAttempt(ip) {
  const now = Date.now();
  if (portAttempts.size > 10000) {
    for (const [key, rec] of portAttempts) {
      if (now - rec.updated > PORT_ATTEMPT_TTL) portAttempts.delete(key);
    }
    if (portAttempts.size > 10000) {
      const oldest = portAttempts.keys().next().value;
      if (oldest) portAttempts.delete(oldest);
    }
  }
  let rec = portAttempts.get(ip);
  if (!rec || now - rec.updated > PORT_ATTEMPT_TTL) {
    rec = { count: 0, updated: now };
    portAttempts.set(ip, rec);
  }
  return rec;
}


const SEGMENT_LINES = {
  a: [4, 2, 20, 2],
  b: [21, 3, 21, 19],
  c: [21, 21, 21, 37],
  d: [4, 38, 20, 38],
  e: [3, 21, 3, 37],
  f: [3, 3, 3, 19],
  g: [4, 20, 20, 20]
};
const DIGIT_SEGMENTS = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'],
  1: ['b', 'c'],
  2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'],
  4: ['f', 'g', 'b', 'c'],
  5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'],
  7: ['a', 'b', 'c'],
  8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  9: ['a', 'b', 'c', 'd', 'f', 'g']
};

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    crc ^= buf[n];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function drawPixel(buf, width, height, x, y, color, alpha) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 3;
  const a = alpha == null ? 1 : alpha;
  buf[i] = Math.round(buf[i] * (1 - a) + color[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + color[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + color[2] * a);
}

function drawLine(buf, width, height, x1, y1, x2, y2, color, thickness, alpha) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const radius = thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          drawPixel(buf, width, height, cx + dx, cy + dy, color, alpha);
        }
      }
    }
  }
}

function captchaPng(digits) {
  const width = 320;
  const height = 112;
  const bg = [28, 28, 33];
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = bg[0];
    buf[i * 3 + 1] = bg[1];
    buf[i * 3 + 2] = bg[2];
  }

  for (let i = 0; i < 14; i++) {
    drawLine(buf, width, height,
      Math.random() * width, Math.random() * height,
      Math.random() * width, Math.random() * height,
      [60, 90, 75], 1.5, 0.35);
  }
  for (let i = 0; i < 90; i++) {
    drawPixel(buf, width, height,
      Math.random() * width, Math.random() * height,
      [80, 80, 95], Math.random() * 0.5 + 0.15);
  }

  const colors = [
    [232, 232, 234], [232, 232, 234], [232, 232, 234],
    [110, 207, 160], [245, 198, 107], [138, 180, 248]
  ];
  const jitter = (amount) => (Math.random() * 2 - 1) * amount;

  for (let i = 0; i < digits.length; i++) {
    const ox = 32 + i * 68;
    const oy = 16 + jitter(4);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const thickness = 6 + Math.random() * 2;
    for (const name of DIGIT_SEGMENTS[digits[i]]) {
      const [x1, y1, x2, y2] = SEGMENT_LINES[name];
      drawLine(buf, width, height,
        ox + x1 * 2 + jitter(2), oy + y1 * 2 + jitter(2),
        ox + x2 * 2 + jitter(2), oy + y2 * 2 + jitter(2),
        color, thickness, 1);
    }
  }

  // Strike-through lines, the classic cheap anti-OCR trick.
  drawLine(buf, width, height,
    8 + Math.random() * 18, 10 + Math.random() * 24,
    width - 8 - Math.random() * 18, height - 10 - Math.random() * 24,
    [180, 90, 90], 4 + Math.random() * 2, 0.75);
  drawLine(buf, width, height,
    8 + Math.random() * 18, height - 10 - Math.random() * 24,
    width - 8 - Math.random() * 18, 10 + Math.random() * 24,
    [95, 135, 110], 3 + Math.random() * 2, 0.65);

  return encodePng(width, height, buf);
}

function createCaptcha(ip) {
  const now = Date.now();
  if (now - lastCaptchaPrune > 60000 || captchas.size >= CAPTCHA_MAX_ENTRIES) {
    for (const [key, rec] of captchas) {
      if (rec.expires <= now) captchas.delete(key);
    }
    lastCaptchaPrune = now;
  }
  if (captchas.size >= CAPTCHA_MAX_ENTRIES) {
    const oldest = captchas.keys().next().value;
    if (oldest) captchas.delete(oldest);
  }

  const answer = String(crypto.randomInt(1000, 10000));
  const id = crypto.randomBytes(16).toString('hex');
  captchas.set(id, { answer, ip, expires: now + CAPTCHA_TTL });
  const png = captchaPng(answer);

  return {
    id,
    image: 'data:image/png;base64,' + png.toString('base64'),
    expiresIn: CAPTCHA_TTL
  };
}

function verifyCaptcha(id, answer, ip) {
  if (!/^[a-f0-9]{32}$/.test(id || '')) return false;
  const rec = captchas.get(id);
  if (!rec) return false;
  captchas.delete(id);
  if (rec.expires <= Date.now()) return false;
  if (rec.ip !== ip) return false;
  return rec.answer === String(answer || '');
}

// ---------- validation ----------
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
function isValidHost(host) {
  return typeof host === 'string' && host.length <= 253 && HOSTNAME_RE.test(host);
}

// Public-suffix aware helpers. DNSBLs and CAA expect a registrable domain, not
// an arbitrary subdomain or a public suffix such as co.uk.
function registrableDomain(host) {
  const value = String(host || '').toLowerCase();
  if (!value || net.isIP(value)) return '';
  return getDomain(value, { allowPrivateDomains: false }) || '';
}

function domainSuffixes(host) {
  const value = String(host || '').toLowerCase().replace(/\.$/, '');
  const labels = value.split('.').filter(Boolean);
  const registrable = registrableDomain(value);
  if (!registrable) return labels.length ? [value] : [];
  const regLabels = registrable.split('.');
  const count = labels.length - regLabels.length + 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = labels.slice(i).join('.');
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
const DNS_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'PTR']);
const PROPAGATION_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA']);
const DNSSEC_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA']);
// Returns the upper-cased record type when it is supported, or null so the
// caller can answer 400 instead of silently falling back to A.
function parseType(t, allowed = DNS_TYPES) {
  const type = String(t || 'A').trim().toUpperCase();
  return allowed.has(type) ? type : null;
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
    throw new Error('Unsupported record type: ' + type);
  } catch (e) {
    const error = new Error(e.code === 'ENODATA'
      ? 'No records found for ' + type
      : (e.code || 'ERROR') + ': ' + e.message);
    error.code = e.code || 'ERROR';
    throw error;
  }
}

// ---------- /api/dnssec ----------
// DNSSEC always goes through the Worker: the local Unbound instance is used
// for DNSBL queries and is not treated as a validating resolver.
async function dnssecInfo(host, type, context) {
  const cacheKey = externalCacheKey('dnssec', host, type);
  let external = getExternalCache(cacheKey);
  if (!external) {
    external = await callExternal(
      opts => externalCheck.checkDnssec(host, type, opts),
      context
    );
    if (!external.error) setExternalCache(cacheKey, external);
  }
  if (external.error) {
    logExternalFailure(external.error);
    throw httpError(external.unavailable ? 503 : 502, external.error);
  }
  return external;
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

// Finds the next whois server to query. Registry responses point at the
// registrar (thin registries such as .com) and IANA points at the registry,
// so this is followed until the most detailed record is reached.
function whoisReferral(text) {
  const patterns = [
    /^Registrar WHOIS Server:\s*(\S+)/im,
    /^ReferralServer:\s*whois:\/\/([^\s/]+)/im,
    /^whois:\s*(\S+)/im,
    /^refer:\s*(\S+)/im
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/^whois:\/\//i, '').replace(/[/:].*$/, '').trim();
  }
  return null;
}

async function whoisLookup(host) {
  const tld = host.split('.').pop().toLowerCase();
  let server = WHOIS_SERVERS[tld] || 'whois.iana.org';
  let text;
  try {
    text = await queryWhois(host, server, 43);
  } catch (e) {
    return queryWhois(host, 'whois.iana.org', 43);
  }

  const seen = new Set([server]);
  for (let hop = 0; hop < 3; hop++) {
    const next = whoisReferral(text);
    if (!next || seen.has(next)) break;
    seen.add(next);
    try {
      // The referral host is taken from the response body, so treat it as
      // untrusted: resolve it and require every address to be public before
      // connecting, exactly like the other outbound endpoints (SSRF guard).
      const ips = await resolvePublic(next);
      const ip = pickAddress(ips);
      const more = await queryWhois(host, ip, 43);
      if (!more) break;
      text += '\n\n--- ' + next + ' ---\n\n' + more;
      server = next;
    } catch (e) {
      break;
    }
  }
  return text;
}

// ---------- /api/site ----------
// Connects to the pre-resolved public IP, keeps the original Host/SNI, verifies TLS.
function charsetFromContentType(value) {
  const match = String(value || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function decodeHtml(bytes, contentType) {
  const head = bytes.toString('latin1', 0, Math.min(bytes.length, 2048));
  const meta = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i);
  const httpEquiv = head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_-]+)/i);
  const label = charsetFromContentType(contentType) ||
    (meta && meta[1]) || (httpEquiv && httpEquiv[1]) || 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch (e) {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function fetchOnce(ip, host, path, secure, timeout) {
  return new Promise((resolve) => {
    const lib = secure ? https : http;
    const start = Date.now();
    const limit = timeout || OUTBOUND_TIMEOUT;
    let settled = false;
    let req;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const options = {
      hostname: ip,
      path: path || '/',
      method: 'GET',
      headers: {
        'Host': host,
        'User-Agent': 'OrbitNet/1.0 (+https://orbitnet.ru)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: limit
    };
    if (secure) {
      options.servername = host;
      options.checkServerIdentity = (servername, cert) => tls.checkServerIdentity(host, cert);
    }

    // Hard deadline: the socket timeout above only fires on inactivity, so a
    // server that dribbles one byte every few seconds would otherwise hold a
    // limiter slot forever.
    timer = setTimeout(() => {
      if (req) req.destroy();
      finish({ error: 'timeout', ms: Date.now() - start });
    }, limit);

    req = lib.request(options, (res) => {
      const status = res.statusCode;
      const headers = res.headers;
      if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
        res.resume();
        finish({ status, redirect: safeRedirect(headers.location), ms: Date.now() - start, headers });
        // Do not wait for the redirect body to drain: close the socket now.
        req.destroy();
        return;
      }
      const chunks = [];
      let total = 0;
      const buildResult = () => {
        const bytes = Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES);
        const body = decodeHtml(bytes, headers['content-type']);
        const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
        return {
          status,
          ms: Date.now() - start,
          server: headers['server'] || '',
          contentType: headers['content-type'] || '',
          title,
          headers,
          body,
          finalUrl: (secure ? 'https://' : 'http://') + host + path
        };
      };
      res.on('data', (chunk) => {
        if (total >= MAX_BODY_BYTES) return;
        const remaining = MAX_BODY_BYTES - total;
        if (chunk.length > remaining) {
          chunks.push(chunk.subarray(0, remaining));
          total += remaining;
          finish(buildResult());
          req.destroy();
          return;
        }
        chunks.push(chunk);
        total += chunk.length;
      });
      res.on('end', () => finish(buildResult()));
      res.on('error', (e) => finish({ error: e.message, ms: Date.now() - start }));
    });
    req.on('timeout', () => { req.destroy(); finish({ error: 'timeout', ms: Date.now() - start }); });
    req.on('error', (e) => finish({ error: e.message, ms: Date.now() - start }));
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

// Provider block pages often return 200 or a redirect. A few common titles are
// enough to trigger the fallback without treating every page with the word
// "blocked" as censorship.
const BLOCK_PAGE_MARKERS = [
  'доступ ограничен',
  'доступ к сайту ограничен',
  'доступ к запрашиваемому ресурсу ограничен',
  'сайт заблокирован',
  'blocked by the administrator',
  'blocked by administrator',
  'blocked by your administrator',
  'web page blocked',
  'website blocked',
  'this site has been blocked',
  'access to this site has been blocked'
];
function looksLikeBlockPage(title) {
  const text = String(title || '').toLowerCase();
  return BLOCK_PAGE_MARKERS.some(marker => text.includes(marker));
}

async function siteInfoLocal(host) {
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
    finalUrl: result.finalUrl || '',
    error: result.error || null,
    blockedPage: looksLikeBlockPage(result.title)
  };
}

function localErrorResult(host, error, extra) {
  return Object.assign({
    host,
    ip: null,
    protocol: 'https',
    status: null,
    responseMs: null,
    server: '',
    title: '',
    redirect: '',
    finalUrl: '',
    error: error && error.message ? error.message : 'local check failed',
    blocked: Boolean(error && error.blocked),
    busy: Boolean(error && error.busy),
    source: 'local'
  }, extra || {});
}

// The worker result replaces a local one only when the local check has no
// status or when the worker turns a likely block (403/451) into a real answer.
function externalImproves(local, external) {
  if (!external || external.error) return false;
  if (local && local.blockedPage) return !looksLikeBlockPage(external.title);
  if (!local || !local.status) return true;
  return local.status >= 400 && external.status < 400;
}

// Local first. The external worker is contacted when the local check did not
// get any HTTP status (DNS/TCP/TLS/timeout) or returned 403/451, never for
// ordinary 2xx/3xx/5xx answers, and never for targets rejected by the SSRF guard.
async function siteInfo(host, context) {
  let local;
  try {
    local = await siteInfoLocal(host);
  } catch (e) {
    local = localErrorResult(host, e);
  }

  if (!externalCheck.shouldUseExternal(local)) {
    delete local.blocked;
    return Object.assign(local, { source: 'local' });
  }

  const external = await callExternal(
    opts => externalCheck.checkHttp(host, { follow: false, timeoutMs: opts.timeoutMs }),
    context
  );
  if (externalImproves(local, external)) {
    return {
      host,
      ip: null,
      protocol: external.protocol,
      status: external.status,
      responseMs: external.responseMs,
      server: external.server,
      title: external.title,
      redirect: external.redirect,
      finalUrl: external.finalUrl,
      error: null,
      blockedPage: looksLikeBlockPage(external.title),
      source: 'worker',
      localStatus: local.status || null,
      localError: local.error || null
    };
  }

  if (external.error) return externalFailure(local, external.error);
  delete local.blocked;
  return Object.assign(local, { source: 'local' });
}

// ---------- /api/headers ----------
async function headersInfoLocal(host) {
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
    finalUrl: result.finalUrl || '',
    error: result.error || null
  };
}

async function headersInfo(host, context) {
  let local;
  try {
    local = await headersInfoLocal(host);
  } catch (e) {
    local = localErrorResult(host, e, { headers: [] });
  }

  if (!externalCheck.shouldUseExternal(local)) {
    delete local.blocked;
    return Object.assign(local, { source: 'local' });
  }

  const external = await callExternal(
    opts => externalCheck.checkHttp(host, { follow: false, timeoutMs: opts.timeoutMs }),
    context
  );
  if (externalImproves(local, external)) {
    return {
      host,
      ip: null,
      protocol: external.protocol,
      status: external.status,
      responseMs: external.responseMs,
      headers: external.headers,
      redirect: external.redirect,
      finalUrl: external.finalUrl,
      error: null,
      source: 'worker',
      localStatus: local.status || null,
      localError: local.error || null
    };
  }

  if (external.error) return externalFailure(local, external.error);
  delete local.blocked;
  return Object.assign(local, { source: 'local' });
}

// ---------- /api/tls ----------
// Deliberately connects with rejectUnauthorized:false so invalid/expired
// certificates can still be inspected; validity is then reported explicitly.
const TLS_PROBE_TIMEOUT = 5000;
// A blocked address often blackholes TCP, so several resolved addresses are
// attempted in parallel. The first successful handshake wins.
const TLS_ATTEMPT_TIMEOUT = 6000;
const TLS_ATTEMPT_LIMIT = 6;
// Protocol versions and a curated cipher slate probed one handshake each.
// "TLSv1" is how Node names TLS 1.0.
const TLS_VERSION_PROBES = ['TLSv1.3', 'TLSv1.2', 'TLSv1.1', 'TLSv1'];
const TLS_CIPHER_PROBES = [
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'DES-CBC3-SHA',
  'RC4-SHA'
].map(name => {
  const strength = classifyCipher(name).strength;
  return { name, strength, weak: strength === 'weak' };
});

function parseSubjectAltName(value) {
  if (!value) return [];
  return String(value).split(',').map(part => part.trim()).filter(Boolean).map(entry => {
    const idx = entry.indexOf(':');
    if (idx === -1) return { type: 'DNS', value: entry };
    return { type: entry.slice(0, idx).toUpperCase(), value: entry.slice(idx + 1) };
  }).filter(e => e.value);
}

function classifyCipher(name) {
  const cipher = String(name || '').toUpperCase();
  const unsafe = /RC4|3DES|DES-CBC3|(^|[^A-Z])DES[^A-Z]|NULL|EXPORT|ANON/.test(cipher);
  const notes = [];
  if (/RC4/.test(cipher)) notes.push('RC4 is cryptographically broken');
  if (/3DES|DES-CBC3/.test(cipher)) notes.push('3DES is deprecated');
  else if (/(^|[^A-Z])DES[^A-Z]/.test(cipher)) notes.push('single DES is unsafe');
  if (/NULL|EXPORT|ANON/.test(cipher)) notes.push('no or anonymous encryption');
  if (/\bMD5\b/.test(cipher)) notes.push('MD5 integrity check');
  if (unsafe) return { strength: 'weak', notes };
  if (/CBC/.test(cipher)) return { strength: 'legacy', notes: ['CBC mode is legacy; prefer an AEAD suite'] };
  if (/GCM|CHACHA20|POLY1305/.test(cipher)) return { strength: 'strong', notes: [] };
  return { strength: 'legacy', notes: [] };
}

function summarizeTlsVersions(versions) {
  const list = versions || [];
  const supported = list.filter(v => v.supported === true).map(v => v.version);
  const unknown = list.filter(v => v.supported === null).map(v => v.version);
  const weak = supported.filter(v => v === 'TLSv1' || v === 'TLSv1.1');
  const issues = [];
  if (!supported.includes('TLSv1.3')) issues.push('TLS 1.3 is not enabled');
  if (weak.length) issues.push('Deprecated ' + weak.join(', ') + ' still accepted');
  return { supported, unknown, weak, issues };
}

const DAY_MS = 86400000;
// CA/Browser Forum TLS Baseline Requirements, ballot SC-081v3. The limit is
// selected from the certificate's notBefore date because shorter limits apply
// only to certificates issued on or after each phase's effective date.
const TLS_VALIDITY_SCHEDULE = [
  { from: 0, maxDays: 398, rule: 'CA/B Forum Baseline Requirements (398 days)' },
  { from: Date.parse('2026-03-15T00:00:00Z'), maxDays: 200, rule: 'CA/B Forum SC-081 phase 1 (200 days)' },
  { from: Date.parse('2027-03-15T00:00:00Z'), maxDays: 100, rule: 'CA/B Forum SC-081 phase 2 (100 days)' },
  { from: Date.parse('2029-03-15T00:00:00Z'), maxDays: 47, rule: 'CA/B Forum SC-081 phase 3 (47 days)' }
];

function parseCertificateDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validityLimitFor(notBefore) {
  const date = parseCertificateDate(notBefore);
  const time = date ? date.getTime() : 0;
  let selected = TLS_VALIDITY_SCHEDULE[0];
  for (const entry of TLS_VALIDITY_SCHEDULE) {
    if (time >= entry.from) selected = entry;
  }
  return { maxDays: selected.maxDays, rule: selected.rule };
}

function certificateValidityInfo(cert, now, options) {
  const parsedNow = now == null ? null : (now instanceof Date ? now : parseCertificateDate(now));
  const numericNow = Number(now);
  const current = parsedNow ? parsedNow.getTime()
    : (now == null ? Date.now() : (Number.isFinite(numericNow) ? numericNow : Date.now()));
  const from = parseCertificateDate(cert && (cert.valid_from || cert.validFrom));
  const to = parseCertificateDate(cert && (cert.valid_to || cert.validTo));
  const daysRemaining = to == null ? null : Math.floor((to.getTime() - current) / DAY_MS);
  const validityDays = from && to ? Math.round((to.getTime() - from.getTime()) / DAY_MS) : null;
  const limit = validityLimitFor(from);
  const exceeds398Days = validityDays != null && validityDays > 398;
  // CA/B Forum limits only apply to publicly trusted chains. Corporate and
  // private CAs are not bound by them, so an untrusted chain must not produce
  // a validity warning.
  const limitApplies = !options || options.trusted !== false;
  const validityTooLong = limitApplies && validityDays != null && validityDays > limit.maxDays;

  let expiryStatus = 'unknown';
  let message = 'Certificate dates are unavailable';
  if (to != null && daysRemaining != null) {
    if (daysRemaining < 0) {
      expiryStatus = 'expired';
      message = 'Certificate expired ' + Math.abs(daysRemaining) + ' day(s) ago';
    } else if (daysRemaining < 14) {
      expiryStatus = 'error';
      message = 'Certificate expires in ' + daysRemaining + ' day(s)';
    } else if (daysRemaining < 30) {
      expiryStatus = 'warning';
      message = 'Certificate expires in ' + daysRemaining + ' day(s)';
    } else {
      expiryStatus = 'ok';
      message = 'Certificate expires in ' + daysRemaining + ' day(s)';
    }
  }
  if (validityTooLong) {
    message += '; validity of ' + validityDays + ' days exceeds the current limit of ' +
      limit.maxDays + ' days (' + limit.rule + ')';
  }

  return {
    daysRemaining,
    validityDays,
    expiryStatus,
    status: expiryStatus,
    message,
    maxValidityDays: limit.maxDays,
    validityRule: limit.rule,
    validityTooLong,
    exceeds398Days,
    valid_from: from ? from.toISOString() : '',
    valid_to: to ? to.toISOString() : ''
  };
}

const WEAK_EC_CURVES = new Set([
  'secp192r1', 'prime192v1', 'secp224r1',
  'secp192k1', 'secp224k1',
  'sect163k1', 'sect163r1', 'sect163r2', 'sect193r1', 'sect193r2',
  'sect233k1', 'sect233r1', 'sect239k1', 'sect283k1', 'sect283r1',
  'sect409k1', 'sect409r1', 'sect571k1', 'sect571r1'
]);
const EC_CURVE_BITS = {
  prime256v1: 256, secp256r1: 256, secp384r1: 384, secp521r1: 521,
  secp192r1: 192, prime192v1: 192, secp224r1: 224, secp256k1: 256
};

function evaluatePublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'object') {
    return { type: 'unknown', bits: null, curve: '', weak: false, reason: 'Public key is unavailable' };
  }
  const type = String(publicKey.asymmetricKeyType || 'unknown').toLowerCase();
  const details = publicKey.asymmetricKeyDetails || {};
  let bits = null;
  let curve = '';
  let weak = false;
  let reason = '';

  if (type === 'rsa' || type === 'rsa-pss') {
    bits = Number(details.modulusLength) || null;
    if (bits != null && bits < 2048) {
      weak = true;
      reason = 'RSA key is only ' + bits + ' bits; at least 2048 bits are required';
    }
  } else if (type === 'dsa') {
    bits = Number(details.modulusLength) || null;
    if (bits != null && bits < 2048) {
      weak = true;
      reason = 'DSA key is only ' + bits + ' bits; at least 2048 bits are required';
    }
  } else if (type === 'ec') {
    curve = String(details.namedCurve || '');
    const lower = curve.toLowerCase();
    const fromName = /(\d{3})/.exec(lower);
    bits = EC_CURVE_BITS[lower] || Number(details.bits) || (fromName ? Number(fromName[1]) : null);
    if (WEAK_EC_CURVES.has(lower) || (bits != null && bits < 256)) {
      weak = true;
      reason = 'Deprecated elliptic curve' + (curve ? ' ' + curve : '') +
        (bits ? ' (' + bits + ' bits)' : '');
    }
  } else if (type === 'ed25519') {
    bits = 256;
  } else if (type === 'ed448') {
    bits = 448;
  } else if (type === 'x25519') {
    bits = 256;
  } else if (type === 'x448') {
    bits = 448;
  } else if (type && type !== 'unknown') {
    weak = false;
  }

  return {
    type,
    bits,
    size: bits,
    curve,
    weak,
    strength: weak ? 'weak' : 'ok',
    reason
  };
}

// The SCT extension is identified by this DER-encoded OID. Searching the raw
// certificate avoids trusting a parsed string and also works for old Node.
const SCT_OID_DER = Buffer.from('060a2b06010401d679020402', 'hex');
const SCT_OID_TEXT = Buffer.from('1.3.6.1.4.1.11129.2.4.2');
function hasEmbeddedSct(raw) {
  if (!raw) return { present: false, count: 0 };
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let count = 0;
  for (const needle of [SCT_OID_DER, SCT_OID_TEXT]) {
    let offset = 0;
    while ((offset = bytes.indexOf(needle, offset)) !== -1) {
      count++;
      offset += needle.length;
    }
  }
  return { present: count > 0, count };
}

// Node reports Authority Information Access as text, for example:
//   OCSP - URI:http://ocsp.example.test
//   CA Issuers - URI:http://ca.example.test/ca.crt
function parseInfoAccess(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(.+?)\s+-\s+([^:]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    out.push({
      method: match[1].trim(),
      type: match[2].trim(),
      value: match[3].trim()
    });
  }
  return out;
}

// Alt-Svc: h3=":443"; ma=86400, h3-29=":443"; ma=86400
function parseAltSvc(value) {
  const raw = String(value || '').trim();
  const services = [];
  if (!raw || /^clear$/i.test(raw)) {
    return { checked: true, raw, services, http3: false };
  }
  for (const part of raw.split(',')) {
    const quoted = /^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"\s*(.*)$/.exec(part);
    const bare = quoted ? null : /^\s*([A-Za-z0-9_.-]+)\s*=\s*([^;\s]+)\s*(.*)$/.exec(part);
    const match = quoted || bare;
    if (!match) continue;
    const params = {};
    for (const token of String(match[3] || '').split(';')) {
      const eq = token.indexOf('=');
      if (eq === -1) continue;
      const key = token.slice(0, eq).trim().toLowerCase();
      const param = token.slice(eq + 1).trim().replace(/^"|"$/g, '');
      if (key) params[key] = param;
    }
    const protocol = match[1].toLowerCase();
    services.push({
      protocol,
      authority: match[2],
      ma: Number.isFinite(Number(params.ma)) ? Number(params.ma) : null,
      persist: params.persist === '1'
    });
  }
  return {
    checked: true,
    raw,
    services,
    http3: services.some(service => /^h3(?:-\d+)?$/.test(service.protocol))
  };
}

function certificateNameKey(name) {
  if (!name || typeof name !== 'object') return '';
  return Object.keys(name)
    .filter(key => key !== 'subjectaltname')
    .sort()
    .map(key => {
      const value = Array.isArray(name[key]) ? name[key].join(',') : String(name[key] == null ? '' : name[key]);
      return key.toUpperCase() + '=' + value.trim().toLowerCase();
    })
    .join('|');
}

function certificateSelfSigned(cert) {
  if (!cert) return false;
  if (typeof cert.selfSigned === 'boolean') return cert.selfSigned;
  const subject = certificateNameKey(cert.subject);
  const issuer = certificateNameKey(cert.issuer);
  return Boolean(subject && subject === issuer);
}

function incompleteChainReason(value) {
  const text = String(value || '');
  // OpenSSL reports either a human-readable string or an upper-case code
  // (UNABLE_TO_GET_ISSUER_CERT_LOCALLY, UNABLE_TO_VERIFY_LEAF_SIGNATURE, ...).
  if (/unable to get local issuer certificate|unable to get issuer certificate|unable to find the certificate issuer|UNABLE_TO_GET_ISSUER_CERT/i.test(text)) {
    return 'The server did not send the intermediate certificate needed to build a trusted chain.';
  }
  if (/unable to verify the first certificate|unable to verify leaf signature|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(text)) {
    return 'The first certificate could not be verified, so the chain is incomplete.';
  }
  if (/self[- ]signed certificate in certificate chain|SELF_SIGNED_CERT_IN_CHAIN/i.test(text)) {
    return 'The chain contains a self-signed certificate that is not a trusted root.';
  }
  return '';
}

let systemRootFingerprints = null;
function isKnownSystemRoot(fingerprint) {
  if (!fingerprint) return false;
  if (!systemRootFingerprints) {
    systemRootFingerprints = new Set();
    for (const pem of tls.rootCertificates || []) {
      try {
        systemRootFingerprints.add(new crypto.X509Certificate(pem).fingerprint256);
      } catch (e) {
        // Ignore malformed entries; the default store is only a hint here.
      }
    }
  }
  return systemRootFingerprints.has(fingerprint);
}

function analyzeCertificateChain(chain, authorizationError, options) {
  const list = Array.isArray(chain) ? chain.filter(Boolean) : [];
  const orderIssues = [];
  for (let i = 0; i < list.length - 1; i++) {
    const issuer = certificateNameKey(list[i].issuer);
    const nextSubject = certificateNameKey(list[i + 1].subject);
    if (issuer && nextSubject && issuer !== nextSubject) {
      orderIssues.push('Certificate ' + (i + 1) + ' is not issued by certificate ' + (i + 2));
    }
  }
  const last = list[list.length - 1];
  const rootIncluded = list.length > 1 && certificateSelfSigned(last);
  // Node appends the trust anchor from its CA store even when the server did
  // not send it, so a self-signed tail alone does not prove an extra root. A
  // trusted root (known system root or a chain that verified cleanly) is
  // treated as the normal trust anchor; an untrusted self-signed tail was
  // necessarily sent by the server and is flagged.
  const rootTrusted = Boolean(rootIncluded && options && options.rootTrusted === true);
  const reason = incompleteChainReason(authorizationError);
  return {
    length: list.length,
    ordered: orderIssues.length === 0,
    orderIssues,
    rootIncluded,
    rootTrusted,
    extraRoot: rootIncluded && !rootTrusted,
    selfSignedLeaf: list.length > 0 && certificateSelfSigned(list[0]),
    incomplete: Boolean(reason),
    incompleteReason: reason
  };
}

function checkCertificateHostname(host, cert) {
  let error = '';
  try {
    const result = tls.checkServerIdentity(host, cert || {});
    if (result) error = result.message || String(result);
  } catch (e) {
    error = e.message || String(e);
  }
  const san = parseSubjectAltName(cert && cert.subjectaltname).map(entry => entry.value);
  return {
    match: !error,
    error,
    san,
    names: cert && cert.subjectaltname ? cert.subjectaltname : '',
    message: error
      ? 'Certificate name does not match ' + host + '. SAN: ' + (san.length ? san.join(', ') : 'none')
      : ''
  };
}

function describeCertificateChain(leaf) {
  const chain = [];
  let node = leaf;
  const seen = new Set();
  while (node && node.subject) {
    const marker = node.fingerprint256 || node.raw || node;
    if (seen.has(marker)) break;
    seen.add(marker);

    let x509 = null;
    try {
      if (node.raw) x509 = new crypto.X509Certificate(node.raw);
    } catch (e) {
      x509 = null;
    }
    const publicKey = x509 ? evaluatePublicKey(x509.publicKey) : null;
    const selfSigned = certificateSelfSigned(node);
    chain.push({
      subject: node.subject,
      issuer: node.issuer,
      valid_from: node.valid_from,
      valid_to: node.valid_to,
      fingerprint256: node.fingerprint256 || '',
      selfSigned,
      ca: x509 ? x509.ca : undefined,
      publicKey,
      sct: x509 ? hasEmbeddedSct(x509.raw) : { present: false, count: 0 },
      infoAccess: x509 ? x509.infoAccess || '' : ''
    });
    node = node.issuerCertificate;
  }
  return chain;
}

function inspectCertificate(host, leaf, authorizationError, authorized) {
  let x509 = null;
  try {
    if (leaf && leaf.raw) x509 = new crypto.X509Certificate(leaf.raw);
  } catch (e) {
    x509 = null;
  }
  const chain = describeCertificateChain(leaf);
  const last = chain[chain.length - 1];
  const trusted = authorized === true || (authorized === undefined && !authorizationError);
  const rootTrusted = Boolean(last && certificateSelfSigned(last) &&
    (isKnownSystemRoot(last.fingerprint256) || !authorizationError));
  const hostname = checkCertificateHostname(host, leaf);
  const validity = certificateValidityInfo(leaf, null, { trusted });
  const publicKey = x509 ? evaluatePublicKey(x509.publicKey) : evaluatePublicKey(null);
  const infoAccess = x509 ? parseInfoAccess(x509.infoAccess) : [];
  const ocspUrls = infoAccess.filter(entry => /^ocsp$/i.test(entry.method) && /^https?:\/\//i.test(entry.value))
    .map(entry => entry.value);
  const sct = x509 ? hasEmbeddedSct(x509.raw) : { present: false, count: 0 };

  return {
    subject: (leaf && leaf.subject) || {},
    issuer: (leaf && leaf.issuer) || {},
    valid_from: (leaf && leaf.valid_from) || '',
    valid_to: (leaf && leaf.valid_to) || '',
    daysRemaining: validity.daysRemaining,
    validity,
    serialNumber: (leaf && leaf.serialNumber) || '',
    fingerprint256: (leaf && leaf.fingerprint256) || '',
    subjectaltname: (leaf && leaf.subjectaltname) || '',
    subjectAltNames: parseSubjectAltName(leaf && leaf.subjectaltname),
    hostnameMatch: hostname.match,
    hostnameError: hostname.error,
    hostnameMessage: hostname.message,
    hostnameCheck: hostname,
    publicKey,
    key: publicKey,
    infoAccess,
    ocspUrls,
    sct,
    chain,
    chainAnalysis: analyzeCertificateChain(chain, authorizationError, { rootTrusted })
  };
}

const TLS_GRADE_RULES = [
  { id: 'trust', title: 'Trusted chain', weight: 25, rule: 'Pass when the certificate chains to a trusted root; an incomplete or untrusted chain is a failure.' },
  { id: 'hostname', title: 'Hostname match', weight: 20, rule: 'Pass when tls.checkServerIdentity() accepts the requested host.' },
  { id: 'validity', title: 'Validity period', weight: 20, rule: 'Warning below 30 days, failure below 14 days or when expired; for trusted chains, a validity longer than the current CA/B Forum limit is a warning.' },
  { id: 'chain', title: 'Chain structure', weight: 10, rule: 'An incomplete chain fails; an extra root is informational; an incorrect certificate order is a warning.' },
  { id: 'key', title: 'Public key strength', weight: 15, rule: 'RSA below 2048 bits or a deprecated elliptic curve is a failure.' },
  { id: 'sct', title: 'Certificate Transparency', weight: 5, rule: 'Embedded SCTs pass; a certificate without SCTs is a warning.' },
  { id: 'ocsp', title: 'OCSP stapling', weight: 5, rule: 'Only evaluated when the certificate contains an OCSP URL. A missing staple is then a warning.' },
  { id: 'alpn', title: 'ALPN', weight: 5, rule: 'h2 passes, HTTP/1.1 or no ALPN negotiation is a warning.' },
  { id: 'http3', title: 'HTTP/3 advertisement', weight: 3, rule: 'An Alt-Svc header advertising h3 passes; no HTTP/3 advertisement is a warning.' },
  { id: 'versions', title: 'TLS versions (deep scan)', weight: 15, rule: 'TLS 1.0/1.1 is a failure; missing TLS 1.3 is a warning.' },
  { id: 'ciphers', title: 'Cipher suites (deep scan)', weight: 10, rule: 'A weak suite is a failure; legacy CBC-only strength is a warning.' },
  { id: 'cap-f', title: 'Ceiling F', weight: 0, rule: 'Expired certificate, hostname mismatch, untrusted/incomplete chain, or weak public key.' },
  { id: 'cap-c', title: 'Ceiling C', weight: 0, rule: 'TLS 1.0/1.1 or a weak cipher suite is accepted.' },
  { id: 'cap-b', title: 'Ceiling B', weight: 0, rule: 'A trusted certificate with excessive validity or an incorrectly ordered chain.' }
];

function tlsGradeCheck(id, title, status, score, weight, detail) {
  return {
    id,
    title,
    status,
    score: Math.max(0, Math.min(1, score)),
    weight,
    detail: detail || ''
  };
}

function gradeRank(letter) {
  return ['F', 'E', 'D', 'C', 'B', 'A'].indexOf(letter);
}

function capGrade(letter, cap) {
  return gradeRank(letter) > gradeRank(cap) ? cap : letter;
}

function buildTlsReport(data) {
  const checks = [];
  const authorizationError = String((data && data.authorizationError) || '');
  const chainAnalysis = (data && data.chainAnalysis) || analyzeCertificateChain(data && data.chain, authorizationError);
  const hostnameMatch = data && data.hostnameMatch !== false &&
    !(data.hostnameCheck && data.hostnameCheck.match === false);
  const trusted = data && data.authorized === true;
  const validity = (data && data.validity) || certificateValidityInfo({
    valid_from: data && data.valid_from,
    valid_to: data && data.valid_to
  }, null, { trusted });
  const key = (data && (data.publicKey || data.key)) || evaluatePublicKey(null);
  const sct = (data && data.sct) || { present: false, count: 0 };
  const ocsp = Object.assign({}, (data && data.ocsp) || {});
  if (typeof ocsp.applicable !== 'boolean') {
    const urls = Array.isArray(ocsp.urls) ? ocsp.urls
      : (Array.isArray(data && data.ocspUrls) ? data.ocspUrls : []);
    ocsp.applicable = urls.length > 0;
  }

  checks.push(tlsGradeCheck('trust', 'Trusted chain', trusted ? 'pass' : 'fail',
    trusted ? 1 : 0, 25,
    trusted ? 'The certificate chains to a trusted root.'
      : (chainAnalysis.incomplete
        ? 'Incomplete chain: ' + chainAnalysis.incompleteReason
        : 'Chain is not trusted' + (authorizationError ? ': ' + authorizationError : ''))));

  checks.push(tlsGradeCheck('hostname', 'Hostname match', hostnameMatch ? 'pass' : 'fail',
    hostnameMatch ? 1 : 0, 20,
    hostnameMatch ? 'The certificate covers ' + (data.host || 'the requested host') + '.'
      : ((data.hostnameMessage || (data.hostnameCheck && data.hostnameCheck.message)) || 'Certificate name does not match')));

  const validityTooLong = trusted && validity.validityTooLong === true;
  let validityStatus = validity.expiryStatus || validity.status || 'unknown';
  let validityScore = validityStatus === 'ok' ? 1
    : (validityStatus === 'warning' ? 0.6 : (validityStatus === 'unknown' ? 0.5 : 0));
  let validityDetail = validity.message || '';
  if (validityTooLong && validityStatus !== 'expired' && validityStatus !== 'error') {
    if (validityStatus === 'ok') validityStatus = 'warning';
    if (validityScore > 0.6) validityScore = 0.6;
  }
  checks.push(tlsGradeCheck('validity', 'Validity period',
    validityStatus === 'ok' || validityStatus === 'unknown' ? 'pass' : validityStatus,
    validityScore, 20, validityDetail));

  let chainStatus = 'pass';
  let chainScore = 1;
  const chainDetails = [];
  if (chainAnalysis.incomplete) {
    chainStatus = 'fail';
    chainScore = 0;
    chainDetails.push('Incomplete chain: ' + chainAnalysis.incompleteReason);
  }
  if (chainAnalysis.extraRoot) {
    // Sending the root is common on legacy servers and mail ports. It is a
    // chain-length hygiene note, not a security defect.
    if (chainStatus === 'pass') chainStatus = 'info';
    chainDetails.push('The server sends the root certificate; roots are normally omitted (informational).');
  }
  if (chainAnalysis.orderIssues && chainAnalysis.orderIssues.length) {
    chainStatus = chainStatus === 'fail' ? 'fail' : 'warn';
    chainScore = Math.min(chainScore, 0.5);
    chainDetails.push(chainAnalysis.orderIssues.join('; '));
  }
  checks.push(tlsGradeCheck('chain', 'Chain structure', chainStatus, chainScore, 10,
    chainDetails.length ? chainDetails.join(' ') : 'The chain is complete and ordered.'));

  checks.push(tlsGradeCheck('key', 'Public key strength', key.weak ? 'fail' : 'pass',
    key.weak ? 0 : 1, 15,
    key.weak ? key.reason : ((key.type || 'Unknown') + (key.bits ? ', ' + key.bits + ' bits' : '') +
      (key.curve ? ' (' + key.curve + ')' : ''))));

  checks.push(tlsGradeCheck('sct', 'Certificate Transparency', sct.present ? 'pass' : 'warn',
    sct.present ? 1 : 0.4, 5,
    sct.present ? 'The certificate embeds ' + sct.count + ' SCT(s).'
      : 'No embedded SCT (OID 1.3.6.1.4.1.11129.2.4.2) was found; this is expected for private CAs and only affects the score.'));

  if (ocsp.applicable) {
    checks.push(tlsGradeCheck('ocsp', 'OCSP stapling', ocsp.stapled ? 'pass' : 'warn',
      ocsp.stapled ? 1 : 0.5, 5,
      ocsp.stapled ? 'The server stapled an OCSP response.'
        : 'The certificate has an OCSP URL but the response was not stapled.'));
  } else {
    checks.push(tlsGradeCheck('ocsp', 'OCSP stapling', 'unknown', 0, 5,
      'Not applicable: the certificate has no OCSP responder URL.'));
  }

  const alpn = String((data && data.alpn) || '');
  const port = data && data.port != null ? Number(data.port) : null;
  const webPort = port == null || port === 443 || port === 8443;
  if (webPort) {
    checks.push(tlsGradeCheck('alpn', 'ALPN', alpn === 'h2' ? 'pass' : 'warn',
      alpn === 'h2' ? 1 : (alpn === 'http/1.1' ? 0.5 : 0.3), 5,
      alpn ? 'Negotiated ' + alpn + ' (offered h2, http/1.1).'
        : 'No ALPN protocol was negotiated (offered h2, http/1.1).'));
  } else {
    checks.push(tlsGradeCheck('alpn', 'ALPN', 'unknown', 0, 5,
      'Not applicable: this is not an HTTP port.'));
  }

  const altSvc = data && data.altSvc;
  if (altSvc && altSvc.checked) {
    checks.push(tlsGradeCheck('http3', 'HTTP/3 advertisement', altSvc.http3 ? 'pass' : 'warn',
      altSvc.http3 ? 1 : 0.4, 3,
      altSvc.http3 ? 'Alt-Svc advertises HTTP/3.'
        : 'The HTTP response does not advertise HTTP/3.'));
  } else {
    checks.push(tlsGradeCheck('http3', 'HTTP/3 advertisement', 'unknown', 0, 3,
      'Not evaluated for this port.'));
  }

  const protocols = Array.isArray(data && data.protocols) ? data.protocols : null;
  const weakVersions = protocols
    ? protocols.filter(item => item.supported === true && (item.version === 'TLSv1' || item.version === 'TLSv1.1')).map(item => item.version)
    : [];
  if (protocols) {
    const supportedVersions = protocols.filter(item => item.supported === true).map(item => item.version);
    if (weakVersions.length) {
      checks.push(tlsGradeCheck('versions', 'TLS versions', 'fail', 0, 15,
        'Deprecated ' + weakVersions.join(', ') + ' still accepted.'));
    } else if (supportedVersions.length && !supportedVersions.includes('TLSv1.3')) {
      checks.push(tlsGradeCheck('versions', 'TLS versions', 'warn', 0.6, 15,
        'TLS 1.3 is not enabled.'));
    } else {
      checks.push(tlsGradeCheck('versions', 'TLS versions', 'pass', 1, 15,
        supportedVersions.length ? supportedVersions.join(', ') : 'No TLS version was confirmed.'));
    }
  } else {
    checks.push(tlsGradeCheck('versions', 'TLS versions', 'unknown', 0, 15,
      'Deep scan was not requested.'));
  }

  const ciphers = Array.isArray(data && data.ciphers) ? data.ciphers : null;
  const weakCiphers = ciphers
    ? ciphers.filter(item => item.supported === true && item.weak === true).map(item => item.name)
    : [];
  const legacyCiphers = ciphers
    ? ciphers.filter(item => item.supported === true && item.strength === 'legacy' && !item.weak).map(item => item.name)
    : [];
  if (ciphers) {
    if (weakCiphers.length) {
      checks.push(tlsGradeCheck('ciphers', 'Cipher suites', 'fail', 0, 10,
        'Weak suites enabled: ' + weakCiphers.join(', ') + '.'));
    } else if (legacyCiphers.length) {
      checks.push(tlsGradeCheck('ciphers', 'Cipher suites', 'warn', 0.6, 10,
        'Legacy suites enabled: ' + legacyCiphers.join(', ') + '.'));
    } else {
      checks.push(tlsGradeCheck('ciphers', 'Cipher suites', 'pass', 1, 10,
        'No weak or legacy probe suite was accepted.'));
    }
  } else {
    checks.push(tlsGradeCheck('ciphers', 'Cipher suites', 'unknown', 0, 10,
      'Deep scan was not requested.'));
  }

  const { grade: scoreGrade, score } = gradeFromChecks(checks);
  let ceiling = '';
  let cappedBy = '';
  if (!trusted || !hostnameMatch || key.weak ||
      validityStatus === 'expired' || validityStatus === 'error' || chainAnalysis.incomplete) {
    ceiling = 'F';
    cappedBy = 'identity or trust failure';
  } else if (weakVersions.length || weakCiphers.length ||
      (data && (data.protocol === 'TLSv1' || data.protocol === 'TLSv1.1'))) {
    ceiling = 'C';
    cappedBy = 'deprecated TLS version or weak cipher';
  } else if (validityTooLong ||
      (chainAnalysis.orderIssues && chainAnalysis.orderIssues.length)) {
    ceiling = 'B';
    cappedBy = 'excessive certificate validity or incorrect chain order';
  }
  const grade = ceiling ? capGrade(scoreGrade, ceiling) : scoreGrade;

  return {
    grade,
    score,
    cappedBy,
    checks,
    rules: TLS_GRADE_RULES
  };
}

// An Alt-Svc header is tiny. Cap the response read so a hostile or broken
// server cannot make the probe buffer an arbitrarily large header or body.
const ALT_SVC_MAX_BYTES = 16 * 1024;

function readAltSvcOnSocket(socket, host, port, alpn, timeoutMs) {
  return new Promise((resolve) => {
    if (!socket || socket.destroyed) return resolve(null);
    const limit = timeoutMs || 2000;
    let settled = false;
    let timer = null;
    let cleanup = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      resolve(value);
    };
    timer = setTimeout(() => finish(null), limit);
    if (timer && typeof timer.unref === 'function') timer.unref();

    const normalizeHeaders = (headers) => {
      const out = {};
      for (const [key, value] of Object.entries(headers || {})) {
        out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      }
      return out;
    };

    if (alpn === 'h2') {
      let session;
      try {
        session = http2.connect('https://' + host + ':' + port, {
          createConnection: () => socket,
          settings: { maxHeaderListSize: ALT_SVC_MAX_BYTES }
        });
      } catch (e) {
        return finish(null);
      }
      let request = null;
      cleanup = () => {
        if (request) try { request.close(); } catch (e) {}
        try { session.close(); } catch (e) {}
      };
      session.once('error', () => finish(null));
      request = session.request({ ':method': 'HEAD', ':path': '/' });
      request.once('response', (headers) => {
        const normalized = normalizeHeaders(headers);
        const headerBytes = Object.entries(normalized).reduce((total, entry) =>
          total + Buffer.byteLength(entry[0]) + Buffer.byteLength(entry[1]) + 4, 0);
        if (headerBytes > ALT_SVC_MAX_BYTES) return finish(null);
        finish(Object.prototype.hasOwnProperty.call(normalized, 'alt-svc') ? normalized['alt-svc'] : '');
      });
      request.once('error', () => finish(null));
      request.end();
      return;
    }

    if (alpn && alpn !== 'http/1.1') return finish(null);
    let data = '';
    const onData = (chunk) => {
      // Stop appending once the cap is reached. A valid header terminator must
      // appear within the cap; anything after it is a body, which is ignored.
      const room = ALT_SVC_MAX_BYTES - data.length;
      data += (chunk.length > room ? chunk.subarray(0, room) : chunk).toString('latin1');
      const end = data.indexOf('\r\n\r\n');
      if (end === -1) {
        if (data.length >= ALT_SVC_MAX_BYTES) finish(null);
        return;
      }
      const lines = data.slice(0, end).split('\r\n');
      const headers = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (key) headers[key] = headers[key] ? headers[key] + ', ' + value : value;
      }
      finish(Object.prototype.hasOwnProperty.call(headers, 'alt-svc') ? headers['alt-svc'] : '');
    };
    const onError = () => finish(null);
    cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.write('HEAD / HTTP/1.1\r\nHost: ' + host +
      '\r\nUser-Agent: OrbitNet/1.0 (+https://orbitnet.ru)' +
      '\r\nAccept: */*\r\nConnection: close\r\n\r\n');
  });
}

function normalizeCaaRecord(raw) {
  if (!raw || typeof raw !== 'object') return { flag: 0, tag: '', value: '' };
  const critical = raw.critical != null ? raw.critical : raw.flag;
  const flag = Number(critical) || 0;
  if (typeof raw.tag === 'string' && typeof raw.value === 'string') {
    return { flag, tag: raw.tag, value: raw.value };
  }
  for (const tag of ['issue', 'issuewild', 'iodef']) {
    if (raw[tag] != null) return { flag, tag, value: String(raw[tag]) };
  }
  return { flag, tag: '', value: raw.value != null ? String(raw.value) : '' };
}

// RFC 8659: the authority is found on the exact name or the nearest ancestor,
// but never above the registrable domain (e.g. not on co.uk).
async function caaLookup(host) {
  for (const name of domainSuffixes(host)) {
    try {
      const records = await withTimeout(dns.resolveCaa(name), DNS_TIMEOUT, 'CAA timeout');
      return { found: true, domain: name, records: records.map(normalizeCaaRecord) };
    } catch (e) {
      const code = e && e.code;
      if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENOTIMP') continue;
      return { found: false, domain: name, records: [], error: code || e.message };
    }
  }
  return { found: false, domain: '', records: [] };
}

function tlsHandshake(ip, host, port, extra, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let socket;
    try {
      socket = tls.connect(Object.assign({
        host: ip,
        servername: host,
        port: port || 443,
        rejectUnauthorized: false,
        timeout: timeout || TLS_PROBE_TIMEOUT
      }, extra || {}), () => {
        const out = {
          ok: true,
          protocol: socket.getProtocol(),
          cipher: (socket.getCipher() || {}).name || ''
        };
        socket.end();
        done(out);
      });
    } catch (e) {
      return done({ ok: false, error: e.code || e.message });
    }
    socket.on('timeout', () => { socket.destroy(); done({ ok: false, error: 'timeout' }); });
    socket.on('error', (e) => done({ ok: false, error: e.code || e.message }));
  });
}

// Node's own OpenSSL build removes TLS 1.0/1.1 and legacy ciphers (RC4, 3DES)
// from the default security level. When a probe fails for that reason the
// server's stance is simply unknowable from here, so report null, not false.
function isClientPolicyError(code) {
  return code === 'ERR_SSL_NO_PROTOCOLS_AVAILABLE' ||
    code === 'ERR_SSL_NO_CIPHER_MATCH' ||
    code === 'ERR_SSL_NO_CIPHERS_AVAILABLE';
}

function probeResult(r) {
  if (r.ok) return true;
  return isClientPolicyError(r.error) ? null : false;
}

async function tlsDeepProbe(ip, host, port) {
  const versions = await Promise.all(TLS_VERSION_PROBES.map(async (version) => {
    const extra = { minVersion: version, maxVersion: version };
    // Older protocols are disabled at OpenSSL's default security level. Lower
    // it only for this probe so the server's real stance can be observed.
    if (version === 'TLSv1' || version === 'TLSv1.1') extra.ciphers = 'DEFAULT:@SECLEVEL=0';
    const r = await outbound(() => tlsHandshake(ip, host, port, extra, TLS_PROBE_TIMEOUT));
    return { version, supported: probeResult(r), cipher: r.ok ? r.cipher : '', error: r.ok ? '' : (r.error || '') };
  }));
  const ciphers = await Promise.all(TLS_CIPHER_PROBES.map(async (probe) => {
    const r = await outbound(() => tlsHandshake(
      ip, host, port,
      { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', ciphers: probe.name + ':@SECLEVEL=0' },
      TLS_PROBE_TIMEOUT));
    return {
      name: probe.name,
      supported: probeResult(r),
      weak: probe.weak,
      strength: probe.strength,
      error: r.ok ? '' : (r.error || '')
    };
  }));
  return { versions, ciphers };
}

function tlsConnectInfo(ip, host, connectPort, timeout) {
  return new Promise((resolve) => {
    let ocspResponse = null;
    let settled = false;
    let readingAltSvc = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const socket = tls.connect({
      host: ip,
      servername: host,
      port: connectPort,
      rejectUnauthorized: false,
      requestOCSP: true,
      ALPNProtocols: ['h2', 'http/1.1'],
      timeout: timeout || OUTBOUND_TIMEOUT
    }, async () => {
      let out;
      try {
        const cert = socket.getPeerCertificate(true);
        const authorizationError = socket.authorizationError ? String(socket.authorizationError) : '';
        const inspected = inspectCertificate(host, cert, authorizationError, socket.authorized);
        const ocspUrls = inspected.ocspUrls;
        const cipher = (socket.getCipher() || {}).name || '';
        out = Object.assign({
          host,
          ip,
          port: connectPort,
          protocol: socket.getProtocol(),
          cipher,
          cipherGrade: classifyCipher(cipher),
          alpn: socket.alpnProtocol || '',
          alpnOffered: ['h2', 'http/1.1'],
          authorized: socket.authorized,
          authorizationError,
          ocsp: {
            requested: true,
            stapled: !!(ocspResponse && ocspResponse.length),
            responseBytes: ocspResponse ? ocspResponse.length : 0,
            urls: ocspUrls,
            applicable: ocspUrls.length > 0
          }
        }, inspected);
      } catch (e) {
        socket.destroy();
        return finish({ host, ip, port: connectPort, error: e.code || e.message });
      }

      // Alt-Svc is carried in an HTTP response. Reuse this TLS socket, so the
      // check does not open a second connection to the target. Mail ports do
      // not speak HTTP, so they are skipped.
      if (connectPort === 443 || connectPort === 8443) {
        readingAltSvc = true;
        let header = null;
        try {
          header = await readAltSvcOnSocket(socket, host, connectPort, out.alpn, 2000);
        } catch (e) {
          header = null;
        } finally {
          readingAltSvc = false;
        }
        out.altSvc = header == null
          ? { checked: false, raw: '', services: [], http3: false }
          : parseAltSvc(header);
      } else {
        out.altSvc = { checked: false, raw: '', services: [], http3: false };
      }
      out.http3 = !!(out.altSvc && out.altSvc.http3);
      if (!socket.destroyed) socket.end();
      finish(out);
    });
    socket.on('OCSPResponse', (buf) => { ocspResponse = buf || null; });
    socket.on('timeout', () => {
      if (readingAltSvc) return;
      socket.destroy();
      finish({ host, ip, port: connectPort, error: 'timeout' });
    });
    socket.on('error', (e) => {
      if (readingAltSvc) return;
      finish({ host, ip, port: connectPort, error: e.code || e.message });
    });
  });
}

// Blocked services often resolve to several anycast addresses; some routes may
// blackhole while another works. Try a small set in parallel and keep the first
// successful handshake.
async function firstTlsBase(ips, host, connectPort, limit) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : TLS_ATTEMPT_LIMIT;
  const candidates = ips
    .filter(ip => net.isIPv4(ip))
    .concat(ips.filter(ip => net.isIPv6(ip)))
    .slice(0, max);
  if (!candidates.length) {
    return { host, port: connectPort, error: 'Cannot resolve ' + host };
  }

  return await new Promise((resolve, reject) => {
    let pending = candidates.length;
    let firstError = null;
    let firstRejection = null;
    const settle = () => {
      if (pending > 0) return;
      if (firstError) resolve(firstError);
      else reject(firstRejection);
    };
    for (const ip of candidates) {
      outbound(() => tlsConnectInfo(ip, host, connectPort, TLS_ATTEMPT_TIMEOUT))
        .then(base => {
          if (base && !base.error) {
            resolve(base);
            return;
          }
          if (!firstError) firstError = base;
          pending--;
          settle();
        }, error => {
          if (!firstRejection) firstRejection = error;
          pending--;
          settle();
        });
    }
  });
}

async function tlsInfo(host, port, options) {
  const deep = !!(options && options.deep);
  const context = options && options.context;
  // Local handshake first. If local DNS is filtered, the Worker supplies the
  // addresses; if DNS works but the route is blocked, the Worker is asked for
  // the full address set only after the local attempt fails. The certificate
  // itself is always read locally, and Worker addresses are rechecked by the
  // local public-IP guard.
  let resolved = context
    ? await resolvePublicWithWorker(host, context, { all: true })
    : { ips: await resolvePublic(host), source: 'local' };
  const connectPort = port || 443;
  let base = await firstTlsBase(
    resolved.ips, host, connectPort,
    resolved.source === 'worker' ? TLS_ATTEMPT_LIMIT : 1
  );

  // Local DNS may work while the route to the address is blocked. If the first
  // local attempt fails, ask the Worker for the full address set and retry.
  if (base.error && context && resolved.source === 'local') {
    const ips = await workerResolvedIps(host, context);
    if (ips.length) {
      const retry = await firstTlsBase(ips, host, connectPort, TLS_ATTEMPT_LIMIT);
      if (!retry.error) {
        base = retry;
        resolved = { ips, source: 'worker' };
      }
    }
  }

  base.source = resolved.source;
  if (base.error) return base;
  const ip = base.ip;

  base.caa = await caaLookup(host).catch(() => ({ found: false, domain: '', records: [] }));
  base.deep = deep;
  if (deep) {
    try {
      const probe = await tlsDeepGate(() => tlsDeepProbe(ip, host, connectPort));
      base.protocols = probe.versions;
      base.versionSummary = summarizeTlsVersions(probe.versions);
      base.ciphers = probe.ciphers;
    } catch (e) {
      base.deepError = e.busy ? 'Deep scan capacity is busy, try again later' : (e.message || 'Deep scan failed');
      base.protocols = [];
      base.ciphers = [];
    }
  }

  const report = buildTlsReport(base);
  base.grade = report.grade;
  base.score = report.score;
  base.gradeCappedBy = report.cappedBy;
  base.gradeChecks = report.checks;
  base.gradeRules = report.rules;
  return base;
}

// ---------- /api/email ----------
const DNS_TRANSPORT_CODES = new Set([
  'ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED', 'ECONNRESET'
]);
function isDnsTransportError(code) {
  return DNS_TRANSPORT_CODES.has(String(code || '').toUpperCase());
}

// Empty/NXDOMAIN answers are normal, so they are only retried when the local
// resolver is demonstrably broken. A short cached canary query avoids turning
// every "no CAA/AAAA" into a Worker call while still recovering from a
// resolver that stopped answering entirely.
const DNS_HEALTH_TTL = 60000;
let dnsHealth = { healthy: null, checkedAt: 0 };
let dnsHealthPromise = null;

async function checkDnsHealth() {
  const now = Date.now();
  try {
    const records = await withTimeout(dns.resolve('example.com', 'A'), 1500, 'timeout');
    dnsHealth = { healthy: Array.isArray(records) && records.length > 0, checkedAt: now };
  } catch (e) {
    dnsHealth = { healthy: false, checkedAt: now };
  }
  return dnsHealth.healthy;
}

async function localDnsHealthy() {
  const now = Date.now();
  if (dnsHealth.healthy !== null && now - dnsHealth.checkedAt < DNS_HEALTH_TTL) {
    return dnsHealth.healthy;
  }
  if (!dnsHealthPromise) {
    dnsHealthPromise = checkDnsHealth().finally(() => { dnsHealthPromise = null; });
  }
  return dnsHealthPromise;
}

async function emailInfoLocal(host, selector) {
  const result = { host, mx: [], spf: null, dmarc: null, dkim: null, errors: {} };
  const lookup = (promise) => withTimeout(promise, DNS_TIMEOUT, 'timeout');
  const errorOf = (settled) => {
    if (settled.status !== 'rejected') return '';
    const reason = settled.reason || {};
    return reason.code || reason.message || 'error';
  };

  // Run the independent lookups in parallel so a filtered resolver costs one
  // timeout rather than four sequential ones before the Worker fallback.
  const [mxSettled, spfSettled, dmarcSettled, dkimSettled] = await Promise.allSettled([
    lookup(dns.resolveMx(host)),
    lookup(dns.resolveTxt(host)),
    lookup(dns.resolveTxt('_dmarc.' + host)),
    selector ? lookup(dns.resolveTxt(selector + '._domainkey.' + host)) : Promise.resolve(null)
  ]);

  if (mxSettled.status === 'fulfilled') {
    result.mx = mxSettled.value.map(r => ({ priority: r.priority, host: r.exchange }))
      .sort((a, b) => a.priority - b.priority);
  } else {
    result.errors.mx = errorOf(mxSettled);
  }

  if (spfSettled.status === 'fulfilled') {
    const flat = spfSettled.value.map(r => r.join(''));
    result.spf = flat.find(t => /^v=spf1/i.test(t)) || null;
  } else {
    result.errors.spf = errorOf(spfSettled);
  }

  if (dmarcSettled.status === 'fulfilled') {
    const flat = dmarcSettled.value.map(r => r.join(''));
    result.dmarc = flat.find(t => /^v=DMARC1/i.test(t)) || null;
  } else {
    result.errors.dmarc = errorOf(dmarcSettled);
  }

  if (selector) {
    if (dkimSettled.status === 'fulfilled' && dkimSettled.value) {
      result.dkim = dkimSettled.value.map(r => r.join(''));
    } else if (dkimSettled.status === 'rejected') {
      result.errors.dkim = errorOf(dkimSettled);
    }
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

// ENOTFOUND/ENODATA for _dmarc, a DKIM selector or an optional record is a
// normal DNS answer, not a broken resolver. Transport failures and an ENOTFOUND
// on the domain's MX lookup are retried through the Worker; otherwise almost
// every domain without DMARC would replace its local answer with the external one.
async function emailInfo(host, selector, context) {
  const local = await emailInfoLocal(host, selector);
  const keys = ['mx', 'spf', 'dmarc'].concat(selector ? ['dkim'] : []);
  const transportError = keys.some(key => isDnsTransportError(local.errors[key]));
  // A domain-level NXDOMAIN (MX lookup) is also what DNS filtering looks like.
  // Missing DMARC/DKIM alone is normal and must not trigger a fallback.
  const mxNxdomain = local.mx.length === 0 && local.errors.mx === 'ENOTFOUND';
  if (!transportError && !mxNxdomain) {
    return Object.assign(local, { source: 'local' });
  }

  const cacheKey = externalCacheKey('email', host, selector || '');
  let external = getExternalCache(cacheKey);
  if (!external) {
    external = await callExternal(
      opts => externalCheck.checkEmail(host, selector, opts),
      context,
      { nxdomain: mxNxdomain && !transportError }
    );
    if (!external.error) setExternalCache(cacheKey, external);
  }
  if (external.error) {
    return externalFailure(local, external.error);
  }
  return Object.assign({}, external, {
    host,
    source: 'worker',
    localErrors: local.errors
  });
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

async function followChain(startUrl, deadline) {
  const chain = [];
  let url = new URL(startUrl);
  let finalUrl = url.href;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') break;
    const remaining = deadline ? deadline - Date.now() : OUTBOUND_TIMEOUT;
    if (remaining < 1000) {
      chain.push({
        url: url.href,
        status: null,
        location: '',
        blocked: false,
        error: 'Request budget exhausted'
      });
      break;
    }
    const secure = url.protocol === 'https:';
    const host = url.hostname;
    const path = url.pathname + url.search;
    const limit = Math.min(OUTBOUND_TIMEOUT, remaining);
    let result;
    try {
      const ips = await withTimeout(resolvePublic(host), limit, 'timeout');
      const ip = pickAddress(ips);
      result = await outbound(() => fetchOnce(ip, host, path, secure, limit));
    } catch (e) {
      chain.push({
        url: url.href,
        status: null,
        location: '',
        blocked: Boolean(e.blocked),
        busy: Boolean(e.busy),
        error: e.message
      });
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
  return { chain, finalUrl };
}

async function redirectChainLocal(startHost, context) {
  const httpsResult = await followChain('https://' + startHost + '/', context && context.deadline);
  // If the first hop could not even be reached over TLS (no HTTPS listener,
  // invalid handshake, connection reset), retry the whole chain over HTTP.
  const first = httpsResult.chain[0];
  if (first && first.error && !first.status && !first.blocked &&
      (!context || context.deadline - Date.now() >= 1000)) {
    const httpResult = await followChain('http://' + startHost + '/', context && context.deadline);
    const httpFirst = httpResult.chain[0];
    if (!(httpFirst && httpFirst.error && !httpFirst.status)) {
      return { host: startHost, chain: httpResult.chain, finalUrl: httpResult.finalUrl, hops: httpResult.chain.length };
    }
  }
  return { host: startHost, chain: httpsResult.chain, finalUrl: httpsResult.finalUrl, hops: httpsResult.chain.length };
}

async function redirectChain(startHost, context) {
  const local = await redirectChainLocal(startHost, context);
  const first = local.chain && local.chain[0];
  const localFailed = first && !first.blocked && !first.busy &&
    ((first.error && !first.status) || first.status === 403 || first.status === 451);
  if (!localFailed) {
    return Object.assign(local, { source: 'local' });
  }

  const external = await callExternal(
    opts => externalCheck.checkHttp(startHost, { follow: true, timeoutMs: opts.timeoutMs }),
    context
  );
  const chain = external.redirects || [];
  if (!chain.length && external.error) {
    return externalFailure(local, external.error);
  }

  if (external.error) logExternalFailure(external.error);
  return {
    host: startHost,
    chain,
    finalUrl: external.finalUrl || (chain.length ? chain[chain.length - 1].url : ''),
    hops: chain.length,
    source: 'worker',
    localError: first.error || null,
    workerError: external.error ? EXTERNAL_UNAVAILABLE : null
  };
}

// ---------- /api/spam (DNSBL / RBL reputation) ----------
// Public DNS blocklists are queried by a reversed IP label
// (4.3.2.1.zen.spamhaus.org) or by domain for URI/domain lists. An answer in
// 127.0.0.0/8 means the target is listed; NXDOMAIN means it is not. Operators
// such as Spamhaus and SURBL answer 127.255.255.252-255 when the query arrives
// from a public/open resolver, so those codes are reported as "blocked", never
// as a listing.
const SPAM_IP_LISTS = [
  { name: 'Spamhaus ZEN', zone: 'zen.spamhaus.org' },
  { name: 'DroneBL', zone: 'dnsbl.dronebl.org' },
  { name: 'Barracuda', zone: 'b.barracudacentral.org' },
  { name: 'PSBL', zone: 'psbl.surriel.com' },
  { name: 'Spam Eating Monkey', zone: 'bl.spameatingmonkey.net' },
  { name: 'Mailspike', zone: 'bl.mailspike.net' }
];
const SPAM_DOMAIN_LISTS = [
  { name: 'Spamhaus DBL', zone: 'dbl.spamhaus.org' },
  { name: 'SURBL', zone: 'multi.surbl.org' },
  { name: 'Spam Eating Monkey URIBL', zone: 'uribl.spameatingmonkey.net' }
];
// Bounded fan-out: each IP costs one query per list, so a domain with many
// A/MX records must not multiply into hundreds of DNS lookups.
const SPAM_MAX_IPS = 4;
const SPAM_RATE_MAX = 10;
const SPAM_CACHE_TTL = 10 * 60 * 1000;
// A refusal ("blocked") is an operator/capacity signal and can change quickly,
// so it must not be cached as long as an actual listing or a clean answer.
const SPAM_BLOCKED_CACHE_TTL = 45 * 1000;
const SPAM_CACHE_MAX = 4000;
const SPAM_RESOLVER_TEST = '2.0.0.127.zen.spamhaus.org';
// Re-resolve DNSBL_RESOLVER hostnames regularly: a recreated Unbound container
// can get a new IP, and a resolver that was not ready at startup must not stay
// cached as null forever.
const SPAM_RESOLVER_REFRESH_MS = 60 * 1000;
// The canary is a separate Spamhaus query, so cache its verdict briefly. An
// error or unknown status is retried quickly so a restarted resolver recovers.
const SPAM_RESOLVER_STATUS_TTL = 90 * 1000;
const SPAM_RESOLVER_ERROR_TTL = 20 * 1000;
const spamHits = new Map();
const spamCache = new Map();
const spamResolverStatusCache = { value: null, expires: 0 };

const DNSBL_BLOCKED_REASONS = {
  '127.255.255.252': 'Query refused: the list blocks queries from public/open resolvers',
  '127.255.255.253': 'Query refused: too many queries from this resolver',
  '127.255.255.254': 'Query refused: open resolver or incorrect setup',
  '127.255.255.255': 'Query refused: malformed query or anonymous use'
};

// Not every 127/8 answer means spam. Spamhaus ZEN mixes PBL (dynamic address
// space), SBL and XBL; Mailspike and SURBL encode reputation/bitmask codes.
const SPAM_CODE_TABLE = {
  'zen.spamhaus.org': {
    '127.0.0.2': { label: 'SBL: spam source', spam: true },
    '127.0.0.3': { label: 'SBL: snowshoe spam source', spam: true },
    '127.0.0.4': { label: 'XBL: exploited machine', spam: true },
    '127.0.0.5': { label: 'XBL: exploited machine', spam: true },
    '127.0.0.6': { label: 'XBL: exploited machine', spam: true },
    '127.0.0.7': { label: 'XBL: exploited machine', spam: true },
    '127.0.0.9': { label: 'SBL: DROP list', spam: true },
    '127.0.0.10': { label: 'PBL: dynamic IP range', spam: false, category: 'pbl' },
    '127.0.0.11': { label: 'PBL: dynamic IP range', spam: false, category: 'pbl' },
    '127.0.0.12': { label: 'PBL: dynamic IP range', spam: false, category: 'pbl' },
    '127.0.0.13': { label: 'PBL: dynamic IP range', spam: false, category: 'pbl' },
    '127.0.0.14': { label: 'PBL: dynamic IP range', spam: false, category: 'pbl' }
  },
  'dnsbl.dronebl.org': {
    '127.0.0.2': { label: 'DroneBL: sample', spam: false, category: 'informational' },
    '127.0.0.3': { label: 'DroneBL: IRC drone', spam: true },
    '127.0.0.5': { label: 'DroneBL: bottler', spam: true },
    '127.0.0.6': { label: 'DroneBL: unknown spambot or drone', spam: true },
    '127.0.0.7': { label: 'DroneBL: DDoS drone', spam: true },
    '127.0.0.8': { label: 'DroneBL: SOCKS proxy', spam: true },
    '127.0.0.9': { label: 'DroneBL: HTTP proxy', spam: true },
    '127.0.0.10': { label: 'DroneBL: proxy chain', spam: true },
    '127.0.0.11': { label: 'DroneBL: web page proxy', spam: true },
    '127.0.0.12': { label: 'DroneBL: open DNS resolver', spam: false, category: 'informational' },
    '127.0.0.13': { label: 'DroneBL: brute-force attacker', spam: true },
    '127.0.0.14': { label: 'DroneBL: open Wingate proxy', spam: true },
    '127.0.0.15': { label: 'DroneBL: compromised router or gateway', spam: true },
    '127.0.0.16': { label: 'DroneBL: autorooting worm', spam: true },
    '127.0.0.17': { label: 'DroneBL: botnet IP', spam: true },
    '127.0.0.18': { label: 'DroneBL: DNS/MX hostname on IRC', spam: false, category: 'informational' },
    '127.0.0.255': { label: 'DroneBL: unknown', spam: true }
  },
  'bl.mailspike.net': {
    '127.0.0.2': { label: 'Mailspike: spam source', spam: true },
    '127.9.0.1': { label: 'Mailspike reputation: poor', spam: false, category: 'reputation' },
    '127.9.0.2': { label: 'Mailspike reputation: bad', spam: false, category: 'reputation' },
    '127.9.0.3': { label: 'Mailspike reputation: very bad', spam: false, category: 'reputation' }
  },
  'multi.surbl.org': {
    '127.0.0.2': { label: 'SURBL: spam domain', spam: true },
    '127.0.0.4': { label: 'SURBL: phishing domain', spam: true },
    '127.0.0.8': { label: 'SURBL: malware domain', spam: true },
    '127.0.0.16': { label: 'SURBL: abused/legitimate domain', spam: false, category: 'informational' }
  }
};

function spamCodeInfo(list, code) {
  const table = (list && SPAM_CODE_TABLE[list.zone]) || {};
  const info = table[code];
  if (info) return Object.assign({ category: 'listing', spam: true, label: 'Listed', reason: '' }, info);
  if (list && list.zone === 'bl.mailspike.net' && /^127\.9\./.test(code)) {
    return {
      category: 'reputation',
      spam: false,
      label: 'Mailspike reputation code ' + code,
      reason: 'Mailspike reputation signal; this is not necessarily a spam listing.'
    };
  }
  return { category: 'listing', spam: true, label: 'Listed', reason: '' };
}

// Blocklist operators reject queries that come from public resolvers, so the
// deployment can point DNSBL lookups at its own or provider resolver instead.
// Comma-separated IPs, optionally with a port (e.g. "127.0.0.1:53,10.0.0.1").
function parseResolverEntry(value) {
  const text = String(value || '').trim();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end === -1) return null;
    const host = text.slice(1, end);
    const rest = text.slice(end + 1);
    const port = /^:\d+$/.test(rest) ? rest.slice(1) : '53';
    return { host: host, port: port };
  }
  const colons = (text.match(/:/g) || []).length;
  if (colons === 1) {
    const idx = text.lastIndexOf(':');
    const port = text.slice(idx + 1);
    if (/^\d+$/.test(port)) return { host: text.slice(0, idx), port: port };
  }
  return { host: text, port: '53' };
}

function resolverServer(host, port) {
  return net.isIPv6(host) ? '[' + host + ']:' + port : host + ':' + port;
}

// Hostnames are accepted too: Compose points this at the bundled Unbound
// service (orbitnet-unbound:53), and Node's Resolver only takes IP literals.
async function createSpamResolver() {
  const servers = String(process.env.DNSBL_RESOLVER || '')
    .split(',').map(part => part.trim()).filter(Boolean);
  if (!servers.length) return null;
  const resolved = [];
  for (const entry of servers) {
    const parsed = parseResolverEntry(entry);
    if (!parsed || !parsed.host) continue;
    let addresses = [];
    if (net.isIP(parsed.host)) {
      addresses = [parsed.host];
    } else {
      try {
        const found = await dns.lookup(parsed.host, { all: true });
        addresses = found.map(item => normalizeIp(item.address)).filter(ip => net.isIP(ip));
      } catch (e) {
        console.warn('spam: cannot resolve DNSBL_RESOLVER host ' + parsed.host + ' (' + e.message + ')');
        continue;
      }
    }
    for (const address of addresses) resolved.push(resolverServer(address, parsed.port));
  }
  if (!resolved.length) {
    console.warn('spam: DNSBL_RESOLVER did not contain a usable resolver; using the system resolver');
    return null;
  }
  try {
    const resolver = new dns.Resolver({ timeout: DNS_TIMEOUT, tries: 2 });
    resolver.setServers(resolved);
    return resolver;
  } catch (e) {
    console.warn('spam: ignoring invalid DNSBL_RESOLVER (' + e.message + ')');
    return null;
  }
}
let spamResolverState = { promise: null, expires: 0 };
function getSpamResolver() {
  const now = Date.now();
  if (!spamResolverState.promise || now >= spamResolverState.expires) {
    const promise = createSpamResolver().catch(e => {
      console.warn('spam: resolver setup failed (' + e.message + ')');
      return null;
    });
    spamResolverState = { promise, expires: now + SPAM_RESOLVER_REFRESH_MS };
  }
  return spamResolverState.promise;
}

function spamCacheGet(key) {
  const record = spamCache.get(key);
  if (!record) return null;
  if (Date.now() > record.expires) {
    spamCache.delete(key);
    return null;
  }
  return record.value;
}

function spamCacheSet(key, value, ttl = SPAM_CACHE_TTL) {
  if (spamCache.size >= SPAM_CACHE_MAX) {
    const oldest = spamCache.keys().next().value;
    if (oldest !== undefined) spamCache.delete(oldest);
  }
  spamCache.set(key, { value, expires: Date.now() + ttl });
}

// Single DNS entry point so tests can inject a fake resolver via options.resolve.
async function spamDns(name, type, options) {
  if (options && typeof options.resolve === 'function') return options.resolve(name, type);
  const resolver = await getSpamResolver();
  if (type === 'TXT') return resolver ? resolver.resolveTxt(name) : dns.resolveTxt(name);
  if (type === 'MX') return resolver ? resolver.resolveMx(name) : dns.resolveMx(name);
  return resolver ? resolver.resolve4(name) : dns.resolve4(name);
}

function spamQueryTimeout(options, fallback = DNS_TIMEOUT) {
  if (!options || !options.deadline) return fallback;
  return Math.max(0, Math.min(fallback, options.deadline - Date.now()));
}

async function spamDnsTimed(name, type, options) {
  const timeout = spamQueryTimeout(options);
  if (timeout <= 0) {
    throw Object.assign(new Error('Request budget exhausted'), { code: 'EBUDGET' });
  }
  return withTimeout(dnsbl(() => spamDns(name, type, options)), timeout, 'DNSBL timeout');
}

function reverseIpName(ip) {
  const norm = normalizeIp(ip);
  if (net.isIPv4(norm)) return norm.split('.').reverse().join('.');
  return '';
}

// Turns the A answers of a DNSBL query into a structured verdict. Any 127/8
// address that is not one of the operator status codes is a real listing.
function parseDnsblRecords(records, list) {
  for (const address of Array.isArray(records) ? records : []) {
    const norm = normalizeIp(address);
    if (!net.isIPv4(norm) || norm.split('.')[0] !== '127') continue;
    if (norm.startsWith('127.255.255.')) {
      return {
        listed: false,
        blocked: true,
        code: norm,
        reason: DNSBL_BLOCKED_REASONS[norm] || 'Query refused by the list operator'
      };
    }
    const base = { listed: true, blocked: false, code: norm, reason: '' };
    if (!list) return base;
    const info = spamCodeInfo(list, norm);
    return Object.assign(base, {
      category: info.category,
      spam: info.spam,
      label: info.label,
      reason: info.reason || ''
    });
  }
  return { listed: false, blocked: false, code: '', reason: '' };
}

async function spamListCheck(lookupName, list, type, options) {
  const key = type + ':' + list.zone + ':' + lookupName;
  const cached = spamCacheGet(key);
  if (cached) return cached;

  const name = lookupName + '.' + list.zone;
  let result;
  try {
    const records = await spamDnsTimed(name, 'A', options);
    result = Object.assign({ name: list.name, zone: list.zone, lookup: lookupName },
      parseDnsblRecords(records, list));
    if (result.listed) {
      try {
        const txt = await spamDnsTimed(name, 'TXT', options);
        const reason = Array.isArray(txt) && txt[0] ? [].concat(txt[0]).join('') : '';
        if (reason) result.reason = reason.slice(0, 300);
      } catch (e) { /* the A answer already proves the listing */ }
    }
  } catch (e) {
    if (e.busy) throw e;
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      result = { name: list.name, zone: list.zone, lookup: lookupName, listed: false, blocked: false, code: '', reason: '' };
    } else {
      return {
        name: list.name,
        zone: list.zone,
        lookup: lookupName,
        listed: null,
        blocked: false,
        code: '',
        error: e.code || e.message || 'error'
      };
    }
  }
  spamCacheSet(key, result, result.blocked ? SPAM_BLOCKED_CACHE_TTL : SPAM_CACHE_TTL);
  return result;
}

async function spamIpCheck(ip, options) {
  const norm = normalizeIp(ip);
  if (!net.isIPv4(norm)) {
    return {
      ip: norm,
      version: net.isIPv6(norm) ? 6 : 4,
      supported: false,
      lists: [],
      note: 'Most reverse DNS blocklists have no IPv6 zone, so this address was not queried'
    };
  }
  const lookupName = reverseIpName(norm);
  const lists = await Promise.all(
    SPAM_IP_LISTS.map(list => spamListCheck(lookupName, list, 'ip', options)));
  return { ip: norm, version: 4, supported: true, lists };
}

async function spamDomainCheck(host, options) {
  // Query the host and its registrable parent (mail.example.com and
  // example.com) but never a public suffix such as co.uk.
  const names = domainSuffixes(host);
  const perName = await Promise.all(names.map(async (name) => {
    const lists = await Promise.all(
      SPAM_DOMAIN_LISTS.map(list => spamListCheck(name, list, 'domain', options)));
    return lists;
  }));
  return { name: host, lists: perName.flat() };
}

async function spamResolveIps(host, options) {
  try {
    const records = await spamDnsTimed(host, 'A', options);
    return [...new Set((Array.isArray(records) ? records : [])
      .map(normalizeIp).filter(ip => net.isIPv4(ip) && isPublicIp(ip)))];
  } catch (e) {
    return [];
  }
}

async function spamResolveMxIps(host, options) {
  try {
    const mx = await spamDnsTimed(host, 'MX', options);
    const hosts = (Array.isArray(mx) ? mx : [])
      .sort((a, b) => a.priority - b.priority)
      .map(record => record.exchange).slice(0, SPAM_MAX_IPS);
    const resolved = await Promise.all(hosts.map(name => spamResolveIps(name, options)));
    return [...new Set(resolved.flat())];
  } catch (e) {
    return [];
  }
}

// Spamhaus publishes 2.0.0.127.zen.spamhaus.org as a test record that is
// always listed. A healthy resolver gets 127.0.0.2/4/10; a blocked one gets
// 127.255.255.254 (or another 127.255.255.x refusal). NXDOMAIN is unexpected.
async function spamResolverProbeUncached(options) {
  try {
    const records = await spamDnsTimed(SPAM_RESOLVER_TEST, 'A', options);
    const addresses = (Array.isArray(records) ? records : [])
      .map(normalizeIp)
      .filter(address => net.isIPv4(address) && address.split('.')[0] === '127');
    const refusal = addresses.find(address => address.startsWith('127.255.255.'));
    if (refusal) {
      return {
        checked: true,
        blocked: true,
        code: refusal,
        reason: 'The DNS resolver is blocked by Spamhaus. Point DNSBL_RESOLVER at the bundled Unbound service or another private recursive resolver.'
      };
    }
    if (addresses.length) {
      // 127.0.0.2/4/10 is the expected listing answer from a healthy resolver.
      return { checked: true, blocked: false, code: addresses[0], reason: '' };
    }
    return { checked: false, blocked: null, error: 'Unexpected canary answer' };
  } catch (e) {
    if (e.busy) throw e;
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      return { checked: false, blocked: null, error: 'Canary returned NXDOMAIN' };
    }
    return { checked: false, blocked: null, error: e.code || e.message || 'error' };
  }
}

async function spamResolverProbe(options) {
  // Injected resolvers are used by tests and must not share production cache.
  if (options && typeof options.resolve === 'function') {
    return spamResolverProbeUncached(options);
  }
  const now = Date.now();
  if (spamResolverStatusCache.value && now < spamResolverStatusCache.expires) {
    return spamResolverStatusCache.value;
  }
  const result = await spamResolverProbeUncached(options);
  const ttl = result.checked === false ? SPAM_RESOLVER_ERROR_TTL : SPAM_RESOLVER_STATUS_TTL;
  spamResolverStatusCache.value = result;
  spamResolverStatusCache.expires = now + ttl;
  return result;
}

// Accepts an IPv4/IPv6 literal, a domain or an email address. Email is reduced
// to its domain; the mailbox itself is never checked or stored.
function parseSpamTarget(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  const literal = normalizeIp(value);
  if (net.isIP(literal)) return { kind: 'ip', ip: literal };

  const match = value.match(/^[^@\s]+@([^@\s]+)$/);
  const host = match ? match[1] : value;
  if (!host.includes('.') || host.length > 253) return null;
  if (!isValidHost(host)) return null;
  if (/\.(localhost|local|internal|home\.arpa|invalid|test)$/.test(host)) return null;
  return { kind: match ? 'email' : 'domain', host };
}

async function spamCheck(target, options) {
  const parsed = parseSpamTarget(target);
  if (!parsed) return null;

  const result = {
    target: String(target || '').trim(),
    kind: parsed.kind,
    checkedAt: new Date().toISOString(),
    source: 'local',
    ips: [],
    domains: []
  };

  if (parsed.kind === 'ip') {
    if (!isPublicIp(parsed.ip)) {
      throw Object.assign(httpError(400, 'Only public IP addresses can be checked'), { blocked: true });
    }
    result.ip = parsed.ip;
    const [entry, resolver] = await Promise.all([
      spamIpCheck(parsed.ip, options),
      spamResolverProbe(options)
    ]);
    result.ips.push(entry);
    result.resolver = resolver;
    return result;
  }

  result.host = parsed.host;
  // Domain lists and IP lists are independent, so run them together under the
  // same request deadline instead of spending a full DNS_TIMEOUT on each stage.
  const [domainEntry, ipEntries, resolver] = await Promise.all([
    spamDomainCheck(parsed.host, options),
    (async () => {
      let ips = parsed.kind === 'email'
        ? await spamResolveMxIps(parsed.host, options)
        : await spamResolveIps(parsed.host, options);
      if (!ips.length) ips = await spamResolveIps(parsed.host, options);
      ips = ips.slice(0, SPAM_MAX_IPS);
      return Promise.all(ips.map(ip => spamIpCheck(ip, options)));
    })(),
    spamResolverProbe(options)
  ]);

  result.domains.push(domainEntry);
  result.ips = ipEntries;
  result.resolver = resolver;
  return result;
}

// ---------- /api/security (site security audit) ----------
// Composes the headers check with body- and file-based signals: HSTS preload
// readiness, security.txt, mixed content and cookie flags, then derives a
// weighted A-F grade. Body-based checks need the page HTML, so a Worker
// fallback can only evaluate the header checks.
function headerValue(headers, name) {
  if (!headers) return '';
  const raw = headers[name] != null ? headers[name] : headers[name.toLowerCase()];
  if (raw == null) return '';
  return Array.isArray(raw) ? raw.join(', ') : String(raw);
}

function parseMaxAge(value) {
  const match = /max-age\s*=\s*(\d+)/i.exec(String(value || ''));
  return match ? parseInt(match[1], 10) : null;
}

function parseCookies(headers) {
  let raw = headers && (headers['set-cookie'] || headers['Set-Cookie']);
  if (!raw) return [];
  if (!Array.isArray(raw)) raw = [raw];

  return raw.map(line => {
    const text = String(line);
    const attributes = text.split(';').slice(1).map(part => part.trim());
    const attributeNames = attributes.map(part => part.split('=')[0].trim().toLowerCase());
    const sameSite = attributes.find(part => /^samesite\s*=/i.test(part));
    const first = text.split(';')[0] || '';
    const eq = first.indexOf('=');
    return {
      name: (eq === -1 ? first : first.slice(0, eq)).trim().slice(0, 100),
      secure: attributeNames.includes('secure'),
      httpOnly: attributeNames.includes('httponly'),
      sameSite: sameSite ? String(sameSite.split('=')[1] || '').trim().toLowerCase() : ''
    };
  }).filter(cookie => cookie.name);
}

// Minimal security.txt reader (RFC 9116): field names are case-insensitive and
// comments start with "#". Only the fields the audit needs are surfaced.
function parseSecurityTxt(text) {
  const fields = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || !value) continue;
    if (!fields[key]) fields[key] = [];
    fields[key].push(value.slice(0, 500));
  }
  const expires = (fields.expires && fields.expires[0]) || '';
  let expired = false;
  if (expires) {
    const time = Date.parse(expires);
    if (!Number.isNaN(time) && time < Date.now()) expired = true;
  }
  return {
    contacts: fields.contact || [],
    expires,
    expired,
    canonical: (fields.canonical && fields.canonical[0]) || '',
    policy: (fields.policy && fields.policy[0]) || ''
  };
}

// Namespace URLs and schema hints are not mixed content, even though they use
// the http scheme.
const MIXED_CONTENT_IGNORE = /^http:\/\/(www\.w3\.org|schema\.org|purl\.org|ns\.adobe\.com|xmlns\.com)\b/i;

function findMixedContent(html, protocol) {
  if (protocol !== 'https') return { checked: false, count: 0, items: [] };
  const text = String(html || '');
  const items = [];
  const seen = new Set();
  const push = (url) => {
    if (items.length >= 50 || !url) return;
    if (!/^http:\/\//i.test(url)) return;
    if (MIXED_CONTENT_IGNORE.test(url) || seen.has(url)) return;
    seen.add(url);
    items.push(url.slice(0, 300));
  };
  const attrValue = (tag, name) => {
    const match = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    return match ? (match[1] != null ? match[1] : (match[2] != null ? match[2] : match[3])) : '';
  };

  // Resource-loading attributes only. A plain <a href="http://..."> is a
  // navigation link, not mixed content, so href is handled below for <link>.
  const attrRe = /\b(?:src|poster|data|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const srcsetRe = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const linkRe = /<link\b[^>]*>/gi;
  const cssRe = /url\(\s*["']?(http:\/\/[^"')\s>]+)/gi;
  let match;

  while ((match = attrRe.exec(text))) {
    push(match[1] != null ? match[1] : (match[2] != null ? match[2] : match[3]));
  }
  while ((match = srcsetRe.exec(text))) {
    const value = match[1] != null ? match[1] : (match[2] != null ? match[2] : match[3]);
    value.split(',').forEach(candidate => {
      const url = candidate.trim().split(/\s+/)[0];
      push(url);
    });
  }
  while ((match = linkRe.exec(text))) {
    const tag = match[0];
    const rel = attrValue(tag, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.includes('stylesheet') || rel.includes('preload')) push(attrValue(tag, 'href'));
  }
  while ((match = cssRe.exec(text))) push(match[1]);
  return { checked: true, count: items.length, items };
}

function securityCheck(id, title, status, score, weight, detail, fix) {
  return {
    id, title, status,
    score: Math.max(0, Math.min(1, score)),
    weight,
    detail: detail || '',
    fix: fix || ''
  };
}

// Weighted average over every evaluated check. "unknown" rows are skipped so a
// Worker-fallback report (headers only) is not penalised for the missing body.
function gradeFromChecks(checks) {
  let points = 0;
  let total = 0;
  for (const item of checks) {
    if (item.status === 'unknown') continue;
    total += item.weight;
    points += item.weight * item.score;
  }
  const score = total ? Math.round((points / total) * 100) : 0;
  let grade = 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else if (score >= 50) grade = 'E';
  return { grade, score };
}

function buildSecurityReport(data) {
  const headers = data.headers || {};
  const ssl = data.protocol === 'https';
  const checks = [];

  checks.push(securityCheck('https', 'HTTPS',
    ssl ? 'pass' : 'fail', ssl ? 1 : 0, 15,
    ssl ? 'The site answered over HTTPS.' : 'The site answered over plain HTTP.',
    'Serve the site over HTTPS and redirect HTTP to HTTPS.'));

  const hsts = headerValue(headers, 'strict-transport-security');
  const hstsInfo = securityHeaderRules.evaluateHsts(hsts);
  if (!hstsInfo.present) {
    checks.push(securityCheck('hsts', 'HTTP Strict Transport Security', 'fail', 0, 12,
      'No Strict-Transport-Security header.',
      'Add "Strict-Transport-Security: max-age=31536000; includeSubDomains".'));
  } else if (hstsInfo.maxAge == null || hstsInfo.maxAge === 0) {
    checks.push(securityCheck('hsts', 'HTTP Strict Transport Security', 'fail', 0, 12,
      hstsInfo.maxAge === 0 ? 'max-age=0 disables HSTS.' : 'The HSTS header has no valid max-age.',
      'Use "Strict-Transport-Security: max-age=31536000; includeSubDomains".'));
  } else {
    checks.push(securityCheck('hsts', 'HTTP Strict Transport Security',
      hstsInfo.status, hstsInfo.score, 12, hsts,
      'Use a max-age of at least one year and add includeSubDomains.'));
  }

  const preloadReady = hstsInfo.preloadReady;
  checks.push(securityCheck('hsts-preload', 'HSTS preload readiness',
    !hstsInfo.present ? 'fail' : (preloadReady ? 'pass' : 'warn'),
    !hstsInfo.present ? 0 : (preloadReady ? 1 : 0.4), 6,
    preloadReady
      ? 'The HSTS header satisfies the preload requirements (submit it at hstspreload.org to be included).'
      : 'The HSTS header is missing preload, includeSubDomains or a one-year max-age.',
    'Emit "max-age=31536000; includeSubDomains; preload", then submit the domain to the preload list.'));

  const csp = headerValue(headers, 'content-security-policy');
  const cspInfo = securityHeaderRules.evaluateCsp(csp);
  if (!csp) {
    checks.push(securityCheck('csp', 'Content-Security-Policy', 'fail', 0, 12,
      'No Content-Security-Policy header.',
      "Define a policy, for example \"default-src 'self'\"."));
  } else if (!cspInfo.hasScriptPolicy) {
    checks.push(securityCheck('csp', 'Content-Security-Policy', 'fail', 0, 12,
      'CSP has no default-src or script-src directive.',
      'Add default-src or script-src to restrict what the page may load.'));
  } else {
    const weak = cspInfo.unsafeInline || cspInfo.unsafeEval || cspInfo.wildcard;
    let score = weak ? 0.4 : 0.8;
    if (cspInfo.hasDefaultSrc) score += 0.2;
    const problems = [];
    if (cspInfo.unsafeInline) problems.push("unsafe-inline without a nonce/strict-dynamic");
    if (cspInfo.unsafeEval) problems.push('unsafe-eval');
    if (cspInfo.wildcard) problems.push('wildcard sources');
    checks.push(securityCheck('csp', 'Content-Security-Policy', weak ? 'warn' : 'pass', score, 12,
      csp.slice(0, 300),
      weak ? 'Remove ' + problems.join(', ') + '.' : ''));
  }

  const xcto = headerValue(headers, 'x-content-type-options');
  const xctoOk = /nosniff/i.test(xcto);
  checks.push(securityCheck('xcto', 'X-Content-Type-Options',
    xctoOk ? 'pass' : 'fail', xctoOk ? 1 : 0, 6,
    xctoOk ? xcto : 'Missing or invalid X-Content-Type-Options.',
    'Add "X-Content-Type-Options: nosniff".'));

  const xfo = headerValue(headers, 'x-frame-options');
  const frameInfo = securityHeaderRules.evaluateFrameProtection(xfo, cspInfo);
  checks.push(securityCheck('frame', 'Clickjacking protection',
    frameInfo.protected ? 'pass' : 'fail', frameInfo.protected ? 1 : 0, 6,
    frameInfo.protected
      ? (frameInfo.cspRestrictive ? 'CSP frame-ancestors is set.' : xfo)
      : (frameInfo.wildcard
        ? 'CSP frame-ancestors * does not restrict framing.'
        : 'Neither X-Frame-Options nor a restrictive CSP frame-ancestors is set.'),
    "Add \"X-Frame-Options: DENY\" or CSP \"frame-ancestors 'none'\"."));

  const referrer = headerValue(headers, 'referrer-policy');
  let referrerStatus = 'fail';
  let referrerScore = 0;
  let referrerDetail = 'No Referrer-Policy header.';
  if (referrer) {
    if (/unsafe-url|no-referrer-when-downgrade/i.test(referrer)) {
      referrerStatus = 'warn';
      referrerScore = 0.5;
    } else {
      referrerStatus = 'pass';
      referrerScore = 1;
    }
    referrerDetail = referrer;
  }
  checks.push(securityCheck('referrer', 'Referrer-Policy', referrerStatus, referrerScore, 5,
    referrerDetail, 'Use strict-origin-when-cross-origin or no-referrer.'));

  const permissions = headerValue(headers, 'permissions-policy');
  checks.push(securityCheck('permissions', 'Permissions-Policy',
    permissions ? 'pass' : 'warn', permissions ? 1 : 0, 4,
    permissions || 'No Permissions-Policy header.',
    'Restrict browser features the site does not use.'));

  const coop = headerValue(headers, 'cross-origin-opener-policy');
  checks.push(securityCheck('coop', 'Cross-Origin-Opener-Policy',
    coop ? 'pass' : 'warn', coop ? 1 : 0, 3,
    coop || 'No Cross-Origin-Opener-Policy header.', ''));

  if (data.securityTxt == null) {
    checks.push(securityCheck('security-txt', 'security.txt', 'unknown', 0, 8, 'Not evaluated.', ''));
  } else if (data.securityTxt.found) {
    const hasContact = data.securityTxt.contacts.length > 0;
    let score = hasContact ? 1 : 0.5;
    if (data.securityTxt.expired) score = Math.min(score, 0.5);
    checks.push(securityCheck('security-txt', 'security.txt',
      hasContact && !data.securityTxt.expired ? 'pass' : 'warn', score, 8,
      data.securityTxt.url +
        (hasContact ? '' : ' (no Contact field)') +
        (data.securityTxt.expired ? ' (Expires is in the past)' : ''),
      'Publish a current Contact and Expires field.'));
  } else {
    checks.push(securityCheck('security-txt', 'security.txt', 'warn', 0, 8,
      'No /.well-known/security.txt found.',
      'Add a security.txt so researchers know how to report issues.'));
  }

  if (data.cookies == null) {
    checks.push(securityCheck('cookies', 'Cookie flags', 'unknown', 0, 8, 'Not evaluated.', ''));
  } else if (!data.cookies.length) {
    checks.push(securityCheck('cookies', 'Cookie flags', 'pass', 1, 8,
      'No cookies were set on the first response.', ''));
  } else {
    const weak = data.cookies.filter(cookie => !cookie.secure || !cookie.httpOnly || !cookie.sameSite);
    const score = Math.max(0, 1 - weak.length / data.cookies.length);
    checks.push(securityCheck('cookies', 'Cookie flags', weak.length ? 'warn' : 'pass', score, 8,
      data.cookies.map(cookie =>
        cookie.name +
        (cookie.secure ? ' [Secure]' : ' [no Secure]') +
        (cookie.httpOnly ? ' [HttpOnly]' : ' [no HttpOnly]') +
        (cookie.sameSite ? ' [SameSite=' + cookie.sameSite + ']' : ' [no SameSite]')
      ).join('; '),
      'Set Secure, HttpOnly and SameSite on every cookie.'));
  }

  if (data.bodyChecked === false) {
    checks.push(securityCheck('mixed', 'Mixed content', 'unknown', 0, 8, 'Not evaluated.', ''));
  } else if (!ssl) {
    checks.push(securityCheck('mixed', 'Mixed content', 'unknown', 0, 8, 'Only checked over HTTPS.', ''));
  } else if (!data.mixedContent || data.mixedContent.count === 0) {
    checks.push(securityCheck('mixed', 'Mixed content', 'pass', 1, 8,
      'No http:// resources were found in the HTML.', ''));
  } else {
    checks.push(securityCheck('mixed', 'Mixed content', 'fail', 0, 8,
      data.mixedContent.count + ' http:// resource(s), e.g. ' +
        data.mixedContent.items.slice(0, 3).join(', '),
      'Load every resource over HTTPS.'));
  }

  const { grade, score } = gradeFromChecks(checks);
  return {
    host: data.host,
    ip: data.ip || null,
    protocol: data.protocol,
    status: data.status || null,
    finalUrl: data.finalUrl || '',
    source: data.source || 'local',
    bodyChecked: data.bodyChecked !== false,
    grade,
    score,
    checks,
    cookies: data.cookies || [],
    securityTxt: data.securityTxt || { found: false },
    mixedContent: data.mixedContent || { checked: false, count: 0, items: [] },
    errors: data.errors || {}
  };
}

async function fetchWithinBudget(ip, host, path, secure, deadline) {
  const remaining = deadline ? deadline - Date.now() : OUTBOUND_TIMEOUT;
  if (remaining < 250) return { error: 'timeout' };
  const limit = Math.min(OUTBOUND_TIMEOUT, remaining);
  try {
    return await withTimeout(
      outbound(() => fetchOnce(ip, host, path, secure, limit)),
      limit + 100,
      'timeout'
    );
  } catch (e) {
    if (e.busy) throw e;
    return { error: e.message || 'timeout' };
  }
}

async function fetchSecurityTxt(ip, host, deadline) {
  const paths = ['/.well-known/security.txt', '/security.txt'];
  // Both locations are fetched together instead of one timeout after another.
  const results = await Promise.all(paths.map(path =>
    fetchWithinBudget(ip, host, path, true, deadline)
      .catch(e => ({ error: e.message || 'error' }))
  ));
  for (let i = 0; i < paths.length; i++) {
    const result = results[i];
    if (result.error || !(result.status >= 200 && result.status < 300) || !result.body) continue;
    // A SPA often answers every path with index.html. RFC 9116 files are plain
    // text, and a file without Contact is not a usable security.txt.
    const contentType = headerValue(result.headers, 'content-type');
    if (!/^text\/plain\b/i.test(contentType)) continue;
    const parsed = parseSecurityTxt(result.body);
    if (!parsed.contacts.length) continue;
    return Object.assign({ url: 'https://' + host + paths[i] }, parsed);
  }
  return null;
}

async function securityAuditLocal(host, context) {
  const deadline = context && context.deadline;
  const ips = await resolvePublic(host);
  const ip = pickAddress(ips);
  // Start security.txt immediately and let the main page fetch run alongside.
  const securityTxtPromise = fetchSecurityTxt(ip, host, deadline);
  let result = await fetchWithinBudget(ip, host, '/', true, deadline);
  let protocol = 'https';
  if (result.error) {
    const httpResult = await fetchWithinBudget(ip, host, '/', false, deadline);
    if (!httpResult.error) { result = httpResult; protocol = 'http'; }
  }
  if (result.error) {
    const error = new Error(result.error);
    error.unresolved = true;
    throw error;
  }

  const headers = result.headers || {};
  const body = result.body || '';
  const errors = {};
  let securityTxt = null;
  try {
    const found = await securityTxtPromise;
    securityTxt = found || { found: false };
  } catch (e) {
    errors.securityTxt = e.message || 'error';
    securityTxt = { found: false };
  }

  return buildSecurityReport({
    host,
    ip,
    protocol,
    status: result.status || null,
    finalUrl: result.finalUrl || '',
    headers,
    body,
    cookies: parseCookies(headers),
    securityTxt,
    mixedContent: findMixedContent(body, protocol),
    bodyChecked: true,
    source: 'local',
    errors
  });
}

// Local first. When the local fetch never produced an HTTP status (censorship,
// blocked route, timeout) the Worker is asked for the response headers, and the
// audit is graded from the checks that can still be evaluated.
async function securityAudit(host, context) {
  try {
    return await securityAuditLocal(host, context);
  } catch (e) {
    if (e.status || e.blocked || e.busy) throw e;

    const external = await callExternal(
      opts => externalCheck.checkHttp(host, { follow: true, timeoutMs: opts.timeoutMs }),
      context
    );
    if (external.error || !external.status) {
      return {
        host,
        status: null,
        protocol: 'https',
        error: external.error || e.message || 'local check failed',
        source: external.error ? 'local' : 'worker',
        unavailable: Boolean(external.unavailable)
      };
    }

    const headers = {};
    for (const item of external.headers || []) headers[item.name.toLowerCase()] = item.value;
    const report = buildSecurityReport({
      host,
      ip: null,
      protocol: external.protocol,
      status: external.status,
      finalUrl: external.finalUrl || '',
      headers,
      body: '',
      cookies: null,
      securityTxt: null,
      mixedContent: { checked: false, count: 0, items: [] },
      bodyChecked: false,
      source: 'worker'
    });
    report.localError = e.message || null;
    return report;
  }
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  res._orbitStarted = Date.now();
  const parsed = new URL(req.url, 'http://localhost');
  const path = parsed.pathname;
  const query = parsed.searchParams;

  // Deliberate: OrbitNet is a public, credential-less API. There are no cookies,
  // sessions or per-user secrets, and rate limiting is per client IP, so a
  // permissive CORS policy only enables third-party frontends to call the same
  // public data. It does expose the client's own IP/geo to any site that calls
  // /api/ip from the visitor's browser, which is why rate limits stay strict.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const ip = clientIp(req);
  const externalContext = requestContext(ip);
  const limited = path === '/api/ip' || path === '/api/geo' || path === '/api/dns' ||
    path === '/api/port' || path === '/api/captcha' || path === '/api/whois' || path === '/api/site' ||
    path === '/api/tls' || path === '/api/headers' || path === '/api/email' ||
    path === '/api/propagation' || path === '/api/dnssec' || path === '/api/redirect' ||
    path === '/api/spam' || path === '/api/security' ||
    path === '/api/anonymity' || path === '/api/anonymity/ports' ||
    path === '/api/anonymity/ping';

  try {
    // /health is internal (Docker healthcheck, localhost only). The public
    // /api/health alias must not expose uptime or operational counters.
    if (path === '/health') return send(res, 200, healthPayload());
    if (path === '/api/health') return send(res, 200, { ok: true });

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
        const resolved = await resolvePublicWithWorker(hostParam, externalContext);
        target = pickAddress(resolved.ips);
      }
      return send(res, 200, { ip: target, geo: await geoLookup(target) });
    }

    if (path === '/api/dns') {
      const host = query.get('host') || '';
      const type = parseType(query.get('type'));
      if (!type) return bad(res, 'Unsupported record type');
      const literal = normalizeIp(host);
      // allow IP lookups too (IPv4 and IPv6)
      if (net.isIP(literal)) {
        if (type === 'PTR') {
          let records = [];
          let err = null;
          let source = 'local';
          try {
            records = await withTimeout(dns.reverse(literal), DNS_TIMEOUT, 'timeout');
          } catch (e) {
            err = e.code || 'error';
            const empty = e.code === 'ENODATA' || e.code === 'ENOTFOUND';
            const fallback = isPublicIp(literal) &&
              (isDnsTransportError(e.code) || (empty && !(await localDnsHealthy())));
            if (fallback) {
              const cacheKey = externalCacheKey('ptr', literal, 'PTR');
              let external = getExternalCache(cacheKey);
              if (!external) {
                external = await callExternal(
                  opts => externalCheck.checkDns(literal, 'PTR', opts),
                  externalContext
                );
                if (!external.error) setExternalCache(cacheKey, external);
              }
              if (!external.error) {
                records = Array.isArray(external.records) ? external.records : [];
                if (records.length) err = null;
                else if (external.nxdomain) err = 'NXDOMAIN';
                else err = err || 'ENODATA';
                source = 'worker';
              } else {
                logExternalFailure(external.error);
              }
            }
          }
          return send(res, 200, { host, type: 'PTR', records, error: err, source });
        }
        if (net.isIPv4(literal) && type === 'A') {
          return send(res, 200, { host, type: 'A', records: [literal], source: 'local' });
        }
        return bad(res, 'For an IP address use type=PTR (or type=A for IPv4)');
      }
      if (type === 'PTR') return bad(res, 'PTR lookup requires an IP address');
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      let records;
      let nxdomain = false;
      let source = 'local';
      try {
        records = await outbound(() => dnsLookup(host, type));
      } catch (e) {
        if (e.busy) throw e;
        const empty = e.code === 'ENODATA' || e.code === 'ENOTFOUND';
        // ENODATA is a normal "no such record" answer and only justifies a
        // Worker call when the resolver also fails a canary query. ENOTFOUND is
        // ambiguous: it is both a genuine NXDOMAIN and a common signature of DNS
        // filtering. Retry through the Worker under the dedicated fallback
        // limits, then cache the successful answer.
        const fallback = isDnsTransportError(e.code) || e.code === 'ENOTFOUND' ||
          (empty && !(await localDnsHealthy()));
        if (!fallback) {
          if (e.code === 'ENODATA') {
            return send(res, 200, { host, type, records: [], nodata: true, source: 'local' });
          }
          throw e;
        }
        const cacheKey = externalCacheKey('dns', host, type);
        let external = getExternalCache(cacheKey);
        if (!external) {
          external = await callExternal(
            opts => externalCheck.checkDns(host, type, opts),
            externalContext,
            { nxdomain: e.code === 'ENOTFOUND' }
          );
          if (!external.error) setExternalCache(cacheKey, external);
        }
        if (external.error) {
          logExternalFailure(external.error);
          if (e.code === 'ENOTFOUND') {
            return send(res, 200, { host, type, records: [], nxdomain: true, source: 'local' });
          }
          throw e;
        }
        records = external.records;
        nxdomain = external.nxdomain === true;
        source = 'worker';
      }
      const response = { host, type, records, source };
      if (nxdomain) response.nxdomain = true;
      else if (Array.isArray(records) && !records.length) response.nodata = true;
      return send(res, 200, response);
    }

    if (path === '/api/dnssec') {
      const host = externalCheck.normalizeDnsName(query.get('host') || '');
      const type = parseType(query.get('type'), DNSSEC_TYPES);
      if (!type) return bad(res, 'Unsupported record type');
      if (!host) return bad(res, 'Invalid hostname');
      return send(res, 200, await dnssecInfo(host, type, externalContext));
    }

    if (path === '/api/captcha') {
      return send(res, 200, createCaptcha(ip));
    }

    if (path === '/api/port') {
      if (req.method !== 'POST') {
        return send(res, 405, { error: 'Use POST with a JSON body' });
      }
      const body = await readJsonBody(req);
      const host = String(body.host || '').trim();
      const portStr = String(body.port == null ? '' : body.port).trim();
      const captchaId = String(body.captcha || '');
      const captchaAnswer = String(body.answer || '');
      if (!/^\d{1,5}$/.test(portStr)) return bad(res, 'Port must be 1-65535');
      const port = parseInt(portStr, 10);
      if (!isValidHost(host) && !net.isIP(normalizeIp(host))) return bad(res, 'Invalid hostname');
      if (port < 1 || port > 65535) return bad(res, 'Port must be 1-65535');

      const attempt = getPortAttempt(ip);
      const needCaptcha = (attempt.count + 1) % PORT_ATTEMPT_EVERY === 0;
      if (needCaptcha) {
        if (!captchaId) {
          return send(res, 403, {
            error: 'Captcha required for this check',
            captchaRequired: true
          });
        }
        if (!verifyCaptcha(captchaId, captchaAnswer, ip)) {
          return send(res, 403, {
            error: 'Captcha failed, request a new one',
            captchaRequired: true
          });
        }
      }

      if (isRateLimited(ip, portHits, PORT_RATE_MAX)) {
        return send(res, 429, { error: 'Too many port checks, wait a minute' });
      }

      attempt.count++;
      attempt.updated = Date.now();

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
      const result = await siteInfo(host, externalContext);
      return send(res, 200, result);
    }

    if (path === '/api/headers') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      return send(res, 200, await headersInfo(host, externalContext));
    }

    if (path === '/api/tls') {
      const host = query.get('host') || '';
      const portStr = query.get('port') || '443';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      if (!/^\d{1,5}$/.test(portStr)) return bad(res, 'Port must be 1-65535');
      const port = parseInt(portStr, 10);
      if (!TLS_PORTS.has(port)) {
        return bad(res, 'TLS checks are limited to ports ' + [...TLS_PORTS].join(', '));
      }
      const deep = query.get('deep') === '1' || query.get('deep') === 'true';
      if (deep && isRateLimited(ip, tlsDeepHits, TLS_DEEP_RATE_MAX)) {
        return send(res, 429, { error: 'Deep TLS scans are limited to ' + TLS_DEEP_RATE_MAX + ' per minute' });
      }
      return send(res, 200, await tlsInfo(host, port, { deep, context: externalContext }));
    }

    if (path === '/api/email') {
      const host = query.get('host') || '';
      const selector = (query.get('selector') || '').trim();
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      if (selector && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(selector)) {
        return bad(res, 'Invalid DKIM selector');
      }
      return send(res, 200, await emailInfo(host, selector, externalContext));
    }

    if (path === '/api/propagation') {
      const host = query.get('host') || '';
      const type = parseType(query.get('type'), PROPAGATION_TYPES);
      if (!type) return bad(res, 'Unsupported record type');
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      let resolvers = await propagation(host, type);
      let source = 'local';
      const allFailed = resolvers.length && resolvers.every(r => r.error);
      const allFallbackCodes = allFailed &&
        resolvers.every(r => isDnsTransportError(r.error) || r.error === 'ENOTFOUND');
      const allNxdomain = allFailed && resolvers.every(r => r.error === 'ENOTFOUND');
      if (allFallbackCodes) {
        const cacheKey = externalCacheKey('propagation', host, type);
        let external = getExternalCache(cacheKey);
        if (!external) {
          external = await callExternal(
            opts => externalCheck.checkPropagation(host, type, opts),
            externalContext,
            { nxdomain: allNxdomain }
          );
          if (!external.error) setExternalCache(cacheKey, external);
        }
        if (!external.error && external.resolvers.length) {
          resolvers = external.resolvers;
          source = 'worker';
        } else if (external.error) {
          logExternalFailure(external.error);
        }
      }
      return send(res, 200, { host, type, resolvers, source });
    }

    if (path === '/api/redirect') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      return send(res, 200, await redirectChain(host, externalContext));
    }

    if (path === '/api/security') {
      const host = query.get('host') || '';
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      if (isRateLimited(ip, securityHits, SECURITY_RATE_MAX)) {
        return send(res, 429, { error: 'Too many security audits, wait a minute' });
      }
      return send(res, 200, await securityAudit(host, externalContext));
    }

    if (path === '/api/spam') {
      const target = (query.get('target') || '').trim();
      if (!target) return bad(res, 'Provide an IP address, domain or email');
      if (isRateLimited(ip, spamHits, SPAM_RATE_MAX)) {
        return send(res, 429, { error: 'Too many spam checks, wait a minute' });
      }
      const result = await spamCheck(target, { deadline: externalContext.deadline });
      if (!result) return bad(res, 'Provide a valid public IP address, domain or email');
      return send(res, 200, result);
    }

    if (path === '/api/anonymity') {
      return send(res, 200, await anonymityInfo(req));
    }

    if (path === '/api/anonymity/ports') {
      const requested = normalizeIp(query.get('ip') || '');
      if (!net.isIP(requested)) return bad(res, 'A valid IP address is required');
      if (!isPublicIp(requested)) return bad(res, 'Only public IP addresses are allowed');
      if (requested.toLowerCase() !== ip.toLowerCase()) {
        return send(res, 403, { error: 'Active port checks are limited to your own public IP' });
      }
      return send(res, 200, await anonymityPorts(requested));
    }

    if (path === '/api/anonymity/ping') {
      const nonce = String(query.get('nonce') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 64);
      return send(res, 200, { nonce, serverTime: Date.now(), ip });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('OrbitNet backend listening on :' + PORT);
    // Warm the Tor exit-list cache in the background so the first request does
    // not have to wait for the download.
    torExitSet().catch(() => {});
  });
}

module.exports = {
  normalizeIp, isPublicIp, clientIp, server, siteInfo, tlsInfo, headersInfo, emailInfo,
  resolvePublicWithWorker,
  decodeHtml, propagation, redirectChain, anonymityInfo, anonymityPorts, torStatus,
  hostingSignals, hostnameSignals, proxyHeaderSignals, externalImproves, looksLikeBlockPage,
  spamCheck, parseSpamTarget, parseDnsblRecords, reverseIpName, spamCodeInfo,
  SPAM_IP_LISTS, SPAM_DOMAIN_LISTS, SPAM_CACHE_TTL, SPAM_BLOCKED_CACHE_TTL,
  registrableDomain, domainSuffixes,
  securityAudit, buildSecurityReport, gradeFromChecks, parseSecurityTxt,
  parseCookies, parseMaxAge, findMixedContent, fetchSecurityTxt,
  securityHeaderRules,
  parseSubjectAltName, classifyCipher, summarizeTlsVersions, normalizeCaaRecord,
  caaLookup, TLS_VERSION_PROBES, TLS_CIPHER_PROBES,
  TLS_VALIDITY_SCHEDULE, validityLimitFor, certificateValidityInfo,
  evaluatePublicKey, hasEmbeddedSct, parseInfoAccess, parseAltSvc,
  analyzeCertificateChain, incompleteChainReason, checkCertificateHostname,
  inspectCertificate, describeCertificateChain, buildTlsReport, gradeTls: buildTlsReport,
  firstTlsBase,
  TLS_GRADE_RULES, readAltSvcOnSocket, SCT_OID_DER
};
