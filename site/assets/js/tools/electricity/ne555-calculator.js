let currentMode = 'astable';
let reverseMode = false;

function setMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  if (mode === 'astable') {
    document.getElementById('astableInputs').style.display = 'block';
    document.getElementById('monostableInputs').style.display = 'none';
    document.getElementById('reverseToggle').style.display = 'block';
  } else {
    document.getElementById('astableInputs').style.display = 'none';
    document.getElementById('monostableInputs').style.display = 'block';
    document.getElementById('reverseToggle').style.display = 'none';
    document.getElementById('reverseCalc').checked = false;
    reverseMode = false;
  }
  
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter values and click Calculate</div>';
}

function toggleCalcMode() {
  reverseMode = document.getElementById('reverseCalc').checked;
  
  if (reverseMode) {
    // Show resistor inputs, hide frequency/duty/capacitor-select
    document.getElementById('freqGroup').style.display = 'none';
    document.getElementById('dutyGroup').style.display = 'none';
    document.getElementById('capGroup').style.display = 'none';
    document.getElementById('r1Group').style.display = 'block';
    document.getElementById('r2Group').style.display = 'block';
    document.getElementById('capRevGroup').style.display = 'block';
  } else {
    // Show frequency/duty, hide resistor inputs
    document.getElementById('freqGroup').style.display = 'block';
    document.getElementById('dutyGroup').style.display = 'block';
    document.getElementById('capGroup').style.display = 'block';
    document.getElementById('r1Group').style.display = 'none';
    document.getElementById('r2Group').style.display = 'none';
    document.getElementById('capRevGroup').style.display = 'none';
  }
  
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter values and click Calculate</div>';
}

/**
 * Parse a component value with an optional SI suffix.
 * Resistors: "200" -> 200 Ω, "4k7" -> 4700 Ω, "1M" -> 1e6 Ω
 * Capacitors: "100p" -> 100 pF, "10n" -> 10 nF, "0.1u" -> 0.1 µF, "1m" -> 1 mF
 * Plain numbers default to Ω (resistor) and µF (capacitor).
 */
