// Holt die Monats-Zusammenfassung (Produktion €, Produzierte Ware, Sorten
// grob über Artikel-Set der Monatsliste) für Bad Hersfeld für August UND
// September 2026 aus Axonity "Monatsbericht", zum echten Monatsvergleich.
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

async function readSummary(page) {
  const val = async (label) => {
    const loc = page.locator('span, div').filter({ hasText: new RegExp('^' + label + '$') }).first();
    const sib = loc.locator('xpath=following-sibling::*[1]');
    try { return (await sib.innerText()).trim(); } catch { return null; }
  };
  return {
    produktion: await val('Produktion:'),
    produzierteWare: await val('Produzierte Ware:'),
    abschriften: await val('Abschriften:'),
    abschriftenUmsatz: await val('Abschriften \\(Umsatz\\):'),
  };
}

async function collectAllRows(page) {
  const items = [];
  const naechsteSeite = page.getByRole('button', { name: 'Nächste Seite' });
  for (let i = 0; i < 40; i++) {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    for (let r = 0; r < count; r++) {
      const cells = rows.nth(r).locator('td');
      const cellCount = await cells.count();
      if (cellCount < 6) continue;
      items.push({
        datum: (await cells.nth(0).innerText()).trim(),
        produkt: (await cells.nth(1).innerText()).trim(),
        anzahl: (await cells.nth(3).innerText()).trim(),
      });
    }
    if (!(await naechsteSeite.isEnabled().catch(() => false))) break;
    await naechsteSeite.click();
    await page.waitForTimeout(400);
  }
  return items;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  console.log('Login...');
  await login(page);
  console.log('Markets laden...');
  const markets = await listMarkets(page);
  const bh = markets.find((m) => m.marktNr === '402146');
  if (!bh) throw new Error('Bad Hersfeld nicht gefunden.');
  console.log('Bad Hersfeld:', JSON.stringify(bh));

  await openUmsaetzeTab(page, bh.href);
  await navTab(page, 'Monatsbericht').click();
  await page.waitForTimeout(1200);

  // September (Default) zuerst einsammeln
  console.log('--- September 2026 ---');
  const sepSummary = await readSummary(page);
  console.log(JSON.stringify(sepSummary));
  const sepItems = await collectAllRows(page);
  console.log('September Zeilen:', sepItems.length);
  fs.writeFileSync(path.join(__dirname, 'bh-monatsbericht-sep.json'), JSON.stringify(sepItems, null, 2));

  // Auf August wechseln: Monats-Picker oben rechts anklicken, "<" Pfeil klicken, dann Monat "Aug" wählen
  const candidates = await page.locator('input').all();
  let monthInput = null;
  for (const c of candidates) {
    const v = await c.inputValue().catch(() => '');
    if (/^[A-Za-zäöü]{3,4}\s\d{4}$/.test(v)) { monthInput = c; console.log('Monatsfeld gefunden:', v); break; }
  }
  if (!monthInput) throw new Error('Monatsfeld nicht gefunden.');
  await monthInput.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'month-picker-open.png'), fullPage: true });

  // Zurück-Pfeil (vorheriger Monat) klicken, dann "Aug" im Kalender wählen
  const prevArrow = page.locator('button').filter({ has: page.locator('svg') }).first();
  // Robuster: aria-label oder Text "<" — MudBlazor date picker header hat 2 Pfeil-Buttons
  const arrows = page.locator('.mud-picker-calendar-header button, .mud-picker-nav-button');
  console.log('Pfeil-Buttons gefunden:', await arrows.count());
  await arrows.first().click(); // linker Pfeil = zurück
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'month-picker-after-prev.png'), fullPage: true });

  const augBtn = page.getByRole('button', { name: /^Aug/i }).first();
  await augBtn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(__dirname, 'monatsbericht-august.png'), fullPage: true });

  console.log('--- August 2026 ---');
  const augSummary = await readSummary(page);
  console.log(JSON.stringify(augSummary));
  const augItems = await collectAllRows(page);
  console.log('August Zeilen:', augItems.length);
  fs.writeFileSync(path.join(__dirname, 'bh-monatsbericht-aug.json'), JSON.stringify(augItems, null, 2));

  fs.writeFileSync(path.join(__dirname, 'bh-monats-summary.json'), JSON.stringify({ september: sepSummary, august: augSummary }, null, 2));

  await browser.close();
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
