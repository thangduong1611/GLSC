// Einmaliges Korrekturskript (Auftrag t.duong 04.09.2026): nach der genaueren
// Zweitfiliale-Zuordnung (echte Wohnadresse statt Filial-Schaetzung) fuer die
// 8 Mitarbeiter der 5 neuen West-Filialen (Bergneustadt/Bergisch Gladbach/
// Köln/Neuss-Allerheiligen/Bergheim) gab es 10 Ueberschneidungen zwischen dem
// automatischen Urlaubsplan (source:'hr') und teils bereits selbst
// eingereichten Antraegen. Regel (Auftrag t.duong): Mitarbeiter, die sich
// SELBST einen Urlaub eingetragen haben, haben Vorrang - nur automatisch
// erzeugte (source:'hr') Buchungen werden verschoben, nie eine
// Selbst-Buchung. Bei zwei sich ueberschneidenden hr-Buchungen wird die
// KUERZERE verschoben (kleinerer Eingriff).
//
// Verschoben werden (gleiche Blocklaenge, naechster freier Zeitraum im
// jeweiligen Filial-Pool, gleiche Logik wie fix-eric-ta-overlap.js):
//   1. Archna Dhusia Sharma (340370)  1 Tag   Bergisch Gladbach-Pool
//   2. Muhammad Yasir Amjad (341384) 11 Tage  Bergisch Gladbach/Köln-Pool
//   3. Thi Dieu Quynh Trinh (330485)  6 Tage  Leverkusen-Pool
//   4. Duc Hanh Doan (340429)         1 Tag   Essen-Haedenkampstraße-Pool
//   5. Eric Ta (350527)              14 Tage  Hagen-Pool (2. Verschiebung)
require('dotenv').config();
const { getDb } = require('./firestore-client');

const TRONG_ID = '550078';
const AUSGESCHLOSSEN = new Set(['550198']); // Gebietsleiter, kein Filial-Pool
const START = new Date('2026-09-14T00:00:00');
const ENDE = new Date('2026-12-31T00:00:00');
const FEIERTAGE = new Set(['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26']);

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function overlaps(aFrom, aTo, bFrom, bTo) { return aFrom <= bTo && bFrom <= aTo; }
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function endForChargedDays(start, len) {
  let end = new Date(start);
  let counted = 0;
  while (counted < len) {
    if (end.getDay() !== 0 && !FEIERTAGE.has(iso(end))) counted++;
    if (counted < len) end = addDays(end, 1);
  }
  return end;
}

const ZU_VERSCHIEBEN = [
  { id: '340370', len: 1, from: '2026-09-14', to: '2026-09-14', grund: 'Überschneidung mit Muhammad Yasir Amjad / Sumi Park (beide bereits eingeteilt)' },
  { id: '341384', len: 11, from: '2026-09-14', to: '2026-09-24', grund: 'Überschneidung mit Sumi Park' },
  { id: '330485', len: 6, from: '2026-09-14', to: '2026-09-19', grund: 'Überschneidung mit selbst eingereichtem Antrag von Panadda Frunzescu' },
  { id: '340429', len: 1, from: '2026-09-14', to: '2026-09-14', grund: 'Überschneidung mit Thi Hoan Tran' },
  { id: '350527', len: 14, from: '2026-12-03', to: '2026-12-16', grund: 'Überschneidung mit selbst eingereichtem Antrag von My Linh Heidel' },
];

async function main() {
  const db = getDb();
  const empsSnap = await db.collection('emps').where('region', '==', 'west').where('active', '==', true).get();
  const people = {};
  empsSnap.forEach((d) => {
    if (AUSGESCHLOSSEN.has(d.id)) return;
    const v = d.data();
    people[d.id] = { id: d.id, name: v.name, filiale: v.filiale, zweit: Array.isArray(v.zweit) ? v.zweit : [] };
  });

  const pools = {};
  Object.values(people).forEach((p) => {
    if (p.id === TRONG_ID) return;
    [p.filiale, ...p.zweit].filter(Boolean).forEach((b) => { (pools[b] = pools[b] || new Set()).add(p.id); });
  });

  const urlaubSnap = await db.collectionGroup('urlaub').get();
  const occupied = {}; // id -> [{from,to}]
  const docsByEmp = {}; // id -> [{path, data}]
  Object.keys(people).forEach((id) => { occupied[id] = []; docsByEmp[id] = []; });
  urlaubSnap.forEach((d) => {
    const v = d.data();
    if (!people[v.empId]) return;
    if (v.status === 'rejected') return;
    if (v.to < '2026-01-01') return;
    occupied[v.empId].push({ from: v.from, to: v.to });
    docsByEmp[v.empId].push({ path: d.ref.path, data: v });
  });

  for (const auftrag of ZU_VERSCHIEBEN) {
    const p = people[auftrag.id];
    const branches = [p.filiale, ...p.zweit];
    const neighborIds = new Set();
    branches.forEach((b) => { (pools[b] || new Set()).forEach((id) => { if (id !== p.id) neighborIds.add(id); }); });

    const oldDoc = docsByEmp[p.id].find((d) => d.data.from === auftrag.from && d.data.to === auftrag.to);
    if (!oldDoc) { console.error(`FEHLER: Buchung ${auftrag.from}-${auftrag.to} fuer ${p.name} (${p.id}) nicht gefunden.`); continue; }

    // Alte Buchung aus dem eigenen "occupied" ausklammern, bevor gesucht wird
    occupied[p.id] = occupied[p.id].filter((iv) => !(iv.from === auftrag.from && iv.to === auftrag.to));

    function isFree(fromIso, toIso) {
      if (occupied[p.id].some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
      for (const nb of neighborIds) {
        if ((occupied[nb] || []).some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
      }
      return true;
    }

    let cursor = new Date(START);
    let result = null;
    while (cursor <= ENDE) {
      const end = endForChargedDays(cursor, auftrag.len);
      if (end > ENDE) break;
      const f = iso(cursor), t = iso(end);
      if (isFree(f, t)) { result = { from: f, to: t }; break; }
      cursor = addDays(cursor, 1);
    }
    if (!result) { console.error(`FEHLER: kein freier ${auftrag.len}-Tage-Zeitraum fuer ${p.name} gefunden.`); continue; }

    const newDocId = `${p.id}_${result.from}_${result.to}`;
    const newDoc = {
      empId: p.id, name: p.name, filiale: p.filiale, region: 'west',
      from: result.from, to: result.to, status: 'approved',
      created: new Date().toISOString(), decidedAt: new Date().toISOString(),
      source: 'hr', note: `Verschoben: ${auftrag.grund} (Auftrag t.duong 04.09.2026)`,
    };
    const oldRef = db.doc(oldDoc.path);
    const newRef = db.collection('filialen').doc(fbSlug(p.filiale)).collection('urlaub').doc(newDocId);
    await db.runTransaction(async (tx) => {
      tx.delete(oldRef);
      tx.set(newRef, newDoc);
    });

    // occupied-Zustand fuer nachfolgende Iterationen aktualisieren
    occupied[p.id].push({ from: result.from, to: result.to });
    docsByEmp[p.id] = docsByEmp[p.id].filter((d) => d.path !== oldDoc.path);
    docsByEmp[p.id].push({ path: newRef.path, data: newDoc });

    console.log(`✓ ${p.name}: ${auftrag.from}-${auftrag.to} → ${result.from}-${result.to}`);
  }
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
