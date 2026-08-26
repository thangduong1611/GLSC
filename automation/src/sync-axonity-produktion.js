// Loggt sich in Axonity ein, geht jede Filiale aus /markets/ durch und liest:
//  - Übersicht: "Umsätze der letzten 30 Tage" (Produktion) — rollierendes
//    30-Tage-Fenster, täglich aktuell. Ersetzt den Welo-CSV-Export als
//    Umsatz-Quelle im Dashboard, weil dessen Export dem laufenden Monat
//    hinterherhinkt (siehe Projekt-Notiz), während dieser Wert hier direkt
//    aus Axonity kommt und nicht künstlich verzögert ist.
//  - Produktionsbericht (heutiges Datum, ist beim Laden schon vorausgewählt):
//    Zusammenfassung oben = umsatzHeute ("Produktion:") + produzierteWare
//    ("Produzierte Ware:") — Stand zum Zeitpunkt des Laufs (z.B. 14 Uhr, je
//    nach Zeitplan). Erste Zeile = SX-Start. Über alle Seiten paginiert für
//    anzahlSorten (Anzahl unterschiedlicher Produkt-Namen) und SX-Ende
//    (letzte Zeile der letzten Seite).
//  - Renner-Penner (laufender Monat): erste Zeile = Topseller
// Schreibt pro Filiale einen Doc nach filiale_produktion/{marktNr}_{datum}.
//
// Braucht Playwright + Chromium (npx playwright install chromium).
// Axonity ist eine Blazor-Server-App mit gelegentlichen SignalR-Aussetzern
// ("An error has occurred... reload") — deshalb pro Filiale ein Retry.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const { GEBIETSLEITER_NAME } = require('./branches');

const BASE_URL = process.env.AXONITY_BASE_URL || 'https://erp.axonity.de';
const USER = process.env.AXONITY_USER;
const PASSWORD = process.env.AXONITY_PASSWORD;
const COLLECTION = 'filiale_produktion';
const RETRIES_PER_MARKT = 2;
const RETRIES_STARTUP = 2;

async function withRetry(fn, retries, label) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) console.log(`  Retry ${attempt} (${label})…`);
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function parseGermanNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function heuteISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function login(page) {
  await page.goto(`${BASE_URL}/signin`);
  await page.locator('input[name="username"]').fill(USER);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 15000 });
}

async function listMarkets(page) {
  await page.goto(`${BASE_URL}/markets/`);
  await page.locator('table tbody tr').first().waitFor({ timeout: 15000 });

  // Seit dem Axonity-Update vom 25.08.2026 zeigt /markets/ standardmäßig
  // alle ~346 Standorte firmenweit statt nur die eigenen 11 (und die
  // Tabellenzellen haben kein data-label mehr, darum jetzt Spaltenposition
  // statt data-label). Gebietsleiter-Filter im Tabellenkopf setzen, um
  // wieder auf die eigenen Filialen zu kommen.
  // Das eigentliche <input> ist type="hidden" (MudBlazor-Interna) — den
  // sichtbaren Wrapper anklicken, sonst verweigert Playwright den Klick.
  // Braucht wie viele Klicks in dieser App zwei Anläufe: der erste öffnet
  // das Popover nicht wirklich (0 Optionen im DOM), erst der zweite Klick
  // öffnet es tatsächlich — per Diagnose-Skript bestätigt.
  const gebietsleiterFilter = page.locator('th', { hasText: 'Gebietsleiter' }).locator('.mud-select').last();
  const options = page.locator('[role="option"]');
  await gebietsleiterFilter.click();
  await page.waitForTimeout(400);
  if ((await options.count()) === 0) {
    await gebietsleiterFilter.click();
    await page.waitForTimeout(400);
  }
  await page.getByRole('option', { name: GEBIETSLEITER_NAME, exact: true }).click();
  await page.waitForTimeout(800);
  await page.locator('table tbody tr').first().waitFor({ timeout: 15000 });

  const rows = await page.locator('table tbody tr').all();
  const markets = [];
  for (const row of rows) {
    const cells = row.locator('td');
    const marktNr = (await cells.nth(0).innerText()).trim();
    const standort = (await cells.nth(1).innerText()).trim();
    const href = await row.locator('a[href^="/markets/"]').getAttribute('href');
    if (marktNr && href) markets.push({ marktNr, standort, href });
  }

  // Sicherheitsnetz: nach dem Update zeigt die Seite ohne wirksamen Filter
  // hunderte Standorte firmenweit — lieber laut scheitern als versehentlich
  // fremde Filialen verarbeiten.
  if (markets.length === 0 || markets.length > 20) {
    throw new Error(`Unerwartete Anzahl Filialen nach Gebietsleiter-Filter: ${markets.length} (erwartet ~11) — Filter vermutlich nicht angewendet.`);
  }
  return markets;
}

