const units = {
  length: {
    'Millimeters (mm)': 0.001,
    'Centimeters (cm)': 0.01,
    'Meters (m)': 1,
    'Kilometers (km)': 1000,
    'Inches (in)': 0.0254,
    'Feet (ft)': 0.3048,
    'Yards (yd)': 0.9144,
    'Miles (mi)': 1609.344
  },
  weight: {
    'Milligrams (mg)': 0.001,
    'Grams (g)': 1,
    'Kilograms (kg)': 1000,
    'Metric Tons (t)': 1000000,
    'Ounces (oz)': 28.349523125,
    'Pounds (lb)': 453.59237,
    'Tons (US)': 907184.74
  },
  temperature: {
    'Celsius (°C)': 'C',
    'Fahrenheit (°F)': 'F',
    'Kelvin (K)': 'K'
  },
  area: {
    'Square mm (mm²)': 0.000001,
    'Square cm (cm²)': 0.0001,
    'Square meters (m²)': 1,
    'Hectares (ha)': 10000,
    'Square km (km²)': 1000000,
    'Square inches (in²)': 0.00064516,
    'Square feet (ft²)': 0.09290304,
    'Square yards (yd²)': 0.83612736,
    'Acres': 4046.8564224,
    'Square miles (mi²)': 2589988.110336
  },
  volume: {
    'Milliliters (ml)': 0.001,
    'Liters (L)': 1,
    'Cubic meters (m³)': 1000,
    'Teaspoons (tsp)': 0.00492892159375,
    'Tablespoons (tbsp)': 0.01478676478125,
    'Fluid ounces (fl oz)': 0.0295735295625,
    'Cups': 0.2365882365,
    'Pints (pt)': 0.473176473,
    'Quarts (qt)': 0.946352946,
    'Gallons (gal)': 3.785411784
  },
  speed: {
    'Meters/second (m/s)': 1,
    'Kilometers/hour (km/h)': 1 / 3.6,
    'Miles/hour (mph)': 0.44704,
    'Feet/second (ft/s)': 0.3048,
    'Knots (kn)': 1852 / 3600
  }
};

let currentCategory = 'length';

function setCategory(category, btn) {
  currentCategory = category;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  populateUnits();
  convert();
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e-6 && abs < 1e15) {
    return Number(n.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 12 });
  }
  return n.toExponential(6).replace(/\.?0+e/, 'e');
}

function populateUnits() {
  const fromSelect = document.getElementById('fromUnit');
  const toSelect = document.getElementById('toUnit');
  
  fromSelect.innerHTML = '';
  toSelect.innerHTML = '';
  
  const unitList = Object.keys(units[currentCategory]);
  
  unitList.forEach(unit => {
    fromSelect.add(new Option(unit, unit));
    toSelect.add(new Option(unit, unit));
  });
  
  if (unitList.length > 1) {
    toSelect.selectedIndex = 1;
  }
}

function convertTemperature(value, from, to) {
  let celsius;
  
  if (from === 'C') celsius = value;
  else if (from === 'F') celsius = (value - 32) * 5/9;
  else if (from === 'K') celsius = value - 273.15;
  
  if (to === 'C') return celsius;
  else if (to === 'F') return celsius * 9/5 + 32;
  else if (to === 'K') return celsius + 273.15;
}

function convert() {
  const value = parseFloat(document.getElementById('inputValue').value);
  const fromUnit = document.getElementById('fromUnit').value;
  const toUnit = document.getElementById('toUnit').value;
  const errEl = document.getElementById('errorMsg');
  errEl.innerHTML = '';
  
  if (isNaN(value)) {
    document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter a valid number</div>';
    return;
  }
  
  let result;
  
  if (currentCategory === 'temperature') {
    const fromCode = units.temperature[fromUnit];
    const toCode = units.temperature[toUnit];
    const belowAbsoluteZero = (fromCode === 'C' && value < -273.15) ||
      (fromCode === 'F' && value < -459.67) ||
      (fromCode === 'K' && value < 0);
    if (belowAbsoluteZero) {
      errEl.innerHTML = '<div class="error">Temperature cannot be below absolute zero (-273.15 °C / -459.67 °F / 0 K).</div>';
      document.getElementById('results').innerHTML = '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">Enter a valid temperature</div>';
      return;
    }
    result = convertTemperature(value, fromCode, toCode);
  } else {
    const fromFactor = units[currentCategory][fromUnit];
    const toFactor = units[currentCategory][toUnit];
    result = value * fromFactor / toFactor;
  }
  
  const formatted = formatNumber(result);
  document.getElementById('results').innerHTML = `
    <div class="result-box highlight"><div class="result-label">Result</div><div class="result-value">${formatted}</div><div class="result-sub">${toUnit}</div></div><div class="result-box"><div class="result-label">Conversion</div><div style="font-size: 1.1rem; font-weight: 600; color: var(--ink);">${value} ${fromUnit}</div><div style="text-align: center; font-size: 1.3rem; color: var(--orange); margin: 8px 0;">→</div><div style="font-size: 1.1rem; font-weight: 600; color: var(--ink);">${formatted} ${toUnit}</div></div>
  `;
}

populateUnits();
convert();
