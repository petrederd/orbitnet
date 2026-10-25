const state = {
  report: null,
  webrtc: null,
  timing: null,
  ports: null,
  running: false
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function setStatus(kind, text) {
  const el = document.getElementById('status');
  el.className = 'status-box ' + kind;
  el.textContent = text;
  el.style.display = 'block';
}

function clearStatus() {
  document.getElementById('status').style.display = 'none';
}

function badge(kind, label) {
  return '<span class="anon-badge ' + kind + '">' + esc(label) + '</span>';
}

function checkRow(title, status, detail) {
  return '<div class="anon-check">' + badge(status.kind, status.label) +
    '<div class="anon-body"><h4>' + esc(title) + '</h4><p>' + detail + '</p></div></div>';
}

function box(label, value, small) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' +
    '<div class="result-value"' + (small ? ' style="font-size:1.05rem;"' : '') + '>' +
    value + '</div></div>';
}

function scoreLabel(score) {
  if (score >= 80) return 'Very strong evidence';
  if (score >= 60) return 'Strong evidence';
  if (score >= 40) return 'Moderate evidence';
  if (score >= 20) return 'Weak evidence';
  return 'No clear signals';
}

function timezoneOffset(timeZone) {
  if (!timeZone) return null;
  for (const style of ['shortOffset', 'longOffset']) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        timeZoneName: style
      }).formatToParts(new Date());
      const name = ((parts.find(p => p.type === 'timeZoneName') || {}).value || '').trim();
      if (/^(GMT|UTC)$/i.test(name) || /^(GMT|UTC)[+-]?0(?:0)?(?::?00)?$/i.test(name)) return 0;
      const m = name.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
      if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
      const m2 = name.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (m2) return (m2[1] === '-' ? -1 : 1) * (Number(m2[2]) * 60 + Number(m2[3]));
    } catch (e) { /* try the next style */ }
  }
  return null;
}

function compareTimezones(ipTimezone) {
  let browserTimezone = '';
  try {
    browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) { /* ignore */ }
  const browserOffset = -new Date().getTimezoneOffset();
  const ipOffset = timezoneOffset(ipTimezone);
  const differ = Boolean(browserTimezone && ipTimezone && browserTimezone !== ipTimezone);
  const offsetMismatch = ipOffset != null && Math.abs(browserOffset - ipOffset) >= 60;
  return {
    browserTimezone,
    ipTimezone: ipTimezone || '',
    browserOffset,
    ipOffset,
    differ,
    offsetMismatch,
    differenceMinutes: ipOffset == null ? null : ipOffset - browserOffset
  };
}

function isPrivateAddress(address) {
  const a = address.toLowerCase();
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some(n => n < 0 || n > 255)) return false;
    const [a1, a2] = octets;
    if (a1 === 0 || a1 === 10 || a1 === 127) return true;                       // 0/8, 10/8, 127/8
    if (a1 === 100 && a2 >= 64 && a2 <= 127) return true;                        // 100.64/10 CGNAT
    if (a1 === 169 && a2 === 254) return true;                                   // link-local
    if (a1 === 172 && a2 >= 16 && a2 <= 31) return true;                         // 172.16/12
    if (a1 === 192 && a2 === 168) return true;                                   // 192.168/16
    if (a1 === 192 && a2 === 0) return true;                                     // 192.0.0/24, 192.0.2/24
    if (a1 === 192 && a2 === 88 && octets[2] === 99) return true;                // 192.88.99/24
    if (a1 === 198 && (a2 === 18 || a2 === 19)) return true;                     // 198.18/15
    if (a1 === 198 && a2 === 51 && octets[2] === 100) return true;               // 198.51.100/24
    if (a1 === 203 && a2 === 0 && octets[2] === 113) return true;                // 203.0.113/24
    if (a1 >= 224) return true;                                                  // multicast + reserved
    return false;
  }

  if (a === '::' || a === '::1') return true;                                    // unspecified, loopback
  if (/^fe[89ab][0-9a-f]:/i.test(a)) return true;                                // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true;                                // fc00::/7 unique local
  if (/^ff[0-9a-f]{2}:/i.test(a)) return true;                                   // ff00::/8 multicast
  if (/^2001:db8:/i.test(a)) return true;                                        // documentation
  if (/^2002:/i.test(a)) return true;                                            // 6to4
  return false;
}

