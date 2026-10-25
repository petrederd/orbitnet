// OrbitNet external checker.
//
// Called only by the OrbitNet backend, never by browsers. The shared secret is
// stored as a Worker secret (wrangler secret put CHECKER_SECRET) and is checked
// on every request.
//
// Request:
//   POST /  {"type":"http","host":"example.com","follow":true}
//   POST /  {"type":"dns","host":"example.com","recordType":"A"}
//   POST /  {"type":"propagation","host":"example.com","recordType":"A"}
//   POST /  {"type":"email","host":"example.com","selector":"default"}
//   POST /  {"type":"dnssec","host":"example.com","recordType":"A"}
// Header: Authorization: Bearer <CHECKER_SECRET>
//
// The worker is a fallback for checks that the Russian server cannot complete
// because of DNS filtering, RKN blocking or an unreachable route. It never
// receives a URL with credentials and never follows a redirect to a private or
// otherwise non-public address.

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_HTML_BYTES = 200000;
const MAX_RESPONSE_HEADERS = 100;
const MAX_HEADER_VALUE = 2048;
const MAX_REDIRECTS = 10;
const HTTP_TIMEOUT_MS = 8000;
const HTTP_TOTAL_TIMEOUT_MS = 12000;
const DNS_TIMEOUT_MS = 5000;
const DNSSEC_QUERY_TIMEOUT_MS = 3000;
const DNSSEC_DEADLINE_MS = 12000;
const DNSSEC_EXPIRY_WARNING_SECONDS = 3 * 24 * 60 * 60;

const USER_AGENT = "OrbitNet-Checker/1.1 (+https://orbitnet.ru)";

const DNS_RESOLVERS = [
  { name: "Cloudflare 1.1.1.1", url: "https://cloudflare-dns.com/dns-query" },
  { name: "Google 8.8.8.8", url: "https://dns.google/resolve" },
  { name: "AdGuard 94.140.14.14", url: "https://dns.adguard-dns.com/resolve" }
];

// DNSSEC needs resolvers that reliably set the AD bit. AdGuard is useful for
// propagation checks but is not used here; two validating resolvers are enough.
const DNSSEC_RESOLVERS = DNS_RESOLVERS.filter(resolver =>
  resolver.url.includes("cloudflare-dns.com") || resolver.url.includes("dns.google")
);

const DEPRECATED_DNSSEC_ALGORITHMS = new Set([3, 5, 6, 7]);
const MODERN_DNSSEC_ALGORITHMS = new Set([13, 15]);

const RECORD_TYPES = new Set([
  "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "PTR"
]);

const FORBIDDEN_SUFFIXES = [
  "localhost", "local", "internal", "home.arpa", "test", "invalid"
];

const SECURITY_HEADERS = {
  strictTransportSecurity: "strict-transport-security",
  contentSecurityPolicy: "content-security-policy",
  xContentTypeOptions: "x-content-type-options",
  xFrameOptions: "x-frame-options",
  referrerPolicy: "referrer-policy",
  permissionsPolicy: "permissions-policy"
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function limitString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function stripDot(value) {
  return String(value || "").replace(/\.$/, "").toLowerCase();
}

function normalizeDomain(raw, allowUnderscore = false) {
  if (typeof raw !== "string") return "";
  const name = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!name || name.length > 253) return "";
  const labels = name.split(".");
  if (labels.length < 2) return "";

  const labelRe = allowUnderscore
    ? /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/
    : /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

  if (!labels.every(label => label.length <= 63 && labelRe.test(label))) {
    return "";
  }
  if (FORBIDDEN_SUFFIXES.some(suffix =>
    name === suffix || name.endsWith("." + suffix)
  )) return "";
  return name;
}

function ipv4ToInt(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (number < 0 || number > 255) return null;
    value = (value * 256) + number;
  }
  return value;
}

