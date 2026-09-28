// Baut den wöchentlichen Umsatz-Maßnahmenbericht (report.html) aus:
//  - data.json (siehe fetch-data.js - reale Firestore-Zahlen)
//  - week-config.json (Kopfdaten, optional ein "systemChange"-Abschnitt für
//    ein gebietsweites Thema dieser Woche, + "Maßnahme diese Woche" pro
//    Filiale - das ist der Teil, der sich JEDE Woche ändert)
//  - week-config.json.systemChange.screenshots (Array), falls gesetzt (Pfade
//    relativ zum Ordner von week-config.json, NICHT zu diesem Skript)
//
// Pro Filiale nur der tägliche Ist-vs-Tagesziel-Chart (ändert sich wöchentlich
// wirklich) - KEIN Monatsumsatz-Balkendiagramm mehr: das sähe in mehreren
// Wochenberichten hintereinander identisch aus, solange sich der Monat nicht
// ändert (Rückmeldung Nutzer 28.09.2026: keine "alten" Charts wiederverwenden).
//
// Aufruf: node build-report.js data.json week-config.json report.html
// Wiederverwendbar: nächste Woche nur ein neues week-config.json (+ data.json
// über fetch-data.js) in einen neuen Wochenordner legen, Rest bleibt gleich.
const fs = require('fs');
const path = require('path');
const { esc, dailyIstZielChart, MUTED } = require('./charts');

function trendColor(p) {
  if (p == null) return MUTED;
  return p >= 0 ? '#1E8449' : '#C0392B';
}

// Verbindet tägliches Ist (filiale_produktion.umsatzHeute) mit dem Tagesziel
// (tagesziel.produktionsziel, ersatzweise .ziel) über dasselbe Datum.
function buildDaily(store) {
  const zielByDate = {};
  store.tagesziel.forEach((t) => { zielByDate[t.datum] = t.produktionsziel != null ? t.produktionsziel : t.ziel; });
  return store.produktion
    .filter((p) => zielByDate[p.datum] !== undefined)
    .map((p) => ({ datum: p.datum, ist: p.umsatzHeute, ziel: zielByDate[p.datum] }));
}

function avgAchievement(daily) {
  // Heutiger Tag ist meist nur ein Teil-Tag (Report wird vormittags erzeugt)
  // und würde den Schnitt künstlich drücken — nur abgeschlossene Tage zählen.
  // Sonntage (ist=0, Filialen geschlossen) ebenfalls ausschließen: 0% an einem
  // geschlossenen Tag ist keine Minderleistung und würde den Schnitt verzerren.
  const todayIso = new Date().toISOString().slice(0, 10);
  const rows = daily.filter((d) => d.datum !== todayIso && d.ziel && d.ist != null && d.ist > 0);
  if (!rows.length) return null;
  const sum = rows.reduce((s, d) => s + Math.min(d.ist / d.ziel, 1.4), 0);
  return Math.round((sum / rows.length) * 1000) / 10;
}

function storeSection(cfg, store, idx, secNum) {
  const daily = buildDaily(store);
  const achievement = avgAchievement(daily);

  let dailyBlock = '';
  if (daily.length >= 3) {
    dailyBlock = `
      <div class="chart-block">
        <div class="chart-title">Ist-Umsatz vs. Tagesziel <span class="chart-sub">(letzte ${daily.length} Tage)</span></div>
        ${dailyIstZielChart(daily)}
        <div class="legend"><span class="sw sw-bar"></span> Ist-Umsatz &nbsp;&nbsp; <span class="sw sw-line"></span> Tagesziel (Produktion, inkl. Waste)</div>
        <div class="chart-foot">Ø Zielerreichung (abgeschlossene Tage): <b style="color:${trendColor((achievement || 0) - 100)}">${achievement != null ? achievement + ' %' : '–'}</b></div>
      </div>`;
  }

  return `
  <section class="store">
    <h3>${secNum}.${idx} ${esc(cfg.name)} <span class="kst">${esc(store.marktNr)}${store.ort ? ' · ' + esc(store.ort) : ''}</span></h3>
    <div class="measure-box">
      <div class="measure-label">Maßnahme diese Woche</div>
      <p>${cfg.measure}</p>
    </div>
    <div class="charts-row">
      ${dailyBlock}
    </div>
    <div class="analysis">
      <div class="analysis-label">Kurzanalyse</div>
      <p>${cfg.analysis}</p>
    </div>
  </section>`;
}

// Optionaler Abschnitt 1 ("gebietsweites Thema dieser Woche") — komplett
// weggelassen, wenn week-config.json kein "systemChange" hat (nicht jede
// Woche hat ein neues übergreifendes Thema zu berichten). Alle Texte kommen
// aus der Config, nichts ist hier hart einprogrammiert.
function systemChangeSection(sc, cfgDir, secNum) {
  if (!sc) return '';
  const shots = (sc.screenshots || []).map((s) => {
    const shotPath = path.join(cfgDir, s.file);
    if (!fs.existsSync(shotPath)) return '';
    const b64 = fs.readFileSync(shotPath).toString('base64');
    return `
    <div class="screenshot-item">
      <img src="data:image/png;base64,${b64}" alt="Screenshot">
      <div class="screenshot-cap">${s.caption || ''}</div>
    </div>`;
  }).filter(Boolean);
  const screenshotBlock = shots.length ? `<div class="screenshot-gallery">${shots.join('')}</div>` : '';
  const calloutBlock = sc.calloutText ? `
    <div class="formula-box">
      ${sc.calloutLabel ? `<b>${esc(sc.calloutLabel)}</b><br>` : ''}
      ${String(sc.calloutText).split('\n\n').map((t) => `<div style="margin-top:4px">${t}</div>`).join('')}
    </div>` : '';
  return `
  <h2>${secNum}. ${esc(sc.heading || 'Übergreifendes Thema dieser Woche')}</h2>
  <p class="lead">${sc.intro || ''}</p>
  ${calloutBlock}
  ${screenshotBlock}
  <p class="lead">${sc.outro || ''}</p>`;
}

