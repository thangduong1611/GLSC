// Fuer die "hr"-Buchungen, die resolve-urlaub-conflicts-welo-import.js keinen
// wirklich freien Platz finden konnte: trotzdem den bestmoeglichen Termin
// vorschlagen (Auftrag t.duong 05.09.2026 "van co goi y nhung dong thoi ghi
// la dang trung voi ai") - naemlich den mit den WENIGSTEN verbleibenden
// Ueberschneidungen, damit der Nutzer gezielt genau diese Person anrufen
// kann. Schreibt NICHTS, reine Vorschau/Report.
require('dotenv').config();
const { getDb } = require('./firestore-client');

const TRONG_ID = '550078', KHANG_ID = '550152';
const START = new Date('2026-09-14T00:00:00');
const ENDE = new Date('2026-12-31T00:00:00');
const WEST_FEIERTAGE = new Set(['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26']);

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function overlaps(a1, a2, b1, b2) { return a1 <= b2 && b1 <= a2; }
function dayCount(f, t) { return Math.round((new Date(t) - new Date(f)) / 86400000) + 1; }
function isBad(dateIso, feiertage) { const d = new Date(dateIso + 'T00:00:00'); return d.getDay() === 0 || feiertage.has(dateIso); }
function endForChargedDays(start, len, feiertage) {
  let end = new Date(start), counted = 0;
  while (counted < len) {
    if (end.getDay() !== 0 && !feiertage.has(iso(end))) counted++;
    if (counted < len) end = addDays(end, 1);
  }
  return end;
}

const STUCK = [
  { id: '340473', name: 'My Linh Heidel', from: '2026-10-01', to: '2026-10-05' },
  { id: '341450', name: 'Paramita Dian Purnomo', from: '2026-10-20', to: '2026-10-28' },
  { id: '341475', name: 'Thi Thu Vi', from: '2026-07-25', to: '2026-08-15' },
];

async function main() {
  const db = getDb();
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
  const docsByEmp = {};
  urlSnap.forEach((d) => {
    const v = d.data();
    if (v.status === 'rejected') return;
    if (v.to < '2026-01-01') return;
    (docsByEmp[v.empId] = docsByEmp[v.empId] || []).push({ path: d.ref.path, from: v.from, to: v.to, source: v.source || 'self', name: v.name });
  });

  for (const s of STUCK) {
    const e = emps[s.id];
    console.log(`\n${s.name} (${s.id}) — aktuell ${s.from} bis ${s.to}, ${e ? e.filiale : '?'}`);
    if (!e) { console.log('  kein emps-Dokument gefunden.'); continue; }
    const feiertage = WEST_FEIERTAGE; // alle 3 Faelle sind West
    const len = dayCount(s.from, s.to);
    let best = null;
    let cursor = new Date(START);
    while (cursor <= ENDE) {
      if (isBad(iso(cursor), feiertage)) { cursor = addDays(cursor, 1); continue; }
      const end = endForChargedDays(cursor, len, feiertage);
      if (end > ENDE) break;
      const f = iso(cursor), t = iso(end);
      const konflikte = [];
      neighbors[s.id].forEach((nb) => {
        (docsByEmp[nb] || []).forEach((iv) => { if (overlaps(f, t, iv.from, iv.to)) konflikte.push({ name: emps[nb] ? emps[nb].name : nb, from: iv.from, to: iv.to, source: iv.source }); });
      });
      if (!best || konflikte.length < best.konflikte.length) {
        best = { from: f, to: t, konflikte };
        if (konflikte.length === 0) break;
      }
      cursor = addDays(cursor, 1);
    }
    if (!best) { console.log('  Kein Vorschlag im Zeitraum möglich.'); continue; }
    console.log(`  Vorschlag: ${best.from} bis ${best.to}`);
    if (!best.konflikte.length) console.log('  -> vollständig frei, keine Überschneidung mehr.');
    else best.konflikte.forEach((k) => console.log(`  -> überschneidet sich weiterhin mit: ${k.name} (${k.from} - ${k.to}, ${k.source})`));
  }
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