function parseIpv6Groups(raw) {
  let s = String(raw || "").split("%")[0].toLowerCase();
  if (!s.includes(":")) return null;

  const dc = s.indexOf("::");
  const head = dc === -1 ? s : s.slice(0, dc);
  const tail = dc === -1 ? "" : s.slice(dc + 2);
  const toGroups = (part) => {
    if (!part) return [];
    const arr = part.split(":");
    const last = arr[arr.length - 1];
    if (last.includes(".")) {
      const v4 = ipv4ToInt(last);
      if (v4 == null) return null;
      arr.pop();
      arr.push(((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
    }
    const groups = arr.map(g => /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN);
    return groups.some(n => !Number.isFinite(n)) ? null : groups;
  };

  const h = toGroups(head);
  const t = toGroups(tail);
  if (h === null || t === null) return null;
  if (dc === -1) return h.length === 8 ? h : null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  return h.concat(new Array(fill).fill(0), t);
}

function isBlockedIpv4(value) {
  const blocked = [
    [0x00000000, 0x00ffffff], // 0.0.0.0/8
    [0x0a000000, 0x0affffff], // 10.0.0.0/8
    [0x64400000, 0x647fffff], // 100.64.0.0/10
    [0x7f000000, 0x7fffffff], // 127.0.0.0/8
    [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
    [0xac100000, 0xac1fffff], // 172.16.0.0/12
    [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
    [0xc6120000, 0xc613ffff], // 198.18.0.0/15
    [0xe0000000, 0xefffffff], // multicast
    [0xf0000000, 0xffffffff]  // reserved
  ];
  return blocked.some(([start, end]) => value >= start && value <= end);
}

function isBlockedIpv6(g) {
  if (g.slice(0, 6).every(n => n === 0)) return true; // ::/96
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every(n => n === 0)) return true; // 64:ff9b::/96
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48
  if (g[0] === 0x0100 && g.slice(1, 4).every(n => n === 0)) return true; // 100::/64
  if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32
  if (g[0] === 0x2001 && g[1] === 2 && g[2] === 0) return true; // 2001:2::/48
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return true; // 2001:10::/28
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0020) return true; // 2001:20::/28
  if (g[0] === 0x2002) return true; // 2002::/16
  if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return true; // 3fff::/20
  if (g[0] === 0x5f00) return true; // 5f00::/16
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

function isPublicIp(raw) {
  const host = String(raw || "").trim().toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;

  const v4 = ipv4ToInt(host);
  if (v4 != null) return !isBlockedIpv4(v4);

  const groups = parseIpv6Groups(host);
  if (!groups) return false;

  // IPv4-mapped ::ffff:0:0/96 is checked as its embedded IPv4 address,
  // matching the backend. This catches ::ffff:127.0.0.1 and its compressed
  // ::ffff:7f00:1 form.
  if (groups.slice(0, 5).every(n => n === 0) && groups[5] === 0xffff) {
    return !isBlockedIpv4(((groups[6] << 16) | groups[7]) >>> 0);
  }

  return !isBlockedIpv6(groups);
}

function normalizeHttpHost(raw) {
  if (typeof raw !== "string") return "";
  const host = raw.trim().toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host || host.length > 253) return "";
  if (ipv4ToInt(host) != null || host.includes(":")) {
    return isPublicIp(host) ? host : "";
  }
  const name = normalizeDomain(host, false);
  if (!name) return "";

  // The URL parser accepts shorthand IPv4 forms such as 127.1, 2130706433 and
  // 0x7f000001. Reject anything that normalises to an IP literal instead of
  // letting fetch resolve it to a private address.
  let parsed;
  try {
    parsed = new URL("http://" + host + "/");
  } catch {
    return "";
  }
  const normalized = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (ipv4ToInt(normalized) != null) {
    return isPublicIp(normalized) ? normalized : "";
  }
  return name;
}

function normalizeDnsName(raw) {
  if (typeof raw !== "string") return "";
  const name = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!name || name.length > 253) return "";
  if (ipv4ToInt(name) != null || name.includes(":")) return "";
  return normalizeDomain(name, true);
}

function isPublicHttpUrl(url) {
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipv4ToInt(host) != null || host.includes(":")) return isPublicIp(host);
  return Boolean(normalizeDomain(host, false));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response, maxBytes = MAX_HTML_BYTES, contentType = "") {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;
  let tail = "";

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }

      const remaining = maxBytes - total;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;

      // The head (including the real <title>) is always before </head>. Stop
      // there instead of at the first </title>, because inline SVG may contain
      // its own <title> before the document title.
      const text = new TextDecoder("latin1").decode(chunk);
      const search = (tail + text).toLowerCase();
      if (search.includes("</head>")) break;
      tail = search.slice(-16);

      if (chunk.byteLength < value.byteLength) break;
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decodeHtml(bytes, contentType);
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {}
    }
  }
}

function charsetFromContentType(value) {
  const match = String(value || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function charsetFromHtml(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const meta = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i);
  if (meta) return meta[1].toLowerCase();
  const httpEquiv = head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_-]+)/i);
  return httpEquiv ? httpEquiv[1].toLowerCase() : "";
}

function decodeHtml(bytes, contentType) {
  try {
    const label = charsetFromContentType(contentType) || charsetFromHtml(bytes) || "utf-8";
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function extractTitle(html) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  const scope = (head ? head[1] : html).replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, "");
  const match = scope.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!match) return null;

  return match[1]
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || null;
}

function collectHeaders(headers) {
  const out = {};
  let count = 0;
  for (const [name, value] of headers) {
    if (count++ >= MAX_RESPONSE_HEADERS) break;
    out[name.toLowerCase()] = limitString(String(value), MAX_HEADER_VALUE);
  }
  return out;
}

