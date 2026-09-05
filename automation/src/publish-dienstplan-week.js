// Veroeffentlicht den in dienstplan_woche_vorschlag.json berechneten
// Wochen-Dienstplan (Auftrag t.duong 05.09.2026, vom Nutzer nach Pruefung der
// Excel-Vorschau freigegeben) in die echten plan/{filiale}__{yyyy-mm}-
// Dokumente, die die Mitarbeiter-App live anzeigt.
//
// Wichtig: ein plan-Dokument deckt den GANZEN Monat einer Filiale ab und
// enthaelt bereits andere Wochen/Mitarbeiter - deshalb wird bestehendes NICHT
// ueberschrieben:
// - employees: bestehende Liste wird geladen, neue Personen werden nur
//   HINZUGEFUEGT (keine Duplikate, kein Verlust bestehender Eintraege).
// - shifts: nur die 6 Zieldaten (Mo-Sa der Zielwoche) je betroffenem
//   Mitarbeiter werden per set(...,{merge:true}) geschrieben - Firestore
//   merged verschachtelte Maps rekursiv, andere Tage/Mitarbeiter in shifts
//   bleiben unangetastet.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const DATA_PATH = path.join(__dirname, '..', 'output', 'dienstplan_woche_vorschlag.json');
const MONAT = '2026-09';
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function dpEmpKey(e) { return (e.id || 'x') + '-' + e.name; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

async function main() {
  const db = getDb();
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const wocheStart = new Date(data.wocheStart + 'T00:00:00');
  const dates = TAGE.map((_, i) => iso(addDays(wocheStart, i)));

  const byFiliale = {};
  data.ergebnisse.forEach((e) => { (byFiliale[e.filiale] = byFiliale[e.filiale] || []).push(e); });

  let filialenCount = 0, mitarbeiterCount = 0;
  for (const [filiale, mitarbeiter] of Object.entries(byFiliale)) {
    const docId = `${fbSlug(filiale)}__${MONAT}`;
    const ref = db.collection('plan').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : { employees: [], shifts: {} };
    const existingEmployees = Array.isArray(existing.employees) ? existing.employees : [];
    const byId = {}; existingEmployees.forEach((e) => { byId[e.id] = e; });

    const shiftsPatch = {};
    mitarbeiter.forEach((m) => {
      if (!byId[m.id]) byId[m.id] = { id: m.id, name: m.name };
      const ek = dpEmpKey({ id: m.id, name: byId[m.id].name });
      const perDate = {};
      TAGE.forEach((t, i) => { perDate[dates[i]] = m.tage[t]; });
      shiftsPatch[ek] = perDate;
      mitarbeiterCount++;
    });

    await ref.set({ employees: Object.values(byId), shifts: shiftsPatch }, { merge: true });
    filialenCount++;
    console.log(`✓ ${filiale} (${docId}): ${mitarbeiter.length} Mitarbeiter geschrieben`);
  }

  console.log(`\n✓ Fertig: ${mitarbeiterCount} Mitarbeiter in ${filialenCount} Filialen fuer die Woche ${data.wocheStart} veroeffentlicht.`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
