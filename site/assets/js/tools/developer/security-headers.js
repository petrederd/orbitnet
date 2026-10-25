function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showError(message) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  if (!message) return;
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(message);
  el.appendChild(div);
}

const REFERRER_VALUES = new Set([
  'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'
]);
const COOP_VALUES = new Set(['unsafe-none', 'same-origin-allow-popups', 'same-origin']);
const CORP_VALUES = new Set(['same-site', 'same-origin', 'cross-origin']);
const COEP_VALUES = new Set(['require-corp', 'credentialless', 'unsafe-none']);

function parseHeaders(text) {
  const lines = String(text || '').split(/\r?\n/);
  const headers = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) throw new Error('Line ' + (index + 1) + ': expected "Name: value"');
    const name = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      throw new Error('Line ' + (index + 1) + ': invalid header name');
    }
    headers.push({ name, value, line: index + 1 });
  });
  if (!headers.length) throw new Error('Please paste at least one header');
  return headers;
}

function findBy(headers, name) {
  return headers.find(header => header.name === name) || null;
}

function sanitizeHeaders(headers) {
  const map = new Map();
  const duplicates = [];
  for (const header of headers) {
    if (!header.value) continue;
    if (map.has(header.name)) {
      duplicates.push(header.name);
      continue;
    }
    map.set(header.name, header.value);
  }
  return { map, duplicates };
}

function analyzeHeaders(headers) {
  const findings = [];
  const { map, duplicates } = sanitizeHeaders(headers);
  const add = (severity, name, message) => findings.push({ severity, name, message });
  const has = name => map.has(name);
  const value = name => map.get(name) || '';

  duplicates.forEach(name => add('error', name, 'Duplicate header; only the first occurrence is kept.'));
  for (const [name, headerValue] of map) {
    if (headerValue.includes('$')) {
      add('warn', name, 'Value contains "$"; nginx add_header expands it as a variable. There is no reliable backslash escape; remove or rename the dollar text.');
    }
  }

  if (!has('content-security-policy')) {
    add('warn', 'Content-Security-Policy', 'Missing. Add a policy that restricts scripts, objects and framing.');
  } else {
    const csp = value('content-security-policy');
    const cspInfo = SecurityHeaderRules.evaluateCsp(csp);
    if (!cspInfo.hasScriptPolicy) {
      add('error', 'Content-Security-Policy', 'No default-src or script-src directive found.');
    } else {
      add('good', 'Content-Security-Policy', 'A script/default policy is present.');
    }
    if (cspInfo.unsafeInline) {
      add('warn', 'Content-Security-Policy', "Contains 'unsafe-inline'; prefer nonces or hashes.");
    }
    if (cspInfo.unsafeEval) add('warn', 'Content-Security-Policy', "Contains 'unsafe-eval'; remove it if possible.");
  }

  if (!has('strict-transport-security')) {
    add('warn', 'Strict-Transport-Security', 'Missing. Add HSTS once HTTPS is reliable.');
  } else {
    const hsts = value('strict-transport-security');
    const hstsInfo = SecurityHeaderRules.evaluateHsts(hsts);
    if (hstsInfo.maxAge == null) {
      add('error', 'Strict-Transport-Security', 'max-age is missing.');
    } else if (hstsInfo.maxAge === 0) {
      add('error', 'Strict-Transport-Security', 'max-age=0 disables HSTS.');
    } else if (hstsInfo.maxAge < 31536000) {
      add('warn', 'Strict-Transport-Security', 'max-age is below one year.');
    } else {
      add('good', 'Strict-Transport-Security', 'max-age is at least one year.');
    }
    if (!hstsInfo.includeSubDomains) add('info', 'Strict-Transport-Security', 'includeSubDomains is not set.');
  }

  const xcto = value('x-content-type-options');
  if (!has('x-content-type-options')) add('warn', 'X-Content-Type-Options', 'Missing. Use nosniff.');
  else if (!/\bnosniff\b/i.test(xcto)) add('error', 'X-Content-Type-Options', 'Value must be nosniff.');
  else add('good', 'X-Content-Type-Options', 'nosniff is set.');

  const xfo = value('x-frame-options');
  const csp = value('content-security-policy');
  const frameInfo = SecurityHeaderRules.evaluateFrameProtection(xfo, csp);
  if (frameInfo.wildcard) {
    add('warn', 'Content-Security-Policy', "frame-ancestors * does not restrict framing.");
  }
  if (!has('x-frame-options') && !frameInfo.cspRestrictive) {
    add('warn', 'X-Frame-Options', 'Missing and no restrictive frame-ancestors directive was found.');
  } else if (!has('x-frame-options') && frameInfo.cspRestrictive) {
    add('good', 'X-Frame-Options', 'Framing is restricted by the CSP frame-ancestors directive.');
  } else if (has('x-frame-options') && !/^(deny|sameorigin)$/i.test(xfo)) {
    add('error', 'X-Frame-Options', 'Use DENY or SAMEORIGIN.');
  } else if (has('x-frame-options')) {
    add('good', 'X-Frame-Options', 'Framing is restricted.');
  }

  const referrer = value('referrer-policy');
  if (!has('referrer-policy')) add('warn', 'Referrer-Policy', 'Missing.');
  else if (!REFERRER_VALUES.has(referrer.toLowerCase())) add('error', 'Referrer-Policy', 'Unknown policy value.');
  else add('good', 'Referrer-Policy', 'Referrer policy is recognized.');

  if (!has('permissions-policy')) add('info', 'Permissions-Policy', 'Not set; consider disabling unused browser features.');

  const coop = value('cross-origin-opener-policy');
  if (coop && !COOP_VALUES.has(coop.toLowerCase())) add('error', 'Cross-Origin-Opener-Policy', 'Unknown value.');
  else if (coop && coop.toLowerCase() === 'unsafe-none') add('info', 'Cross-Origin-Opener-Policy', 'unsafe-none offers no isolation.');

  const corp = value('cross-origin-resource-policy');
  if (corp && !CORP_VALUES.has(corp.toLowerCase())) add('error', 'Cross-Origin-Resource-Policy', 'Unknown value.');

  const coep = value('cross-origin-embedder-policy');
  if (coep && !COEP_VALUES.has(coep.toLowerCase())) add('error', 'Cross-Origin-Embedder-Policy', 'Unknown value.');

  if (has('x-xss-protection')) add('warn', 'X-XSS-Protection', 'Deprecated. Remove it and use a Content-Security-Policy.');
  if (has('x-powered-by')) add('warn', 'X-Powered-By', 'Reveals stack details. Remove it.');
  if (has('server')) add('info', 'Server', 'Reveals server software. Consider minimizing the version string.');

  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.filter(item => item.severity === 'warn').length;
  const good = findings.filter(item => item.severity === 'good').length;

  return { findings, sanitized: map, duplicates, counts: { errors, warnings, good } };
}