function headersToList(map) {
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

function securityHeaderFlags(map) {
  const flags = {};
  for (const [key, name] of Object.entries(SECURITY_HEADERS)) {
    flags[key] = map[name] ? "present" : "missing";
  }
  return flags;
}

function parseContentLength(value) {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

async function inspectHttp(rawHost, path = "/", follow = false) {
  const host = normalizeHttpHost(rawHost);
  if (!host) return { ok: false, error: "Invalid or non-public host" };

  const authority = host.includes(":") ? "[" + host + "]" : host;
  const safePath = typeof path === "string" && path.startsWith("/") &&
    path.length <= 2048 ? path : "/";
  const started = Date.now();
  const deadline = started + HTTP_TOTAL_TIMEOUT_MS;
  const redirects = [];
  let current = new URL("https://" + authority + safePath);
  let protocol = "https";
  let triedPlainHttp = false;
  let lastError = "Connection failed";

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(current)) {
      return {
        ok: false,
        type: "http",
        host,
        reachable: false,
        error: "Redirect target is not public",
        redirects,
        responseMs: Date.now() - started
      };
    }

    const hopStarted = Date.now();
    const remaining = deadline - hopStarted;
    if (remaining < 250) {
      redirects.push({
        url: current.href,
        status: null,
        location: "",
        error: "Connection timed out",
        ms: 0
      });
      return {
        ok: false,
        type: "http",
        host,
        reachable: false,
        httpOk: false,
        status: null,
        protocol,
        error: "Connection timed out",
        responseMs: Date.now() - started,
        redirects
      };
    }

    let response;
    try {
      response = await fetchWithTimeout(current.href, Math.min(HTTP_TIMEOUT_MS, remaining));
    } catch (error) {
      lastError = error && error.name === "AbortError"
        ? "Connection timed out"
        : "Connection failed";

      // Match the local checks: if HTTPS cannot connect, retry the first hop
      // over plain HTTP before giving up.
      if (hop === 0 && current.protocol === "https:" && !triedPlainHttp) {
        triedPlainHttp = true;
        protocol = "http";
        current = new URL("http://" + authority + safePath);
        hop--;
        continue;
      }

      redirects.push({
        url: current.href,
        status: null,
        location: "",
        error: lastError,
        ms: Date.now() - hopStarted
      });
      return {
        ok: false,
        type: "http",
        host,
        reachable: false,
        httpOk: false,
        status: null,
        protocol,
        error: lastError,
        responseMs: Date.now() - started,
        redirects
      };
    }

    const status = response.status;
    const location = limitString(response.headers.get("location") || "", 2048);
    const isRedirect = [301, 302, 303, 307, 308].includes(status) && location;
    const contentType = response.headers.get("content-type") || "";
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);

    let title = null;
    if (!isRedirect && isHtml && status >= 200 && status < 300) {
      const html = await readLimitedText(response, MAX_HTML_BYTES, contentType);
      title = extractTitle(html);
    } else {
      try {
        await response.body?.cancel();
      } catch {}
    }

    const headerMap = collectHeaders(response.headers);
    const finalUrl = current.href;

    redirects.push({
      url: finalUrl,
      status,
      location: isRedirect ? location : "",
      ms: Date.now() - hopStarted
    });

    const canFollow = follow && isRedirect && hop < MAX_REDIRECTS;
    if (canFollow) {
      let next = null;
      try {
        next = new URL(location, current);
      } catch {}
      if (!next || !isPublicHttpUrl(next)) {
        if (next) redirects[redirects.length - 1].error = "Redirect target is not public";
        return {
          ok: false,
          type: "http",
          host,
          reachable: true,
          httpOk: false,
          status,
          protocol: current.protocol.slice(0, -1),
          error: "Redirect target is not public",
          responseMs: Date.now() - started,
          redirects
        };
      }
      current = next;
      continue;
    }

    return {
      ok: true,
      type: "http",
      host,
      reachable: true,
      httpOk: status >= 200 && status < 400,
      protocol: current.protocol.slice(0, -1),
      status,
      statusText: response.statusText,
      responseMs: Date.now() - started,
      redirect: isRedirect ? location : null,
      finalUrl,
      redirects,
      title,
      headers: headersToList(headerMap),
      headerMap,
      securityHeaders: securityHeaderFlags(headerMap),
      contentType: contentType || null,
      contentLength: parseContentLength(headerMap["content-length"]),
      server: headerMap.server || null,
      source: "Cloudflare Worker"
    };
  }

  return {
    ok: false,
    type: "http",
    host,
    reachable: true,
    error: "Too many redirects",
    responseMs: Date.now() - started,
    redirects
  };
}

function parseTxt(data, separator = " ") {
  const chunks = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(String(data || "")))) {
    chunks.push(match[1].replace(/\\(.)/g, "$1"));
  }
  if (!chunks.length) return String(data || "").replace(/^"|"$/g, "");
  return chunks.join(separator);
}

function parseCaa(data) {
  const match = String(data || "").match(/^(\d+)\s+(\S+)\s+"?([^"]*)"?$/);
  if (!match) return null;
  return { flag: Number(match[1]), tag: match[2], value: match[3] };
}

function parseSoa(data) {
  const parts = String(data || "").trim().split(/\s+/);
  if (parts.length < 7) return null;
  return {
    nsname: stripDot(parts[0]),
    hostmaster: stripDot(parts[1]),
    serial: Number(parts[2]),
    refresh: Number(parts[3]),
    retry: Number(parts[4]),
    expire: Number(parts[5]),
    minttl: Number(parts[6])
  };
}

const DNS_TYPE_NAMES = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  12: "PTR",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  43: "DS",
  46: "RRSIG",
  48: "DNSKEY",
  257: "CAA"
};