function main() {
  const [dataPath, cfgPath, outPath] = process.argv.slice(2);
  if (!dataPath || !cfgPath || !outPath) {
    console.error('Aufruf: node build-report.js data.json week-config.json report.html');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const cfgDir = path.dirname(path.resolve(cfgPath));

  const hasSystemChange = !!cfg.systemChange;
  const storesSecNum = hasSystemChange ? 2 : 1;
  const summarySecNum = hasSystemChange ? 3 : 2;

  const storeSections = cfg.stores.map((s, i) => storeSection(s, data[s.marktNr], i + 1, storesSecNum)).join('\n');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>${esc(cfg.title)}</title>
<style>
  @page { size: A4; margin: 20mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', sans-serif; color: #1A1A18; font-size: 12.5px; line-height: 1.55; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15.5px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid #1A1A18; }
  h3 { font-size: 14px; margin: 18px 0 8px; }
  .kst { font-weight: 400; font-size: 11.5px; color: #6B6860; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #C0392B; padding-bottom: 10px; margin-bottom: 6px; }
  .header .meta { text-align: right; font-size: 11.5px; color: #6B6860; line-height: 1.6; }
  .subtitle { font-size: 12.5px; color: #6B6860; margin: 0 0 18px; }
  .lead { font-size: 12.5px; margin: 0 0 10px; }
  .formula-box { background: #F5F3F0; border-left: 3px solid #1A5276; border-radius: 4px; padding: 10px 14px; margin: 10px 0; font-size: 12px; }
  .formula-box code { font-family: 'Courier New', monospace; background: #fff; padding: 1px 5px; border-radius: 3px; border: 1px solid #E5E2DC; }
  .screenshot-gallery { display: flex; gap: 14px; flex-wrap: wrap; margin: 14px 0; }
  .screenshot-item { flex: 1 1 200px; max-width: 240px; }
  .screenshot-item img { width: 100%; border: 1px solid #E5E2DC; border-radius: 6px; display: block; }
  .screenshot-cap { font-size: 11px; color: #6B6860; margin-top: 5px; }
  .measure-box { background: #FFF7E6; border: 1px solid #F0C070; border-radius: 6px; padding: 8px 12px; margin: 8px 0 12px; }
  .measure-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #8A5A00; margin-bottom: 3px; }
  .measure-box p { margin: 0; font-size: 12.5px; }
  .charts-row { display: flex; flex-direction: column; gap: 10px; }
  .chart-block { border: 1px solid #E5E2DC; border-radius: 6px; padding: 10px 12px 6px; }
  .chart-title { font-size: 11.5px; font-weight: 700; margin-bottom: 4px; }
  .chart-sub { font-weight: 400; color: #6B6860; }
  .chart-foot { font-size: 11px; color: #6B6860; margin-top: 4px; }
  .legend { font-size: 10.5px; color: #6B6860; margin-top: 2px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 3px; }
  .sw-bar { background: #DCEAF7; border: 1px solid #2A6FB0; }
  .sw-line { background: #C0392B; border-radius: 50%; width: 8px; height: 8px; }
  .analysis { margin-top: 8px; }
  .analysis-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #6B6860; margin-bottom: 3px; }
  .analysis p { margin: 0; }
  .store { page-break-inside: avoid; margin-bottom: 8px; }
  table.summary { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 8px; }
  table.summary th, table.summary td { border: 1px solid #E5E2DC; padding: 6px 8px; text-align: left; }
  table.summary th { background: #F5F3F0; font-weight: 700; }
  ul.next-steps { margin: 6px 0 0; padding-left: 18px; }
  ul.next-steps li { margin-bottom: 4px; }
  .footer-note { margin-top: 24px; padding-top: 10px; border-top: 1px solid #E5E2DC; font-size: 10.5px; color: #6B6860; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${esc(cfg.title)}</h1>
      <div class="subtitle">${esc(cfg.subtitle)}</div>
    </div>
    <div class="meta">${cfg.region ? esc(cfg.region) + '<br>' : ''}Gebietsleiter: ${esc(cfg.author)}<br>Erstellt am ${esc(cfg.created)}</div>
  </div>

  ${systemChangeSection(cfg.systemChange, cfgDir, 1)}

  <h2>${storesSecNum}. Filialen im Fokus dieser Woche</h2>
  <p class="lead">${cfg.storesIntro}</p>
  ${storeSections}

  <h2>${summarySecNum}. Zusammenfassung &amp; nächste Schritte</h2>
  <table class="summary">
    <tr><th>Filiale</th><th>Maßnahme</th></tr>
    ${cfg.stores.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.measureShort}</td></tr>`).join('')}
  </table>
  <ul class="next-steps">
    ${cfg.nextSteps.map((n) => `<li>${n}</li>`).join('')}
  </ul>

  <div class="footer-note">Datenquellen: Firestore <code>filiale_umsatz</code> (Welo-Statistik-Export, Monatswerte), <code>filiale_produktion</code> (Axonity, Tageswerte), <code>tagesziel</code> (Live-Berechnung). Bericht automatisiert aus echten Produktionsdaten erzeugt — keine geschätzten oder fiktiven Zahlen.</div>
</body>
</html>`;

  fs.writeFileSync(outPath, html);
  console.log('geschrieben:', outPath);
}

main();
