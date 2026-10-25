const START = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
const BANK = ('ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure ' +
  'in reprehenderit voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident ' +
  'sunt in culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nulla gravida orci a odio ' +
  'nullam varius turpis non enim commodo condimentum vivamus elementum semper nisi aenean vulputate eleifend tellus').split(' ');

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function makeSentence(wordCount) {
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(pick(BANK));
  }
  let s = words.join(' ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s + '.';
}

function makeParagraph(sentenceCount) {
  const parts = [];
  for (let i = 0; i < sentenceCount; i++) parts.push(makeSentence(randInt(8, 16)));
  return parts.join(' ');
}

function build() {
  const unit = document.getElementById('unit').value;
  const count = Math.max(1, Math.min(100, parseInt(document.getElementById('count').value, 10) || 1));
  const classic = document.getElementById('classic').checked;

  if (unit === 'paragraphs') {
    const paras = [];
    for (let i = 0; i < count; i++) paras.push(makeParagraph(randInt(3, 6)));
    if (classic && paras.length) paras[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' + paras[0];
    return paras.join('\n\n');
  }
  if (unit === 'sentences') {
    const sents = [];
    for (let i = 0; i < count; i++) sents.push(makeSentence(randInt(8, 16)));
    if (classic && sents.length) sents[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    return sents.join(' ');
  }
  // words
  const out = [];
  for (let i = 0; i < count; i++) out.push(classic && i < START.length ? START[i] : pick(BANK));
  let s = out.join(' ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s + '.';
}

function generate() {
  document.getElementById('out').textContent = build();
}

function copyOut(btn) {
  const text = document.getElementById('out').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
}

generate();