// Die Unter-Tabs (Übersicht/Produktionsbericht/Monatsbericht/Renner-Penner/
// Wundertüte) sind <a class="nav-link"> OHNE href — laut ARIA-Spec zählt ein
// <a> ohne href nicht als role="link", darum hier gezielt über die Klasse
// suchen statt über getByRole('link'). Es existiert zusätzlich ein <option>
// mit demselben Text in einem (bei Desktop-Breite verstecktem) Mobile-
// Dropdown — ".nav-link" grenzt eindeutig auf die klickbare Variante ein.
function navTab(page, text) {
  return page.locator('a.nav-link', { hasText: text });
}

async function openUmsaetzeTab(page, href) {
  await page.goto(`${BASE_URL}${href}`);
  const umsaetzeLink = page.getByRole('link', { name: /Umsätze/ }).first();
  const produktionsberichtTab = navTab(page, 'Produktionsbericht');

  // Der erste Klick markiert den Nav-Punkt oft nur, ohne den Inhalt zu
  // wechseln (beobachtet beim manuellen Testen) — bei Bedarf ein zweites
  // Mal klicken.
  await umsaetzeLink.click();
  try {
    await produktionsberichtTab.waitFor({ timeout: 3000 });
  } catch {
    await umsaetzeLink.click();
    await produktionsberichtTab.waitFor({ timeout: 15000 });
  }
}

// Übersicht ist der Default-Unterreiter beim Betreten von "Umsätze" — hier
// direkt lesen, ohne extra hinzuklicken. Struktur laut DOM-Inspektion:
// <h4>Umsätze der letzten 30 Tage</h4> gefolgt von
// <div class="card-body"><span><strong>Produktion:</strong><span>43.143,41 €</span></span>...</div>
async function readUmsatz30Tage(page) {
  const heading = page.locator('h4', { hasText: 'Umsätze der letzten 30 Tage' });
  await heading.waitFor({ timeout: 15000 });
  const card = page.locator('.card-body', { has: heading });
  const produktionWert = card.locator('span:has(> strong:text-is("Produktion:")) > span');
  const text = await produktionWert.innerText();
  return parseGermanNumber(text);
}

// Liest ein "Label: Wert"-Paar aus der Zusammenfassung (<label class="form-label">
// gefolgt vom Wert im nächsten Geschwister-Element — mal <span>, mal <div>).
async function readZusammenfassungLabel(page, exactLabelText) {
  const label = page.locator('label.form-label', { hasText: new RegExp(`^${exactLabelText}$`) }).first();
  if ((await label.count()) === 0) return null;
  const value = await label.locator('xpath=following-sibling::*[1]').innerText();
  return value.trim();
}

async function readProduktionsbericht(page) {
  const tab = navTab(page, 'Produktionsbericht');
  const uhrzeitHeader = page.locator('table th', { hasText: 'Uhrzeit' });
  await tab.click();
  try {
    await uhrzeitHeader.waitFor({ timeout: 3000 });
  } catch {
    await tab.click();
    await uhrzeitHeader.waitFor({ timeout: 15000 });
  }
  await page.waitForTimeout(800); // Blazor-Datenfetch nach Tab-Wechsel braucht kurz

  const umsatzHeute = parseGermanNumber(await readZusammenfassungLabel(page, 'Produktion:'));
  const produzierteWareText = await readZusammenfassungLabel(page, 'Produzierte Ware:');
  const produzierteWare = produzierteWareText ? parseInt(produzierteWareText.replace(/\D/g, ''), 10) : null;

  let rows = page.locator('table tbody tr');
  let count = await rows.count();
  if (count === 0) {
    return { sxStart: null, sxEnde: null, umsatzHeute, produzierteWare, anzahlSorten: 0 };
  }

  const sxStart = (await rows.first().locator('td[data-label="Uhrzeit"]').innerText()).trim();

  // Über alle Seiten paginieren, um jedes produzierte Produkt einmal zu sehen
  // (für die Sortenzahl) — SX-Ende ergibt sich dabei automatisch aus der
  // letzten Zeile der letzten Seite. Obergrenze gegen Endlosschleife, falls
  // "Nächste Seite" aus irgendeinem Grund nie disabled wird.
  const sorten = new Set();
  let sxEnde = null;
  const naechsteSeite = page.getByRole('button', { name: 'Nächste Seite' });
  for (let i = 0; i < 20; i++) {
    rows = page.locator('table tbody tr');
    count = await rows.count();
    const produkte = await rows.locator('td[data-label="Produkt"]').allInnerTexts();
    produkte.forEach((p) => sorten.add(p.trim()));
    sxEnde = (await rows.nth(count - 1).locator('td[data-label="Uhrzeit"]').innerText()).trim();

    if (!(await naechsteSeite.isEnabled())) break;
    await naechsteSeite.click();
    await page.waitForTimeout(500);
  }

  return { sxStart, sxEnde, umsatzHeute, produzierteWare, anzahlSorten: sorten.size };
}

