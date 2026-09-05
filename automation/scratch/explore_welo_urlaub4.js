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

  // Finde die Zeile mit "Amjad" und untersuche ALLE <a>-Elemente darin genau
  const rowInfo = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const row = rows.find((r) => r.textContent.includes('Amjad'));
    if (!row) return null;
    return Array.from(row.querySelectorAll('a')).map((a) => ({
      text: a.textContent.trim(),
      href: a.getAttribute('href'),
      onclick: a.getAttribute('onclick'),
      outerHTML: a.outerHTML.slice(0, 300),
    }));
  });
  fs.writeFileSync(path.join(OUT, '8_amjad_row_anchors.json'), JSON.stringify(rowInfo, null, 2), 'utf8');
  console.log(JSON.stringify(rowInfo, null, 2));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
