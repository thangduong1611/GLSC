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

  await page.goto(`${sessionBase}/pf/info/330685.html`);
  await page.click('a[href="#p-termine"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '3_termine_tab.png'), fullPage: true });
  const termineHtml = await page.$eval('#p-termine', (el) => el.outerHTML).catch(() => 'NOT FOUND');
  fs.writeFileSync(path.join(OUT, '3_termine_tab.html'), termineHtml, 'utf8');

  await page.click('a[href="#p-einsaetze"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '4_einsaetze_tab.png'), fullPage: true });

  await page.goto(`${sessionBase}/urlaubsliste/index.html`);
  await page.screenshot({ path: path.join(OUT, '5_urlaubsliste_index.png'), fullPage: true });
  const ulLinks = await page.$$eval('a', (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })).filter((l) => l.text));
  fs.writeFileSync(path.join(OUT, '5_urlaubsliste_links.json'), JSON.stringify(ulLinks, null, 2), 'utf8');

  console.log('done');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
