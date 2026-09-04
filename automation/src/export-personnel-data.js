// Hilfsskript: exportiert Filialen (filialen_meta) + aktive Mitarbeiter (emps,
// gemergt mit emp_welo fuer Wohnadresse) nach output/branch_personnel_export.json
// — Rohdaten fuer build_personnel_excel.py.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

async function main() {
  const db = getDb();
  const [filSnap, empSnap, weloSnap] = await Promise.all([
    db.collection('filialen_meta').get(),
    db.collection('emps').where('active', '==', true).get(),
    db.collection('emp_welo').get(),
  ]);
  const filialen = [];
  filSnap.forEach((d) => filialen.push(d.data()));
  const weloById = {};
  weloSnap.forEach((d) => { weloById[d.id] = d.data(); });
  const emps = [];
  empSnap.forEach((d) => {
    const v = d.data();
    const w = weloById[d.id] || {};
    emps.push({ id: d.id, name: v.name, filiale: v.filiale, zweit: v.zweit || [], region: v.region || '', shopleiter: !!v.shopleiter, strasse: w.strasse || '', plz: w.plz || '', ort: w.ort || '' });
  });
  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'branch_personnel_export.json'), JSON.stringify({ filialen, emps }, null, 2));
  console.log(`Filialen: ${filialen.length} | Mitarbeiter: ${emps.length}`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