function dnssecRecordList(data, type) {
  const list = data && Array.isArray(data.Answer) ? data.Answer : [];
  return list.filter(record => record && record.type === type).slice(0, 100);
}

function parseDnssecDs(record) {
  const parts = String(record && record.data || "").trim().split(/\s+/);
  if (parts.length < 4) return null;
  return {
    keyTag: Number(parts[0]),
    algorithm: Number(parts[1]),
    digestType: Number(parts[2]),
    digest: parts.slice(3).join("").slice(0, 256)
  };
}

function parseDnssecDnskey(record) {
  const parts = String(record && record.data || "").trim().split(/\s+/);
  if (parts.length < 4) return null;
  return {
    flags: Number(parts[0]),
    protocol: Number(parts[1]),
    algorithm: Number(parts[2])
  };
}

function parseDnssecRrsig(record) {
  const parts = String(record && record.data || "").trim().split(/\s+/);
  if (parts.length < 8) return null;
  return {
    name: stripDot(record.name),
    typeCovered: String(parts[0] || "").toUpperCase(),
    algorithm: Number(parts[1]),
    labels: Number(parts[2]),
    originalTtl: Number(parts[3]),
    expiration: Number(parts[4]),
    inception: Number(parts[5]),
    keyTag: Number(parts[6]),
    signer: stripDot(parts[7])
  };
}

function dnssecZoneCandidates(data) {
  const zones = new Set();
  for (const section of [data && data.Answer, data && data.Authority]) {
    if (!Array.isArray(section)) continue;
    for (const record of section) {
      if (!record) continue;
      if (record.type === 46) {
        const signature = parseDnssecRrsig(record);
        if (signature && signature.signer) zones.add(signature.signer);
      } else if (record.type === 6) {
        const zone = stripDot(record.name);
        if (zone) zones.add(zone);
      }
    }
  }
  return [...zones];
}

function dnssecAnswerRecords(data) {
  const list = data && Array.isArray(data.Answer) ? data.Answer : [];
  return list.filter(record => record && record.type !== 46).slice(0, 50).map(record => ({
    name: stripDot(record.name),
    type: DNS_TYPE_NAMES[record.type] || String(record.type),
    ttl: Number.isFinite(record.TTL) ? record.TTL : null,
    data: limitString(String(record.data || ""), 2048)
  }));
}

async function dnssecQuery(name, type, resolver, options = {}, deadline = Infinity) {
  const remaining = deadline - Date.now();
  if (remaining <= 250) return { error: "DNSSEC deadline exceeded" };
  return dohQuery(name, type, resolver, {
    ...options,
    timeoutMs: Math.min(options.timeoutMs || DNSSEC_QUERY_TIMEOUT_MS, remaining)
  });
}

async function findDnssecZone(name, resolver, deadline) {
  let candidate = name;
  while (candidate.includes(".") && Date.now() < deadline) {
    const result = await dnssecQuery(candidate, "SOA", resolver, { dnssec: true, cd: true }, deadline);
    if (!result.error) {
      const zones = dnssecZoneCandidates(result.data);
      if (zones.length) return zones[0];
    }
    candidate = candidate.slice(candidate.indexOf(".") + 1);
  }
  return "";
}

async function inspectDnssecZone(zone, resolver, deadline) {
  const [dsResult, dnskeyResult] = await Promise.all([
    dnssecQuery(zone, "DS", resolver, { dnssec: true, cd: true }, deadline),
    dnssecQuery(zone, "DNSKEY", resolver, { dnssec: true, cd: true }, deadline)
  ]);
  const ds = dsResult.error
    ? []
    : dnssecRecordList(dsResult.data, 43).map(parseDnssecDs).filter(Boolean);
  const dnskey = dnskeyResult.error
    ? []
    : dnssecRecordList(dnskeyResult.data, 48).map(parseDnssecDnskey).filter(Boolean);
  const rrsig = dnskeyResult.error
    ? []
    : dnssecRecordList(dnskeyResult.data, 46).map(parseDnssecRrsig)
      .filter(signature => signature && signature.typeCovered === "DNSKEY");
  return {
    name: zone,
    ds,
    dnskey,
    rrsig,
    dsOk: !dsResult.error,
    dnskeyOk: !dnskeyResult.error
  };
}

function dnssecTargetCandidates(data) {
  const names = new Set();
  const records = data && Array.isArray(data.Answer) ? data.Answer : [];
  for (const record of records) {
    if (!record) continue;
    if (record.type === 5) {
      const target = stripDot(record.data);
      if (target) names.add(target);
    }
    if ([1, 28, 15, 16, 257].includes(record.type)) {
      const owner = stripDot(record.name);
      if (owner) names.add(owner);
    }
  }
  return [...names].slice(0, 6);
}

function dnssecCnameTargets(data) {
  const records = data && Array.isArray(data.Answer) ? data.Answer : [];
  return [...new Set(records
    .filter(record => record && record.type === 5)
    .map(record => stripDot(record.data))
    .filter(Boolean))].slice(0, 4);
}

