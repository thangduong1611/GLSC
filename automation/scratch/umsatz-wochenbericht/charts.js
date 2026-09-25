// Handgebaute SVG-Charts fürs PDF (kein Chart.js — Playwright rendert das
// HTML zu PDF, ein statisches, server-seitig gebautes SVG ist dafür robuster
// und schärfer als ein zur Druckzeit noch laufendes Canvas-Skript).
// Farben/Maße für Druck optimiert: helle Fläche, dunkler Text, kein Dark Mode.

const INK = '#1A1A18';
const MUTED = '#6B6860';
const GRID = '#E5E2DC';
const BLUE = '#2A6FB0';
const BLUE_FILL = '#DCEAF7';
const CORAL = '#C0392B';

function fmtEUR(n) {
  if (n == null || Number.isNaN(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}
function fmtEURk(n) {
  if (n == null || Number.isNaN(n)) return '–';
  return (n / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k €';
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const MONTH_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
function monthLabel(periode) {
  const [y, m] = periode.split('-');
  return MONTH_DE[parseInt(m, 10) - 1] + ' ' + y.slice(2);
}
function dayLabel(datum) {
  const d = new Date(datum + 'T00:00:00');
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.';
}

// Einfaches Balkendiagramm: monatlicher Umsatz, ein Wert pro Monat.
function monthlyBarChart(months, opts) {
  opts = opts || {};
  const W = 620, H = 220, padL = 56, padR = 16, padT = 22, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const values = months.map((m) => m.umsatz || 0);
  const maxV = Math.max(...values, 1) * 1.18;
  const n = months.length;
  const gap = 28;
  const barW = Math.min(64, (plotW - gap * (n - 1)) / n);
  const usedW = barW * n + gap * (n - 1);
  const startX = padL + (plotW - usedW) / 2;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    const v = maxV * f;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="${MUTED}" font-family="Arial,sans-serif">${fmtEURk(v)}</text>`;
  }).join('');

  const bars = months.map((m, i) => {
    const x = startX + i * (barW + gap);
    const v = m.umsatz || 0;
    const h = plotH * (v / maxV);
    const y = padT + plotH - h;
    const label = monthLabel(m.periode);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${BLUE}"/>`
      + `<text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}" font-family="Arial,sans-serif">${fmtEUR(v)}</text>`
      + `<text x="${x + barW / 2}" y="${padT + plotH + 20}" text-anchor="middle" font-size="12" fill="${MUTED}" font-family="Arial,sans-serif">${esc(label)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monatlicher Umsatz">`
    + `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#C3C2B7" stroke-width="1"/>`
    + gridLines + bars + `</svg>`;
}

// Kombi-Chart: täglicher Ist-Umsatz (Balken) vs. Tagesziel (Linie).
function dailyIstZielChart(days) {
  const W = 620, H = 230, padL = 56, padR = 16, padT = 22, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = days.length;
  const allVals = [];
  days.forEach((d) => { if (d.ist != null) allVals.push(d.ist); if (d.ziel != null) allVals.push(d.ziel); });
  const maxV = Math.max(...allVals, 1) * 1.15;
  const barW = Math.min(22, (plotW / n) * 0.55);
  const step = plotW / n;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    const v = maxV * f;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="${MUTED}" font-family="Arial,sans-serif">${fmtEURk(v)}</text>`;
  }).join('');

  const bars = days.map((d, i) => {
    const cx = padL + step * i + step / 2;
    const v = d.ist || 0;
    const h = plotH * (v / maxV);
    const y = padT + plotH - h;
    return `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${Math.max(h, 0.5)}" rx="3" fill="${BLUE_FILL}" stroke="${BLUE}" stroke-width="1"/>`;
  }).join('');

  const zielPts = days.map((d, i) => {
    const cx = padL + step * i + step / 2;
    if (d.ziel == null) return null;
    const y = padT + plotH * (1 - Math.min(d.ziel / maxV, 1));
    return { x: cx, y };
  });
  let linePath = '';
  let prev = null;
  zielPts.forEach((p) => {
    if (!p) { prev = null; return; }
    linePath += (prev ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' ';
    prev = p;
  });
  const dots = zielPts.filter(Boolean).map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${CORAL}"/>`).join('');

  const everyNth = n > 16 ? 2 : 1;
  const xLabels = days.map((d, i) => {
    if (i % everyNth !== 0) return '';
    const cx = padL + step * i + step / 2;
    return `<text x="${cx}" y="${padT + plotH + 18}" text-anchor="middle" font-size="9.5" fill="${MUTED}" font-family="Arial,sans-serif" transform="rotate(0)">${dayLabel(d.datum)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ist-Umsatz vs. Tagesziel">`
    + `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#C3C2B7" stroke-width="1"/>`
    + gridLines + bars
    + `<path d="${linePath.trim()}" fill="none" stroke="${CORAL}" stroke-width="2"/>` + dots
    + xLabels + `</svg>`;
}

module.exports = { fmtEUR, fmtEURk, esc, monthLabel, dayLabel, monthlyBarChart, dailyIstZielChart, INK, MUTED, BLUE, CORAL };