function nginxSnippet(map) {
  const names = [...map.keys()].sort();
  return names.map(name => {
    const value = String(map.get(name)).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return 'add_header ' + name.replace(/(^|-)([a-z])/g, (m, dash, letter) => dash + letter.toUpperCase()) + ' "' + value + '" always;';
  }).join('\n') + '\n';
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
  } catch (error) {
    // Clipboard access is optional.
  }
}

function copyCodeBlock() {
  const index = Number(this.dataset.codeIndex);
  const block = document.querySelectorAll('.code-block')[index];
  if (block) copyText(block.textContent);
}

function analyze() {
  showError('');
  let report;
  try {
    const headers = parseHeaders(document.getElementById('headersInput').value);
    report = analyzeHeaders(headers);
  } catch (error) {
    showError(error.message);
    document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Fix the header list to see the report.</div>';
    return;
  }

  const colors = { error: 'var(--danger)', warn: 'var(--warning)', good: 'var(--accent)', info: 'var(--muted)' };
  let html = '<div class="result-box highlight"><div class="result-label">Summary</div>' +
    '<div class="result-value" style="font-size:1.05rem;">' + report.counts.errors + ' error(s), ' +
    report.counts.warnings + ' warning(s), ' + report.counts.good + ' passing check(s).</div></div>';

  html += '<div class="result-box"><div class="result-label">Findings</div><table class="data-table"><thead><tr><th>Header</th><th>Severity</th><th>Details</th></tr></thead><tbody>';
  report.findings.forEach(item => {
    html += '<tr><td>' + esc(item.name) + '</td><td style="color:' + colors[item.severity] + ';font-weight:600;">' +
      esc(item.severity) + '</td><td>' + esc(item.message) + '</td></tr>';
  });
  html += '</tbody></table></div>';

  const sanitizedLines = [...report.sanitized.entries()].map(([name, value]) => name + ': ' + value).join('\n');
  const snippet = nginxSnippet(report.sanitized);
  html += '<div class="result-box"><div class="result-label">Sanitized headers</div>' +
    '<pre class="code-block">' + esc(sanitizedLines || '(none)') + '</pre>' +
    '<div class="toolbar"><button class="btn btn-secondary" data-action="copyCodeBlock" data-code-index="0">Copy sanitized</button></div></div>';
  html += '<div class="result-box"><div class="result-label">nginx snippet</div>' +
    '<pre class="code-block">' + esc(snippet || '(none)') + '</pre>' +
    '<div class="toolbar"><button class="btn btn-secondary" data-action="copyCodeBlock" data-code-index="1">Copy nginx</button></div></div>';

  document.getElementById('results').innerHTML = html;
}

function loadExample() {
  document.getElementById('headersInput').value = [
    "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
    'Strict-Transport-Security: max-age=31536000; includeSubDomains',
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=()',
    'X-XSS-Protection: 1; mode=block',
    'Server: nginx/1.27.0'
  ].join('\n');
  analyze();
}

function clearAll() {
  document.getElementById('headersInput').value = '';
  showError('');
  document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Paste headers and analyze them.</div>';
}

analyze();