function dnssecWarnings(zones, answerRrsig, nowSeconds) {
  const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  const warnings = [];
  const seen = new Set();
  const add = (level, code, message) => {
    const key = level + ":" + code + ":" + message;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({ level, code, message });
  };

  const signatures = [];
  for (const zone of zones) {
    if (Array.isArray(zone.rrsig)) signatures.push(...zone.rrsig);
  }
  if (Array.isArray(answerRrsig)) signatures.push(...answerRrsig);

  for (const signature of signatures) {
    if (!signature) continue;
    const label = (signature.typeCovered || "record") +
      (signature.name ? " at " + signature.name : "");
    if (Number.isFinite(signature.expiration)) {
      const remaining = signature.expiration - now;
      if (remaining <= 0) {
        add("error", "rrsig-expired", "The RRSIG for " + label + " has expired.");
      } else if (remaining < DNSSEC_EXPIRY_WARNING_SECONDS) {
        const days = Math.max(1, Math.ceil(remaining / 86400));
        add("warning", "rrsig-expiry", "The RRSIG for " + label +
          " expires in " + days + " day" + (days === 1 ? "" : "s") + ".");
      }
    }
    if (Number.isFinite(signature.inception) && signature.inception > now) {
      add("warning", "rrsig-not-yet-valid", "The RRSIG for " + label + " is not valid yet.");
    }
  }

  const algorithms = new Set();
  for (const zone of zones) {
    for (const record of zone.ds || []) {
      if (Number.isFinite(record.algorithm)) algorithms.add(record.algorithm);
    }
    for (const record of zone.dnskey || []) {
      if (Number.isFinite(record.algorithm)) algorithms.add(record.algorithm);
    }
    for (const record of zone.rrsig || []) {
      if (Number.isFinite(record.algorithm)) algorithms.add(record.algorithm);
    }
  }
  if (Array.isArray(answerRrsig)) {
    for (const signature of answerRrsig) {
      if (signature && Number.isFinite(signature.algorithm)) algorithms.add(signature.algorithm);
    }
  }
  for (const algorithm of [...algorithms].sort((a, b) => a - b)) {
    if (DEPRECATED_DNSSEC_ALGORITHMS.has(algorithm)) {
      add("warning", "deprecated-algorithm", "DNSSEC algorithm " + algorithm +
        " is deprecated (DSA/RSASHA1); migrate to ECDSA P-256 (13) or Ed25519 (15).");
    }
  }

  const dsRecords = zones.flatMap(zone => Array.isArray(zone.ds) ? zone.ds : []);
  if (dsRecords.length && dsRecords.every(record => record.digestType === 1)) {
    add("warning", "ds-sha1", "All DS records use SHA-1 (digest type 1); add a SHA-256 DS record.");
  }

  const dnskeyRecords = zones.flatMap(zone => Array.isArray(zone.dnskey) ? zone.dnskey : []);
  if (dnskeyRecords.length &&
      dnskeyRecords.every(record => MODERN_DNSSEC_ALGORITHMS.has(record.algorithm))) {
    add("info", "modern-algorithm", "DNSSEC keys use a modern algorithm (13/15).");
  }

  return warnings.slice(0, 12);
}

function dnssecIndeterminate(host, type, detail, options = {}) {
  return {
    ok: true,
    type: "dnssec",
    host,
    recordType: type,
    status: "indeterminate",
    ad: options.ad === true ? true : options.ad === false ? false : null,
    dnsStatus: Number.isInteger(options.dnsStatus) ? options.dnsStatus : null,
    zone: "",
    zones: [],
    answer: [],
    rrsig: [],
    warnings: [],
    detail,
    resolver: options.resolver || "",
    source: "Cloudflare Worker"
  };
}

