// Liest die ECHTEN, bereits in Welo erfassten Urlaub/Krank/Sonderurlaub/
// Arbeitsunfall/Unbezahlt-Tage jedes Mitarbeiters von der "U/K Liste"
// (/urlaubsliste/{jahr}-{typ}-alle-v-01.html, typ=fs/mj/tmdm — 3 getrennte
// Personalarten-Listen, siehe sync-welo-personal.js) und vergleicht sie
// gegen die in der App gespeicherten Urlaub-Buchungen (Auftrag t.duong
// 05.09.2026: "Urlaub die schon registriert wurden in Welo muessen auch in
// der App gespeichert sein").
//
// DOM-Struktur (live am 05.09.2026 verifiziert): jede Mitarbeiter-Zeile hat
// eine Zelle <td class="tpt"><span class="tpp">48</span><span class="pi">
// <b|span style="color:XXX">TT.MM</b|span>, ...</span></td> - ein <b>/<span>
// pro markiertem Tag im Jahr, durch Komma getrennt. Farbe = Kategorie
// (Legende, live gelesen): blue=Urlaub, red=Krank, #808=Sonderurlaub,
// #80D=Arbeitsunfall, #558=Unbezahlt. Fettschrift (<b> statt <span>) markiert
// den ERSTEN Tag eines zusammenhaengenden Blocks ("Belegstart").
//
// Nur "Urlaub" (blau) wird mit der App abgeglichen (Auftrag: "Urlaub"
// explizit genannt) - Krank/Sonderurlaub/etc. werden nur mitgeloggt, nicht
// automatisch importiert.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getDb } = require('./firestore-client');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;
const YEAR = 2026;
const RANGE_START = '2026-09-01';
const RANGE_END = '2026-12-31';
const OUT_PATH = path.join(__dirname, '..', 'output', 'welo_urlaub_scan.json');

const FARBE_ZU_KATEGORIE = {
  blue: 'Urlaub',
  red: 'Krank',
  '#808': 'Sonderurlaub',
  '#80d': 'Arbeitsunfall',
  '#558': 'Unbezahlt',
};

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.waitForURL((url) => /^\/[A-Za-z0-9]+-[A-Za-z0-9]+\/index\.html/.test(url.pathname), { timeout: 15000 });
  const m = page.url().match(/^(https:\/\/[^/]+\/[A-Za-z0-9]+-[A-Za-z0-9]+)\//);
  return m[1];
}

function iso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Gruppiert eine sortierte Liste von {dateIso, kategorie} in zusammenhaengende
// {from, to, kategorie}-Bloecke (aufeinanderfolgende Kalendertage, gleiche Kategorie).
function gruppiereBloecke(tage) {
  const bloecke = [];
  let cur = null;
  tage.forEach((t) => {
    if (cur && cur.kategorie === t.kategorie && isoOf(addDays(new Date(cur.to + 'T00:00:00'), 1)) === t.dateIso) {
      cur.to = t.dateIso;
    } else {
      if (cur) bloecke.push(cur);
      cur = { from: t.dateIso, to: t.dateIso, kategorie: t.kategorie };
    }
  });
  if (cur) bloecke.push(cur);
  return bloecke;
}

async function scrapeTyp(page, sessionBase, typ) {
  await page.goto(`${sessionBase}/urlaubsliste/${YEAR}-${typ}-alle-v-01.html`);
  return page.evaluate((year) => {
    function findRowTds(personalNr) { return null; } // ungenutzt, siehe unten
    const rows = [];
    document.querySelectorAll('tr.n').forEach((tr) => {
      const idLink = tr.querySelector('td a[href*="/pf/info/"]');
      if (!idLink) return;
      const idMatch = idLink.getAttribute('href').match(/\/pf\/info\/(\d+)\.html/);
      if (!idMatch) return;
      const id = idMatch[1];
      const nameCell = tr.querySelectorAll('td')[1];
      const name = nameCell ? nameCell.textContent.trim().split('\n')[0] : '';
      const piSpan = tr.querySelector('.pi');
      const tage = [];
      if (piSpan) {
        piSpan.querySelectorAll('b, span').forEach((el) => {
          const txt = el.textContent.trim();
          const m = txt.match(/^(\d{2})\.(\d{2})$/);
          if (!m) return;
          const style = el.getAttribute('style') || '';
          const colorMatch = style.match(/color:\s*([^;]+)/);
          if (!colorMatch) return;
          const color = colorMatch[1].trim().toLowerCase();
          const dateIso = year + '-' + m[2] + '-' + m[1];
          tage.push({ dateIso, color });
        });
      }
      rows.push({ id, name, tage });
    });
    return rows;
  }, YEAR);
}

async function main() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER / WELO_PASSWORD fehlen.');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  console.log('Login bei Welo …');
  const sessionBase = await login(page);

  const merged = {}; // id -> {name, tage:[{dateIso,color}]}
  for (const typ of ['fs', 'mj', 'tmdm']) {
    console.log(`Lade U/K Liste (${typ}) …`);
    const rows = await scrapeTyp(page, sessionBase, typ);
    rows.forEach((r) => { if (!merged[r.id]) merged[r.id] = r; });
    console.log(`  ${rows.length} Zeilen.`);
  }
  await browser.close();

  const ids = Object.keys(merged);
  console.log(`\n${ids.length} Mitarbeiter insgesamt gescannt.`);

  // Nur Sep-Dez 2026 behalten, in Bloecke gruppieren
  const result = {};
  ids.forEach((id) => {
    const tage = merged[id].tage
      .filter((t) => t.dateIso >= RANGE_START && t.dateIso <= RANGE_END)
      .map((t) => ({ dateIso: t.dateIso, kategorie: FARBE_ZU_KATEGORIE[t.color] || ('unbekannt:' + t.color) }))
      .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    const bloecke = gruppiereBloecke(tage);
    if (bloecke.length) result[id] = { name: merged[id].name, bloecke };
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`✓ ${Object.keys(result).length} Mitarbeiter mit Eintraegen Sep-Dez 2026 gefunden.`);
  console.log('Gespeichert:', OUT_PATH);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
