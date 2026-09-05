// Einmaliges Hilfsskript: nimmt echte Screenshots der Mitarbeiter-App fuer die
// Anleitungs-PDFs auf (neue Funktionen: "Vorschlag Gebietsleiter"-Badge,
// Update-Banner). Nutzt Playwright (bereits als Dependency vorhanden, siehe
// sync-employee-address.js) gegen den lokalen statischen Server auf :8791.
const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, '..', 'output', 'guide_shots');
require('fs').mkdirSync(OUT, { recursive: true });

// Sprache passend zum jeweiligen Anleitungs-PDF: DE-Guide nutzt "Max Mustermann",
// VI-Guide nutzt "Nguyễn Văn A" als Platzhaltername (siehe bestehende Guide-Seiten).
const RUNS = [
  { lang: 'de', name: 'Max Mustermann', suffix: '_de' },
  { lang: 'vi', name: 'Nguyễn Văn A', suffix: '_vi' },
];

async function capture(browser, { lang, name, suffix }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await page.goto('http://localhost:8791/mitarbeiter.html');
  if (lang !== 'de') await page.click(`button[onclick="setLang('${lang}')"]`);
  await page.fill('#login-pid', '341384');
  await page.click('button[onclick="maDoLogin()"]');
  await page.waitForTimeout(1500);
  await page.click('#ico-ul');
  await page.waitForTimeout(1500);

  await page.evaluate((n) => {
    const el = document.querySelector('.ul-list-item .uname');
    if (el) el.textContent = n;
  }, name);

  const ulCard = await page.evaluateHandle(() => {
    const heading = Array.from(document.querySelectorAll('div')).find(e => e.children.length === 0 && /Urlaub dieses Jahr|Nghỉ phép năm nay/.test(e.textContent || ''));
    return heading ? heading.closest('.card') : document.getElementById('ul-list').closest('.card');
  });
  await ulCard.asElement().screenshot({ path: path.join(OUT, `urlaub_gl_vorschlag${suffix}.png`) });

  await page.evaluate((n) => {
    const b = document.getElementById('update-box'); if (b) b.style.display = 'flex';
    const hdr = document.getElementById('hdr-sub'); if (hdr) hdr.textContent = n + ' · 401891: E-Kassel-Frankfurter Str. - Aschoff';
    window.scrollTo(0, 0);
  }, name);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `update_banner_full${suffix}.png`), clip: { x: 0, y: 0, width: 390, height: 220 } });
  await page.close();
}

async function main() {
  const browser = await chromium.launch();
  for (const run of RUNS) await capture(browser, run);
  await browser.close();
  console.log('OK: Screenshots gespeichert in', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
