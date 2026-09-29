// Korrigiert: der Monats-Picker zeigt direkt ein Jahresraster (2026: Jan-Dez)
// — "Aug" im BEREITS offenen 2026-Raster anklicken, KEIN Pfeil vorher (das
// hatte beim ersten Versuch auf 2025 zurückgeblättert).
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
async function collectAllRows(page) {
  const items = [];
  const naechsteSeite = page.getByRole('button', { name: 'Nächste Seite' });
  for (let i = 0; i < 40; i++) {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    for (let r = 0; r < count; r++) {
      const cells = rows.nth(r).locator('td');
      if ((await cells.count()) < 6) continue;
      items.push({
        datum: (await cells.nth(0).innerText()).trim(),
        produkt: (await cells.nth(1).innerText()).trim(),
        anzahl: (await cells.nth(3).innerText()).trim(),
        gesamtpreis: (await cells.nth(5).innerText()).trim(),
      });
    }
    if (!(await naechsteSeite.isEnabled().catch(() => false))) break;
    await naechsteSeite.click();
    await page.waitForTimeout(350);
  }
  return items;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  console.log('Login...');
  await login(page);
  const markets = await listMarkets(page);
  const bh = markets.find((m) => m.marktNr === '402146');
  if (!bh) throw new Error('Bad Hersfeld nicht gefunden.');
  await openUmsaetzeTab(page, bh.href);
  await navTab(page, 'Monatsbericht').click();
  await page.waitForTimeout(1200);

  const candidates = await page.locator('input').all();
  let monthInput = null;
  for (const c of candidates) {
    const v = await c.inputValue().catch(() => '');
    if (/^[A-Za-zäöü]{3,4}\s\d{4}$/.test(v)) { monthInput = c; break; }
  }
  if (!monthInput) throw new Error('Monatsfeld nicht gefunden.');
  await monthInput.click();
  await page.waitForTimeout(500);
  // "Aug" DIREKT im bereits offenen 2026-Jahresraster anklicken (kein Pfeil-Klick!)
  await page.getByText('Aug', { exact: true }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(__dirname, 'monatsbericht-august-fixed.png'), fullPage: true });

  const headerText = await page.locator('body').innerText();
  console.log('--- Kopf nach Klick ---');
  console.log(headerText.slice(0, 700));

  const items = await collectAllRows(page);
  console.log('August Zeilen:', items.length);
  fs.writeFileSync(path.join(__dirname, 'bh-monatsbericht-aug.json'), JSON.stringify(items, null, 2));

  await browser.close();
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
