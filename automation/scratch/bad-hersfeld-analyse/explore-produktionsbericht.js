// Einmaliges Explorationsskript (Login/Navigation 1:1 aus
// src/sync-axonity-produktion.js kopiert, unverändert) — prüft, ob der
// "Produktionsbericht"-Tab in Axonity einen Datumsfilter hat, um ein
// vergangenes Datum (17.09.2026) statt nur "heute" zu sehen.
require('dotenv').config();
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
  if ((await options.count()) === 0) {
    await gebietsleiterFilter.click();
    await page.waitForTimeout(400);
  }
  await page.getByRole('option', { name: getGebietsleiterName(), exact: true }).click();
  await page.waitForTimeout(800);
  await page.locator('table tbody tr').first().waitFor({ timeout: 15000 });

  const perPageSelect = page.locator('.mud-table-pagination-select');
  await perPageSelect.click();
  await page.waitForTimeout(400);
  if ((await options.count()) === 0) {
    await perPageSelect.click();
    await page.waitForTimeout(400);
  }
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

function navTab(page, text) {
  return page.locator('a.nav-link', { hasText: text });
}

async function openUmsaetzeTab(page, href) {
  await page.goto(`${BASE_URL}${href}`);
  const umsaetzeLink = page.getByRole('link', { name: /Umsätze/ }).first();
  const produktionsberichtTab = navTab(page, 'Produktionsbericht');
  await umsaetzeLink.click();
  try {
    await produktionsberichtTab.waitFor({ timeout: 3000 });
  } catch {
    await umsaetzeLink.click();
    await produktionsberichtTab.waitFor({ timeout: 15000 });
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  console.log('Login...');
  await login(page);
  console.log('Markets laden...');
  const markets = await listMarkets(page);
  console.log(`${markets.length} Filialen gefunden.`);
  const bovenden = markets.find((m) => m.marktNr === '402207' || m.standort.toLowerCase().includes('bovenden'));
  if (!bovenden) throw new Error('Bovenden nicht gefunden. Gefundene Filialen: ' + markets.map(m=>m.marktNr+' '+m.standort).join(', '));
  console.log('Bovenden:', JSON.stringify(bovenden));

  await openUmsaetzeTab(page, bovenden.href);
  const tab = navTab(page, 'Produktionsbericht');
  await tab.click();
  await page.locator('table th', { hasText: 'Uhrzeit' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(__dirname, 'produktionsbericht-heute.png'), fullPage: true });
  console.log('Screenshot gespeichert: produktionsbericht-heute.png');

  const allText = await page.locator('body').innerText();
  console.log('--- Sichtbarer Text (erste 2500 Zeichen) ---');
  console.log(allText.slice(0, 2500));

  const dateInputCount = await page.locator('input[type="date"]').count();
  const pickerCount = await page.locator('.mud-picker, .mud-date-picker, [class*="date" i]').count();
  console.log('input[type=date]:', dateInputCount, '| .mud-picker/date-Klassen:', pickerCount);

  await browser.close();
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
