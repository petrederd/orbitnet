// Toggle between CIDR and Subnet Mask input
document.getElementById('subnetType').addEventListener('change', function() {
  const isCIDR = this.value === 'cidr';
  document.getElementById('cidrGroup').style.display = isCIDR ? 'block' : 'none';
  document.getElementById('maskGroup').style.display = isCIDR ? 'none' : 'block';
});

function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  // Shift operations return a signed 32-bit integer; >>> 0 makes it unsigned.
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(int) {
  return [
    (int >>> 24) & 0xFF,
    (int >>> 16) & 0xFF,
    (int >>> 8) & 0xFF,
    int & 0xFF
  ].join('.');
}

function cidrToMask(cidr) {
  const mask = cidr === 0 ? 0 : (0xFFFFFFFF << (32 - cidr)) >>> 0;
  return intToIp(mask);
}

function maskToCidr(mask) {
  const binary = ipToInt(mask).toString(2);
  return binary.split('1').length - 1;
}

function validateIP(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === num.toString();
  });
}

function validateMask(mask) {
  if (!validateIP(mask)) return false;
  const binary = ipToInt(mask).toString(2).padStart(32, '0');
  return /^1*0*$/.test(binary); // Must be consecutive 1s followed by 0s
}

function showError(message) {
  const errorDiv = document.getElementById('errorMsg');
  errorDiv.innerHTML = `<div class="error">${message}</div>`;
}

function clearError() {
  document.getElementById('errorMsg').innerHTML = '';
}

function calculate() {
  clearError();
  
  const ipAddress = document.getElementById('ipAddress').value.trim();
  const subnetType = document.getElementById('subnetType').value;
  
  // Validate IP
  if (!validateIP(ipAddress)) {
    showError('Invalid IP address. Please enter a valid IPv4 address (e.g., 192.168.1.1)');
    return;
  }
  
  let cidr;
  let subnetMask;
  
  if (subnetType === 'cidr') {
    const cidrRaw = document.getElementById('cidr').value.trim();
    if (!/^\d{1,2}$/.test(cidrRaw)) {
      showError('CIDR must be an integer between 0 and 32');
      return;
    }
    cidr = Number(cidrRaw);
    if (cidr < 0 || cidr > 32) {
      showError('CIDR must be an integer between 0 and 32');
      return;
    }
    subnetMask = cidrToMask(cidr);
  } else {
    subnetMask = document.getElementById('subnetMask').value.trim();
    if (!validateMask(subnetMask)) {
      showError('Invalid subnet mask. Please enter a valid mask (e.g., 255.255.255.0)');
      return;
    }
    cidr = maskToCidr(subnetMask);
  }
  
  // Calculate network details
  const ipInt = ipToInt(ipAddress);
  const maskInt = ipToInt(subnetMask);
  const networkInt = (ipInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;
  const firstHostInt = networkInt + 1;
  const lastHostInt = broadcastInt - 1;
  
  const totalHosts = Math.pow(2, 32 - cidr);
  const usableHosts = cidr === 32 ? 1 : (cidr === 31 ? 2 : totalHosts - 2);
  
  const networkAddr = intToIp(networkInt);
  const broadcastAddr = intToIp(broadcastInt);
  const firstHost = cidr >= 31 ? networkAddr : intToIp(firstHostInt);
  const lastHost = cidr >= 31 ? broadcastAddr : intToIp(lastHostInt);
  
  // Display results
  const resultsHTML = `
    <div class="result-box highlight"><div class="result-label">Network Address</div><div class="result-value large">${networkAddr}/${cidr}</div><div class="result-sub">Network ID for this subnet</div></div><div class="result-box"><div class="result-label">Subnet Mask</div><div class="result-value">${subnetMask}</div><div class="result-sub">Decimal notation</div></div><div class="result-box"><div class="result-label">Broadcast Address</div><div class="result-value">${broadcastAddr}</div><div class="result-sub">Used to send packets to all hosts</div></div><div class="result-box"><div class="result-label">First Usable Host</div><div class="result-value">${firstHost}</div><div class="result-sub">Lowest assignable IP</div></div><div class="result-box"><div class="result-label">Last Usable Host</div><div class="result-value">${lastHost}</div><div class="result-sub">Highest assignable IP</div></div><div class="result-box highlight"><div class="result-label">Total Hosts</div><div class="result-value">${totalHosts.toLocaleString('en-US')}</div><div class="result-sub">Including network and broadcast</div></div><div class="result-box highlight"><div class="result-label">Usable Hosts</div><div class="result-value large">${usableHosts.toLocaleString('en-US')}</div><div class="result-sub">Available for devices</div></div>
  `;
  
  document.getElementById('results').innerHTML = resultsHTML;
}

function reset() {
  document.getElementById('ipAddress').value = '';
  document.getElementById('cidr').value = '';
  document.getElementById('subnetMask').value = '';
  document.getElementById('subnetType').value = 'cidr';
  document.getElementById('cidrGroup').style.display = 'block';
  document.getElementById('maskGroup').style.display = 'none';
  clearError();
  document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter an IP address and subnet to see the results</div>';
}
