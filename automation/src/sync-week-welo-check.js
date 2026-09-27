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
const { login, scrapeEmployeeYear, makeYearCache, isoOf } = require('./welo-jahresansicht');

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
  if (!process.env.WELO_USER || !process.env.WELO_PASSWORD) throw new Error('WELO_USER/WELO_PASSWORD fehlen.');
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
