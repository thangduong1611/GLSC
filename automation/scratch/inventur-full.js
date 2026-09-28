// Rein lesend: liest ALLE Artikelzeilen der gegebenen Inventur-Seite (Artikel-
// nummer, Kurzname, Langbeschreibung, Gebinde) und schreibt sie als JSON-Datei
// zur weiteren Auswertung. Schreibt NICHTS auf Welo.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login } = require('../src/welo-jahresansicht');

const URL = process.argv[2];

async function main() {
  if (!URL) throw new Error('Aufruf: node inventur-full.js <url>');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  try {
    await login(page);
    await page.goto(URL, { waitUntil: 'networkidle' });
    const rows = await page.evaluate(() => {
      const tbl = document.querySelector('table.inventur-table') || document.querySelector('table');
      if (!tbl) return [];
      return Array.from(tbl.querySelectorAll('tr')).map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 8) return null;
        return {
          unit: tds[1].textContent.trim(),
          shortName: tds[2].textContent.trim(),
          longDesc: tds[3].textContent.trim(),
          pack: tds[4].textContent.trim(),
          price: tds[5].textContent.trim(),
          artNr: tds[7].textContent.trim(),
        };
      }).filter(Boolean);
    });
    const outPath = path.join(__dirname, 'inventur-welo-rows.json');
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
    console.log('Geschrieben:', outPath, '—', rows.length, 'Zeilen');
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
