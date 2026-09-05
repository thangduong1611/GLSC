require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;
const OUT = path.join(__dirname, '..', 'output', 'welo_explore');
fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.waitForURL((url) => /^\/[A-Za-z0-9]+-[A-Za-z0-9]+\/index\.html/.test(url.pathname), { timeout: 15000 });
  const m = page.url().match(/^(https:\/\/[^/]+\/[A-Za-z0-9]+-[A-Za-z0-9]+)\//);
  return m[1];
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const sessionBase = await login(page);

  await page.goto(`${sessionBase}/urlaubsliste/index.html`);
  // Amjad's Tage-Link finden (Zeile enthaelt "341384")
  const html = await page.content();
  const hrefs = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')));
  fs.writeFileSync(path.join(OUT, '6_all_hrefs.json'), JSON.stringify(hrefs, null, 2), 'utf8');

  // Klick auf den unterstrichenen Tage-Link in Amjads Zeile
  const link = page.locator('tr:has-text("Amjad") a').first();
  const href = await link.getAttribute('href');
  console.log('Amjad Tage-Link href:', href);
  await link.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '7_amjad_tage_detail.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, '7_amjad_tage_detail.html'), await page.content(), 'utf8');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