async function readTopProdukt(page) {
  const tab = navTab(page, 'Renner-Penner');
  const produktHeader = page.locator('table th', { hasText: 'Produkt' });
  await tab.click();
  try {
    await produktHeader.waitFor({ timeout: 3000 });
  } catch {
    await tab.click();
    await produktHeader.waitFor({ timeout: 15000 });
  }
  await page.waitForTimeout(800);
  const rows = page.locator('table tbody tr');
  if ((await rows.count()) === 0) return null;
  return (await rows.first().locator('td[data-label="Produkt"]').innerText()).trim();
}

async function scrapeOneMarkt(page, markt) {
  await openUmsaetzeTab(page, markt.href);
  const umsatz30Tage = await readUmsatz30Tage(page);
  const { sxStart, sxEnde, umsatzHeute, produzierteWare, anzahlSorten } = await readProduktionsbericht(page);
  const topProdukt = await readTopProdukt(page);
  return { ...markt, umsatz30Tage, sxStart, sxEnde, umsatzHeute, produzierteWare, anzahlSorten, topProdukt };
}

async function main() {
  if (!USER || !PASSWORD) {
    throw new Error('AXONITY_USER / AXONITY_PASSWORD fehlen in der .env-Datei.');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('Login bei Axonity…');
    await withRetry(() => login(page), RETRIES_STARTUP, 'Login');

    console.log('Lade Filialliste…');
    const markets = await withRetry(() => listMarkets(page), RETRIES_STARTUP, 'Filialliste');
    console.log(`${markets.length} Filialen gefunden.`);

    const db = getDb();
    const datum = heuteISO();
    const results = [];

    for (const markt of markets) {
      let lastErr = null;
      let ok = false;
      for (let attempt = 0; attempt <= RETRIES_PER_MARKT && !ok; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`  Retry ${attempt} für ${markt.marktNr} (${markt.standort})…`);
          }
          const result = await scrapeOneMarkt(page, markt);
          results.push(result);
          console.log(`  ✓ ${markt.marktNr} ${markt.standort}: Umsatz30T ${result.umsatz30Tage}, UmsatzHeute ${result.umsatzHeute}, Ware ${result.produzierteWare}, Sorten ${result.anzahlSorten}, SX ${result.sxStart}–${result.sxEnde}, Top: ${result.topProdukt}`);
          ok = true;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!ok) {
        console.error(`  ✗ ${markt.marktNr} (${markt.standort}) übersprungen:`, lastErr.message);
      }
    }

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    results.forEach((r) => {
      const ref = db.collection(COLLECTION).doc(`${r.marktNr}_${datum}`);
      batch.set(
        ref,
        {
          marktNr: r.marktNr,
          datum,
          standort: r.standort,
          umsatz30Tage: r.umsatz30Tage,
          umsatzHeute: r.umsatzHeute,
          produzierteWare: r.produzierteWare,
          anzahlSorten: r.anzahlSorten,
          sxStart: r.sxStart,
          sxEnde: r.sxEnde,
          topProdukt: r.topProdukt,
          updatedAt: now,
        },
        { merge: true }
      );
    });
    await batch.commit();
    console.log(`✓ ${results.length}/${markets.length} Filialen in "${COLLECTION}" geschrieben.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('✗ Sync fehlgeschlagen:', err.message);
  process.exitCode = 1;
});