async function inspectDnssec(rawHost, rawType) {
  const host = normalizeDnsName(rawHost);
  if (!host) return { ok: false, error: "Invalid or non-public host" };
  const type = String(rawType || "A").toUpperCase();
  if (!RECORD_TYPES.has(type) || type === "PTR") {
    return { ok: false, error: "Unsupported record type" };
  }

  const deadline = Date.now() + DNSSEC_DEADLINE_MS;
  let resolver = null;
  let firstAnswer = null;
  let lastError = "DNS resolvers unavailable";
  for (const candidate of DNSSEC_RESOLVERS) {
    const result = await dnssecQuery(host, type, candidate, { dnssec: true }, deadline);
    if (!result.error) {
      resolver = candidate;
      firstAnswer = result.data;
      break;
    }
    lastError = result.error;
  }
  if (!firstAnswer) return dnssecIndeterminate(host, type, lastError);

  const firstStatus = Number.isInteger(firstAnswer.Status) ? firstAnswer.Status : null;
  const ad = firstAnswer.AD === true ? true : firstAnswer.AD === false ? false : null;
  if (firstStatus !== null && firstStatus !== 0 && firstStatus !== 2 && firstStatus !== 3) {
    return dnssecIndeterminate(host, type,
      "The resolver returned DNS status " + firstStatus + ", so the result is inconclusive.",
      { ad, dnsStatus: firstStatus, resolver: resolver.name });
  }

  let answer = firstAnswer;
  let validationFailed = false;
  if (firstStatus === 2) {
    const cdResult = await dnssecQuery(host, type, resolver, { dnssec: true, cd: true }, deadline);
    if (cdResult.error) {
      return dnssecIndeterminate(host, type,
        "The validating resolver returned SERVFAIL and the CD retry failed: " + cdResult.error,
        { ad, dnsStatus: 2, resolver: resolver.name });
    }
    const cdStatus = Number.isInteger(cdResult.data.Status) ? cdResult.data.Status : null;
    if (cdStatus === 0 || cdStatus === 3) {
      validationFailed = true;
      answer = cdResult.data;
    } else if (cdStatus === 2) {
      return dnssecIndeterminate(host, type,
        "The resolver returned SERVFAIL both with and without the CD bit. This can be broken delegation or unreachable nameservers, not necessarily a DNSSEC failure.",
        { ad, dnsStatus: 2, resolver: resolver.name });
    } else {
      return dnssecIndeterminate(host, type,
        "The CD retry returned DNS status " + (cdStatus == null ? "unknown" : cdStatus) +
          ", so the result is inconclusive.",
        { ad, dnsStatus: 2, resolver: resolver.name });
    }
  }

  const recordType = type;
  const rrsig = dnssecRecordList(answer, 46)
    .map(parseDnssecRrsig).filter(Boolean).slice(0, 20);

  let zoneNames = dnssecZoneCandidates(answer).slice(0, 4);
  if (!zoneNames.length) {
    const fallbackZone = await findDnssecZone(host, resolver, deadline);
    if (fallbackZone) zoneNames = [fallbackZone];
  }

  let cnameTargetZones = [];
  if (ad !== true && !validationFailed) {
    const targetNames = dnssecTargetCandidates(answer);
    const cnameNames = new Set(dnssecCnameTargets(answer));
    const resolved = await Promise.all(targetNames.map(async name => ({
      name,
      zone: await findDnssecZone(name, resolver, deadline)
    })));
    cnameTargetZones = [...new Set(resolved
      .filter(item => cnameNames.has(item.name))
      .map(item => item.zone)
      .filter(Boolean))];
    for (const item of resolved) {
      if (item.zone && !zoneNames.includes(item.zone)) zoneNames.push(item.zone);
    }
    zoneNames = zoneNames.slice(0, 6);
  }

  const zones = await Promise.all(zoneNames.map(zone =>
    inspectDnssecZone(zone, resolver, deadline)
  ));
  const warnings = dnssecWarnings(zones, rrsig, Math.floor(Date.now() / 1000));

  const cnameZoneSet = new Set(cnameTargetZones);
  const cnameUnsigned = zones.find(zone =>
    cnameZoneSet.has(zone.name) && zone.dsOk && !zone.ds.length
  );
  const unsigned = zones.find(zone => zone.dsOk && !zone.ds.length);
  const broken = zones.find(zone =>
    zone.ds.length && (!zone.dnskeyOk || !zone.dnskey.length || !zone.rrsig.length)
  );
  const allSigned = zones.every(zone =>
    zone.dsOk && zone.ds.length && zone.dnskeyOk && zone.dnskey.length && zone.rrsig.length
  );

  let status = "indeterminate";
  let detail = "Some DNSSEC records could not be retrieved, so the result is inconclusive.";

  if (validationFailed) {
    status = "bogus";
    detail = "The validating resolver returned SERVFAIL, but the same query with the CD bit succeeded, so DNSSEC validation failed.";
  } else if (ad === true) {
    status = "secure";
    detail = "The resolver set the Authenticated Data (AD) bit, so the full chain of trust validated.";
  } else if (!zones.length) {
    detail = "Could not determine the DNSSEC zone or retrieve DS/DNSKEY records.";
  } else if (cnameUnsigned) {
    status = "insecure";
    detail = "The CNAME chain crosses " + cnameUnsigned.name +
      ", which has no DS record, so the answer is not signed.";
  } else if (unsigned) {
    status = "insecure";
    detail = "No DS record exists at " + unsigned.name + ", so the zone is not signed.";
  } else if (broken) {
    status = "bogus";
    detail = "DS exists at " + broken.name + ", but the DNSKEY RRset or its RRSIG is missing.";
  } else if (allSigned) {
    detail = "DS, DNSKEY and RRSIG records exist, but the resolver did not set the AD bit. " +
      "The answer may cross an unsigned CNAME target, or the resolver may not be validating.";
  }

  return {
    ok: true,
    type: "dnssec",
    host,
    recordType,
    status,
    ad,
    dnsStatus: firstStatus,
    zone: zoneNames[0] || "",
    zones,
    answer: dnssecAnswerRecords(answer),
    rrsig,
    warnings,
    detail,
    resolver: resolver.name,
    source: "Cloudflare Worker"
  };
}