function collectWebRTC(timeout, useStun) {
  return new Promise(resolve => {
    const result = { supported: false, stun: Boolean(useStun), candidates: [], local: [], public: [], error: '' };
    let pc;
    try {
      if (typeof RTCPeerConnection !== 'function') throw new Error('WebRTC is not available');
      const iceServers = useStun
        ? [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
        : [];
      pc = new RTCPeerConnection({ iceServers });
      result.supported = true;
    } catch (e) {
      result.error = e.message;
      resolve(result);
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { pc.close(); } catch (e) { /* ignore */ }
      result.candidates = [...new Set(result.candidates)];
      result.local = [...new Set(result.local)];
      result.public = [...new Set(result.public)];
      resolve(result);
    };

    pc.onicecandidate = event => {
      if (!event.candidate) return;
      const candidate = event.candidate.candidate || '';
      const parts = candidate.split(/\s+/);
      const address = (parts[4] || '').replace(/^\[|\]$/g, '').split('%')[0];
      if (!address || address.endsWith('.local') || !/^[0-9a-f:.]+$/i.test(address)) return;
      result.candidates.push(address);
      if (isPrivateAddress(address)) result.local.push(address);
      else result.public.push(address);
    };

    try {
      pc.createDataChannel('orbitnet-anonymity');
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .catch(e => { result.error = e.message; });
    } catch (e) {
      result.error = e.message;
    }

    setTimeout(finish, timeout || 4000);
  });
}

async function pingOnce(index) {
  const nonce = 'anon-' + Date.now().toString(36) + '-' + index + '-' + Math.random().toString(36).slice(2, 8);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const started = performance.now();
  try {
    const response = await fetch('/api/anonymity/ping?nonce=' + encodeURIComponent(nonce), {
      cache: 'no-store',
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || data.nonce !== nonce) throw new Error('probe failed');
    return performance.now() - started;
  } finally {
    clearTimeout(timer);
  }
}

async function measurePing() {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    try { samples.push(await pingOnce(i)); } catch (e) { /* collect what works */ }
  }
  if (!samples.length) return { samples: [], median: null, jitter: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const jitter = Math.max(...samples) - Math.min(...samples);
  return { samples, median, jitter };
}

function calcScore(report, webrtc, timing, ports) {
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    if (points > 0) {
      score += points;
      reasons.push(reason);
    }
  };

  const proxyHeaders = report.proxyHeaders || [];
  if (proxyHeaders.length) {
    add(proxyHeaders.some(h => h.strength === 'high') ? 30 : 12, 'Proxy-related HTTP header present');
  }

  if (report.tor && report.tor.listed === true) add(100, 'IP is listed as a Tor exit node');

  if (report.hosting && report.hosting.score) {
    add(Math.round(report.hosting.score * 0.35), 'Hosting/cloud provider signals in ASN or PTR');
  }

  if (report.hostnameSignals && report.hostnameSignals.score) {
    add(Math.round(report.hostnameSignals.score * 0.25), 'Suspicious keyword in the PTR hostname');
  }

  const timezone = compareTimezones(report.geo && report.geo.timezone);
  if (timezone.offsetMismatch) add(25, 'Browser timezone differs from the IP timezone');
  else if (timezone.differ) add(5, 'Browser and IP timezone names differ');

  if (webrtc && webrtc.public.length) {
    if (report.ip && webrtc.public.some(ip => ip !== report.ip)) {
      add(35, 'WebRTC exposed a public IP different from the HTTP IP');
    }
  } else if (webrtc && webrtc.local.length) {
    add(5, 'WebRTC exposed a local/private IP');
  }

  if (ports) {
    const group = ports.groups || {};
    if (group.httpProxy && group.httpProxy.some(p => p.open)) add(25, 'An HTTP proxy port is open');
    if (group.webProxy && group.webProxy.some(p => p.open)) add(10, 'A web proxy port is open');
    if (group.vpn && group.vpn.some(p => p.open)) add(20, 'A VPN port is open');
  }

  if (timing && timing.median != null && (timing.median >= 300 || timing.jitter >= 150)) {
    add(5, 'High or unstable latency (weak tunnel hint)');
  }

  score = Math.min(100, score);
  return { score, reasons };
}

function render() {
  const report = state.report;
  if (!report) return;

  const timezone = compareTimezones(report.geo && report.geo.timezone);
  const score = calcScore(report, state.webrtc, state.timing, state.ports);
  const level = scoreLabel(score.score);

  const reasonsHtml = score.reasons.length
    ? '<ul class="anon-list">' + score.reasons.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>'
    : '<p class="score-note">No proxy, VPN, Tor or hosting signals were detected. This does not prove that no such tool is in use.</p>';

  document.getElementById('summaryBox').innerHTML =
    '<div class="result-box highlight">' +
      '<div class="result-label">Proxy / VPN / Tor signals</div>' +
      '<div class="result-value large">' + score.score + ' / 100 · ' + esc(level) + '</div>' +
      '<div class="result-sub">A higher score means more evidence of anonymising tools, not better anonymity. This is a heuristic count, not a probability.</div>' +
      '<div class="score-bar"><span style="width:' + score.score + '%"></span></div>' +
      reasonsHtml +
    '</div>';

  const place = [report.geo && report.geo.city, report.geo && report.geo.region, report.geo && report.geo.country].filter(Boolean).join(', ') || 'Unknown';
  const provider = report.geo && report.geo.asnOrganization
    ? esc(report.geo.asnOrganization) + (report.geo.asn ? ' (AS' + esc(report.geo.asn) + ')' : '')
    : 'Unknown';

  document.getElementById('networkBox').innerHTML =
    box('Your public IP', '<span class="mono">' + esc(report.ip) + '</span>') +
    box('Reverse DNS', esc(report.hostname || 'not set'), true) +
    box('Location', esc(place), true) +
    box('Provider', provider, true) +
    box('IP timezone', esc((report.geo && report.geo.timezone) || 'Unknown'), true) +
    box('Browser timezone', esc(timezone.browserTimezone || 'Unknown'), true);

  const rows = [];

  const proxyHeaders = report.proxyHeaders || [];
  if (proxyHeaders.length) {
    const strong = proxyHeaders.some(h => h.strength === 'high');
    rows.push(checkRow('HTTP proxy headers', strong ? { kind: 'bad', label: 'Seen' } : { kind: 'warn', label: 'Possible' },
      proxyHeaders.map(h => '<span class="mono">' + esc(h.name) + '</span>: ' + esc(h.value)).join('<br>')));
  } else {
    rows.push(checkRow('HTTP proxy headers', { kind: 'ok', label: 'Clear' },
      'No proxy-specific headers were visible. OrbitNet’s own Cloudflare/Caddy/nginx headers are ignored.'));
  }

  if (report.tor) {
    if (report.tor.listed === true) {
      rows.push(checkRow('Tor network membership', { kind: 'bad', label: 'Listed' },
        'Your IP is in the Tor Project bulk exit-node list.'));
    } else if (report.tor.available) {
      rows.push(checkRow('Tor network membership', { kind: 'ok', label: 'Not listed' },
        'Your IP was not found in the cached Tor exit-node list. Non-exit Tor traffic is not covered by this list.'));
    } else {
      rows.push(checkRow('Tor network membership', { kind: 'unknown', label: 'Unknown' },
        'The Tor exit list could not be downloaded, so membership could not be checked.'));
    }
  }

  const hosting = report.hosting || { score: 0, reasons: [] };
  if (hosting.likely) {
    rows.push(checkRow('Hosting provider / ASN', hosting.score >= 60 ? { kind: 'bad', label: 'Strong' } : { kind: 'warn', label: 'Likely' },
      esc(hosting.organization || 'Unknown organisation') +
      (hosting.providers.length ? ' — ' + esc(hosting.providers.join(', ')) : '') +
      (hosting.reasons.length ? '<br>' + esc(hosting.reasons.join('; ')) : '')));
  } else {
    rows.push(checkRow('Hosting provider / ASN', { kind: 'ok', label: 'Residential?' },
      esc(hosting.organization || 'Unknown organisation') + '. No common hosting or privacy provider was matched.'));
  }

  const hostSignals = report.hostnameSignals || { score: 0, reasons: [] };
  if (!report.hostname) {
    rows.push(checkRow('Suspicious hostname (PTR)', { kind: 'unknown', label: 'No PTR' },
      'No reverse DNS name is configured. This is neutral and common for home connections.'));
  } else if (hostSignals.score > 0) {
    rows.push(checkRow('Suspicious hostname (PTR)', { kind: 'warn', label: 'Keywords' },
      '<span class="mono">' + esc(report.hostname) + '</span><br>' + esc(hostSignals.reasons.join('; '))));
  } else {
    rows.push(checkRow('Suspicious hostname (PTR)', { kind: 'ok', label: 'Clear' },
      '<span class="mono">' + esc(report.hostname) + '</span> contains no obvious hosting or privacy keywords.'));
  }

  if (timezone.offsetMismatch) {
    rows.push(checkRow('Timezone difference', { kind: 'bad', label: 'Mismatch' },
      'Browser: ' + esc(timezone.browserTimezone) + ' (UTC' + (timezone.browserOffset >= 0 ? '+' : '') + (timezone.browserOffset / 60) +
      '), IP: ' + esc(timezone.ipTimezone || 'unknown') + ' (UTC' + (timezone.ipOffset >= 0 ? '+' : '') + (timezone.ipOffset / 60) + ').'));
  } else if (timezone.differ) {
    rows.push(checkRow('Timezone difference', { kind: 'warn', label: 'Names differ' },
      'Browser: ' + esc(timezone.browserTimezone) + ', IP: ' + esc(timezone.ipTimezone) + '. The UTC offsets match, so this is weak.'));
  } else {
    rows.push(checkRow('Timezone difference', { kind: 'ok', label: 'Aligned' },
      'Browser and IP timezone are consistent.'));
  }

  const webrtc = state.webrtc;
  if (!webrtc || !webrtc.supported) {
    rows.push(checkRow('WebRTC IP leak', { kind: 'unknown', label: 'Unavailable' },
      'WebRTC is not available in this browser, so local and public candidates could not be collected.'));
  } else if (webrtc.public.length) {
    const different = report.ip && webrtc.public.some(ip => ip !== report.ip);
    if (different) {
      rows.push(checkRow('WebRTC IP leak', { kind: 'bad', label: 'Different IP' },
        'Public candidate <span class="mono">' + esc(webrtc.public.join(', ')) + '</span> differs from the HTTP-observed IP. This is a strong proxy/VPN or split-tunnel signal.'));
    } else {
      rows.push(checkRow('WebRTC IP leak', { kind: 'ok', label: 'Matches' },
        'Public candidate <span class="mono">' + esc(webrtc.public.join(', ')) + '</span> matches the HTTP-observed IP, so no public-IP leak was detected.'));
    }
  } else if (webrtc.local.length) {
    rows.push(checkRow('WebRTC IP leak', { kind: 'warn', label: 'Local only' },
      'Only local/private candidates were exposed: <span class="mono">' + esc(webrtc.local.join(', ')) + '</span>. These describe your LAN, not your public IP.' +
      (webrtc.stun ? ' The STUN request completed without returning a public candidate.' : ' Enable the STUN option to test for a real public-IP leak.')));
  } else if (webrtc.stun) {
    rows.push(checkRow('WebRTC IP leak', { kind: 'ok', label: 'No IPs' },
      'STUN was enabled but no IP candidates were exposed, so no public-IP leak was observed.'));
  } else {
    rows.push(checkRow('WebRTC IP leak', { kind: 'unknown', label: 'Limited' },
      'Only local candidates were checked because STUN was disabled. Enable the STUN option for a real public-IP leak test.'));
  }

  const clientMismatch = (timezone.offsetMismatch || (webrtc && webrtc.public.length && report.ip && webrtc.public.some(ip => ip !== report.ip)));
  rows.push(checkRow('Web proxy (browser-side heuristic)', clientMismatch ? { kind: 'warn', label: 'Possible' } : { kind: 'ok', label: 'No hint' },
    clientMismatch
      ? 'A browser-side inconsistency was found (timezone or WebRTC). JavaScript cannot reliably identify an HTTP proxy without external endpoints.'
      : 'No browser-side proxy hint was found. This does not prove that no web proxy is active.'));

  if (state.timing && state.timing.median != null) {
    const unstable = state.timing.median >= 300 || state.timing.jitter >= 150;
    rows.push(checkRow('Tunnel detection (two-way ping)', unstable ? { kind: 'warn', label: 'Slow/variable' } : { kind: 'ok', label: 'Stable' },
      'Median ' + Math.round(state.timing.median) + ' ms, jitter ' + Math.round(state.timing.jitter) + ' ms across ' + state.timing.samples.length + ' probes. Latency is only a weak tunnel hint.'));
  } else {
    rows.push(checkRow('Tunnel detection (two-way ping)', { kind: 'unknown', label: 'No data' },
      'The request/response probes did not complete.'));
  }

  const ports = state.ports;
  const portRow = (title, groupName, note) => {
    if (!ports || !ports.groups || !ports.groups[groupName]) {
      rows.push(checkRow(title, { kind: 'unknown', label: 'Not run' }, note));
      return;
    }
    const group = ports.groups[groupName];
    const open = group.filter(p => p.open);
    if (open.length) {
      rows.push(checkRow(title, { kind: 'warn', label: 'Open' },
        open.map(p => '<span class="mono">' + esc(p.port) + '/tcp</span>').join(', ') + ' open. ' + note));
    } else {
      rows.push(checkRow(title, { kind: 'ok', label: 'Closed' },
        'No checked TCP port answered. ' + note));
    }
  };

  portRow('Open ports: HTTP proxy', 'httpProxy', 'A closed port does not prove that no proxy is running.');
  portRow('Open ports: web proxy', 'webProxy', 'Port 80/443 can belong to a normal web server or router, so this is ambiguous.');
  portRow('Open ports: VPN', 'vpn', 'UDP-only services such as WireGuard and most IPsec VPNs cannot be detected with a TCP check.');

  let vpnScore = 0;
  if (hosting.likely) vpnScore += 35;
  if (hostSignals.score > 0) vpnScore += 20;
  if (timezone.offsetMismatch) vpnScore += 20;
  if (webrtc && webrtc.public.length && report.ip && webrtc.public.some(ip => ip !== report.ip)) vpnScore += 20;
  if (ports && ports.groups && ports.groups.vpn && ports.groups.vpn.some(p => p.open)) vpnScore += 25;
  vpnScore = Math.min(100, vpnScore);
  rows.push(checkRow('VPN fingerprint', vpnScore >= 50 ? { kind: 'bad', label: 'Strong' } : (vpnScore > 0 ? { kind: 'warn', label: 'Signals' } : { kind: 'ok', label: 'Weak' }),
    'Combined heuristic: ' + vpnScore + '/100 from hosting, PTR, timezone, WebRTC and VPN ports. This is not proof of VPN use.'));

  document.getElementById('checks').innerHTML = rows.join('');
  document.getElementById('summary').hidden = false;
  document.getElementById('checksPanel').hidden = false;
}

async function runPassive() {
  if (state.running) return;
  state.running = true;
  document.getElementById('runBtn').disabled = true;
  setStatus('info', 'Running passive checks and browser probes…');

  const useStun = document.getElementById('stunConsent').checked;

  try {
    const [response, webrtc, timing] = await Promise.all([
      fetch('/api/anonymity', { cache: 'no-store' }),
      collectWebRTC(useStun ? 6000 : 4000, useStun),
      measurePing()
    ]);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'The anonymity API returned an error');
    state.report = data;
    state.webrtc = webrtc;
    state.timing = timing;
    render();
    setStatus('success', 'Passive checks complete. Active port checks are optional.');
  } catch (error) {
    setStatus('error', 'Check failed: ' + (error.message || 'unknown error'));
  } finally {
    state.running = false;
    document.getElementById('runBtn').disabled = false;
  }
}

