// Wöchentlicher Abgleich: wer hat DIESE Woche genehmigten Urlaub bzw. eine
// Krankmeldung in der App — und ist das auch schon in Welo erfasst? Reine
// Leseaktion, schreibt NIE etwas auf Welo (Auftrag t.duong 10.09.2026).
// Ergebnis geht nach welo_week_check/{region} — 1 Dok. pro Region, bei
// jedem Lauf komplett überschrieben.
//
// WICHTIG (Bugfix 10.09.2026, live mit Screenshot des Nutzers verifiziert):
// die erste Version las die Welo "U/K-Liste" (/urlaubsliste/{jahr}-{typ}-
// alle-v-01.html, typ=fs/mj/tmdm). Diese 3 Listen decken NICHT alle
// Mitarbeiter ab — z.B. fehlen dort Mitarbeiter mit Anstellungsart
// "Festang. mit Gehalt" (Monatsgehalt statt Stundenlohn) komplett (111
// aktive Mitarbeiter in der App, aber nur 51 Zeilen über alle 3 Listen
// zusammen). Ein fehlender Mitarbeiter in der Liste sah für den Abgleich
// aus wie "kein Welo-Urlaub gefunden" — obwohl die Person auf ihrer
// eigenen Jahresansicht-Seite ganz normal als Urlaub markiert war (siehe
// Screenshot: Frau Tran, Thi Bich, Personal-Nr. 350153, grüne Markierung
// 10.-12.09.2026, aber weder auf der fs- noch mj- noch tmdm-Liste zu finden).
//
// Fix: statt der 3 Sammel-Listen wird jetzt PRO betroffenem Mitarbeiter
// direkt die eigene Jahresansicht-Seite gelesen (/pf/jahresansicht/
// {PersonalNr}-{Jahr}.html — exakt die Seite, die auch ein Mensch im
// Browser aufruft). Das deckt jede Anstellungsart ab (per-Mitarbeiter-Seite,
// keine Typ-Filterung) und ist effizient, weil pro Lauf nur für die
// Mitarbeiter mit einem App-Eintrag diese Woche 1-2 Seiten geladen werden
// (nicht alle ~111 Mitarbeiter).
//
// DOM-Struktur (live verifiziert 10.09.2026): jeder Tag ist eine eigene
// <table class="tgl"|"tgd" _r="YYYYMMDD">-Zelle ("tgl" = normaler Tag,
// "tgd" = Tag mit besonderem Status wie Urlaub/Krank — reine Render-Klasse,
// für den Inhalt irrelevant). Darin <img class="ma" src="/images/xN.gif">
// zeigt die Tages-Kategorie über eine feste Icon-Nummer; am ERSTEN Tag
// eines zusammenhängenden Blocks steht zusätzlich <span class="ur"> bzw.
// <span class="kr"> davor (bestätigt über die eigene Legende der Seite:
// a.ur{color:blue}=Urlaub, a.kr{color:red}=Krank). Icon-Zuordnung über 4
// verschiedene Mitarbeiter/Anstellungsarten hinweg konsistent verifiziert:
// x10.gif=Urlaub, x6.gif/x7.gif=Krank — nie widersprüchlich mit der
// span-Klasse, wo eine vorhanden war.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

const ICON_KATEGORIE = {
  'x10.gif': 'Urlaub',
  'x6.gif': 'Krank',
  'x7.gif': 'Krank',
};

function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function todayBerlinISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }); }
function currentWeekRange() {
  const d = new Date(todayBerlinISO() + 'T12:00:00');
  const dow = d.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDays(d, diffToMonday);
  const sunday = addDays(monday, 6);
  return { weekStart: isoOf(monday), weekEnd: isoOf(sunday) };
}
function overlaps(a1, a2, b1, b2) { return a1 <= b2 && b1 <= a2; }
function clip(from, to, lo, hi) { return { from: from < lo ? lo : from, to: to > hi ? hi : to }; }
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

// Prüft, ob JEDER Tag im Bereich [from,to] in Welo als "kategorie" markiert
// ist — nicht nur eine Überlappung, sondern lückenlos, damit ein nur
// teilweise eingetragener Zeitraum ebenfalls als "noch zu prüfen" auffällt.
// Sonntage werden übersprungen (live verifiziert 10.09.2026, Mitarbeiter
// 350153): innerhalb eines Urlaubsblocks markiert Welo den Sonntag mit einem
// EIGENEN Icon (x8.gif statt x10.gif), nicht mit dem normalen
// Urlaub-Icon — ohne diese Ausnahme würde jeder über einen Sonntag
// laufende Urlaub fälschlich als "fehlt in Welo" gemeldet, obwohl Mo-Sa
// korrekt eingetragen sind.
async function weloDeckt(getYear, empId, kategorie, from, to) {
  const years = Array.from(new Set([from.slice(0, 4), to.slice(0, 4)]));
  const dayMap = {};
  for (const year of years) Object.assign(dayMap, await getYear(empId, year));
  let d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    if (d.getDay() !== 0 && dayMap[isoOf(d)] !== kategorie) return false;
    d = addDays(d, 1);
  }
  return true;
}

