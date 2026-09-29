// Baut den Analysebericht "Bad Hersfeld vs. Bovenden" als report.html, aus den
// bereits gesammelten echten Daten in diesem Ordner (bh-monatsbericht-aug.json
// via aggregierte Werte, filiale_produktion September, bh-shift-vs-sx.json,
// bovenden-1709-items.json). Einmaliges Skript für diese eine Analyse.
const fs = require('fs');
const path = require('path');

const INK = '#1A1A18', MUTED = '#6B6860', GRID = '#E5E2DC', BLUE = '#2A6FB0', BLUE_FILL = '#DCEAF7', CORAL = '#C0392B', GREEN = '#1E8449', AMBER = '#8A5A00';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtEUR(n) { return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
function fmtEUR0(n) { return Math.round(n).toLocaleString('de-DE') + ' €'; }

// ── Kennzahlen (bereits vorher live berechnet, hier als Konstanten übernommen) ──
const aug = { tage: 25, umsatzTag: 563.21, stueckTag: 56.7, sortenTag: 14.1, umsatzGesamt: 14080.13, stueckGesamt: 1417 };
const sep = { tage: 16, umsatzTag: 641.14, stueckTag: 68.3, sortenTag: 21.3, umsatzGesamt: null, stueckGesamt: null };
const wachstum = {
  umsatz: (sep.umsatzTag / aug.umsatzTag - 1) * 100,
  stueck: (sep.stueckTag / aug.stueckTag - 1) * 100,
  sorten: (sep.sortenTag / aug.sortenTag - 1) * 100,
};

const bovenden = { datum: '17.09.2026', start: '08:40', ende: '12:02', minuten: 202, umsatz: 602.74, stueck: 76, sorten: 34, proMin: 602.74 / 202, proStd: (602.74 / 202) * 60 };
const bhAktiv = { minuten: 178, anteilSchicht: 40, luckeStart: 123, luckeEnde: 149, proMin: 641.14 / 178, proStd: (641.14 / 178) * 60 };

const shiftData = JSON.parse(fs.readFileSync(path.join(__dirname, 'bh-shift-vs-sx.json'), 'utf8'));
const bovendenItems = JSON.parse(fs.readFileSync(path.join(__dirname, 'bovenden-1709-items.json'), 'utf8'));

// ── Stat-Kachel: zwei Werte + Delta, keine Chart-Achse nötig (dataviz-Skill: "stat tile" statt Balken bei nur 2 Werten mit unterschiedlicher Einheit) ──
function statTile(label, augVal, sepVal, deltaPct, unit) {
  const up = deltaPct >= 0;
  const color = up ? GREEN : CORAL;
  const arrow = up ? '▲' : '▼';
  return `<div class="stat-tile">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-row"><span class="stat-month">Aug</span><span class="stat-val">${augVal}${unit}</span></div>
    <div class="stat-row"><span class="stat-month">Sep</span><span class="stat-val stat-val-main">${sepVal}${unit}</span></div>
    <div class="stat-delta" style="color:${color}">${arrow} ${Math.abs(deltaPct).toFixed(1)} %</div>
  </div>`;
}

// ── Gantt-Chart: geplante Schicht (heller Balken) vs. aktives Produktionsfenster (blauer Balken), 1 Zeile pro Tag ──
function ganttChart(days) {
  const dayMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const rangeStart = 7 * 60, rangeEnd = 16 * 60; // 07:00 - 16:00
  const W = 640, rowH = 22, padL = 70, padR = 16, padT = 26, padB = 8;
  const plotW = W - padL - padR;
  const rows = days.filter((d) => d.sxStart);
  const H = padT + rows.length * rowH + padB;
  const xOf = (mins) => padL + ((mins - rangeStart) / (rangeEnd - rangeStart)) * plotW;

  // Zeitraster jede volle Stunde
  let grid = '';
  for (let h = 7; h <= 16; h++) {
    const x = xOf(h * 60);
    grid += `<line x1="${x}" y1="${padT - 6}" x2="${x}" y2="${H - padB}" stroke="${GRID}" stroke-width="1"/>`;
    grid += `<text x="${x}" y="${padT - 10}" text-anchor="middle" font-size="9.5" fill="${MUTED}" font-family="Arial,sans-serif">${h}h</text>`;
  }

  let bars = '';
  rows.forEach((d, i) => {
    const y = padT + i * rowH;
    const schedX1 = xOf(dayMinutes(d.schedStart)), schedX2 = xOf(dayMinutes(d.schedEnd));
    const sxX1 = xOf(dayMinutes(d.sxStart)), sxX2 = xOf(dayMinutes(d.sxEnde));
    bars += `<text x="${padL - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="10" fill="${INK}" font-family="Arial,sans-serif">${esc(d.wd)} ${esc(d.datum.slice(8, 10))}.${esc(d.datum.slice(5, 7))}.</text>`;
    bars += `<rect x="${schedX1}" y="${y + 3}" width="${schedX2 - schedX1}" height="${rowH - 8}" rx="3" fill="#F0EEE9" stroke="${GRID}" stroke-width="1"/>`;
    bars += `<rect x="${sxX1}" y="${y + 3}" width="${Math.max(sxX2 - sxX1, 2)}" height="${rowH - 8}" rx="3" fill="${BLUE}"/>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Geplante Schicht vs. aktives Produktionsfenster">${grid}${bars}</svg>`;
}

function bovendenTable(items) {
  const rows = items.map((it) => `<tr><td>${esc(it.uhrzeit)}</td><td>${esc(it.produkt)}</td><td class="num">${esc(it.anzahl)}</td><td class="num">${esc(it.einzelpreis)}</td><td class="num">${esc(it.gesamtpreis)}</td></tr>`).join('');
  return `<table class="items"><thead><tr><th>Uhrzeit</th><th>Produkt</th><th class="num">Anzahl</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Produktivitäts-Analyse: Bad Hersfeld vs. Bovenden</title>
<style>
  @page { size: A4; margin: 20mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', sans-serif; color: ${INK}; font-size: 12.5px; line-height: 1.55; margin: 0; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid ${INK}; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${CORAL}; padding-bottom: 10px; margin-bottom: 6px; }
  .header .meta { text-align: right; font-size: 11.5px; color: ${MUTED}; line-height: 1.6; }
  .subtitle { font-size: 12.5px; color: ${MUTED}; margin: 0 0 18px; }
  .lead { font-size: 12.5px; margin: 0 0 10px; }
  .note { background: #F5F3F0; border-left: 3px solid ${BLUE}; border-radius: 4px; padding: 8px 12px; margin: 10px 0; font-size: 11.5px; color: ${MUTED}; }
  .stats-row { display: flex; gap: 12px; margin: 12px 0; }
  .stat-tile { flex: 1; border: 1px solid ${GRID}; border-radius: 8px; padding: 10px 12px; }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: ${MUTED}; margin-bottom: 6px; }
  .stat-row { display: flex; justify-content: space-between; font-size: 12px; padding: 1px 0; }
  .stat-month { color: ${MUTED}; }
  .stat-val { font-weight: 600; }
  .stat-val-main { font-weight: 800; font-size: 14px; }
  .stat-delta { margin-top: 4px; font-weight: 700; font-size: 12px; }
  .chart-block { border: 1px solid ${GRID}; border-radius: 6px; padding: 10px 12px 8px; margin: 10px 0; }
  .chart-title { font-size: 11.5px; font-weight: 700; margin-bottom: 6px; }
  .legend { font-size: 10.5px; color: ${MUTED}; margin-top: 6px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 4px; }
  .sw-plan { background: #F0EEE9; border: 1px solid ${GRID}; }
  .sw-active { background: ${BLUE}; }
  .callout { background: #FFF7E6; border: 1px solid #F0C070; border-radius: 6px; padding: 10px 14px; margin: 10px 0; font-size: 12.5px; }
  .callout b { color: ${AMBER}; }
  .compare-row { display: flex; gap: 14px; margin: 10px 0; }
  .compare-card { flex: 1; border: 1px solid ${GRID}; border-radius: 8px; padding: 12px 14px; }
  .compare-card h4 { margin: 0 0 6px; font-size: 12.5px; }
  .compare-card .big { font-size: 20px; font-weight: 800; }
  .compare-card .sub { font-size: 11px; color: ${MUTED}; }
  table.items { width: 100%; border-collapse: collapse; font-size: 10.8px; margin-top: 8px; }
  table.items th, table.items td { border: 1px solid ${GRID}; padding: 4px 7px; text-align: left; }
  table.items th { background: #F5F3F0; font-weight: 700; }
  table.items td.num, table.items th.num { text-align: right; font-variant-numeric: tabular-nums; }
  ul.next-steps { margin: 6px 0 0; padding-left: 18px; }
  ul.next-steps li { margin-bottom: 5px; }
  .footer-note { margin-top: 22px; padding-top: 10px; border-top: 1px solid ${GRID}; font-size: 10.5px; color: ${MUTED}; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Produktivitäts-Analyse: Bad Hersfeld</h1>
      <div class="subtitle">Vergleich August → September 2026 &amp; Benchmark gegen Bovenden</div>
    </div>
    <div class="meta">Gebiet Ost<br>Gebietsleiter: Thang Duc Duong<br>Erstellt am ${new Date().toLocaleDateString('de-DE')}</div>
  </div>

  <h2>1. Entwicklung August → September (Tegut Bad Hersfeld)</h2>
  <p class="lead">Reale Axonity-Zahlen (Produktionsbericht/Monatsbericht), Tagesdurchschnitt über alle Verkaufstage des jeweiligen Monats (August: ${aug.tage} Tage, September: ${sep.tage} Tage bisher).</p>
  <div class="stats-row">
    ${statTile('Ø Umsatz / Tag', fmtEUR0(aug.umsatzTag), fmtEUR0(sep.umsatzTag), wachstum.umsatz, '')}
    ${statTile('Ø Produzierte Stück / Tag', aug.stueckTag.toFixed(1), sep.stueckTag.toFixed(1), wachstum.stueck, '')}
    ${statTile('Ø Sorten / Tag', aug.sortenTag.toFixed(1), sep.sortenTag.toFixed(1), wachstum.sorten, '')}
  </div>
  <p class="lead">Es gibt echtes Wachstum: Umsatz +${wachstum.umsatz.toFixed(1)} %, produzierte Menge +${wachstum.stueck.toFixed(1)} %, Produktvielfalt sogar +${wachstum.sorten.toFixed(1)} %. Das ist die gute Nachricht und sollte im Gespräch auch so benannt werden. Das eigentliche Problem liegt nicht im Trend, sondern im Abschnitt 2.</p>

  <h2>2. Der eigentliche Befund: bezahlte Zeit vs. tatsächlich aktive Zeit</h2>
  <p class="lead">Herr Nguyen (Bad Hersfeld) ist an den meisten Tagen für <b>7,5 Std.</b> eingeplant (z. B. 07:30–15:00). Axonity zeichnet zu jedem gescannten Produkt eine Uhrzeit auf – "SX-Start" und "SX-Ende" markieren die Spanne, in der überhaupt etwas produziert/verbucht wurde. Diese Spanne unten als blauer Balken, die geplante Schicht als heller Rahmen darum.</p>
  <div class="chart-block">
    <div class="chart-title">Geplante Schicht (hell) vs. aktives Produktionsfenster in Axonity (blau) – September 2026</div>
    ${ganttChart(shiftData)}
    <div class="legend"><span class="sw sw-plan"></span> Geplante Schicht &nbsp;&nbsp; <span class="sw sw-active"></span> Aktives Produktionsfenster (SX-Start–SX-Ende)</div>
  </div>
  <div class="callout">
    Im Schnitt beginnt die erste gescannte Produktion <b>${bhAktiv.luckeStart} Minuten (≈ 2 Std.)</b> nach Schichtbeginn, und die letzte Buchung liegt <b>${bhAktiv.luckeEnde} Minuten (≈ 2,5 Std.)</b> vor Schichtende. Aktiv sind im Schnitt nur <b>${bhAktiv.minuten} Minuten von 450 Minuten Schicht – also ${bhAktiv.anteilSchicht} %</b>. An 4 Tagen (07.09., 08.09., 28.09., 29.09.) liegt überhaupt keine Produktionsbuchung vor, obwohl eine Schicht geplant war.
  </div>
  <p class="lead" style="font-size:11px;color:${MUTED}">Hinweis zur Fairness: SX-Start/-Ende erfasst nur gescannte Produktion, nicht zwingend jede Tätigkeit (Verkauf am Tresen, Wareneingang, Reinigung). Die Lücke ist trotzdem so groß und so regelmäßig, dass sie ein reales Gesprächsthema ist – am besten direkt fragen, was in diesen ca. 4,5 Std. pro Tag passiert.</p>

  <h3>Wichtig: Wenn er aktiv ist, ist die Leistung nicht schlecht</h3>
  <div class="compare-row">
    <div class="compare-card">
      <h4>Bovenden – 17.09.2026, 1 Mitarbeiter allein</h4>
      <div class="big">${fmtEUR0(bovenden.proStd)} / Std.</div>
      <div class="sub">${fmtEUR(bovenden.umsatz)} in ${bovenden.minuten} Min. aktiver Produktion (${bovenden.start}–${bovenden.ende}), ${bovenden.stueck} Stück, ${bovenden.sorten} Sorten</div>
    </div>
    <div class="compare-card">
      <h4>Bad Hersfeld – Ø September, nur aktives Fenster</h4>
      <div class="big">${fmtEUR0(bhAktiv.proStd)} / Std.</div>
      <div class="sub">${fmtEUR0(sep.umsatzTag)} Tagesschnitt in ${bhAktiv.minuten} Min. aktivem Fenster, ${sep.stueckTag.toFixed(0)} Stück, ${sep.sortenTag.toFixed(0)} Sorten</div>
    </div>
  </div>
  <p class="lead">Pro aktiver Minute produziert Bad Hersfeld sogar etwas mehr Umsatz als Bovenden. Das Argument gegenüber dem Mitarbeiter ist deshalb nicht "du arbeitest langsam", sondern: <b>"in der Zeit, in der du produzierst, bist du gut – aber du produzierst nur an 40&nbsp;% deiner bezahlten Schicht. Bei Bovenden schafft eine Person allein in ${(bovenden.minuten / 60).toFixed(1)} Std. das, wofür du eine 7,5-Std.-Schicht zur Verfügung hast."</b></p>

  <div class="page-break"></div>
  <h2>3. Beispiel-Liste: Was 1 Mitarbeiter allein in einer Schicht produzieren kann (Bovenden, 17.09.2026)</h2>
  <p class="lead">Vollständige Artikel-Liste aus Axonity, ${bovenden.start}–${bovenden.ende} (${(bovenden.minuten / 60).toFixed(1)} Std.), 1 Person allein, ${bovendenItems.length} Buchungen, ${bovenden.sorten} unterschiedliche Sorten, ${bovenden.stueck} Stück, ${fmtEUR(bovenden.umsatz)}.</p>
  ${bovendenTable(bovendenItems)}

  <div class="page-break"></div>
  <h2>4. Gesprächsleitfaden &amp; nächste Schritte für Bad Hersfeld</h2>
  <ul class="next-steps">
    <li><b>Positiv einsteigen:</b> Wachstum August → September (+${wachstum.umsatz.toFixed(0)} % Umsatz, +${wachstum.sorten.toFixed(0)} % Sortenvielfalt) anerkennen – das ist real und motiviert eher als ein reiner Vorwurf.</li>
    <li><b>Die Zahlen zeigen, nicht behaupten:</b> das Gantt-Diagramm aus Abschnitt 2 gemeinsam anschauen und konkret fragen, was zwischen Schichtbeginn und erstem Scan bzw. nach dem letzten Scan bis Schichtende passiert.</li>
    <li><b>Bovenden-Liste als Referenz zeigen:</b> nicht als Vorwurf ("mach das genauso"), sondern als Beleg, was in ${(bovenden.minuten / 60).toFixed(1)} Std. konzentrierter Arbeit möglich ist – Bad Hersfeld hat dafür die doppelte Zeit zur Verfügung.</li>
    <li><b>Konkrete Zielvereinbarung:</b> z. B. aktives Produktionsfenster in den nächsten 4 Wochen schrittweise auf 5–6 Std. der 7,5-Std.-Schicht ausweiten, Fortschritt wöchentlich anhand von SX-Start/-Ende prüfen.</li>
    <li><b>Die 4 Tage ganz ohne Buchung (07.09., 08.09., 28.09., 29.09.) direkt ansprechen</b> – dafür gibt es keine Krankmeldung im System, also nachfragen was an diesen Tagen tatsächlich lief.</li>
    <li><b>Wiedervorlage:</b> in 4 Wochen dieselbe Auswertung erneut laufen lassen und direkt vergleichen, ob sich das aktive Fenster wirklich verändert hat.</li>
  </ul>

  <div class="footer-note">Datenquellen: Axonity "Produktionsbericht"/"Monatsbericht" (live abgerufen, ${new Date().toLocaleDateString('de-DE')}), Firestore <code>filiale_produktion</code> (September, bereits synchronisiert), Firestore <code>plan</code> (geplante Schichten Bad Hersfeld). Keine geschätzten Zahlen – alle Werte real erhoben.</div>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'report.html'), html);
console.log('geschrieben: report.html');
