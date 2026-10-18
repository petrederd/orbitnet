const http = require('http');
const dns = require('dns').promises;
const net = require('net');

const PORT = process.env.PORT || 3000;

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

// ---------- validation ----------
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
function isValidHost(host) {
  return typeof host === 'string' && host.length <= 253 && HOSTNAME_RE.test(host);
}
function isValidIpv4(ip) {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255);
}
function sanitizeType(t) {
  return /^[A-Z]{1,6}$/.test(t || '') ? t.toUpperCase() : 'A';
}

// ---------- /api/ip ----------
async function ipInfo(req) {
  const xff = req.headers['x-forwarded-for'];
  const remote = (xff && xff.split(',')[0].trim()) || req.socket.remoteAddress || '';
  const ip = remote.replace(/^::ffff:/, '');

  let hostname = '';
  try {
    hostname = await dns.reverse(ip);
    hostname = hostname[0] || '';
  } catch (e) { hostname = ''; }

  const version = ip.includes(':') ? 6 : 4;
  return { ip, version, hostname };
}

// ---------- /api/dns ----------
async function dnsLookup(host, type) {
  const resolver = new dns.Resolver();
  try {
    if (type === 'A' || type === 'AAAA') {
      const records = await dns.resolve(host, type);
      return records;
    }
    if (type === 'CNAME') {
      const records = await dns.resolveCname(host);
      return records;
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
function checkPort(host, port, timeout) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const to = timeout || 3000;
    let done = false;
    const finish = (open, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ host, port, open, error: err || null });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), to);
    sock.setTimeout(to);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false, 'timeout'));
    sock.once('error', (e) => finish(false, e.code || 'error'));
    sock.connect(port, host);
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
    const raw = await queryWhois(host, server, 43);
    return raw;
  } catch (e) {
    // fallback to iana
    const raw = await queryWhois(host, 'whois.iana.org', 43);
    return raw;
  }
}

// ---------- /api/site ----------
// Follows redirects, returns HTTP status, server header, page title and timing.
function fetchOnce(targetHost, path, secure, timeout) {
  return new Promise((resolve) => {
    const lib = secure ? require('https') : http;
    const start = Date.now();
    const options = {
      hostname: targetHost,
      path: path || '/',
      method: 'GET',
      headers: {
        'User-Agent': 'OrbitNet/1.0 (+https://orbitnet.ru)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: timeout || 8000,
      rejectUnauthorized: false
    };
    const req = lib.request(options, (res) => {
      const status = res.statusCode;
      const headers = res.headers;
      if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
        res.resume();
        return resolve({ status, redirect: headers.location, ms: Date.now() - start, headers });
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
          finalUrl: (secure ? 'https://' : 'http://') + targetHost + path
        });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - start }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - start }));
    req.end();
  });
}

async function siteInfo(host) {
  const address = await dns.lookup(host, { family: 4 });
  // Try HTTPS first, fall back to HTTP
  let result = await fetchOnce(host, '/', true);
  let protocol = 'https';
  if (result.error || (result.status && result.status >= 400 && !result.redirect)) {
    const httpResult = await fetchOnce(host, '/', false);
    if (!httpResult.error) { result = httpResult; protocol = 'http'; }
  }
  return {
    host,
    ip: address.address,
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

  try {
    if (path === '/health') return send(res, 200, { ok: true });

    if (path === '/api/ip') {
      return send(res, 200, await ipInfo(req));
    }

    if (path === '/api/dns') {
      const host = query.get('host') || '';
      const type = sanitizeType(query.get('type'));
      // allow IP lookup too
      if (isValidIpv4(host) && type === 'A') {
        return send(res, 200, { host, type: 'A', records: [host] });
      }
      if (isValidIpv4(host) && type === 'PTR') {
        let records = [];
        let err = null;
        try { records = await dns.reverse(host); } catch (e) { err = e.code || 'error'; }
        return send(res, 200, { host, type: 'PTR', records, error: err });
      }
      if (!isValidHost(host)) return bad(res, 'Invalid hostname');
      const records = await dnsLookup(host, type);
      return send(res, 200, { host, type, records });
    }

    if (path === '/api/port') {
      const host = query.get('host') || '';
      const port = parseInt(query.get('port'), 10);
      if (!isValidHost(host) && !isValidIpv4(host)) return bad(res, 'Invalid hostname');
      if (isNaN(port) || port < 1 || port > 65535) return bad(res, 'Port must be 1-65535');
      const result = await checkPort(host, port);
      return send(res, 200, result);
    }

    if (path === '/api/whois') {
      const host = query.get('host') || '';
      if (!isValidHost(host) && !isValidIpv4(host)) return bad(res, 'Invalid hostname');
      const raw = await whoisLookup(host);
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
    return send(res, 500, { error: e.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log('OrbitNet backend listening on :' + PORT);
});