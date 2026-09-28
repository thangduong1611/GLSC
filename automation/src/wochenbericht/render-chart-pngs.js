// Rendert dieselben SVG-Charts aus charts.js als PNG-Dateien (für das .docx -
// Word kann kein Inline-SVG, daher hier zu Bildern rastern). 2x Auflösung für
// scharfe Darstellung, aber mit den ORIGINAL-Maßen (W/H aus charts.js)
// zurückgegeben, damit build-docx.js sie in der richtigen Druckgröße einbettet.
// Nur der tägliche Ist-vs-Tagesziel-Chart (kein Monatsumsatz mehr - siehe
// build-report.js, Rückmeldung Nutzer 28.09.2026).
//
// Aufruf: node render-chart-pngs.js <data.json> <week-config.json> <chart-png-ausgabeordner>
// Alle 3 Pfade gehören zum jeweiligen Wochen-Durchlauf (Scratchpad-Ordner),
// nicht zu diesem Skript selbst - deshalb Argumente statt __dirname.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { dailyIstZielChart } = require('./charts');

const SVG_W = 620, SVG_H_DAILY = 230;

function buildDaily(store) {
  const zielByDate = {};
  store.tagesziel.forEach((t) => { zielByDate[t.datum] = t.produktionsziel != null ? t.produktionsziel : t.ziel; });
  return store.produktion
    .filter((p) => zielByDate[p.datum] !== undefined)
    .map((p) => ({ datum: p.datum, ist: p.umsatzHeute, ziel: zielByDate[p.datum] }));
}

async function shot(browser, svg, w, h, outPath) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0;padding:0;background:#fff">${svg}</body></html>`);
  await page.screenshot({ path: outPath });
  await page.close();
}

async function main() {
  const [dataPath, cfgPath, outDirArg] = process.argv.slice(2);
  if (!dataPath || !cfgPath || !outDirArg) {
    console.error('Aufruf: node render-chart-pngs.js <data.json> <week-config.json> <chart-png-ausgabeordner>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const outDir = path.resolve(outDirArg);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const manifest = {};
  for (const s of cfg.stores) {
    const store = data[s.marktNr];
    const entry = { marktNr: s.marktNr, w: SVG_W };
    const daily = buildDaily(store);
    if (daily.length >= 3) {
      const svg = dailyIstZielChart(daily);
      const file = path.join(outDir, `daily_${s.marktNr}.png`);
      await shot(browser, svg, SVG_W, SVG_H_DAILY, file);
      entry.daily = { file, h: SVG_H_DAILY };
    }
    manifest[s.marktNr] = entry;
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Chart-PNGs geschrieben in', outDir);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
