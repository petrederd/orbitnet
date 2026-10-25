/**
 * Escape a value before inserting it into HTML.
 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/**
 * Main calculation function
 */
function calculate() {
  // Clear previous errors
  document.getElementById('errorMsg').innerHTML = '';
  
  // Get input values
  const input1 = document.getElementById('input1').value.trim();
  
  // Validation
  if (!input1) {
    showError('Please enter a value');
    return;
  }
  
  try {
    // Perform calculations
    const result = processInput(input1);
    
    // Display results
    displayResults(result);
  } catch (error) {
    showError(error.message);
  }
}

/**
 * Process input and return results
 */
function processInput(input) {
  // TODO: Implement tool logic here
  return {
    value: input,
    // Add calculated values
  };
}

/**
 * Display results in the results panel
 */
function displayResults(result) {
  const html = `
    <div class="result-box highlight">
      <div class="result-label">Result Label</div>
      <div class="result-value large">${esc(result.value)}</div>
    </div>
  `;
  document.getElementById('results').innerHTML = html;
}

/**
 * Show error message (text is inserted safely, never as raw HTML)
 */
function showError(message) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(message == null ? '' : message);
  el.appendChild(div);
}

/**
 * Reset the tool
 */
function reset() {
  document.getElementById('input1').value = '';
  document.getElementById('errorMsg').innerHTML = '';
  document.getElementById('results').innerHTML = 
    '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter values to see results</div>';
}
