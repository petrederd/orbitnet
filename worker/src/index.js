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
// Header: Authorization: Bearer <CHECKER_SECRET>
//
// The worker is a fallback for checks that the Russian server cannot complete
// because of DNS filtering, RKN blocking or an unreachable route. It never
// receives a URL with credentials and never follows a redirect to a private or
// otherwise non-public address.

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_RESPONSE_HEADERS = 100;
const MAX_HEADER_VALUE = 2048;
const MAX_REDIRECTS = 10;
const HTTP_TIMEOUT_MS = 8000;
const DNS_TIMEOUT_MS = 5000;

const USER_AGENT = "OrbitNet-Checker/1.1 (+https://orbitnet.ru)";

const DNS_RESOLVERS = [
  { name: "Cloudflare 1.1.1.1", url: "https://cloudflare-dns.com/dns-query" },
  { name: "Google 8.8.8.8", url: "https://dns.google/resolve" },
  { name: "AdGuard 94.140.14.14", url: "https://dns.adguard-dns.com/resolve" }
];

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

function isPublicIp(raw) {
  const host = String(raw || "").trim().toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;

  const v4 = ipv4ToInt(host);
  if (v4 != null) {
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
    return !blocked.some(([start, end]) => v4 >= start && v4 <= end);
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return false;
    if (/^f[cd]/.test(host)) return false;      // fc00::/7
    if (/^fe[89ab]/.test(host)) return false;   // fe80::/10
    if (/^ff/.test(host)) return false;         // multicast
    if (host.startsWith("::ffff:")) return isPublicIp(host.slice(7));
    return true;
  }

  return false;
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
  return normalizeDomain(host, false);
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

async function readLimitedText(response, maxBytes = MAX_HTML_BYTES) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;

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

      if (chunk.byteLength < value.byteLength) break;
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {}
    }
  }
}

function extractTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
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
    let response;
    try {
      response = await fetchWithTimeout(current.href, HTTP_TIMEOUT_MS);
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
      const html = await readLimitedText(response);
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

async function dohQuery(name, type, resolver) {
  const url = new URL(resolver.url);
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
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

  const result = await dnsLookupAny(name, type);
  if (result.error) {
    return { ok: false, type: "dns", host: name, recordType: type, error: result.error };
  }
  return {
    ok: true,
    type: "dns",
    host: name,
    recordType: type,
    records: result.records,
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
      const ptrResult = await dnsLookupAny(ip, "PTR");
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

      return json({ error: "Unsupported check type" }, 400);
    } catch (error) {
      return json({ error: "Checker failed" }, 500);
    }
  }
};
