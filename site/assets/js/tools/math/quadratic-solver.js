function fmtNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e-6 && abs < 1e15) {
    return String(Number(n.toPrecision(12)));
  }
  return n.toExponential(6).replace(/\.?0+e/, 'e');
}

function updatePreview() {
  const [a, b, c] = ['coeffA', 'coeffB', 'coeffC'].map(id => {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : parseFloat(v);
  });

  const parts = [];

  if (a === null) parts.push('ax²');
  else if (a === 1) parts.push('x²');
  else if (a === -1) parts.push('-x²');
  else parts.push(fmtNumber(a) + 'x²');

  if (b === null) parts.push('+ bx');
  else if (b !== 0) parts.push((b > 0 ? '+ ' : '- ') + (Math.abs(b) === 1 ? '' : fmtNumber(Math.abs(b))) + 'x');

  if (c === null) parts.push('+ c');
  else if (c !== 0) parts.push((c > 0 ? '+ ' : '- ') + fmtNumber(Math.abs(c)));

  document.getElementById('equationPreview').textContent = parts.join(' ') + ' = 0';
}

function solve() {
  clearError();
  
  const a = parseFloat(document.getElementById('coeffA').value);
  const b = parseFloat(document.getElementById('coeffB').value);
  const c = parseFloat(document.getElementById('coeffC').value);
  
  if (isNaN(a) || isNaN(b) || isNaN(c)) {
    showError('Please enter all coefficients');
    return;
  }
  
  if (a === 0) {
    showError('Coefficient a cannot be zero (this is not a quadratic equation)');
    return;
  }
  
  // Treat a discriminant that is zero up to floating-point error as zero.
  const scale = Math.max(1, b * b, Math.abs(4 * a * c));
  const eps = Number.EPSILON * scale * 8;
  let discriminant = b * b - 4 * a * c;
  if (Math.abs(discriminant) <= eps) discriminant = 0;
  
  const bLabel = b < 0 ? '(' + b + ')' : String(b);
  let html = `
    <div class="result-box"><div class="result-label">Discriminant (D)</div><div class="result-value">${fmtNumber(discriminant)}</div><div class="result-sub">D = b² - 4ac = ${bLabel}² - 4·${a}·${c}</div></div>
  `;
  
  if (discriminant > 0) {
    const sqrtD = Math.sqrt(discriminant);
    // Stable form: avoids cancellation when b is large relative to the roots.
    const q = -0.5 * (b + (b >= 0 ? sqrtD : -sqrtD));
    let x1, x2;
    if (q === 0) {
      x1 = 0;
      x2 = -b / a;
    } else {
      x1 = q / a;
      x2 = c / q;
    }
    // Keep x₁ matching the "+√D" formula and x₂ the "−√D" one.
    if (b >= 0) {
      const swap = x1;
      x1 = x2;
      x2 = swap;
    }
    
    html += `
      <div class="result-box highlight"><div class="result-label">Root x₁</div><div class="result-value large">${fmtNumber(x1)}</div><div class="result-sub">x₁ = (-b + √D) / 2a</div></div><div class="result-box highlight"><div class="result-label">Root x₂</div><div class="result-value large">${fmtNumber(x2)}</div><div class="result-sub">x₂ = (-b - √D) / 2a</div></div><div class="result-box"><div class="result-label">Root Type</div><div class="result-value" style="font-size: 1.1rem;">Two distinct real roots</div><div class="result-sub">D > 0</div></div>
    `;
  } else if (discriminant === 0) {
    const x = -b / (2 * a);
    
    html += `
      <div class="result-box highlight"><div class="result-label">Root x</div><div class="result-value large">${fmtNumber(x)}</div><div class="result-sub">x = -b / 2a (double root)</div></div><div class="result-box"><div class="result-label">Root Type</div><div class="result-value" style="font-size: 1.1rem;">One root (multiplicity 2)</div><div class="result-sub">D = 0</div></div>
    `;
  } else {
    const realPart = -b / (2 * a);
    const imagPart = Math.abs(Math.sqrt(-discriminant) / (2 * a));
    
    html += `
      <div class="result-box highlight"><div class="result-label">Root x₁</div><div class="result-value large">${fmtNumber(realPart)} + ${fmtNumber(imagPart)}i</div><div class="result-sub">Complex root</div></div><div class="result-box highlight"><div class="result-label">Root x₂</div><div class="result-value large">${fmtNumber(realPart)} - ${fmtNumber(imagPart)}i</div><div class="result-sub">Complex root</div></div><div class="result-box"><div class="result-label">Root Type</div><div class="result-value" style="font-size: 1.1rem;">Complex conjugate pair</div><div class="result-sub">D < 0</div></div>
    `;
  }
  
  document.getElementById('results').innerHTML = html;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showError(message) {
  document.getElementById('errorMsg').innerHTML = `<div class="error"> ${esc(message)}</div>`;
}

function clearError() {
  document.getElementById('errorMsg').innerHTML = '';
}

function reset() {
  document.getElementById('coeffA').value = '';
  document.getElementById('coeffB').value = '';
  document.getElementById('coeffC').value = '';
  updatePreview();
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter coefficients and click Solve</div>';
}

updatePreview();
