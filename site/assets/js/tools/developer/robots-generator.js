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

function normalizePaths(text, label) {
  const paths = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return paths.map(path => {
    if (/\s/.test(path)) throw new Error(label + ' path must not contain spaces: ' + path);
    if (!path.startsWith('/')) throw new Error(label + ' path must start with "/": ' + path);
    return path;
  });
}

function buildRobots(input) {
  const data = Object.assign({
    userAgent: '*', allow: [], disallow: [], crawlDelay: '', sitemap: '', emptyDisallow: false, extraGroups: ''
  }, input || {});

  const agents = String(data.userAgent || '').split(/[,\r\n]/).map(agent => agent.trim()).filter(Boolean);
  if (!agents.length) throw new Error('User-agent is required');
  agents.forEach(agent => {
    if (/\s/.test(agent)) throw new Error('User-agent must not contain spaces: ' + agent);
  });

  const allow = normalizePaths(Array.isArray(data.allow) ? data.allow.join('\n') : data.allow, 'Allow');
  const disallow = normalizePaths(Array.isArray(data.disallow) ? data.disallow.join('\n') : data.disallow, 'Disallow');
  const sitemap = String(data.sitemap || '').trim();
  if (sitemap && !/^https?:\/\//i.test(sitemap)) throw new Error('Sitemap must be an absolute http(s) URL');

  const lines = agents.map(agent => 'User-agent: ' + agent);
  allow.forEach(path => lines.push('Allow: ' + path));
  disallow.forEach(path => lines.push('Disallow: ' + path));
  if (!disallow.length && data.emptyDisallow) lines.push('Disallow:');

  const delay = String(data.crawlDelay == null ? '' : data.crawlDelay).trim();
  if (delay) {
    const seconds = Number(delay);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Crawl-delay must be a non-negative number');
    lines.push('Crawl-delay: ' + seconds);
  }
  if (sitemap) lines.push('Sitemap: ' + sitemap);

  const extra = String(data.extraGroups || '').trim();
  if (extra) {
    extra.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      if (!/^(User-agent|Allow|Disallow|Crawl-delay|Sitemap):\s*\S/i.test(trimmed)) {
        throw new Error('Additional group line ' + (index + 1) + ': expected a robots.txt directive');
      }
      if (/[\x00-\x1F\x7F]/.test(trimmed)) {
        throw new Error('Additional group line ' + (index + 1) + ': control characters are not allowed');
      }
    });
  }

  return lines.join('\n') + (extra ? '\n\n' + extra : '') + '\n';
}

function generate() {
  showError('');
  try {
    const output = buildRobots({
      userAgent: document.getElementById('userAgent').value,
      allow: document.getElementById('allowPaths').value,
      disallow: document.getElementById('disallowPaths').value,
      crawlDelay: document.getElementById('crawlDelay').value,
      sitemap: document.getElementById('sitemap').value,
      emptyDisallow: document.getElementById('emptyDisallow').checked,
      extraGroups: document.getElementById('extraGroups').value
    });
    document.getElementById('output').value = output;
    document.getElementById('stats').textContent = output.split('\n').filter(Boolean).length + ' directives generated.';
  } catch (error) {
    document.getElementById('output').value = '';
    document.getElementById('stats').textContent = '';
    showError(error.message);
  }
}

async function copyOutput() {
  const output = document.getElementById('output');
  output.select();
  if (!await copyText(output.value)) output.select();
}

generate();
