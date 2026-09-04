// Einmaliges/bei Bedarf wiederholbares Sync-Skript (kein täglicher Cron-Job):
// holt die private Wohnadresse jedes Mitarbeiters von der Welo-Personalseite
// (Personal > Suche "*" > Klick auf Personal-Nr. -> /pf/info/{PersonalNr}.html,
// Felder "Strasse:" und "PLZ / Ort:") und schreibt sie nach
// emp_welo/{PersonalNr}.{strasse, plz, ort}.
//
// Zweck (Auftrag t.duong 04.09.2026): Grundlage, um für jeden Mitarbeiter die
// nächstgelegene Filiale zu berechnen (Zweitfiliale-Zuordnung), siehe
// compute-nearest-filiale.js.
//
// Standardverhalten (Auftrag t.duong 04.09.2026, "sonst wieder alle
// nachschlagen ist zu langsam"): OHNE Argumente werden NUR Mitarbeiter
// abgefragt, die noch KEINE Adresse gespeichert haben (typischerweise 1-2
// neue Mitarbeiter) - nicht alle 71. Explizite Personal-Nrn. als Argument
// erzwingen einen Refresh genau dieser Personen, auch wenn schon eine
// Adresse vorliegt (z.B. nach einem Umzug).
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb } = require('./firestore-client');
const { withWeloLock } = require('./sync-lock');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.waitForURL((url) => /^\/[A-Za-z0-9]+-[A-Za-z0-9]+\/index\.html/.test(url.pathname), { timeout: 15000 });
  const m = page.url().match(/^(https:\/\/[^/]+\/[A-Za-z0-9]+-[A-Za-z0-9]+)\//);
  if (!m) throw new Error('Session-Präfix nach Login nicht gefunden: ' + page.url());
  return m[1];
}

function extractLabelValue(html, label) {
  const re = new RegExp('>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<\\/td>\\s*<td[^>]*>([^<]*)<\\/td>', 'i');
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

async function main() {
  return withWeloLock('welo', syncAll);
}

async function syncAll() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER / WELO_PASSWORD fehlen in der .env-Datei.');
  const db = getDb();

  console.log('Lade Mitarbeiterliste (emp_welo) …');
  const weloSnap = await db.collection('emp_welo').get();
  const nurDiese = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  let ids;
  if (nurDiese.length) {
    ids = nurDiese;
    console.log(`  ${ids.length} explizit angegebene Personal-Nr. (Refresh erzwungen).`);
  } else {
    ids = [];
    weloSnap.forEach((d) => { if (!d.data().strasse) ids.push(d.id); });
    console.log(`  ${ids.length} Mitarbeiter ohne bekannte Adresse (von ${weloSnap.size} insgesamt).`);
    if (!ids.length) { console.log('\n✓ Alle Mitarbeiter haben bereits eine Adresse. Nichts zu tun.'); process.exit(0); }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Login bei Welo/SuCi-Net …');
  const sessionBase = await login(page);

  let done = 0, ohneAdresse = 0;
  for (const id of ids) {
    try {
      await page.goto(`${sessionBase}/pf/info/${id}.html`, { waitUntil: 'domcontentloaded' });
      const html = await page.content();
      const strasse = extractLabelValue(html, 'Strasse:');
      const plzOrt = extractLabelValue(html, 'PLZ / Ort:');
      const m = plzOrt.match(/^(\d{5})\s+(.*)$/);
      const plz = m ? m[1] : '';
      const ort = m ? m[2] : plzOrt;
      if (!strasse && !plzOrt) { ohneAdresse++; console.warn(`  ⚠ ${id}: keine Adresse gefunden.`); continue; }
      await db.collection('emp_welo').doc(id).set({ strasse, plz, ort, adresseUpdatedAt: new Date().toISOString() }, { merge: true });
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${ids.length} Adressen geladen …`);
    } catch (e) {
      console.warn(`  ⚠ Fehler bei ${id}: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\n✓ ${done} Adressen synchronisiert (${ohneAdresse} ohne Adresse).`);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
