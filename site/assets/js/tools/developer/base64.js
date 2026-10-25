function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showStatus(elementId, type, message) {
  const statusDiv = document.getElementById(elementId);
    
  statusDiv.innerHTML = `<div class="status-box ${type}">${esc(message)}</div>`;
  
  if (type === 'success') {
    setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
  }
}

function clearStatus(elementId) {
  document.getElementById(elementId).innerHTML = '';
}

function updateStats(text, statsId) {
  if (!text) {
    document.getElementById(statsId).innerHTML = '';
    return;
  }
  
  const chars = text.length;
  const bytes = new Blob([text]).size;
  const lines = text.split('\n').length;
  
  document.getElementById(statsId).innerHTML = `
    <div><span>${chars.toLocaleString('en-US')}</span> characters</div><div><span>${bytes.toLocaleString('en-US')}</span> bytes</div><div><span>${lines}</span> lines</div>
  `;
}

function encode() {
  clearStatus('plainStatus');
  clearStatus('base64Status');
  
  const plainText = document.getElementById('plainText').value;
  
  if (!plainText) {
    showStatus('plainStatus', 'error', 'No text to encode');
    return;
  }
  
  try {
    const bytes = new TextEncoder().encode(plainText);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const encoded = btoa(binary);
    document.getElementById('base64Text').value = encoded;
    
    updateStats(encoded, 'base64Stats');
    showStatus('plainStatus', 'success', 'Text encoded successfully');
    
    // Show size comparison
    const originalSize = new Blob([plainText]).size;
    const encodedSize = new Blob([encoded]).size;
    const increase = ((encodedSize / originalSize - 1) * 100).toFixed(1);
    showStatus('base64Status', 'info', `Size increased by ${increase}% (${originalSize} → ${encodedSize} bytes)`);
  } catch (error) {
    showStatus('plainStatus', 'error', 'Encoding failed: ' + error.message);
  }
}

function decode() {
  clearStatus('plainStatus');
  clearStatus('base64Status');
  
  const base64Text = document.getElementById('base64Text').value.trim();
  
  if (!base64Text) {
    showStatus('base64Status', 'error', 'No Base64 to decode');
    return;
  }
  
  try {
    // Remove whitespace, accept the URL-safe alphabet, and restore padding.
    let cleaned = base64Text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');

    // Validate Base64 format
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
      throw new Error('Invalid Base64 format');
    }
    if (cleaned.length % 4) cleaned += '='.repeat(4 - cleaned.length % 4);

    const binary = atob(cleaned);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));

    let decoded;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (decodeError) {
      showStatus('base64Status', 'error', 'Valid Base64, but the decoded bytes are binary data, not UTF-8 text. Use a binary-aware decoder to inspect it.');
      return;
    }
    
    document.getElementById('plainText').value = decoded;

    updateStats(decoded, 'plainStats');
    showStatus('base64Status', 'success', 'Base64 decoded successfully');
  } catch (error) {
    showStatus('base64Status', 'error', 'Decoding failed: invalid Base64 string');
  }
}

function copyPlain() {
  const text = document.getElementById('plainText').value;
  
  if (!text) {
    showStatus('plainStatus', 'error', 'Nothing to copy');
    return;
  }
  
  copyText(text).then(copied => {
    showStatus('plainStatus', copied ? 'success' : 'error', copied ? 'Plain text copied to clipboard!' : 'Failed to copy to clipboard');
  });
}

function copyBase64() {
  const text = document.getElementById('base64Text').value;
  
  if (!text) {
    showStatus('base64Status', 'error', 'Nothing to copy');
    return;
  }
  
  copyText(text).then(copied => {
    showStatus('base64Status', copied ? 'success' : 'error', copied ? 'Base64 copied to clipboard!' : 'Failed to copy to clipboard');
  });
}

function clearPlain() {
  document.getElementById('plainText').value = '';
  clearStatus('plainStatus');
  updateStats('', 'plainStats');
}

function clearBase64() {
  document.getElementById('base64Text').value = '';
  clearStatus('base64Status');
  updateStats('', 'base64Stats');
}

// Update stats on input
document.getElementById('plainText').addEventListener('input', (e) => {
  updateStats(e.target.value, 'plainStats');
});

document.getElementById('base64Text').addEventListener('input', (e) => {
  updateStats(e.target.value, 'base64Stats');
});
