// Gezielte Pruefung fuer 1 Mitarbeiter, der in der U/K-Liste (fs/mj/tmdm)
// nicht auftauchte (bekannte Luecke) - liest stattdessen die individuelle
// Jahresansicht-Seite (deckt JEDE Person ab) und markiert "besondere" Tage
// (Urlaub/Krank/Feiertag/Unbezahlt, ohne Unterscheidung - siehe
// sync-welo-personal.js Kommentar) im angegebenen Zeitraum.
require('dotenv').config();
const { chromium } = require('playwright');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;
const ID = process.argv[2] || '330485';
const YEAR = 2026;

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
  const page = await browser.newPage();
  const sessionBase = await login(page);
  await page.goto(`${sessionBase}/pf/jahresansicht/${ID}-${YEAR}.html`);
  const daily = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('table.tgl, table.tgd').forEach((el) => {
      const date = el.getAttribute('_r');
      if (!date || date in out) return;
      out[date] = el.classList.contains('tgd');
    });
    return out;
  });
  const dates = Object.keys(daily).filter((d) => d >= '20261001' && d <= '20261130').sort();
  console.log(`Besondere Tage (Urlaub/Krank/etc.) fuer ${ID} im Okt-Nov 2026:`);
  let block = null;
  dates.forEach((d) => {
    const iso = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    if (daily[d]) {
      if (!block) block = { from: iso, to: iso };
      else block.to = iso;
    } else if (block) {
      console.log('  ', block.from, '-', block.to);
      block = null;
    }
  });
  if (block) console.log('  ', block.from, '-', block.to);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
