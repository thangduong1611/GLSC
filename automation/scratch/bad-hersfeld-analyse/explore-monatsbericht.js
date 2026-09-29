// Prüft, ob der "Monatsbericht"-Tab in Axonity echte Monats-Vergleichsdaten
// (August vs September) für Bad Hersfeld liefert.
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  console.log('Login...');
  await login(page);
  console.log('Markets laden...');
  const markets = await listMarkets(page);
  const bh = markets.find((m) => m.marktNr === '402146');
  if (!bh) throw new Error('Bad Hersfeld nicht gefunden. Liste: ' + markets.map(m=>m.marktNr+' '+m.standort).join(', '));
  console.log('Bad Hersfeld:', JSON.stringify(bh));

  await openUmsaetzeTab(page, bh.href);
  await navTab(page, 'Monatsbericht').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'monatsbericht-bh.png'), fullPage: true });
  const txt = await page.locator('body').innerText();
  console.log('--- Monatsbericht Text ---');
  console.log(txt.slice(0, 3000));

  await browser.close();
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
