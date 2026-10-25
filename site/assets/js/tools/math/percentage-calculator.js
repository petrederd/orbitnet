let currentMode = 'basic';

function setMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  document.getElementById('basicInputs').style.display = mode === 'basic' ? 'block' : 'none';
  document.getElementById('changeInputs').style.display = mode === 'change' ? 'block' : 'none';
  document.getElementById('reverseInputs').style.display = mode === 'reverse' ? 'block' : 'none';
  document.getElementById('increaseInputs').style.display = mode === 'increase' ? 'block' : 'none';
  
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Select calculation type and enter values</div>';
}

function calculate() {
  clearError();
  
  if (currentMode === 'basic') {
    const percent = parseFloat(document.getElementById('percent1').value);
    const value = parseFloat(document.getElementById('value1').value);
    
    if (isNaN(percent) || isNaN(value)) {
      showError('Please enter all values');
      return;
    }
    
    const result = (percent / 100) * value;
    
    document.getElementById('results').innerHTML = `
      <div class="result-box highlight"><div class="result-label">Result</div><div class="result-value large">${result.toFixed(2)}</div><div class="result-sub">${percent}% of ${value}</div></div><div class="result-box"><div class="result-label">Formula</div><div class="result-value" style="font-size: 1.1rem;">(${percent} ÷ 100) × ${value}</div></div>
    `;
  } else if (currentMode === 'change') {
    const oldVal = parseFloat(document.getElementById('oldValue').value);
    const newVal = parseFloat(document.getElementById('newValue').value);
    
    if (isNaN(oldVal) || isNaN(newVal)) {
      showError('Please enter all values');
      return;
    }
    
    if (oldVal === 0) {
      showError('Original value cannot be zero');
      return;
    }
    
    const change = ((newVal - oldVal) / Math.abs(oldVal)) * 100;
    const diff = newVal - oldVal;
    const type = change >= 0 ? 'Increase' : 'Decrease';
    
    document.getElementById('results').innerHTML = `
      <div class="result-box highlight"><div class="result-label">Percentage Change</div><div class="result-value large">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</div><div class="result-sub">${type}</div></div><div class="result-box"><div class="result-label">Absolute Change</div><div class="result-value">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}</div><div class="result-sub">${oldVal} → ${newVal}</div></div>
    `;
  } else if (currentMode === 'reverse') {
    const part = parseFloat(document.getElementById('partValue').value);
    const total = parseFloat(document.getElementById('totalValue').value);
    
    if (isNaN(part) || isNaN(total)) {
      showError('Please enter all values');
      return;
    }
    
    if (total === 0) {
      showError('Total value cannot be zero');
      return;
    }
    
    const percent = (part / total) * 100;
    
    document.getElementById('results').innerHTML = `
      <div class="result-box highlight"><div class="result-label">Percentage</div><div class="result-value large">${percent.toFixed(2)}%</div><div class="result-sub">${part} is ${percent.toFixed(2)}% of ${total}</div></div><div class="result-box"><div class="result-label">Formula</div><div class="result-value" style="font-size: 1.1rem;">(${part} ÷ ${total}) × 100</div></div>
    `;
  } else if (currentMode === 'increase') {
    const base = parseFloat(document.getElementById('baseValue').value);
    const percent = parseFloat(document.getElementById('percent2').value);
    
    if (isNaN(base) || isNaN(percent)) {
      showError('Please enter all values');
      return;
    }
    
    const increased = base * (1 + percent / 100);
    const decreased = base * (1 - percent / 100);
    
    document.getElementById('results').innerHTML = `
      <div class="result-box highlight"><div class="result-label">Increase by ${percent}%</div><div class="result-value large">${increased.toFixed(2)}</div><div class="result-sub">${base} + ${percent}% = ${increased.toFixed(2)}</div></div><div class="result-box highlight"><div class="result-label">Decrease by ${percent}%</div><div class="result-value large">${decreased.toFixed(2)}</div><div class="result-sub">${base} - ${percent}% = ${decreased.toFixed(2)}</div></div>
    `;
  }
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
  ['percent1', 'value1', 'oldValue', 'newValue', 'partValue', 'totalValue', 'baseValue', 'percent2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Select calculation type and enter values</div>';
}
