// Einmaliges Analyse-Skript (kein Cron-Job): sammelt für einen Mitarbeiter die
// TATSÄCHLICHEN Kommen/Gehen-Zeiten (Stechzeiten) über viele Tage aus Welo/
// SuCi-Time (/sn/edit/{YYYYMMDD}-{marktNr}/index.html — dieselbe Seite, auf
// der HR die Stundennachweise bearbeitet), um ein reales Ankunftsmuster zu
// erkennen. Auftrag t.duong 03.09.2026: Frau Vu, Truong Thuy Vi Linh
// (330384, Filiale 402150 Sontra) fährt oft mit dem Zug weit an, kommt manche
// Tage 1-2 Std. später als andere — Ziel ist eine Übersicht als
// Planungsgrundlage für den Dienstplan, NICHT eine automatische Entscheidung
// über ihre "richtige" Startzeit (das bleibt eine manuelle Einschätzung).
//
// Für ihre Filiale (402150) existiert KEIN veröffentlichter Dienstplan in
// unserer eigenen Firestore-"plan"-Collection (geprüft 03.09.2026) — darum
// hier keine Soll-/Plan-Spalte, nur die reinen Ist-Werte aus Welo.
//
// Output: CSV-Datei mit einer Zeile pro Tag (auch Tage ohne Eintrag, damit
// Lücken/Freie Tage sichtbar bleiben).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

const PERSONAL_NR = process.argv[2] || '330384';
const MARKT_NR = process.argv[3] || '402150';
const TAGE_ZURUECK = parseInt(process.argv[4] || '90', 10);

async function login(page) {
  await page.goto(BASE_URL);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await Promise.all([page.waitForNavigation(), page.locator('input[name="login"]').click()]);
  const url = new URL(page.url());
  const m = url.pathname.match(/^\/[^/]+/);
  return `${url.origin}${m ? m[0] : ''}`;
}

function compactDate(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

async function getDayRow(page, sessionBase, date, marktNr, personalNr) {
  const url = `${sessionBase}/sn/edit/${compactDate(date)}-${marktNr}/index.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // AJAX-Tabelle lädt nach — auf "wartet..."-Indikator warten, bis er verschwindet
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('(wartet...)'),
      { timeout: 8000 }
    );
  } catch (e) { /* nach Timeout trotzdem versuchen zu lesen */ }
  await page.waitForTimeout(300);

  return page.evaluate((pnr) => {
    const inputs = Array.from(document.querySelectorAll('input[name^="pnr["]'));
    const hit = inputs.find((i) => i.value === pnr);
    if (!hit) return null;
    const m = hit.name.match(/pnr\[(\d+)\]/);
    if (!m) return null;
    const idx = m[1];
    const start = document.querySelector(`input[name="start[${idx}]"]`);
    const ende = document.querySelector(`input[name="ende[${idx}]"]`);
    const pause = document.querySelector(`input[name="pause[${idx}]"]`);
    // Std.-Zelle steht in derselben <tr> wie das Startzeit-Feld
    const tr = start ? start.closest('tr') : null;
    let std = null;
    if (tr) {
      const cells = Array.from(tr.querySelectorAll('td[align="right"]'));
      if (cells[0]) std = cells[0].textContent.trim();
    }
    return {
      start: start ? start.value : null,
      ende: ende ? ende.value : null,
      pause: pause ? pause.value : null,
      std,
    };
  }, personalNr);
}

async function main() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER / WELO_PASSWORD fehlen in der .env-Datei.');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const rows = [];
  try {
    console.log(`Login bei Welo/SuCi-Net…`);
    const sessionBase = await login(page);

    const heute = new Date();
    const ende = new Date(heute);
    ende.setDate(ende.getDate() - 1); // gestern — heute evtl. noch nicht fertig gestempelt

    console.log(`Sammle Stempelzeiten für Personal-Nr. ${PERSONAL_NR} an Filiale ${MARKT_NR}, letzte ${TAGE_ZURUECK} Tage…`);
    for (let i = TAGE_ZURUECK - 1; i >= 0; i--) {
      const d = new Date(ende);
      d.setDate(d.getDate() - i);
      let row;
      try {
        row = await getDayRow(page, sessionBase, d, MARKT_NR, PERSONAL_NR);
      } catch (e) {
        console.warn(`  Fehler am ${isoDate(d)}: ${e.message}`);
        row = null;
      }
      rows.push({
        datum: isoDate(d),
        wochentag: WOCHENTAGE[d.getDay()],
        start: row ? row.start : '',
        ende: row ? row.ende : '',
        pause: row ? row.pause : '',
        std: row ? row.std : '',
      });
      if ((TAGE_ZURUECK - i) % 10 === 0) console.log(`  ${TAGE_ZURUECK - i}/${TAGE_ZURUECK} Tage geladen…`);
    }
  } finally {
    await browser.close();
  }

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `ankunftsmuster_${PERSONAL_NR}.csv`);
  const header = 'Datum;Wochentag;Startzeit;Endzeit;Pause;Std.\n';
  const lines = rows.map((r) => [r.datum, r.wochentag, r.start, r.ende, r.pause, r.std].join(';')).join('\n');
  fs.writeFileSync(outPath, '﻿' + header + lines, 'utf8');
  console.log(`\n✓ ${rows.length} Tage geschrieben nach: ${outPath}`);

  const gearbeitet = rows.filter((r) => r.start);
  console.log(`  Davon Tage mit Stempelzeit: ${gearbeitet.length}`);
}

main().catch((err) => {
  console.error('FEHLER:', err);
  process.exit(1);
});
