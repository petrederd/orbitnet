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

function sourcePath(value, line) {
  let source = String(value).trim();
  if (!source) throw new Error('Line ' + line + ': empty source path');
  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      if (url.search || url.hash) throw new Error('query strings and fragments cannot be matched');
      source = url.pathname;
    } catch (error) {
      throw new Error('Line ' + line + ': invalid source URL: ' + source);
    }
  }
  if (!source.startsWith('/')) throw new Error('Line ' + line + ': source must start with "/": ' + source);
  if (/[\x00-\x1F\x7F\s]/.test(source)) throw new Error('Line ' + line + ': source must not contain whitespace or control characters');
  if (/[{};"'`\\$#?]/.test(source)) throw new Error('Line ' + line + ': source contains a character that is unsafe in a redirect rule');
  if (/%0d|%0a/i.test(source)) throw new Error('Line ' + line + ': source must not contain encoded CR/LF');
  if (source.includes('*') && (!source.endsWith('*') || source.slice(0, -1).includes('*'))) {
    throw new Error('Line ' + line + ': "*" is only allowed once at the end of the source');
  }
  return source;
}

function targetValue(value, wildcard, line) {
  const target = String(value).trim();
  if (!target) throw new Error('Line ' + line + ': empty target URL');
  if (/[\x00-\x1F\x7F\s]/.test(target)) throw new Error('Line ' + line + ': target must not contain whitespace or control characters');
  if (/[{};"'`\\]/.test(target)) throw new Error('Line ' + line + ': target contains a character that is unsafe in a redirect rule');
  if (/%0d|%0a/i.test(target)) throw new Error('Line ' + line + ': target must not contain encoded CR/LF');
  const dollarCheck = wildcard ? target.replace(/\$1/g, '') : target;
  if (dollarCheck.includes('$')) throw new Error('Line ' + line + ': "$" is only allowed as the wildcard "$1" placeholder');
  if (target.startsWith('/')) return target;
  if (!/^https?:\/\//i.test(target)) throw new Error('Line ' + line + ': target must be an absolute URL or start with "/": ' + target);
  return target;
}

function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function parseRules(text, defaultCode) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!lines.length) throw new Error('Please enter at least one redirect rule');

  return lines.map((line, index) => {
    let source;
    let target;
    let code = String(defaultCode || '301');

    if (line.includes('->')) {
      const parts = line.split('->');
      if (parts.length !== 2) throw new Error('Line ' + (index + 1) + ': use exactly one "->"');
      const right = parts[1].trim().split(/\s+/);
      source = parts[0];
      target = right[0];
      if (right[1]) code = right[1];
    } else {
      const parts = line.split(/\s+/);
      if (parts.length < 2) throw new Error('Line ' + (index + 1) + ': expected "old -> new"');
      source = parts[0];
      target = parts[1];
      if (parts[2]) code = parts[2];
    }

    if (!/^30[1278]$/.test(code)) throw new Error('Line ' + (index + 1) + ': status must be 301, 302, 307 or 308');
    const sourceValue = sourcePath(source, index + 1);
    const wildcard = sourceValue.endsWith('*');
    const from = wildcard ? sourceValue.slice(0, -1) : sourceValue;
    if (wildcard && !from) throw new Error('Line ' + (index + 1) + ': wildcard source needs a path prefix');
    return { from, target: targetValue(target, wildcard, index + 1), code, wildcard };
  });
}

function withQuery(target, keepQuery) {
  if (!keepQuery) return target;
  if (target.includes('?')) return target + '&$args';
  return target + '$is_args$args';
}

function generateRedirects(rules, options) {
  const opts = Object.assign({ server: 'nginx', keepQuery: true }, options || {});
  const blocks = rules.map(rule => {
    if (opts.server === 'apache') {
      const pattern = '^' + escapeRegex(rule.from) + (rule.wildcard ? '(.*)$' : '$');
      const target = rule.wildcard && !rule.target.includes('$1') ? rule.target + '$1' : rule.target;
      return 'RedirectMatch ' + rule.code + ' ' + pattern + ' ' + target;
    }

    if (rule.wildcard) {
      if (rule.code !== '301' && rule.code !== '302') {
        throw new Error('nginx wildcard redirects support 301 and 302 only; use 301/302 or Apache for ' + rule.code);
      }
      let target = rule.target.includes('$1') ? rule.target : rule.target + '$1';
      if (!opts.keepQuery) target += '?';
      const flag = rule.code === '301' ? 'permanent' : 'redirect';
      return 'rewrite ^' + escapeRegex(rule.from) + '(.*)$ ' + target + ' ' + flag + ';';
    }
    return 'location = ' + rule.from + ' {\n    return ' + rule.code + ' ' + withQuery(rule.target, opts.keepQuery) + ';\n}';
  });
  return blocks.join('\n\n') + '\n';
}

function generate() {
  showError('');
  try {
    const rules = parseRules(document.getElementById('rules').value, document.getElementById('status').value);
    const output = generateRedirects(rules, {
      server: document.getElementById('server').value,
      keepQuery: document.getElementById('keepQuery').checked
    });
    document.getElementById('output').value = output;
    document.getElementById('stats').textContent = rules.length + ' redirect rule(s) generated for ' +
      (document.getElementById('server').value === 'nginx' ? 'nginx' : 'Apache');
  } catch (error) {
    document.getElementById('output').value = '';
    document.getElementById('stats').textContent = '';
    showError(error.message);
  }
}

async function copyOutput() {
  const output = document.getElementById('output');
  output.select();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(output.value);
    } else {
      document.execCommand('copy');
    }
  } catch (error) {
    // The text remains selected for manual copying.
  }
}

generate();
