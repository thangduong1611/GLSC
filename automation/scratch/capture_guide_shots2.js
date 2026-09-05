// Screenshots fuer 2 weitere fehlende Guide-Abschnitte (Auftrag t.duong
// 05.09.2026): "Meine Daten (Welo)"-Karte (Urlaub-Reiter) und Umsatzziel-Box
// (Dienstplan-Reiter). Nutzt Mitarbeiter 330685 (Kassel-Aschoff), da für diese
// Filiale heute echte tagesziel/filiale_produktion-Daten vorliegen.
const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, '..', 'output', 'guide_shots');
require('fs').mkdirSync(OUT, { recursive: true });

const RUNS = [
  { lang: 'de', name: 'Max Mustermann', suffix: '_de' },
  { lang: 'vi', name: 'Nguyễn Văn A', suffix: '_vi' },
];

async function capture(browser, { lang, name, suffix }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await page.goto('http://localhost:8791/mitarbeiter.html');
  if (lang !== 'de') await page.click(`button[onclick="setLang('${lang}')"]`);
  await page.fill('#login-pid', '330685');
  await page.click('button[onclick="maDoLogin()"]');
  await page.waitForTimeout(1500);

  // Screenshot A: "Meine Daten (Welo)"-Karte auf dem Urlaub-Reiter
  await page.click('#ico-ul');
  await page.waitForTimeout(1500);
  const weloCard = await page.$('#welo-self-card');
  await weloCard.screenshot({ path: path.join(OUT, `welo_self${suffix}.png`) });

  // Screenshot B: Umsatzziel-Box auf dem Dienstplan-Reiter.
  // HINWEIS: filiale_produktion ist client-seitig aktuell nur fuer Manager
  // freigegeben (firestore.rules), die Mitarbeiter-App bekommt bis zum Rules-
  // Deploy "permission-denied" und die Box bleibt leer. Fuer den Screenshot
  // wird deshalb dieselbe Ausgabe wie maRenderZielInfo() manuell mit den
  // echten, per Admin-SDK gelesenen Werten nachgebaut (siehe Chat-Antwort).
  await page.click('#ico-dp');
  await page.waitForTimeout(1500);
  await page.evaluate((n) => {
    const hdr = document.getElementById('hdr-sub'); if (hdr) hdr.textContent = n + ' · 401891: E-Kassel-Frankfurter Str. - Aschoff';
  }, name);
  await page.evaluate(() => {
    const z = { marktname: '401891: E-Kassel-Frankfurter Str. - Aschoff', ziel: 1177.96, umsatzVorjahr: 942.37, produktionsziel: 1570.61 };
    const umsatzHeuteLive = 908.06;
    const pct = Math.round(umsatzHeuteLive / z.ziel * 100);
    const barColor = pct >= 100 ? 'var(--grn)' : 'var(--amb)';
    let html = '<div>' + t('welo_ziel', { filiale: z.marktname, ziel: weloFmtNum(z.ziel, 2) + ' €', vorjahr: weloFmtNum(z.umsatzVorjahr, 2) + ' €' }) + '</div>';
    html += '<div style="margin-top:6px;font-size:12px;font-weight:600;color:' + barColor + '">' + t('welo_heute', { n: weloFmtNum(umsatzHeuteLive, 2) + ' €', pct }) + '</div>'
      + '<div style="height:6px;border-radius:100px;background:var(--bg);overflow:hidden;margin-top:4px"><div style="height:100%;border-radius:100px;background:' + barColor + ';width:' + Math.min(pct, 100) + '%"></div></div>';
    html += '<div style="margin-top:6px">' + t('welo_produktion', { n: weloFmtNum(z.produktionsziel, 2) + ' €' }) + '</div>';
    document.getElementById('dp-ziel-info').innerHTML = html;
  });
  const zielEl = await page.$('#dp-ziel-info');
  await zielEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await zielEl.screenshot({ path: path.join(OUT, `ziel_info${suffix}.png`) });

  await page.close();
}

async function main() {
  const browser = await chromium.launch();
  for (const run of RUNS) await capture(browser, run);
  await browser.close();
  console.log('OK: Screenshots gespeichert in', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
