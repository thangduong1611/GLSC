// Loggt sich in Axonity ein, liest die neuesten Webshop-Bestellungen von
// /pickups/ (Seite 1, standardmäßig nach Bestellzeit absteigend sortiert —
// die neuesten Bestellungen stehen oben) und schreibt bisher unbekannte
// Bestellungen nach filiale_bestellungen/{bestellnummer}.
//
// "Neu" heißt: Bestellnummer existiert noch nicht in Firestore. Nur bei
// echten Neuzugängen wird createdAt gesetzt (Zeitpunkt der Entdeckung durch
// dieses Skript) — bestehende Dokumente werden beim erneuten Sehen mit den
// aktuellen Spaltenwerten aktualisiert (z.B. falls "Storniert" sich ändert),
// aber createdAt bleibt unangetastet, damit die "neu"-Markierung im
// Dashboard nicht bei jedem Lauf zurückgesetzt wird.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');

const BASE_URL = process.env.AXONITY_BASE_URL || 'https://erp.axonity.de';
const USER = process.env.AXONITY_USER;
const PASSWORD = process.env.AXONITY_PASSWORD;
const COLLECTION = 'filiale_bestellungen';

async function login(page) {
  await page.goto(`${BASE_URL}/signin`);
  await page.locator('input[name="username"]').fill(USER);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 15000 });
}

async function readBestellungen(page) {
  await page.goto(`${BASE_URL}/pickups/`);
  await page.locator('table tbody tr').first().waitFor({ timeout: 15000 });

  const rows = await page.locator('table tbody tr').all();
  const bestellungen = [];
  for (const row of rows) {
    const cells = await row.locator('td[data-label]').all();
    const data = {};
    for (const cell of cells) {
      const label = await cell.getAttribute('data-label');
      const value = (await cell.innerText()).trim();
      if (label) data[label] = value;
    }
    if (data['Bestellnummer']) bestellungen.push(data);
  }
  return bestellungen;
}

async function main() {
  if (!USER || !PASSWORD) {
    throw new Error('AXONITY_USER / AXONITY_PASSWORD fehlen in der .env-Datei.');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('Login bei Axonity…');
    await login(page);

    console.log('Lade neueste Webshop-Bestellungen…');
    const bestellungen = await readBestellungen(page);
    console.log(`${bestellungen.length} Bestellungen auf Seite 1 gelesen.`);

    const db = getDb();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let neu = 0;

    for (const b of bestellungen) {
      const bestellnummer = b['Bestellnummer'];
      const ref = db.collection(COLLECTION).doc(bestellnummer);
      const existing = await ref.get();
      const isNeu = !existing.exists;

      const payload = {
        bestellnummer,
        marktNr: b['Kostenstelle'] || '',
        standort: b['Standort'] || '',
        bestellzeit: b['Bestellzeit'] || '',
        abholzeit: b['Abholzeit'] || '',
        storniert: !!(b['Storniert'] && b['Storniert'].trim()),
        updatedAt: now,
      };
      if (isNeu) {
        payload.createdAt = now;
        neu++;
      }
      await ref.set(payload, { merge: true });
    }

    console.log(`✓ ${bestellungen.length} Bestellungen geprüft, ${neu} davon neu in "${COLLECTION}" angelegt.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('✗ Sync fehlgeschlagen:', err.message);
  process.exitCode = 1;
});