function normalizeAnswers(type, answers, txtSeparator = " ") {
  const list = Array.isArray(answers) ? answers : [];

  if (type === "A" || type === "AAAA") {
    return list.filter(record => record.type === 1 || record.type === 28)
      .map(record => String(record.data || ""));
  }
  if (type === "CNAME") {
    return list.filter(record => record.type === 5).map(record => stripDot(record.data));
  }
  if (type === "NS") {
    return list.filter(record => record.type === 2).map(record => stripDot(record.data));
  }
  if (type === "PTR") {
    return list.filter(record => record.type === 12).map(record => stripDot(record.data));
  }
  if (type === "MX") {
    return list.filter(record => record.type === 15).map(record => {
      const [priority, exchange] = String(record.data || "").split(/\s+/);
      return { priority: Number(priority), host: stripDot(exchange) };
    }).filter(record => Number.isFinite(record.priority) && record.host)
      .sort((a, b) => a.priority - b.priority);
  }
  if (type === "TXT") {
    return list.filter(record => record.type === 16)
      .map(record => parseTxt(record.data, txtSeparator));
  }
  if (type === "CAA") {
    return list.filter(record => record.type === 257)
      .map(record => parseCaa(record.data)).filter(Boolean);
  }
  if (type === "SOA") {
    return list.filter(record => record.type === 6)
      .map(record => parseSoa(record.data)).find(Boolean) || null;
  }
  return [];
}