async function runPorts() {
  const consent = document.getElementById('consent');
  if (!consent.checked) return;
  if (!state.report || !state.report.ip) {
    setStatus('error', 'Run the passive check first so the tool knows your public IP.');
    return;
  }

  const button = document.getElementById('portsBtn');
  button.disabled = true;
  setStatus('info', 'Connecting to common proxy and VPN TCP ports on ' + state.report.ip + '…');

  try {
    const response = await fetch('/api/anonymity/ports?ip=' + encodeURIComponent(state.report.ip), { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'The port check returned an error');
    state.ports = data;
    render();
    setStatus('success', 'Active port checks complete. ' + (data.note || ''));
  } catch (error) {
    setStatus('error', 'Port check failed: ' + (error.message || 'unknown error'));
  } finally {
    button.disabled = !consent.checked;
  }
}

document.getElementById('runBtn').addEventListener('click', runPassive);
document.getElementById('portsBtn').addEventListener('click', runPorts);
document.getElementById('consent').addEventListener('change', event => {
  document.getElementById('portsBtn').disabled = !event.target.checked;
});
document.getElementById('stunConsent').addEventListener('change', async event => {
  if (!state.report || state.running) return;
  const useStun = event.target.checked;
  state.webrtc = await collectWebRTC(useStun ? 6000 : 4000, useStun);
  render();
  setStatus('success', useStun ? 'WebRTC check re-run with a public STUN server.' : 'WebRTC check reset to local candidates only.');
});
