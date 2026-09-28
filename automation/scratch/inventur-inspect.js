// Rein lesend: öffnet die vom Nutzer gegebene Inventur-Seite und dumpt die
// Zeilenstruktur (Artikelnummer, Name, evtl. Menge) als JSON — nur zur
// Inspektion, schreibt NICHTS auf Welo.
require('dotenv').config();
const { chromium } = require('playwright');
const { login } = require('../src/welo-jahresansicht');

const URL = process.argv[2];

async function main() {
  if (!URL) throw new Error('Aufruf: node inventur-inspect.js <url>');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  try {
    await login(page);
    await page.goto(URL, { waitUntil: 'networkidle' });
    const info = await page.evaluate(() => {
      const out = { title: document.title, tableCount: document.querySelectorAll('table').length, sample: [] };
      const tbl = document.querySelector('table.inventur-table') || document.querySelector('table');
      if (!tbl) return out;
      const rows = Array.from(tbl.querySelectorAll('tr')).slice(0, 8);
      out.sample = rows.map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td')).map((td) => td.className + ':"' + td.textContent.trim() + '"');
        const input = tr.querySelector('input');
        return { tds, inputClass: input ? input.className : null, inputVal: input ? input.value : null, inputName: input ? input.name : null };
      });
      out.totalRows = tbl.querySelectorAll('tr').length;
      return out;
    });
    console.log(JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
