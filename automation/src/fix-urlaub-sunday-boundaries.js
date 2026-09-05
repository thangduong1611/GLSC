// Einmaliges Korrekturskript (Auftrag t.duong 05.09.2026, Mitarbeiter-
// Beschwerde: "Urlaub wurde auf Sonntag gelegt"): plan-urlaub-west.js /
// plan-urlaub-ost.js / resolve-urlaub-conflicts-2026-09.js suchten einen
// freien Start-Kandidaten Tag fuer Tag, OHNE dabei Sonntag/Feiertag als
// gueltigen START- oder END-Kandidaten auszuschliessen. endForChargedDays()
// zaehlt Sonntage/Feiertage zwar korrekt nicht mit, aber wenn der
// SUCHCURSOR selbst auf einem Sonntag/Feiertag landete, wurde GENAU dieses
// Datum trotzdem als "from" gespeichert (bzw. in einem Fall als "to") -
// der Mitarbeiter sieht dann z.B. "20.09.2026 (Sonntag) - 25.09.2026", obwohl
// nur Mo-Fr tatsaechlich angerechnet wurden.
//
// Fix ist rein kosmetisch/Datenkorrektur, KEINE Bilanz-Aenderung: Sonntag/
// Feiertag wurden nie angerechnet, also aendert sich die Anzahl angerechneter
// Tage nicht, wenn man den Rand auf den naechsten/vorherigen echten
// Arbeitstag verschiebt.
require('dotenv').config();
const { getDb } = require('./firestore-client');

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
function isBad(dateIso, feiertage) { const d = new Date(dateIso + 'T00:00:00'); return d.getDay() === 0 || feiertage.has(dateIso); }
function nextWorkday(dateIso, feiertage) { let d = new Date(dateIso + 'T00:00:00'); do { d.setDate(d.getDate() + 1); } while (isBad(iso(d), feiertage)); return iso(d); }
function prevWorkday(dateIso, feiertage) { let d = new Date(dateIso + 'T00:00:00'); do { d.setDate(d.getDate() - 1); } while (isBad(iso(d), feiertage)); return iso(d); }

async function main() {
  const db = getDb();
  const APPLY = process.argv.includes('--apply');

  const empsSnap = await db.collection('emps').get();
  const empsById = {}; empsSnap.forEach((d) => { empsById[d.id] = d.data(); });

  const snap = await db.collectionGroup('urlaub').get();
  const toFix = [];
  snap.forEach((d) => {
    const v = d.data();
    if (v.to < '2026-09-01' || v.from > '2026-12-31') return;
    if (v.status === 'rejected') return;
    const e = empsById[v.empId];
    const feiertage = v.region === 'ost' ? ostFeiertage(e && e.filialeNr) : WEST_FEIERTAGE;
    const badFrom = isBad(v.from, feiertage), badTo = isBad(v.to, feiertage);
    if (!badFrom && !badTo) return;
    const neuFrom = badFrom ? nextWorkday(v.from, feiertage) : v.from;
    const neuTo = badTo ? prevWorkday(v.to, feiertage) : v.to;
    toFix.push({ path: d.ref.path, name: v.name, altFrom: v.from, altTo: v.to, neuFrom, neuTo });
  });

  console.log(`${toFix.length} Eintraege mit Sonntag/Feiertag am Rand gefunden.`);
  toFix.forEach((f) => console.log(`  ${f.name}: ${f.altFrom} - ${f.altTo}  ->  ${f.neuFrom} - ${f.neuTo}`));

  if (!APPLY) { console.log('\n(Nur Vorschau. Mit --apply erneut aufrufen zum Schreiben.)'); process.exit(0); }

  for (const f of toFix) {
    await db.doc(f.path).update({ from: f.neuFrom, to: f.neuTo });
  }
  console.log(`\n✓ ${toFix.length} Eintraege korrigiert.`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