function parseSI(input, kind) {
  if (input == null) return NaN;
  let s = String(input).trim().replace(/\s+/g, '').replace(',', '.');
  if (!s) return NaN;
  
  // Support "4k7" / "1M5" style (unit in the middle)
  s = s.replace(/^([0-9]+)\.?([0-9]*)[kK]([0-9]+)$/, '$1.$3k');
  s = s.replace(/^([0-9]+)\.?([0-9]*)[mM]([0-9]+)$/, '$1.$3M');
  
  const match = s.match(/^([0-9]*\.?[0-9]+)\s*([a-zA-ZµΩ]*)$/);
  if (!match) return NaN;
  
  const num = parseFloat(match[1]);
  if (isNaN(num)) return NaN;
  
  const suffix = match[2].toLowerCase();
  const suffixMaps = {
    resistor: { '': 1, 'r': 1, 'ohm': 1, 'ohms': 1, 'ω': 1, 'k': 1e3, 'kohm': 1e3, 'kω': 1e3, 'm': 1e6, 'meg': 1e6, 'mohm': 1e6, 'mω': 1e6 },
    capacitor: { '': 1e-6, 'p': 1e-12, 'pf': 1e-12, 'n': 1e-9, 'nf': 1e-9, 'u': 1e-6, 'uf': 1e-6, 'µ': 1e-6, 'µf': 1e-6, 'm': 1e-3, 'mf': 1e-3, 'f': 1 }
  };
  
  const multiplier = suffixMaps[kind][suffix];
  if (multiplier == null) return NaN;
  
  return num * multiplier;
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

function formatResistor(ohms) {
  if (ohms >= 1000000) return `${(ohms / 1000000).toFixed(2)} MΩ`;
  if (ohms >= 1000) return `${(ohms / 1000).toFixed(2)} kΩ`;
  return `${ohms.toFixed(2)} Ω`;
}

function formatFrequency(hz) {
  if (hz >= 1000000) return `${(hz / 1000000).toFixed(2)} MHz`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${hz.toFixed(2)} Hz`;
}

function formatCapacitance(farads) {
  if (farads >= 1) return `${farads.toFixed(2)} F`;
  if (farads >= 0.001) return `${(farads / 0.001).toFixed(2)} mF`;
  if (farads >= 0.000001) return `${(farads / 0.000001).toFixed(2)} µF`;
  if (farads >= 0.000000001) return `${(farads / 0.000000001).toFixed(2)} nF`;
  return `${(farads / 0.000000000001).toFixed(2)} pF`;
}

function formatTime(seconds) {
  if (seconds >= 1) return `${seconds.toFixed(4)} s`;
  if (seconds >= 0.001) return `${(seconds * 1000).toFixed(4)} ms`;
  if (seconds >= 0.000001) return `${(seconds * 1000000).toFixed(4)} µs`;
  return `${(seconds * 1000000000).toFixed(2)} ns`;
}

function findStandardResistor(value) {
  // E12 series (10% tolerance) - common values
  const e12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  
  let bestValue = value;
  let bestDiff = Infinity;
  
  // Check across different decades (up to 10 MΩ so large E12 values are reachable)
  for (let decade = 1; decade <= 10000000; decade *= 10) {
    for (let base of e12) {
      const stdValue = base * decade;
      const diff = Math.abs(stdValue - value);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestValue = stdValue;
      }
    }
  }
  
  return bestValue;
}

function calculate() {
  clearError();
  
  if (currentMode === 'astable') {
    if (reverseMode) {
      calculateAstableReverse();
    } else {
      calculateAstable();
    }
  } else {
    calculateMonostable();
  }
}

function calculateAstable() {
  const freq = parseFloat(document.getElementById('frequency').value) * parseFloat(document.getElementById('freqUnit').value);
  const duty = parseFloat(document.getElementById('dutyCycle').value);
  const C = parseFloat(document.getElementById('capacitor').value) * parseFloat(document.getElementById('capUnit').value);
  
  if (isNaN(freq) || freq <= 0) {
    showError('Please enter a valid frequency');
    return;
  }
  
  if (isNaN(duty) || duty <= 50 || duty > 99) {
    showError('Duty cycle must be greater than 50% and at most 99%. In this astable circuit the HIGH time is always longer than the LOW time, so exactly 50% would require R1 = 0 and is not achievable.');
    return;
  }
  
  if (isNaN(C) || C <= 0) {
    showError('Please enter a valid capacitor value');
    return;
  }
  
  // Formulas for 555 astable mode:
  // f = 1.44 / ((R1 + 2*R2) * C)
  // Duty = (R1 + R2) / (R1 + 2*R2)
  
  const dutyDecimal = duty / 100;
  
  // Solve for R1 and R2
  // From duty cycle: R1 = R2 * (2*duty - 1) / (1 - duty)
  // From frequency: R1 + 2*R2 = 1.44 / (f * C)
  
  const sum = 1.44 / (freq * C);  // R1 + 2*R2
  
  // For duty cycle D: R1 = R2 * (2D - 1) / (1 - D)
  // Substituting into sum: R2 * (2D - 1)/(1 - D) + 2*R2 = sum
  // R2 * [(2D - 1)/(1 - D) + 2] = sum
  // R2 = sum / [(2D - 1)/(1 - D) + 2]
  
  const R2 = sum / ((2 * dutyDecimal - 1) / (1 - dutyDecimal) + 2);
  const R1 = sum - 2 * R2;
  
  if (R1 < 1000 || R2 < 1000) {
    showError('Calculated resistor values too small. Try a smaller capacitor or lower frequency.');
    return;
  }
  
  if (R1 > 10000000 || R2 > 10000000) {
    showError('Calculated resistor values too large. Try a larger capacitor or higher frequency.');
    return;
  }
  
  // Find standard resistor values
  const R1_std = findStandardResistor(R1);
  const R2_std = findStandardResistor(R2);
  
  // Recalculate actual frequency and duty cycle with standard values
  const actualFreq = 1.44 / ((R1_std + 2 * R2_std) * C);
  const actualDuty = ((R1_std + R2_std) / (R1_std + 2 * R2_std)) * 100;
  const tHigh = 0.693 * (R1_std + R2_std) * C;
  const tLow = 0.693 * R2_std * C;
  const period = 1 / actualFreq;
  
  const html = `
    <div class="result-box highlight"><div class="result-label">R1 (Resistor 1)</div><div class="result-value large">${formatResistor(R1_std)}</div><div class="result-sub">Calculated: ${formatResistor(R1)}</div></div><div class="result-box highlight"><div class="result-label">R2 (Resistor 2)</div><div class="result-value large">${formatResistor(R2_std)}</div><div class="result-sub">Calculated: ${formatResistor(R2)}</div></div><div class="result-box"><div class="result-label">Actual Frequency</div><div class="result-value">${formatFrequency(actualFreq)}</div><div class="result-sub">Target: ${formatFrequency(freq)}</div></div><div class="result-box"><div class="result-label">Actual Duty Cycle</div><div class="result-value">${actualDuty.toFixed(2)}%</div><div class="result-sub">Target: ${duty}%</div></div><div class="result-box"><div class="result-label">Period</div><div class="result-value">${(period * 1000).toFixed(3)} ms</div><div class="result-sub">Time for one complete cycle</div></div><div class="result-box"><div class="result-label">Time High / Time Low</div><div class="result-value" style="font-size: 1.1rem;">${(tHigh * 1000).toFixed(3)} ms / ${(tLow * 1000).toFixed(3)} ms</div><div class="result-sub">Output pulse timing</div></div><div class="diagram"><strong>555 Astable Circuit</strong><br><br>
      Vcc ----[R1=${formatResistor(R1_std)}]---+--- Pin 7 (Discharge)<br>
                                  |<br>
                          [R2=${formatResistor(R2_std)}]<br>
                                  |<br>
      Pin 2,6 (Trig/Thresh) ------+<br>
                                  |<br>
                              [C=${formatCapacitance(C)}]<br>
                                  |<br>
      GND ---------------------+---+<br><br>
      Output: Pin 3 • Vcc: Pin 8 • GND: Pin 1
    </div>
  `;
  
  document.getElementById('results').innerHTML = html;
}

function calculateAstableReverse() {
  const R1 = parseSI(document.getElementById('r1Input').value, 'resistor');
  const R2 = parseSI(document.getElementById('r2Input').value, 'resistor');
  const C = parseSI(document.getElementById('capacitorRev').value, 'capacitor');
  
  if (isNaN(R1) || R1 <= 0) {
    showError('Please enter a valid R1 value (e.g., 200 or 4k7)');
    return;
  }
  
  if (isNaN(R2) || R2 <= 0) {
    showError('Please enter a valid R2 value (e.g., 4k7 or 47k)');
    return;
  }
  
  if (isNaN(C) || C <= 0) {
    showError('Please enter a valid capacitor value (e.g., 0.1u or 100n)');
    return;
  }
  
  // Calculate frequency and duty cycle from resistor values
  const frequency = 1.44 / ((R1 + 2 * R2) * C);
  const dutyCycle = ((R1 + R2) / (R1 + 2 * R2)) * 100;
  const tHigh = 0.693 * (R1 + R2) * C;
  const tLow = 0.693 * R2 * C;
  const period = 1 / frequency;
  
  const html = `
    <div class="result-box"><div class="result-label">Using Values</div><div class="result-value" style="font-size: 1.2rem;">R1 = ${formatResistor(R1)} • R2 = ${formatResistor(R2)}</div><div class="result-sub">C = ${formatCapacitance(C)} (parsed from your input)</div></div><div class="result-box highlight"><div class="result-label">Frequency</div><div class="result-value large">${formatFrequency(frequency)}</div><div class="result-sub">Oscillation frequency</div></div><div class="result-box highlight"><div class="result-label">Duty Cycle</div><div class="result-value large">${dutyCycle.toFixed(2)}%</div><div class="result-sub">Percentage of time HIGH</div></div><div class="result-box"><div class="result-label">Period</div><div class="result-value">${formatTime(period)}</div><div class="result-sub">Time for one complete cycle</div></div><div class="result-box"><div class="result-label">Time High / Time Low</div><div class="result-value" style="font-size: 1.1rem;">${formatTime(tHigh)} / ${formatTime(tLow)}</div><div class="result-sub">Output pulse timing</div></div><div class="diagram"><strong>555 Astable Circuit</strong><br><br>
      Vcc ----[R1=${formatResistor(R1)}]---+--- Pin 7 (Discharge)<br>
                                  |<br>
                          [R2=${formatResistor(R2)}]<br>
                                  |<br>
      Pin 2,6 (Trig/Thresh) ------+<br>
                                  |<br>
                              [C=${formatCapacitance(C)}]<br>
                                  |<br>
      GND ---------------------+---+<br><br>
      Output: Pin 3 • Vcc: Pin 8 • GND: Pin 1
    </div>
  `;
  
  document.getElementById('results').innerHTML = html;
}

function calculateMonostable() {
  const pulseWidth = parseFloat(document.getElementById('pulseWidth').value) * parseFloat(document.getElementById('pulseUnit').value);
  const C = parseFloat(document.getElementById('capacitorMono').value) * parseFloat(document.getElementById('capUnitMono').value);
  
  if (isNaN(pulseWidth) || pulseWidth <= 0) {
    showError('Please enter a valid pulse width');
    return;
  }
  
  if (isNaN(C) || C <= 0) {
    showError('Please enter a valid capacitor value');
    return;
  }
  
  // Formula: T = 1.1 × R × C
  const R = pulseWidth / (1.1 * C);
  
  if (R < 1000) {
    showError('Calculated resistor too small. Try a smaller capacitor.');
    return;
  }
  
  if (R > 10000000) {
    showError('Calculated resistor too large. Try a larger capacitor.');
    return;
  }
  
  const R_std = findStandardResistor(R);
  const actualPulse = 1.1 * R_std * C;
  
  const html = `
    <div class="result-box highlight"><div class="result-label">R (Timing Resistor)</div><div class="result-value large">${formatResistor(R_std)}</div><div class="result-sub">Calculated: ${formatResistor(R)}</div></div><div class="result-box"><div class="result-label">Actual Pulse Width</div><div class="result-value">${(actualPulse * 1000).toFixed(3)} ms</div><div class="result-sub">Target: ${(pulseWidth * 1000).toFixed(3)} ms</div></div><div class="result-box"><div class="result-label">Trigger Required</div><div class="result-value" style="font-size: 1.1rem;">LOW pulse</div><div class="result-sub">Momentary connection to ground</div></div><div class="diagram"><strong>555 Monostable Circuit</strong><br><br>
      Vcc -----[R=${formatResistor(R_std)}]---+--- Pin 7 (Discharge)<br>
                                |<br>
      Pin 6 (Threshold) --------+<br>
                                |<br>
                            [C=${formatCapacitance(C)}]<br>
                                |<br>
      GND -----------------+----+<br>
                          |<br>
      Trigger (Pin 2) ----o (momentary to GND)<br><br>
      Output: Pin 3 • Vcc: Pin 8 • GND: Pin 1<br>
      Pin 2 via 10kΩ to Vcc • Pin 4 to Vcc
    </div>
  `;
  
  document.getElementById('results').innerHTML = html;
}

function reset() {
  ['frequency', 'dutyCycle', 'capacitor', 'r1Input', 'r2Input', 'capacitorRev', 'pulseWidth', 'capacitorMono'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter values and click Calculate</div>';
}
