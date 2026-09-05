// Einmaliges Erkundungsskript: loggt sich bei Welo ein und macht Screenshots
// der Personalinfo-Seite eines Test-Mitarbeiters sowie des Hauptmenues, um
// eine Seite mit KONKRETEN Urlaub-Datumsbereichen (nicht nur Summen) zu
// finden (Auftrag t.duong 05.09.2026).
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const sessionBase = await login(page);
  console.log('eingeloggt, sessionBase=', sessionBase);

  // 1) Hauptmenue
  await page.goto(`${sessionBase}/index.html`);
  await page.screenshot({ path: path.join(OUT, '1_hauptmenue.png'), fullPage: true });
  const navLinks = await page.$$eval('a', (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })).filter((l) => l.text));
  fs.writeFileSync(path.join(OUT, '1_hauptmenue_links.json'), JSON.stringify(navLinks, null, 2), 'utf8');
  console.log('Hauptmenue-Links gespeichert:', navLinks.length);

  // 2) Personalinfo-Seite eines Test-Mitarbeiters (330685, bereits bekannt)
  await page.goto(`${sessionBase}/pf/info/330685.html`);
  await page.screenshot({ path: path.join(OUT, '2_personalinfo.png'), fullPage: true });
  const infoLinks = await page.$$eval('a', (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })).filter((l) => l.text));
  fs.writeFileSync(path.join(OUT, '2_personalinfo_links.json'), JSON.stringify(infoLinks, null, 2), 'utf8');
  console.log('Personalinfo-Links gespeichert:', infoLinks.length);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
