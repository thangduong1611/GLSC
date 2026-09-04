// Einmaliges Korrekturskript: Herr Ta, Eric (350527) hat eine bestehende
// genehmigte Urlaubsbuchung (05.10.-18.10.2026), die sich mit ZWEI Kollegen im
// selben Filial-Pool überschneidet (Dinh Chien Nguyen 17.-26.10., My Linh
// Heidel 17.-19.10.). Auftrag t.duong 04.09.2026: eine der sich
// überschneidenden Buchungen entfernen und auf ein anderes, freies Datum
// verschieben. Da Erics Buchung der gemeinsame Berührungspunkt beider
// Überschneidungen ist, wird SEINE Buchung verschoben (löst beide Konflikte
// in einem Schritt) - dieselbe Anzahl Tage (14), auf den nächsten freien
// Zeitraum ab heute+10 Tagen, unter Berücksichtigung der Feiertage (Tage
// zaehlen nicht als Urlaub, verlängern den Block stattdessen).
require('dotenv').config();
const { getDb } = require('./firestore-client');

const TRONG_ID = '550078';
const AUSGESCHLOSSEN = new Set(['550198']);
const START = new Date('2026-09-14T00:00:00');
const ENDE = new Date('2026-12-31T00:00:00');
const FEIERTAGE = new Set(['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26']);
const ERIC_ID = '350527';
const OLD_DOC_PATH = 'filialen/402185:_k-hagen-auf_dem_lölfert/urlaub/gcBqmP8E8pz7QCypVTut';

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function overlaps(aFrom, aTo, bFrom, bTo) { return aFrom <= bTo && bFrom <= aTo; }
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }

async function main() {
  const db = getDb();
  const empsSnap = await db.collection('emps').where('region', '==', 'west').where('active', '==', true).get();
  const people = [];
  empsSnap.forEach((d) => {
    if (AUSGESCHLOSSEN.has(d.id)) return;
    const v = d.data();
    people.push({ id: d.id, name: v.name, filiale: v.filiale, zweit: Array.isArray(v.zweit) ? v.zweit : [] });
  });
  const eric = people.find((p) => p.id === ERIC_ID);
  console.log('Eric Ta:', eric.name, eric.filiale, 'zweit:', eric.zweit);

  // Pools bauen (ohne Trong)
  const pools = {};
  people.forEach((p) => {
    if (p.id === TRONG_ID) return;
    [p.filiale, ...p.zweit].filter(Boolean).forEach((b) => { (pools[b] = pools[b] || new Set()).add(p.id); });
  });
  const ericBranches = [eric.filiale, ...eric.zweit];
  const neighborIds = new Set();
  ericBranches.forEach((b) => { (pools[b] || new Set()).forEach((id) => { if (id !== ERIC_ID) neighborIds.add(id); }); });
  console.log('Erics Pool-Nachbarn:', Array.from(neighborIds));

  // Alle aktuellen Buchungen laden (fuer Eric selbst UND alle Nachbarn), OHNE die alte Eric-Buchung
  const westIds = new Set(people.map((p) => p.id));
  const urlaubSnap = await db.collectionGroup('urlaub').get();
  const occupied = {}; // id -> [{from,to}]
  westIds.forEach((id) => { occupied[id] = []; });
  let oldEricDoc = null;
  urlaubSnap.forEach((d) => {
    const v = d.data();
    if (!westIds.has(v.empId)) return;
    if (v.status === 'rejected') return;
    if (v.to < '2026-01-01') return;
    if (d.ref.path === OLD_DOC_PATH) { oldEricDoc = { path: d.ref.path, data: v }; return; } // die zu verschiebende Buchung ausklammern
    (occupied[v.empId] = occupied[v.empId] || []).push({ from: v.from, to: v.to });
  });
  if (!oldEricDoc) { console.error('FEHLER: alte Eric-Buchung nicht gefunden unter', OLD_DOC_PATH); process.exit(1); }
  console.log('Alte Buchung:', oldEricDoc.data.from, '-', oldEricDoc.data.to);

  function isFree(fromIso, toIso) {
    if ((occupied[ERIC_ID] || []).some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    for (const nb of neighborIds) {
      if ((occupied[nb] || []).some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    }
    return true;
  }
  function endForChargedDays(start, len) {
    let end = new Date(start);
    let counted = 0;
    while (counted < len) {
      if (!FEIERTAGE.has(iso(end))) counted++;
      if (counted < len) end = addDays(end, 1);
    }
    return end;
  }

  const LEN = 14; // gleiche Laenge wie die alte Buchung (05.10.-18.10. = 14 Tage)
  let cursor = new Date(START);
  let result = null;
  while (cursor <= ENDE) {
    const end = endForChargedDays(cursor, LEN);
    if (end > ENDE) break;
    const f = iso(cursor), t = iso(end);
    if (isFree(f, t)) { result = { from: f, to: t }; break; }
    cursor = addDays(cursor, 1);
  }
  if (!result) { console.error('Kein freier 14-Tage-Zeitraum gefunden.'); process.exit(1); }
  console.log('Neuer Zeitraum fuer Eric Ta:', result.from, '-', result.to);

  // Alte Buchung loeschen, neue anlegen (deterministische Doc-ID)
  const newDocId = `${ERIC_ID}_${result.from}_${result.to}`;
  const newDoc = {
    empId: ERIC_ID, name: eric.name, filiale: eric.filiale,
    from: result.from, to: result.to, status: 'approved',
    created: new Date().toISOString(), decidedAt: new Date().toISOString(),
    source: 'hr', note: 'Verschoben wegen Überschneidung mit Dinh Chien Nguyen / My Linh Heidel (Auftrag t.duong 04.09.2026)',
  };
  const oldRef = db.doc(OLD_DOC_PATH);
  const newRef = db.collection('filialen').doc(fbSlug(eric.filiale)).collection('urlaub').doc(newDocId);
  await db.runTransaction(async (tx) => {
    tx.delete(oldRef);
    tx.set(newRef, newDoc);
  });
  console.log(`\n✓ Verschoben: Eric Ta ${oldEricDoc.data.from}-${oldEricDoc.data.to} → ${result.from}-${result.to}`);
  console.log(`  Alter Doc gelöscht: ${OLD_DOC_PATH}`);
  console.log(`  Neuer Doc: filialen/${fbSlug(eric.filiale)}/urlaub/${newDocId}`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
