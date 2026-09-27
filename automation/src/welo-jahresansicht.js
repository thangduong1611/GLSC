// Gemeinsame Bausteine zum Lesen von Welo/SuCi-Net-Jahresansichten
// (/pf/jahresansicht/{PersonalNr}-{Jahr}.html) — ausgelagert aus
// sync-week-welo-check.js, damit sync-welo-urlaub-suggest.js (Urlaub-Vorschläge
// für den Dienstplan) dieselbe, bereits live verifizierte Lese-Logik nutzt statt
// sie erneut zu erraten.
//
// DOM-Struktur (live verifiziert 10.09.2026): jeder Tag ist eine eigene
// <table class="tgl"|"tgd" _r="YYYYMMDD">-Zelle ("tgl" = normaler Tag,
// "tgd" = Tag mit besonderem Status wie Urlaub/Krank — reine Render-Klasse,
// für den Inhalt irrelevant). Darin <img class="ma" src="/images/xN.gif">
// zeigt die Tages-Kategorie über eine feste Icon-Nummer. Icon-Zuordnung über
// 4 verschiedene Mitarbeiter/Anstellungsarten hinweg konsistent verifiziert:
// x10.gif=Urlaub, x6.gif/x7.gif=Krank. Sonntage tragen innerhalb eines
// Urlaubsblocks ein eigenes Icon (x8.gif statt x10.gif) — kein Bug, siehe
// weloDeckt() in sync-week-welo-check.js.
const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

const ICON_KATEGORIE = {
  'x10.gif': 'Urlaub',
  'x6.gif': 'Krank',
  'x7.gif': 'Krank',
};

function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function rToIso(r) { return r.slice(0, 4) + '-' + r.slice(4, 6) + '-' + r.slice(6, 8); }

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.waitForURL((url) => /^\/[A-Za-z0-9]+-[A-Za-z0-9]+\/index\.html/.test(url.pathname), { timeout: 15000 });
  const m = page.url().match(/^(https:\/\/[^/]+\/[A-Za-z0-9]+-[A-Za-z0-9]+)\//);
  if (!m) throw new Error('Session-Präfix nach Login nicht gefunden: ' + page.url());
  return m[1];
}

// Liest die Jahresansicht eines Mitarbeiters, gibt {isoDatum: kategorie} für
// alle Tage zurück, die ein bekanntes Icon (Urlaub/Krank) tragen.
async function scrapeEmployeeYear(page, sessionBase, empId, year) {
  await page.goto(`${sessionBase}/pf/jahresansicht/${empId}-${year}.html`);
  const raw = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('table.tgd[_r], table.tgl[_r]').forEach((t) => {
      const img = t.querySelector('img.ma');
      if (!img) return;
      const src = img.getAttribute('src') || '';
      out.push({ r: t.getAttribute('_r'), icon: src.slice(src.lastIndexOf('/') + 1) });
    });
    return out;
  });
  const map = {};
  raw.forEach(({ r, icon }) => {
    const kat = ICON_KATEGORIE[icon];
    if (kat) map[rToIso(r)] = kat;
  });
  return map;
}

// Cache pro Mitarbeiter+Jahr, damit derselbe Mitarbeiter (z.B. bei mehreren
// Zeiträumen) nicht zweimal geladen wird.
function makeYearCache(page, sessionBase) {
  const cache = new Map();
  return async function getYear(empId, year) {
    const key = empId + '-' + year;
    if (!cache.has(key)) cache.set(key, await scrapeEmployeeYear(page, sessionBase, empId, year));
    return cache.get(key);
  };
}

module.exports = { login, scrapeEmployeeYear, makeYearCache, ICON_KATEGORIE, isoOf, rToIso, USER, PASSWORD };
