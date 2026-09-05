// Erweitert den fuer die Woche 21.-27.09.2026 genehmigten Dienstplan-Vorschlag
// (dienstplan_woche_vorschlag.json, siehe build-dienstplan-week.js) auf ALLE
// Wochen von September bis Ende Dezember 2026 (Auftrag t.duong 05.09.2026:
// "lich lam cung dang luon ... khong phai ca nam ma chi la tu thang 9 den het
// thang 12", danach passt der Nutzer einzelne Wochen selbst manuell an).
//
// Dasselbe Wochentags-Muster (Mo-Sa Schichtzeiten je Mitarbeiter) wird fuer
// jede Woche wiederholt, MIT EINER Ausnahme: an den 3 NRW-Feiertagen, die auf
// einen Mo-Sa fallen (03.10. Sa, 25.12. Fr, 26.12. Sa - 01.11. ist ein
// Sonntag und taucht im Mo-Sa-Raster ohnehin nie auf), wird "Frei"
// geschrieben statt der Schichtzeit. Sonst wuerde dpAutofillFeiertage() das
// NICHT automatisch korrigieren, weil diese Funktion nur LEERE Zellen mit
// "Frei" vorbelegt, keine bereits befuellten (siehe index.html).
//
// Genehmigter Urlaub wird bewusst NICHT ausgespart: die App ueberlagert die
// rohe Schicht-Zelle beim Anzeigen sowieso automatisch mit 🌴/🏥, sobald ein
// genehmigter Urlaub/Krank-Eintrag fuer den Tag existiert (dpAbs in
// dpRenderWeeks) - das rohe Zeitfenster darunter bleibt also folgenlos.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const DATA_PATH = path.join(__dirname, '..', 'output', 'dienstplan_woche_vorschlag.json');
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const FEIERTAGE = new Set(['2026-10-03', '2026-12-25', '2026-12-26']);
const ENDE = new Date('2026-12-31T00:00:00');

function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function dpEmpKey(e) { return (e.id || 'x') + '-' + e.name; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function alleWochenMontage(start, ende) {
  const out = [];
  let m = new Date(start);
  while (m <= ende) { out.push(new Date(m)); m = addDays(m, 7); }
  return out;
}

async function main() {
  const db = getDb();
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const montage = alleWochenMontage(new Date(data.wocheStart + 'T00:00:00'), ENDE);
  console.log(`${montage.length} Wochen (${iso(montage[0])} bis ${iso(montage[montage.length - 1])} + 5 Tage).`);

  // Fuer jede Filiale: {monat -> {empKey -> {datum: wert}}}
  const byFilialeMonat = {};
  data.ergebnisse.forEach((e) => {
    montage.forEach((montag) => {
      TAGE.forEach((tag, i) => {
        const datum = addDays(montag, i);
        if (datum > ENDE) return;
        const dIso = iso(datum);
        const monat = dIso.slice(0, 7);
        const wert = FEIERTAGE.has(dIso) ? 'Frei' : e.tage[tag];
        const key = `${e.filiale}||${monat}`;
        if (!byFilialeMonat[key]) byFilialeMonat[key] = { filiale: e.filiale, monat, shifts: {} };
        const ek = dpEmpKey({ id: e.id, name: e.name });
        if (!byFilialeMonat[key].shifts[ek]) byFilialeMonat[key].shifts[ek] = {};
        byFilialeMonat[key].shifts[ek][dIso] = wert;
      });
    });
  });

  let filialenCount = 0, tageCount = 0;
  for (const { filiale, monat, shifts } of Object.values(byFilialeMonat)) {
    const docId = `${fbSlug(filiale)}__${monat}`;
    const ref = db.collection('plan').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : { employees: [], shifts: {} };
    const existingEmployees = Array.isArray(existing.employees) ? existing.employees : [];
    const byId = {}; existingEmployees.forEach((e) => { byId[e.id] = e; });

    const shiftsPatch = {};
    Object.entries(shifts).forEach(([ek, perDate]) => {
      const id = ek.slice(0, ek.indexOf('-'));
      const name = ek.slice(ek.indexOf('-') + 1);
      if (!byId[id]) byId[id] = { id, name };
      const realEk = dpEmpKey(byId[id]); // benutzt den ggf. schon vorhandenen Namen im Dokument
      shiftsPatch[realEk] = perDate;
      tageCount += Object.keys(perDate).length;
    });

    await ref.set({ employees: Object.values(byId), shifts: shiftsPatch }, { merge: true });
    filialenCount++;
    console.log(`✓ ${docId}: ${Object.keys(shiftsPatch).length} Mitarbeiter aktualisiert`);
  }

  console.log(`\n✓ Fertig: ${filialenCount} Filial-Monats-Dokumente, ${tageCount} Tages-Zellen geschrieben.`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
