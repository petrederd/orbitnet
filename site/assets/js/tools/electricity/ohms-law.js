function getBaseValue(inputId, unitId) {
  const value = parseFloat(document.getElementById(inputId).value);
  const multiplier = parseFloat(document.getElementById(unitId).value);
  return isNaN(value) ? null : value * multiplier;
}

function clearError() {
  document.getElementById('errorMsg').innerHTML = '';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showError(message) {
  document.getElementById('errorMsg').innerHTML = `<div class="error"> ${esc(message)}</div>`;
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e-4 && abs < 1e9) {
    return String(Number(n.toPrecision(6)));
  }
  return n.toExponential(5).replace(/\.?0+e/, 'e');
}

function formatValue(value, baseUnit, units) {
  // Pick the largest unit that still gives a value >= 1.
  for (let i = units.length - 1; i >= 0; i--) {
    const [unitName, multiplier] = units[i];
    if (Math.abs(value) >= multiplier) {
      return `${formatNumber(value / multiplier)} ${unitName}`;
    }
  }
  // Values smaller than the smallest unit fall back to the base unit.
  return `${formatNumber(value)} ${baseUnit}`;
}

function calculate() {
  clearError();
  
  // Get all values in base units
  const V = getBaseValue('voltage', 'voltageUnit');
  const I = getBaseValue('current', 'currentUnit');
  const R = getBaseValue('resistance', 'resistanceUnit');
  const P = getBaseValue('power', 'powerUnit');
  
  // Count how many values are provided (zero is a valid value, e.g. 0 V).
  const provided = [V, I, R, P].filter(v => v !== null);
  
  if (provided.length < 2) {
    showError('Please enter at least TWO values to calculate the rest');
    return;
  }
  
  if (provided.length > 2) {
    showError('Please enter exactly TWO values. Clear unused fields.');
    return;
  }
  
  // Calculate missing values
  let calcV = V, calcI = I, calcR = R, calcP = P;
  let formulas = [];
  
  try {
    // V = I × R
    if (I !== null && R !== null && V === null) {
      calcV = I * R;
      formulas.push('V = I × R');
    }
    // I = V ÷ R
    else if (V !== null && R !== null && I === null) {
      if (R === 0) throw new Error('Resistance cannot be zero');
      calcI = V / R;
      formulas.push('I = V ÷ R');
    }
    // R = V ÷ I
    else if (V !== null && I !== null && R === null) {
      if (I === 0) throw new Error('Current cannot be zero');
      calcR = V / I;
      formulas.push('R = V ÷ I');
    }
    // P = V × I, then derive missing value
    else if (V !== null && P !== null) {
      if (V === 0) throw new Error('Voltage cannot be zero');
      calcI = P / V;
      calcR = V / calcI;
      formulas.push('I = P ÷ V', 'R = V ÷ I');
    }
    // P = I² × R
    else if (I !== null && P !== null) {
      if (I === 0) throw new Error('Current cannot be zero');
      calcR = P / (I * I);
      calcV = I * calcR;
      formulas.push('R = P ÷ I²', 'V = I × R');
    }
    // P = V² ÷ R
    else if (V !== null && R !== null) {
      if (R === 0) throw new Error('Resistance cannot be zero');
      calcI = V / R;
      calcP = V * calcI;
      formulas.push('I = V ÷ R', 'P = V × I');
    }
    else if (R !== null && P !== null) {
      if (R === 0) throw new Error('Resistance cannot be zero');
      calcI = Math.sqrt(P / R);
      calcV = calcI * R;
      formulas.push('I = √(P ÷ R)', 'V = I × R');
    }
    else {
      showError('This combination of values cannot be calculated. Try different inputs.');
      return;
    }
    
    // Calculate power if not provided
    if (calcP === null && calcV !== null && calcI !== null) {
      calcP = calcV * calcI;
    }
    
    // Validate results
    if (isNaN(calcV) || isNaN(calcI) || isNaN(calcR) || isNaN(calcP)) {
      throw new Error('Invalid calculation result');
    }
    
    const negative = [['voltage', calcV], ['current', calcI], ['resistance', calcR], ['power', calcP]]
      .find(([, v]) => v < 0);
    if (negative) {
      throw new Error('Negative values are not allowed (' + negative[0] + ' is negative). Enter zero or a positive value.');
    }
    
    displayResults(calcV, calcI, calcR, calcP, formulas);
    
  } catch (error) {
    showError(error.message);
  }
}

function displayResults(V, I, R, P, formulas) {
  const vDisplay = formatValue(V, 'V', [['mV', 0.001], ['V', 1], ['kV', 1000]]);
  const iDisplay = formatValue(I, 'A', [['µA', 0.000001], ['mA', 0.001], ['A', 1], ['kA', 1000]]);
  const rDisplay = formatValue(R, 'Ω', [['Ω', 1], ['kΩ', 1000], ['MΩ', 1000000]]);
  const pDisplay = formatValue(P, 'W', [['mW', 0.001], ['W', 1], ['kW', 1000], ['MW', 1000000]]);
  
  const html = `
    <div class="result-box highlight"><div class="result-label">Voltage</div><div class="result-value large">${vDisplay}</div><div class="result-sub">V = ${V.toExponential(3)}</div></div><div class="result-box highlight"><div class="result-label">Current</div><div class="result-value large">${iDisplay}</div><div class="result-sub">I = ${I.toExponential(3)}</div></div><div class="result-box highlight"><div class="result-label">Resistance</div><div class="result-value large">${rDisplay}</div><div class="result-sub">R = ${R.toExponential(3)}</div></div><div class="result-box highlight"><div class="result-label">Power</div><div class="result-value large">${pDisplay}</div><div class="result-sub">P = ${P.toExponential(3)}</div></div>
    
    ${formulas.length > 0 ? `
    <div class="result-box"><div class="result-label">Formulas Used</div><div style="font-size: .95rem; color: var(--muted); margin-top: 8px;">
        ${formulas.map(f => `• ${f}`).join('<br>')}
      </div></div>
    ` : ''}
  `;
  
  document.getElementById('results').innerHTML = html;
}

function reset() {
  document.getElementById('voltage').value = '';
  document.getElementById('current').value = '';
  document.getElementById('resistance').value = '';
  document.getElementById('power').value = '';
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter any two values to calculate the rest</div>';
}