async function dohQuery(name, type, resolver, options = {}) {
  const url = new URL(resolver.url);
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  if (options.dnssec) url.searchParams.set("do", "true");
  if (options.cd) url.searchParams.set("cd", "true");

  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(250, Math.min(options.timeoutMs, DNS_TIMEOUT_MS))
    : DNS_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "Accept": "application/dns-json" }
    });
    if (!response.ok) return { error: "DNS HTTP " + response.status };
    const data = await response.json();
    if (!data || typeof data !== "object") return { error: "Invalid DNS response" };
    return { data };
  } catch (error) {
    return {
      error: error && error.name === "AbortError"
        ? "DNS timeout"
        : "DNS resolver unavailable"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dnsLookup(name, type, resolver, txtSeparator = " ") {
  const result = await dohQuery(name, type, resolver);
  if (result.error) return { error: result.error };

  const data = result.data;
  if (data.Status === 3) {
    return { records: type === "SOA" ? null : [], nxdomain: true };
  }
  if (data.Status !== 0 && data.Status !== 3) {
    return { error: "DNS status " + data.Status };
  }
  return {
    records: normalizeAnswers(type, data.Answer, txtSeparator),
    nxdomain: false
  };
}

async function dnsLookupAny(name, type, txtSeparator = " ") {
  let lastError = "DNS resolvers unavailable";
  for (const resolver of DNS_RESOLVERS) {
    const result = await dnsLookup(name, type, resolver, txtSeparator);
    if (!result.error) {
      return { ...result, resolver: resolver.name };
    }
    lastError = result.error;
  }
  return { error: lastError };
}

function reverseDnsName(raw) {
  const ip = String(raw || "").trim().replace(/^\[|\]$/g, "");
  const v4 = ipv4ToInt(ip);
  if (v4 != null) return ip.split(".").reverse().join(".") + ".in-addr.arpa";
  const groups = parseIpv6Groups(ip);
  if (!groups) return "";
  return groups.slice().reverse()
    .map(group => group.toString(16).padStart(4, "0").split("").reverse().join("."))
    .join(".") + ".ip6.arpa";
}

function errorCode(result) {
  if (result.nxdomain) return "ENOTFOUND";
  if (!result.records || (Array.isArray(result.records) && !result.records.length)) {
    return "ENODATA";
  }
  return "";
}

async function inspectDns(name, type) {
  if (!RECORD_TYPES.has(type)) return { ok: false, error: "Unsupported record type" };

  if (type === "PTR") {
    name = String(name || "").trim().replace(/^\[|\]$/g, "");
    if (!isPublicIp(name)) {
      return { ok: false, error: "PTR lookup requires a public IP address" };
    }
  } else {
    name = normalizeDnsName(name);
    if (!name) return { ok: false, error: "Invalid or non-public host" };
  }

  const lookupName = type === "PTR" ? reverseDnsName(name) : name;
  if (!lookupName) return { ok: false, error: "Invalid PTR lookup name" };
  const result = await dnsLookupAny(lookupName, type);
  if (result.error) {
    return { ok: false, type: "dns", host: name, recordType: type, error: result.error };
  }
  return {
    ok: true,
    type: "dns",
    host: name,
    recordType: type,
    records: result.records,
    nxdomain: result.nxdomain === true,
    resolver: result.resolver,
    source: "Cloudflare Worker"
  };
}

function propagationRecord(type, records) {
  if (type === "MX") {
    return (records || []).map(record => record.priority + " " + record.host);
  }
  if (type === "CAA") {
    return (records || []).map(record => record.flag + " " + record.tag + " " + record.value);
  }
  if (type === "SOA") {
    return records ? [JSON.stringify(records)] : [];
  }
  return (records || []).slice();
}

async function inspectPropagation(name, type) {
  name = normalizeDnsName(name);
  if (!name) return { ok: false, error: "Invalid or non-public host" };
  if (!RECORD_TYPES.has(type) || type === "PTR") {
    return { ok: false, error: "Unsupported record type" };
  }

  const resolvers = await Promise.all(DNS_RESOLVERS.map(async resolver => {
    const result = await dnsLookup(name, type, resolver, "");
    if (result.error) return { server: resolver.name, error: result.error };
    const records = propagationRecord(type, result.records).sort();
    return { server: resolver.name, records };
  }));

  return {
    ok: true,
    type: "propagation",
    host: name,
    recordType: type,
    resolvers,
    source: "Cloudflare Worker"
  };
}

async function inspectEmail(rawHost, rawSelector) {
  const host = normalizeDomain(rawHost, false);
  if (!host) return { ok: false, error: "Invalid or non-public host" };

  const selector = String(rawSelector || "").trim();
  if (selector && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(selector)) {
    return { ok: false, error: "Invalid DKIM selector" };
  }

  const result = {
    host,
    mx: [],
    spf: null,
    dmarc: null,
    dkim: null,
    errors: {}
  };

  const [mxResult, spfResult, dmarcResult, dkimResult] = await Promise.all([
    dnsLookupAny(host, "MX"),
    dnsLookupAny(host, "TXT", ""),
    dnsLookupAny("_dmarc." + host, "TXT", ""),
    selector ? dnsLookupAny(selector + "._domainkey." + host, "TXT", "") : Promise.resolve(null)
  ]);

  if (mxResult.error) {
    result.errors.mx = mxResult.error;
  } else {
    result.mx = Array.isArray(mxResult.records) ? mxResult.records : [];
    const code = errorCode(mxResult);
    if (code) result.errors.mx = code;
  }

  if (spfResult.error) {
    result.errors.spf = spfResult.error;
  } else {
    const records = Array.isArray(spfResult.records) ? spfResult.records : [];
    result.spf = records.find(record => /^v=spf1/i.test(record)) || null;
    if (!records.length) result.errors.spf = errorCode(spfResult);
  }

  if (dmarcResult.error) {
    result.errors.dmarc = dmarcResult.error;
  } else {
    const records = Array.isArray(dmarcResult.records) ? dmarcResult.records : [];
    result.dmarc = records.find(record => /^v=DMARC1/i.test(record)) || null;
    if (!records.length) result.errors.dmarc = errorCode(dmarcResult);
  }

  if (selector) {
    if (dkimResult.error) {
      result.errors.dkim = dkimResult.error;
    } else {
      const records = Array.isArray(dkimResult.records) ? dkimResult.records : [];
      result.dkim = records;
      if (!records.length) result.errors.dkim = errorCode(dkimResult);
    }
  }

  if (result.mx.length) {
    const aResult = await dnsLookupAny(result.mx[0].host, "A");
    const ip = !aResult.error && Array.isArray(aResult.records) ? aResult.records[0] : "";
    if (ip && isPublicIp(ip)) {
      const ptrName = reverseDnsName(ip);
      const ptrResult = ptrName
        ? await dnsLookupAny(ptrName, "PTR")
        : { error: "Invalid PTR lookup name" };
      if (!ptrResult.error && Array.isArray(ptrResult.records) && ptrResult.records.length) {
        result.mxPtr = { ip, hostnames: ptrResult.records };
      }
    }
  }

  return {
    ok: true,
    type: "email",
    ...result,
    source: "Cloudflare Worker"
  };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ error: "POST required" }, 405);
    }

    const secret = env.CHECKER_SECRET;
    if (!secret || !constantTimeEqual(request.headers.get("Authorization"),
      "Bearer " + secret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const length = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
      return json({ error: "Request body is too large" }, 413);
    }

    let input;
    try {
      const text = await request.text();
      if (text.length > MAX_REQUEST_BYTES) {
        return json({ error: "Request body is too large" }, 413);
      }
      input = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json({ error: "Invalid request" }, 400);
    }

    const type = String(input.type || "http").toLowerCase();

    try {
      if (type === "http") {
        return json(await inspectHttp(
          input.host,
          input.path,
          input.follow !== false
        ));
      }

      if (type === "dns") {
        const recordType = String(input.recordType || "A").toUpperCase();
        const out = await inspectDns(input.host, recordType);
        return json(out, out.ok === false && /Unsupported/.test(out.error || "") ? 400 : 200);
      }

      if (type === "propagation") {
        const recordType = String(input.recordType || "A").toUpperCase();
        const out = await inspectPropagation(input.host, recordType);
        return json(out, out.ok === false && /Unsupported/.test(out.error || "") ? 400 : 200);
      }

      if (type === "email") {
        return json(await inspectEmail(input.host, input.selector));
      }

      if (type === "dnssec") {
        const recordType = String(input.recordType || "A").toUpperCase();
        const out = await inspectDnssec(input.host, recordType);
        return json(out, out.ok === false && /Unsupported/.test(out.error || "") ? 400 : 200);
      }

      return json({ error: "Unsupported check type" }, 400);
    } catch (error) {
      return json({ error: "Checker failed" }, 500);
    }
  }
};
