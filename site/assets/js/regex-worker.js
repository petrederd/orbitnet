self.onmessage = function (e) {
  const pattern = e.data.pattern;
  const flags = e.data.flags;
  const text = e.data.text;
  const maxMatches = e.data.maxMatches;
  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
    return;
  }
  const matches = [];
  let truncated = false;
  if (re.flags.includes('g')) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (matches.length >= maxMatches) { truncated = true; break; }
      matches.push({ value: m[0], index: m.index, groups: m.slice(1) });
      if (m[0] === '') re.lastIndex++;
      if (re.lastIndex > text.length) break;
    }
  } else {
    const m = re.exec(text);
    if (m) matches.push({ value: m[0], index: m.index, groups: m.slice(1) });
  }
  self.postMessage({ ok: true, matches: matches, truncated: truncated });
};
