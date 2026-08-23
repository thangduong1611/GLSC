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
//
// Nur für NEUE Bestellungen wird zusätzlich das Detail-Dialogfenster
// geöffnet, um die bestellten Artikel + die Kundennotiz zu lesen (für die
// "Nachricht kopieren"-Funktion im Dashboard). Kundenname/Telefon/E-Mail im
// selben Dialog werden bewusst NICHT gelesen/gespeichert — nicht gebraucht,
// unnötige personenbezogene Daten. Das Dialogfenster hat auch einen
// "Stornieren"-Button, der die Bestellung beim Kunden stornieren würde —
// das Skript schließt den Dialog ausschließlich über den exakt benannten
// "Abbrechen"-Button, nie über Storno-Buttons.
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

async function closeStrayDialog(page) {
  const dialog = page.locator('.mud-dialog-content');
  if ((await dialog.count()) > 0) {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
}

async function readOrderDetail(page, rowIndex) {
  // Falls ein vorheriger Dialog aus irgendeinem Grund offen geblieben ist,
  // erst aufräumen — sonst blockiert dessen Overlay den nächsten Klick.
  await closeStrayDialog(page);

  const row = page.locator('table tbody tr').nth(rowIndex);
  const detailsBtn = row.locator('td:last-child').locator('a, button').last();
  await detailsBtn.click();

  const dialog = page.locator('.mud-dialog-content');
  await dialog.waitFor({ timeout: 10000 });

  const items = [];
  const itemEls = await dialog.locator('ul.list-group li.list-group-item').all();
  for (const el of itemEls) {
    const badge = el.locator('.badge');
    const menge = (await badge.count()) ? (await badge.innerText()).trim() : '1';
    const fullText = (await el.innerText()).trim();
    const name = menge ? fullText.replace(menge, '').trim() : fullText;
    items.push({ name, menge });
  }

  let notiz = '';
  const notizFeld = dialog.locator('textarea[name="PickupOrder.Notice"]');
  if ((await notizFeld.count()) > 0) {
    notiz = (await notizFeld.inputValue()).trim();
  }

  // Dialog per Escape schließen — NIE einen Button im Dialog klicken (dort
  // steht auch "Stornieren", was die Bestellung beim Kunden stornieren
  // würde). Escape löst bei MudDialog denselben Abbrechen-Pfad aus und ist
  // in der Praxis zuverlässiger als der direkte Klick auf "Abbrechen".
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  return { items, notiz };
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

    // Erst prüfen, welche Bestellnummern neu sind, bevor irgendein
    // Detail-Dialog geöffnet wird (Detail-Öffnen ist der langsame Teil,
    // nur für tatsächliche Neuzugänge nötig).
    const flags = await Promise.all(
      bestellungen.map((b) => db.collection(COLLECTION).doc(b['Bestellnummer']).get().then((d) => !d.exists))
    );

    let neu = 0;
    for (let i = 0; i < bestellungen.length; i++) {
      const b = bestellungen[i];
      const bestellnummer = b['Bestellnummer'];
      const isNeu = flags[i];

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
        neu++;
        try {
          const { items, notiz } = await readOrderDetail(page, i);
          payload.artikel = items;
          payload.notiz = notiz;
        } catch (err) {
          console.error(`  ⚠️ Details für #${bestellnummer} konnten nicht gelesen werden:`, err.message);
        }
        payload.createdAt = now;
      }

      await db.collection(COLLECTION).doc(bestellnummer).set(payload, { merge: true });
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
