// Holt die vollständige Artikel-Liste (Uhrzeit/Produkt/EAN/Anzahl/Preis) des
// Produktionsberichts von Bovenden für den 17.09.2026 (Login/Navigation 1:1
// aus src/sync-axonity-produktion.js kopiert, unverändert).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getGebietsleiterName } = require('../../src/branches');

const BASE_URL = process.env.AXONITY_BASE_URL || 'https://sck.sushi-circle.de';
const USER = process.env.AXONITY_USER;
const PASSWORD = process.env.AXONITY_PASSWORD;

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
  const gebietsleiterFilter = page.locator('th', { hasText: 'Gebietsleiter' }).locator('.mud-select').last();
  const options = page.locator('[role="option"]');
  await gebietsleiterFilter.click();
  await page.waitForTimeout(400);
  if ((await options.count()) === 0) { await gebietsleiterFilter.click(); await page.waitForTimeout(400); }
  await page.getByRole('option', { name: getGebietsleiterName(), exact: true }).click();
  await page.waitForTimeout(800);
  await page.locator('table tbody tr').first().waitFor({ timeout: 15000 });

  const perPageSelect = page.locator('.mud-table-pagination-select');
  await perPageSelect.click();
  await page.waitForTimeout(400);
  if ((await options.count()) === 0) { await perPageSelect.click(); await page.waitForTimeout(400); }
  await options.last().click();
  await page.waitForTimeout(500);
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
  return markets;
}

function navTab(page, text) { return page.locator('a.nav-link', { hasText: text }); }

async function openUmsaetzeTab(page, href) {
  await page.goto(`${BASE_URL}${href}`);
  const umsaetzeLink = page.getByRole('link', { name: /Umsätze/ }).first();
  const produktionsberichtTab = navTab(page, 'Produktionsbericht');
  await umsaetzeLink.click();
  try { await produktionsberichtTab.waitFor({ timeout: 3000 }); }
  catch { await umsaetzeLink.click(); await produktionsberichtTab.waitFor({ timeout: 15000 }); }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  console.log('Login...');
  await login(page);
  console.log('Markets laden...');
  const markets = await listMarkets(page);
  const bovenden = markets.find((m) => m.marktNr === '402207');
  if (!bovenden) throw new Error('Bovenden nicht gefunden.');
  console.log('Bovenden:', JSON.stringify(bovenden));

  await openUmsaetzeTab(page, bovenden.href);
  await navTab(page, 'Produktionsbericht').click();
  await page.locator('table th', { hasText: 'Uhrzeit' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  // Datumsfeld oben rechts ("29.09.2026") öffnet einen MudBlazor-Kalender
  // (readonly <input>, kein direktes Tippen möglich) — Tag "17" anklicken.
  const candidates = await page.locator('input').all();
  let targetInput = null;
  for (const c of candidates) {
    const val = await c.inputValue().catch(() => '');
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(val)) { targetInput = c; console.log('Datumsfeld gefunden, aktueller Wert:', val); break; }
  }
  if (!targetInput) throw new Error('Kein Datumsfeld mit DD.MM.YYYY-Wert gefunden.');

  await targetInput.click();
  await page.waitForTimeout(400);
  // September ist bereits offen (gleicher Monat wie heute) — Tag 17 anklicken.
  // ".mud-picker-calendar-day button" mit exaktem Text "17" (nicht "27").
  const dayBtn = page.locator('.mud-picker-calendar-day button, button.mud-picker-calendar-day', { hasText: /^17$/ }).first();
  if (await dayBtn.count() === 0) {
    // Fallback: irgendein Button mit exakt "17" als Text im geöffneten Popover
    await page.getByRole('button', { name: '17', exact: true }).first().click();
  } else {
    await dayBtn.click();
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(__dirname, 'after-date-set.png'), fullPage: true });

  const summaryText = await page.locator('body').innerText();
  console.log('--- Zusammenfassung nach Datumswechsel ---');
  console.log(summaryText.slice(0, 900));

  // Alle Seiten der Artikel-Tabelle einsammeln
  const items = [];
  const naechsteSeite = page.getByRole('button', { name: 'Nächste Seite' });
  for (let i = 0; i < 30; i++) {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    for (let r = 0; r < count; r++) {
      const cells = rows.nth(r).locator('td');
      const cellCount = await cells.count();
      if (cellCount < 6) continue;
      items.push({
        uhrzeit: (await cells.nth(0).innerText()).trim(),
        produkt: (await cells.nth(1).innerText()).trim(),
        ean: (await cells.nth(2).innerText()).trim(),
        anzahl: (await cells.nth(3).innerText()).trim(),
        einzelpreis: (await cells.nth(4).innerText()).trim(),
        gesamtpreis: (await cells.nth(5).innerText()).trim(),
      });
    }
    if (!(await naechsteSeite.isEnabled().catch(() => false))) break;
    await naechsteSeite.click();
    await page.waitForTimeout(500);
  }

  console.log('Anzahl Zeilen eingesammelt:', items.length);
  fs.writeFileSync(path.join(__dirname, 'bovenden-1709-items.json'), JSON.stringify(items, null, 2));
  console.log('Gespeichert: bovenden-1709-items.json');

  await browser.close();
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
