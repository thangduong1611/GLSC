// Loest Urlaub-Konflikte, die nach dem Welo-Import (import-welo-urlaub.js)
// UND durch seither veraenderte Zweitfiliale-Zuordnungen entstanden sind
// (Auftrag t.duong 05.09.2026: Welo-Daten sind die Wahrheit, automatisch
// geplante (source:'hr') Buchungen werden bei Konflikt verschoben).
//
// Prioritaet: 'welo' (schon offiziell in Welo gebucht) und selbst
// eingereichte Antraege (kein source-Feld) werden NIE verschoben. Nur
// 'hr'-Buchungen (dieser eigene Automatik-Plan) sind beweglich. Bei
// hr-vs-hr wird die KUERZERE Buchung verschoben (kleinerer Eingriff).
// Konflikte OHNE bewegliche Seite (welo-vs-welo, welo-vs-self, self-vs-self)
// werden nicht angefasst und am Ende separat aufgelistet - hier kann nur ein
// Mensch entscheiden, wer den Platz raeumt.
require('dotenv').config();
const { getDb } = require('./firestore-client');

const TRONG_ID = '550078', KHANG_ID = '550152';
const START = new Date('2026-09-14T00:00:00');
const ENDE = new Date('2026-12-31T00:00:00');
const WEST_FEIERTAGE = new Set(['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26']);
const BUNDESLAND_JE_MARKTNR = {
  '401125': 'HE', '401888': 'HE', '401891': 'HE', '402146': 'HE', '402150': 'HE', '402254': 'HE',
  '402155': 'TH', '402240': 'TH',
  '402207': 'NI', '402257': 'NI', '402286': 'NI', '402297': 'NI', '402501': 'NI', '402502': 'NI',
};
function ostFeiertage(marktNr) {
  const bl = BUNDESLAND_JE_MARKTNR[marktNr] || null;
  const set = new Set(['2026-10-03', '2026-12-25', '2026-12-26']);
  if (bl === 'NI' || bl === 'TH') set.add('2026-10-31');
  if (bl === 'TH') set.add('2026-09-20');
  return set;
}
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function overlaps(a1, a2, b1, b2) { return a1 <= b2 && b1 <= a2; }
function dayCount(f, t) { return Math.round((new Date(t) - new Date(f)) / 86400000) + 1; }
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function isBad(dateIso, feiertage) { const d = new Date(dateIso + 'T00:00:00'); return d.getDay() === 0 || feiertage.has(dateIso); }
function endForChargedDays(start, len, feiertage) {
  let end = new Date(start), counted = 0;
  while (counted < len) {
    if (end.getDay() !== 0 && !feiertage.has(iso(end))) counted++;
    if (counted < len) end = addDays(end, 1);
  }
  return end;
}

