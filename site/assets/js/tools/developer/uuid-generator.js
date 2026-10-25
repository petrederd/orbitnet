let currentUUIDs = [];

function generateUUID() {
  // Use crypto.randomUUID() if available, otherwise build a v4 UUID from secure random bytes.
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20);
}

function formatUUID(uuid, format) {
  switch(format) {
    case 'upper':
      return uuid.toUpperCase();
    case 'lower':
      return uuid.toLowerCase();
    case 'compact':
      return uuid.replace(/-/g, '');
    case 'braces':
      return `{${uuid}}`;
    default:
      return uuid;
  }
}

function generateSingle() {
  const uuid = generateUUID();
  document.getElementById('singleUUID').textContent = uuid;
  document.getElementById('singleStatus').innerHTML = '';
}

function copySingle() {
  const uuid = document.getElementById('singleUUID').textContent;
  
  if (uuid === '-') {
    generateSingle();
    return;
  }
  
  navigator.clipboard.writeText(uuid).then(() => {
    document.getElementById('singleStatus').innerHTML = 
      '<div class="status-box success"> UUID copied to clipboard!</div>';
    setTimeout(() => {
      document.getElementById('singleStatus').innerHTML = '';
    }, 3000);
  }).catch(() => {
    alert('Failed to copy. Please select and copy manually.');
  });
}

function generateBulk() {
  const count = parseInt(document.getElementById('bulkCount').value);
  const format = document.getElementById('format').value;
  
  if (isNaN(count) || count < 1 || count > 1000) {
    document.getElementById('bulkStatus').innerHTML = 
      '<div class="status-box" style="background: rgba(255,85,85,.1); border: 1.5px solid #ff5555; color: #ff5555;">Please enter a number between 1 and 1000</div>';
    return;
  }
  
  currentUUIDs = [];
  for (let i = 0; i < count; i++) {
    const uuid = formatUUID(generateUUID(), format);
    currentUUIDs.push(uuid);
  }
  
  displayBulkUUIDs();
  document.getElementById('bulkList').style.display = 'block';
  document.getElementById('bulkStatus').innerHTML = '';
}

function displayBulkUUIDs() {
  const listHTML = currentUUIDs.map((uuid, index) => `
    <div class="uuid-item"><span class="uuid-text">${uuid}</span><button class="uuid-copy" data-action="copyUUID" data-args='[${index},{"$el":true}]'>Copy</button></div>
  `).join('');
  
  document.getElementById('uuidList').innerHTML = listHTML;
  document.getElementById('bulkTotal').textContent = currentUUIDs.length;
}

function copyUUID(index, btn) {
  const uuid = currentUUIDs[index];
  navigator.clipboard.writeText(uuid).then(() => {
    btn.textContent = ' Copied!';
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 2000);
  });
}

function copyAll() {
  if (currentUUIDs.length === 0) {
    document.getElementById('bulkStatus').innerHTML = 
      '<div class="status-box" style="background: rgba(255,85,85,.1); border: 1.5px solid #ff5555; color: #ff5555;">Generate UUIDs first</div>';
    return;
  }
  
  const text = currentUUIDs.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('bulkStatus').innerHTML = 
      '<div class="status-box success"> All UUIDs copied to clipboard!</div>';
    setTimeout(() => {
      document.getElementById('bulkStatus').innerHTML = '';
    }, 3000);
  }).catch(() => {
    alert('Failed to copy. Please select and copy manually.');
  });
}

function clearBulk() {
  currentUUIDs = [];
  document.getElementById('bulkList').style.display = 'none';
  document.getElementById('bulkStatus').innerHTML = '';
}

function downloadUUIDs() {
  if (currentUUIDs.length === 0) {
    document.getElementById('bulkStatus').innerHTML = 
      '<div class="status-box" style="background: rgba(255,85,85,.1); border: 1.5px solid #ff5555; color: #ff5555;">Generate UUIDs first</div>';
    return;
  }
  
  const text = currentUUIDs.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `uuids-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  document.getElementById('bulkStatus').innerHTML = 
    '<div class="status-box success"> File downloaded!</div>';
  setTimeout(() => {
    document.getElementById('bulkStatus').innerHTML = '';
  }, 3000);
}

// Generate initial UUID on load
generateSingle();
