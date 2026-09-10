(function () {
  'use strict';

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

// Accepts "23 1/2", "23-1/2", "1/2", "-1/2", "0.75", "12", and any of
// those with a trailing inch mark ("23 1/2\"") since that's exactly what
// these fields display -- a field that isn't fully re-selected before
// typing (a single click positions the cursor but doesn't select existing
// content) ends up with the old value's trailing '"' still present.
function parseFraction(input) {
  if (typeof input === 'number') return input;
  let str = String(input ?? '').trim();
  if (str.endsWith('"')) str = str.slice(0, -1).trim();
  if (str === '') return NaN;

  const negative = str.startsWith('-');
  const body = negative ? str.slice(1).trim() : str;

  if (/^\d*\.?\d+$/.test(body)) {
    const v = parseFloat(body);
    return negative ? -v : v;
  }

  const mixed = body.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return NaN;
    const v = whole + num / den;
    return negative ? -v : v;
  }

  const frac = body.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) return NaN;
    const v = num / den;
    return negative ? -v : v;
  }

  return NaN;
}

// Renders a decimal-inch value as a mixed-number fraction string, rounded
// to the nearest 1/precisionDenominator, reduced to lowest terms.
function formatFraction(value, precisionDenominator = 16) {
  if (!Number.isFinite(value)) return '—';

  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const totalUnits = Math.round(abs * precisionDenominator);

  const whole = Math.floor(totalUnits / precisionDenominator);
  let rem = totalUnits - whole * precisionDenominator;
  let den = precisionDenominator;

  if (rem === 0) return `${sign}${whole}"`;

  const g = gcd(rem, den);
  rem /= g;
  den /= g;

  if (whole === 0) return `${sign}${rem}/${den}"`;
  return `${sign}${whole} ${rem}/${den}"`;
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.units = { gcd, parseFraction, formatFraction };

})();
