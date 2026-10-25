const DETERMINISTIC_LIMIT = 1n << 64n;
const BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
const MR_ROUNDS = 32;
const MAX_DIGITS = 200;
const TRIAL_LIMIT = 5000000n;
const FACTOR_TIME_MS = 800;
const NEAREST_STEPS = 4000n;
const NEAREST_TIME_MS = 800;

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function randomBase(n) {
  const bytes = Math.max(1, Math.ceil(n.toString(16).length / 2));
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let x = 0n;
  for (const b of buf) x = (x << 8n) | BigInt(b);
  return (x % (n - 3n)) + 2n;
}

function millerRabin(n, bases) {
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d /= 2n; r++; }
  for (const a of bases) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let passed = false;
    for (let i = 1n; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1n) { passed = true; break; }
    }
    if (!passed) return false;
  }
  return true;
}

function isPrime(n) {
  if (n < 2n) return false;
  for (const p of BASES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  if (n < DETERMINISTIC_LIMIT) return millerRabin(n, BASES);
  const bases = [];
  for (let i = 0; i < MR_ROUNDS; i++) bases.push(randomBase(n));
  return millerRabin(n, bases);
}

function factorize(n) {
  const factors = [];
  let m = n;
  const add = (p, count) => { if (count) factors.push({ p, count }); };
  let c2 = 0;
  while (m % 2n === 0n) { m /= 2n; c2++; }
  add(2n, c2);
  if (m === 1n) return { factors, capped: false };
  if (isPrime(m)) { add(m, 1); return { factors, capped: false }; }

  const started = performance.now();
  let i = 3n, steps = 0n, capped = false;
  while (i * i <= m && i <= TRIAL_LIMIT) {
    if ((steps++ & 63n) === 0n && performance.now() - started > FACTOR_TIME_MS) {
      capped = true;
      break;
    }
    let c = 0;
    while (m % i === 0n) { m /= i; c++; }
    add(i, c);
    if (c > 0 && m > 1n && isPrime(m)) { add(m, 1); return { factors, capped: false }; }
    i += 2n;
  }
  if (i > TRIAL_LIMIT && i * i <= m) capped = true;
  if (m > 1n) {
    if (!capped && isPrime(m)) add(m, 1);
    else { add(m, 1); capped = true; }
  }
  return { factors, capped };
}

function fmtFactor(f) {
  return f.count > 1 ? f.p + '^' + f.count : f.p.toString();
}

let runTimer = null;

function scheduleRun() {
  clearTimeout(runTimer);
  runTimer = setTimeout(run, 250);
}

function run() {
  const raw = document.getElementById('value').value.trim();
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  if (!raw) {
    resEl.innerHTML = '<div class="result-sub">Enter an integer to analyse.</div>';
    return;
  }
  if (!/^\d+$/.test(raw)) {
    errEl.innerHTML = '<div class="error">Please enter a non-negative integer.</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid integer.</div>';
    return;
  }

  const digits = raw.replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_DIGITS) {
    errEl.innerHTML = '<div class="error">Please enter at most ' + MAX_DIGITS + ' digits.</div>';
    resEl.innerHTML = '<div class="result-sub">The number is too large for this tool.</div>';
    return;
  }

  const n = BigInt(digits);
  const prime = isPrime(n);
  const exact = n < DETERMINISTIC_LIMIT;

  const below = n > 2n ? findPrime(n - 1n, -1) : { value: null, capped: false };
  const above = findPrime(n + 1n < 2n ? 2n : n + 1n, 1);

  let note = '';
  if (n < 2n) note = 'Neither prime nor composite';
  else if (!prime) note = 'Composite number';
  else if (exact) note = 'Confirmed with a deterministic test';
  else note = 'Probably prime — probabilistic test (32 rounds)';

  let html = '';
  html += '<div class="result-box ' + (prime ? 'highlight' : '') + '">' +
    '<div class="result-label">Is ' + digits + ' prime?</div>' +
    '<div class="result-value large">' + (prime ? 'Yes' : 'No') + '</div>' +
    '<div class="result-sub">' + note + '</div>' +
    '</div>';

  if (n > 1n) {
    const { factors, capped } = factorize(n);
    const expr = factors.length ? factors.map(fmtFactor).join(' × ') : digits;
    html += '<div class="result-box"><div class="result-label">Prime factorisation</div>' +
      '<div class="result-value" style="font-size:1.1rem;">' + expr + '</div>' +
      (capped ? '<div class="result-sub">Trial division was time-limited; the remaining factor may be composite.</div>' : '') +
      '</div>';

    // divisors count and sum (only when factorisation is reliable)
    if (!capped) {
      let divCount = 1n, divSum = 1n;
      for (const f of factors) {
        divCount *= BigInt(f.count + 1);
        let term = 1n, pk = 1n;
        for (let k = 0; k < f.count; k++) { pk *= f.p; term += pk; }
        divSum *= term;
      }
      html += '<div class="grid-2">' +
        '<div class="result-box"><div class="result-label">Divisors</div><div class="result-value">' + divCount + '</div></div>' +
        '<div class="result-box"><div class="result-label">Sum of divisors</div><div class="result-value" style="font-size:1rem;">' + divSum + '</div></div>' +
        '</div>';
    }
  }

  const belowText = below.value !== null ? below.value.toString() : (below.capped ? 'not found (search limit)' : '—');
  const aboveText = above.value !== null ? above.value.toString() : 'not found (search limit)';
  html += '<div class="grid-2">' +
    '<div class="result-box"><div class="result-label">Previous prime</div><div class="result-value">' + belowText + '</div></div>' +
    '<div class="result-box"><div class="result-label">Next prime</div><div class="result-value">' + aboveText + '</div></div>' +
    '</div>';

  resEl.innerHTML = html;
}

function findPrime(start, direction) {
  let x = start;
  let steps = 0n;
  const started = performance.now();
  while (x >= 2n && steps < NEAREST_STEPS) {
    if ((steps & 31n) === 0n && performance.now() - started > NEAREST_TIME_MS) {
      return { value: null, capped: true };
    }
    if (isPrime(x)) return { value: x, capped: false };
    x += BigInt(direction);
    steps++;
  }
  return { value: null, capped: true };
}

function setValue(v) {
  document.getElementById('value').value = v.toString();
  run();
}

function increment() {
  const raw = document.getElementById('value').value.trim();
  if (/^\d+$/.test(raw)) setValue(BigInt(raw) + 1n);
}

function decrement() {
  const raw = document.getElementById('value').value.trim();
  if (/^\d+$/.test(raw) && BigInt(raw) > 0n) setValue(BigInt(raw) - 1n);
}

function random() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  setValue(BigInt(bytes[0]) % 1000000n + 2n);
}

run();
