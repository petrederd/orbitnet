const STOP = new Set([
  // English
  'the','and','for','are','but','not','you','all','any','can','her','was','one','our','out','day','get','has','him','his','how','its','new','now','old','see','two','way','who','boy','did','use','that','this','with','from','they','have','will','your','what','when','were','been','them','than','then','some','into','there','their','would','could','should','about','which','these','those','other','after','before','because','while',
  // Russian
  'что','как','это','для','или','при','его','они','она','оно','все','всё','еще','ещё','уже','только','даже','если','когда','где','там','тут','есть','был','была','было','были','быть','может','можно','нужно','очень','более','менее','также','чтобы','чем','кто','этот','эта','эти','тот','без','через','между','после','перед','около','него','нее','неё','них','себя','себе','свой','своя','свое','своё','свои','который','которая','которое','которые','которых','потому','поэтому','тогда','сейчас','здесь','так','тоже','либо','ведь','вот','мне','меня','тебя','тебе','нас','вас','ним','ней','которую','которого','которым','которыми','какой','какая','какое','какие'
]);

function update() {
  const text = document.getElementById('input').value;
  const trimmed = text.trim();

  const wordList = trimmed ? trimmed.split(/\s+/) : [];
  const words = wordList.filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  const sentences = trimmed ? (trimmed.match(/[^.!?]+[.!?]*/g) || []).filter(s => s.trim()).length : 0;
  const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter(p => p.trim()).length : 0;
  const lines = text ? text.split(/\r?\n/).length : 0;

  document.getElementById('words').textContent = words;
  document.getElementById('chars').textContent = chars;
  document.getElementById('charsNoSpace').textContent = charsNoSpace;
  document.getElementById('sentences').textContent = sentences;
  document.getElementById('paragraphs').textContent = paragraphs;
  document.getElementById('lines').textContent = lines;
  document.getElementById('readTime').textContent = formatTime(words, 200);
  document.getElementById('speakTime').textContent = formatTime(words, 130);

  topKeywords(trimmed);
}

function formatTime(words, wpm) {
  if (!words) return '0s';
  const seconds = Math.round(words / wpm * 60);
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + 'm ' + s + 's';
}

function topKeywords(text) {
  const el = document.getElementById('keywords');
  if (!text) { el.innerHTML = '<div class="result-sub">No words yet.</div>'; return; }
  const counts = {};
  (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).forEach(w => {
    if ([...w].length < 3 || STOP.has(w)) return;
    counts[w] = (counts[w] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  if (!top.length) { el.innerHTML = '<div class="result-sub">No significant keywords found.</div>'; return; }
  el.innerHTML = top.map(([w, n]) =>
    '<span class="pill" style="margin:0 6px 6px 0;display:inline-block;">' + w + ' · ' + n + '</span>'
  ).join('');
}

function clearAll() {
  document.getElementById('input').value = '';
  update();
}

update();