async function main() {
  const db = getDb();
  const APPLY = process.argv.includes('--apply');

  const empsSnap = await db.collection('emps').where('active', '==', true).get();
  const emps = {}; empsSnap.forEach((d) => { emps[d.id] = d.data(); });

  const pools = {};
  Object.entries(emps).forEach(([id, e]) => {
    if (id === TRONG_ID || id === KHANG_ID) return;
    [e.filiale, ...(e.zweit || [])].filter(Boolean).forEach((b) => { (pools[b] = pools[b] || new Set()).add(id); });
  });
  const neighbors = {};
  Object.keys(emps).forEach((id) => { neighbors[id] = new Set(); });
  Object.values(pools).forEach((set) => { const arr = [...set]; arr.forEach((a) => arr.forEach((b) => { if (a !== b) neighbors[a].add(b); })); });

  const urlSnap = await db.collectionGroup('urlaub').get();
  const docsByEmp = {}; // id -> [{path,from,to,source}]
  urlSnap.forEach((d) => {
    const v = d.data();
    if (v.status === 'rejected') return;
    if (v.to < '2026-01-01') return;
    (docsByEmp[v.empId] = docsByEmp[v.empId] || []).push({ path: d.ref.path, from: v.from, to: v.to, source: v.source || 'self', filiale: v.filiale, name: v.name, region: v.region });
  });

  function findConflicts() {
    const out = [], seen = new Set();
    Object.keys(neighbors).forEach((a) => {
      neighbors[a].forEach((b) => {
        if (a >= b) return;
        (docsByEmp[a] || []).forEach((x) => (docsByEmp[b] || []).forEach((y) => {
          if (!overlaps(x.from, x.to, y.from, y.to)) return;
          const key = [x.path, y.path].sort().join('|');
          if (seen.has(key)) return; seen.add(key);
          out.push({ a: { id: a, ...x }, b: { id: b, ...y } });
        }));
      });
    });
    return out;
  }

  function isFree(id, fromIso, toIso, excludePath) {
    if ((docsByEmp[id] || []).some((iv) => iv.path !== excludePath && overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    for (const nb of neighbors[id]) {
      if ((docsByEmp[nb] || []).some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    }
    return true;
  }

  async function moveEntry(entry, grund) {
    const e = emps[entry.id];
    const region = entry.region || (e && e.region);
    const feiertage = region === 'ost' ? ostFeiertage(e && e.filialeNr) : WEST_FEIERTAGE;
    const len = dayCount(entry.from, entry.to);
    let cursor = new Date(START);
    let result = null;
    while (cursor <= ENDE) {
      if (isBad(iso(cursor), feiertage)) { cursor = addDays(cursor, 1); continue; }
      const end = endForChargedDays(cursor, len, feiertage);
      if (end > ENDE) break;
      const f = iso(cursor), t = iso(end);
      if (isFree(entry.id, f, t, entry.path)) { result = { from: f, to: t }; break; }
      cursor = addDays(cursor, 1);
    }
    if (!result) { console.log(`  ✗ Kein freier Platz fuer ${entry.name} (${entry.id}) gefunden - UNVERAENDERT gelassen.`); return false; }
    console.log(`  ✓ ${entry.name}: ${entry.from}-${entry.to} → ${result.from}-${result.to}  (${grund})`);
    const list = docsByEmp[entry.id];
    const idx = list.findIndex((x) => x.path === entry.path);
    list[idx] = { ...list[idx], from: result.from, to: result.to };
    if (APPLY) {
      const oldRef = db.doc(entry.path);
      const newDocId = `${entry.id}_${result.from}_${result.to}`;
      const newRef = db.collection('filialen').doc(fbSlug(entry.filiale)).collection('urlaub').doc(newDocId);
      await db.runTransaction(async (tx) => {
        tx.delete(oldRef);
        tx.set(newRef, {
          empId: entry.id, name: entry.name, filiale: entry.filiale, region: region || null,
          from: result.from, to: result.to, status: 'approved',
          created: new Date().toISOString(), decidedAt: new Date().toISOString(),
          source: 'hr', note: `Verschoben: ${grund} (Auftrag t.duong 05.09.2026)`,
        });
      });
      list[idx].path = newRef.path;
    }
    return true;
  }

  // Ein Konflikt nach dem anderen, mit SOFORT neu berechnetem Konflikt-Status
  // danach (nicht die ganze zu Beginn gefundene Liste stur abarbeiten) - sonst
  // verweisen spaetere Eintraege in derselben Liste noch auf laengst
  // verschobene alte Positionen (Auftrag t.duong 05.09.2026, beim ersten
  // Testlauf live als doppelte/stale Verschiebung aufgefallen).
  let runde = 0;
  const versagt = new Set(); // Pfade, fuer die schon "kein freier Platz" galt - nicht erneut versuchen
  while (runde < 200) {
    const conflicts = findConflicts().filter((c) => {
      const aHr = c.a.source === 'hr' && !versagt.has(c.a.path);
      const bHr = c.b.source === 'hr' && !versagt.has(c.b.path);
      return aHr || bHr;
    });
    if (!conflicts.length) break;
    const c = conflicts[0];
    const aMovable = c.a.source === 'hr' && !versagt.has(c.a.path);
    const bMovable = c.b.source === 'hr' && !versagt.has(c.b.path);
    let mover;
    if (aMovable && bMovable) mover = dayCount(c.a.from, c.a.to) <= dayCount(c.b.from, c.b.to) ? c.a : c.b;
    else mover = aMovable ? c.a : c.b;
    const partner = mover === c.a ? c.b : c.a;
    const ok = await moveEntry(mover, `Überschneidung mit ${partner.name} (${partner.source})`);
    if (!ok) versagt.add(mover.path);
    runde++;
  }

  const rest = findConflicts();
  console.log(`\n${runde} Verschiebung(en) versucht.`);
  console.log(`${rest.length} verbleibende(r) Konflikt(e) - manuelle Entscheidung noetig:`);
  rest.forEach((c) => {
    const aStuck = c.a.source === 'hr' && versagt.has(c.a.path);
    const bStuck = c.b.source === 'hr' && versagt.has(c.b.path);
    const tag = aStuck || bStuck ? ' [KEIN FREIER PLATZ FUER hr-SEITE GEFUNDEN]' : '';
    console.log(`   ${c.a.name} ${c.a.from}-${c.a.to} (${c.a.source}) vs ${c.b.name} ${c.b.from}-${c.b.to} (${c.b.source})${tag}`);
  });
  if (!APPLY) console.log('\n(Vorschau - mit --apply erneut aufrufen zum Schreiben.)');
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