async function main() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER/WELO_PASSWORD fehlen.');
  const db = getDb();
  const { weekStart, weekEnd } = currentWeekRange();
  console.log(`Prüfe Woche ${weekStart} – ${weekEnd} …`);

  // App-Urlaub: nur genehmigt, überlappt diese Woche.
  const urlSnap = await db.collectionGroup('urlaub').get();
  const appUrlaub = [];
  urlSnap.forEach((d) => {
    const v = d.data();
    if (v.status !== 'approved') return;
    if (!v.empId || !v.from || !v.to) return;
    if (!overlaps(v.from, v.to, weekStart, weekEnd)) return;
    appUrlaub.push({ empId: '' + v.empId, name: v.name || '', filiale: v.filiale || '', region: v.region || null, ...clip(v.from, v.to, weekStart, weekEnd) });
  });

  // App-Krankmeldung: kein Status-Feld — offenes "bis" heißt "noch laufend",
  // dafür wird zumindest bis Wochenende angenommen.
  const krSnap = await db.collection('krank').get();
  const appKrank = [];
  krSnap.forEach((d) => {
    const v = d.data();
    if (!v.empId || !v.from) return;
    const to = v.to || weekEnd;
    if (!overlaps(v.from, to, weekStart, weekEnd)) return;
    appKrank.push({ empId: '' + v.empId, name: v.name || '', filiale: v.filiale || '', region: v.region || null, ...clip(v.from, to, weekStart, weekEnd) });
  });

  if (!appUrlaub.length && !appKrank.length) {
    console.log('Diese Woche keine genehmigten Urlaube/Krankmeldungen in der App — nichts zu prüfen.');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const urlaubMissing = [];
  const krankMissing = [];
  try {
    console.log('Login bei Welo …');
    const sessionBase = await login(page);
    const getYear = makeYearCache(page, sessionBase);

    for (const e of appUrlaub) {
      const ok = await weloDeckt(getYear, e.empId, 'Urlaub', e.from, e.to);
      if (!ok) urlaubMissing.push(e);
    }
    for (const e of appKrank) {
      const ok = await weloDeckt(getYear, e.empId, 'Krank', e.from, e.to);
      if (!ok) krankMissing.push(e);
    }
  } finally {
    await browser.close();
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const byRegion = {};
  function bucket(region) { return byRegion[region || 'ost'] || (byRegion[region || 'ost'] = { urlaubMissing: [], krankMissing: [] }); }
  urlaubMissing.forEach((e) => { const { region, ...rest } = e; bucket(region).urlaubMissing.push(rest); });
  krankMissing.forEach((e) => { const { region, ...rest } = e; bucket(region).krankMissing.push(rest); });

  // Beide bekannten Regionen immer schreiben (auch wenn leer) — sonst würde
  // eine "alles gebucht"-Woche fälschlich noch den Stand der letzten Woche
  // zeigen, weil kein neuer Treffer den alten Firestore-Doc überschreibt.
  const regionsToWrite = new Set(['ost', 'west', ...Object.keys(byRegion)]);
  const batch = db.batch();
  regionsToWrite.forEach((region) => {
    const data = byRegion[region] || { urlaubMissing: [], krankMissing: [] };
    batch.set(db.collection('welo_week_check').doc(region), {
      weekStart, weekEnd, region, checkedAt: now, ...data,
    });
  });
  await batch.commit();

  console.log(`✓ Fertig. ${urlaubMissing.length} Urlaub-Eintrag(e) diese Woche fehlen in Welo, ${krankMissing.length} Krankmeldung(en) fehlen in Welo.`);
  urlaubMissing.forEach((e) => console.log(`   URLAUB fehlt: ${e.name} (${e.filiale}) ${e.from} – ${e.to}`));
  krankMissing.forEach((e) => console.log(`   KRANK  fehlt: ${e.name} (${e.filiale}) ${e.from} – ${e.to}`));
}

module.exports = { main, currentWeekRange };
if (require.main === module) {
  main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
}
