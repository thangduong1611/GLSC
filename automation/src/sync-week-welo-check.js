// Wöchentlicher Abgleich: wer hat DIESE Woche genehmigten Urlaub bzw. eine
// Krankmeldung in der App — und ist das auch schon in Welo (U/K-Liste)
// erfasst? Reine Leseaktion, schreibt NIE etwas auf Welo (Auftrag t.duong
// 10.09.2026: "so sánh giữa những người có Urlaub được plan của tuần hiện
// tại đã được buch trên Welo chưa, hoặc những ai nghỉ ốm tuần hiện tại đã
// được buch chưa"). Ergebnis geht nach welo_week_check/{region} — ein Dok.
// pro Region, bei jedem Lauf komplett überschrieben (kein Verlauf nötig,
// die App zeigt immer nur den aktuellen Stand), analog zu
// inventur_welo_preview (sync-inventur-diff.js).
//
// Wiederverwendet die U/K-Listen-Scraping-Logik aus scrape-welo-urlaub.js
// (DOM-Struktur dort ausführlich dokumentiert), hier aber auf die aktuelle
// Kalenderwoche statt eines festen Sep-Dez-Zeitraums umgestellt, und mit
// "Krank" (rot) zusätzlich zu "Urlaub" (blau) abgeglichen — der Auftrag
// nennt beides, das alte Skript hatte Krank nur mitgeloggt.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

const FARBE_ZU_KATEGORIE = {
  blue: 'Urlaub',
  red: 'Krank',
  '#808': 'Sonderurlaub',
  '#80d': 'Arbeitsunfall',
  '#558': 'Unbezahlt',
};

function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
// Datum in Berlin-Ortszeit statt Server-Zeitzone (Cloud Run läuft in UTC) —
// über Mittag geparst, damit der max. 2h-Zeitzonenunterschied nie den
// Kalendertag verschiebt (siehe unten in currentWeekRange).
function todayBerlinISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }); }
function currentWeekRange() {
  const d = new Date(todayBerlinISO() + 'T12:00:00');
  const dow = d.getDay(); // 0=So, 1=Mo, ... 6=Sa
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDays(d, diffToMonday);
  const sunday = addDays(monday, 6);
  return { weekStart: isoOf(monday), weekEnd: isoOf(sunday) };
}
function overlaps(a1, a2, b1, b2) { return a1 <= b2 && b1 <= a2; }
function clip(from, to, lo, hi) { return { from: from < lo ? lo : from, to: to > hi ? hi : to }; }

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

// Gruppiert eine sortierte Liste von {dateIso, kategorie} in zusammenhaengende
// {from, to, kategorie}-Bloecke (aufeinanderfolgende Kalendertage, gleiche Kategorie).
function gruppiereBloecke(tage) {
  const bloecke = [];
  let cur = null;
  tage.forEach((t) => {
    if (cur && cur.kategorie === t.kategorie && isoOf(addDays(new Date(cur.to + 'T00:00:00'), 1)) === t.dateIso) {
      cur.to = t.dateIso;
    } else {
      if (cur) bloecke.push(cur);
      cur = { from: t.dateIso, to: t.dateIso, kategorie: t.kategorie };
    }
  });
  if (cur) bloecke.push(cur);
  return bloecke;
}

async function scrapeTyp(page, sessionBase, year, typ) {
  await page.goto(`${sessionBase}/urlaubsliste/${year}-${typ}-alle-v-01.html`);
  return page.evaluate((y) => {
    const rows = [];
    document.querySelectorAll('tr.n').forEach((tr) => {
      const idLink = tr.querySelector('td a[href*="/pf/info/"]');
      if (!idLink) return;
      const idMatch = idLink.getAttribute('href').match(/\/pf\/info\/(\d+)\.html/);
      if (!idMatch) return;
      const id = idMatch[1];
      const nameCell = tr.querySelectorAll('td')[1];
      const name = nameCell ? nameCell.textContent.trim().split('\n')[0] : '';
      const piSpan = tr.querySelector('.pi');
      const tage = [];
      if (piSpan) {
        piSpan.querySelectorAll('b, span').forEach((el) => {
          const txt = el.textContent.trim();
          const m = txt.match(/^(\d{2})\.(\d{2})$/);
          if (!m) return;
          const style = el.getAttribute('style') || '';
          const colorMatch = style.match(/color:\s*([^;]+)/);
          if (!colorMatch) return;
          const color = colorMatch[1].trim().toLowerCase();
          const dateIso = y + '-' + m[2] + '-' + m[1];
          tage.push({ dateIso, color });
        });
      }
      rows.push({ id, name, tage });
    });
    return rows;
  }, year);
}

// Liest die U/K-Listen aller 3 Personalarten (fs/mj/tmdm), für jedes Jahr,
// das die Woche berührt (nur relevant für die eine Woche im Jahr um Silvester),
// und gruppiert pro Mitarbeiter in Bloecke, beschränkt auf [weekStart, weekEnd].
async function scrapeWeekBloecke(page, sessionBase, weekStart, weekEnd) {
  const years = Array.from(new Set([weekStart.slice(0, 4), weekEnd.slice(0, 4)]));
  const merged = {}; // id -> {name, tage:[{dateIso,color}]}
  for (const year of years) {
    for (const typ of ['fs', 'mj', 'tmdm']) {
      const rows = await scrapeTyp(page, sessionBase, year, typ);
      rows.forEach((r) => {
        if (!merged[r.id]) merged[r.id] = { name: r.name, tage: [] };
        merged[r.id].tage.push(...r.tage);
      });
    }
  }
  const result = {};
  Object.entries(merged).forEach(([id, v]) => {
    const tage = v.tage
      .filter((t) => t.dateIso >= weekStart && t.dateIso <= weekEnd)
      .map((t) => ({ dateIso: t.dateIso, kategorie: FARBE_ZU_KATEGORIE[t.color] || ('unbekannt:' + t.color) }))
      .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    if (tage.length) result[id] = { name: v.name, bloecke: gruppiereBloecke(tage) };
  });
  return result;
}

async function main() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER/WELO_PASSWORD fehlen.');
  const db = getDb();
  const { weekStart, weekEnd } = currentWeekRange();
  console.log(`Prüfe Woche ${weekStart} – ${weekEnd} …`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  let weloScan;
  try {
    console.log('Login bei Welo …');
    const sessionBase = await login(page);
    weloScan = await scrapeWeekBloecke(page, sessionBase, weekStart, weekEnd);
  } finally {
    await browser.close();
  }

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

  // App-Krankmeldung: kein Status-Feld (reine Meldung) — offenes "bis" heißt
  // "noch laufend", dafür wird zumindest bis Wochenende angenommen.
  const krSnap = await db.collection('krank').get();
  const appKrank = [];
  krSnap.forEach((d) => {
    const v = d.data();
    if (!v.empId || !v.from) return;
    const to = v.to || weekEnd;
    if (!overlaps(v.from, to, weekStart, weekEnd)) return;
    appKrank.push({ empId: '' + v.empId, name: v.name || '', filiale: v.filiale || '', region: v.region || null, ...clip(v.from, to, weekStart, weekEnd) });
  });

  function fehltInWelo(entry, kategorie) {
    const scan = weloScan[entry.empId];
    if (!scan) return true;
    return !scan.bloecke.some((b) => b.kategorie === kategorie && overlaps(b.from, b.to, entry.from, entry.to));
  }

  const urlaubMissing = appUrlaub.filter((e) => fehltInWelo(e, 'Urlaub'));
  const krankMissing = appKrank.filter((e) => fehltInWelo(e, 'Krank'));

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
