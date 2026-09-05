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

  const legendHtml = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('td')).filter((e) => e.textContent.trim() === 'Legende:');
    if (!cands.length) return 'NOT FOUND';
    const table = cands[0].closest('table');
    return table ? table.outerHTML : 'NO TABLE';
  });
  fs.writeFileSync(path.join(OUT, '10_legend.html'), legendHtml, 'utf8');
  console.log('LEGEND:', legendHtml);

  const info = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('td')).filter((c) => c.textContent.includes('Amjad') && !c.querySelector('table'));
    if (!candidates.length) return { error: 'td not found' };
    const td = candidates[candidates.length - 1]; // tiefstes/spezifischstes zuerst? nimm das kuerzeste
    const shortest = candidates.reduce((a, b) => (a.textContent.length <= b.textContent.length ? a : b));
    const tr = shortest.closest('tr');
    return {
      count: candidates.length,
      trHtml: tr.outerHTML,
    };
  });
  fs.writeFileSync(path.join(OUT, '9_amjad_tr.html'), info.trHtml || info.error, 'utf8');
  console.log('candidates:', info.count);
  console.log((info.trHtml || info.error).slice(0, 3000));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
