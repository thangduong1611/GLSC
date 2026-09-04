// Einmaliges Ergänzungsskript (kein Cron-Job): trägt für die 2 West-Filialen
// mit nur 1 Stammkraft eine Vertretung (Herr Nguyen, Trong) in den
// Dienstplan (Firestore "plan") ein, für genau die Tage, an denen die
// Stammkraft laut genehmigtem Urlaub fehlt. Analog zu
// add-urlaub-coverage.js (Ost), Auftrag t.duong 04.09.2026.
//
// Zuordnung (aus plan-urlaub-west.js "vertretung"-Array):
// - R-Düsseldorf-Münsterstraße (Frau Ngo, Thi Tu): 03.-15.10. und 27.10.-06.11.
// - E-Bergheim-Fischenich (Frau Trinh, Thi Dieu Quynh): 14.-19.09.
// Uhrzeiten: die Schicht der ABWESENDEN Stammkraft (aus
// dienstplan_vorschlag.csv, wochentagsbasiert) wird für Trong übernommen —
// bildet den tatsächlichen Personalbedarf der Filiale ab. Feiertage (NRW)
// werden ausgelassen (03.10. faellt in Fenster 1, 01.11. in Fenster 2).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function dpEmpKey(id, name) { return (id || 'x') + '-' + name; }
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(';');
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}
const WOCHENTAG_SPALTEN = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const FEIERTAGE_NRW = new Set(['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26']);
const TRONG_ID = '550078';
const TRONG_NAME = 'Trong Nguyen';

const AUFGABEN = [
  {
    filiale: '402272: R-Düsseldorf-Münsterstraße',
    absentId: '350553', // Thi Tu Ngo
    segments: [
      { from: '2026-10-03', to: '2026-10-15' },
      { from: '2026-10-27', to: '2026-11-06' },
    ],
  },
  {
    filiale: '402414: E-Bergheim-Dansweilerstraße - Fischenich',
    absentId: '330485', // Thi Dieu Quynh Trinh
    segments: [{ from: '2026-09-14', to: '2026-09-19' }],
  },
];

async function main() {
  const db = getDb();
  const csvPath = path.join(__dirname, '..', 'output', 'dienstplan_vorschlag.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const rowById = {};
  rows.forEach((r) => { rowById[r.PersonalNr] = r; });

  // Vorher: alle zuvor eingetragenen Trong-Vertretungszellen in beiden
  // Ziel-Filialen entfernen (falls sich Daten durch einen erneuten Lauf von
  // plan-urlaub-west.js verschoben haben).
  const alleMonate = ['2026-09', '2026-10', '2026-11', '2026-12'];
  for (const aufgabe of AUFGABEN) {
    for (const ym of alleMonate) {
      const docRef = db.collection('plan').doc(fbSlug(aufgabe.filiale) + '__' + ym);
      const snap = await docRef.get();
      if (!snap.exists) continue;
      const existing = snap.data() || {};
      const employees = Array.isArray(existing.employees) ? existing.employees : [];
      const shifts = Object.assign({}, existing.shifts || {});
      let changed = false;
      employees.forEach((e) => {
        if ('' + (e.id || '') !== TRONG_ID) return;
        const key = dpEmpKey(e.id, e.name);
        if (shifts[key] && Object.keys(shifts[key]).length) { shifts[key] = {}; changed = true; }
      });
      if (changed) {
        await docRef.set({ employees, shifts });
        console.log(`  🧹 ${aufgabe.filiale} / ${ym}: alte Trong-Zellen entfernt.`);
      }
    }
  }

  let totalCells = 0;
  for (const aufgabe of AUFGABEN) {
    const absentRow = rowById[aufgabe.absentId];
    if (!absentRow) { console.warn('  ⚠ Keine Vorschlagsdaten fuer', aufgabe.absentId, '- ueberspringe', aufgabe.filiale); continue; }

    const monate = new Set();
    aufgabe.segments.forEach((s) => {
      let d = new Date(s.from + 'T00:00:00');
      const end = new Date(s.to + 'T00:00:00');
      while (d <= end) { monate.add(iso(d).slice(0, 7)); d.setDate(d.getDate() + 1); }
    });

    for (const ym of monate) {
      const docRef = db.collection('plan').doc(fbSlug(aufgabe.filiale) + '__' + ym);
      const snap = await docRef.get();
      const existing = snap.exists ? (snap.data() || {}) : {};
      const employees = Array.isArray(existing.employees) ? existing.employees.slice() : [];
      const shifts = {};
      Object.keys(existing.shifts || {}).forEach((k) => { shifts[k] = Object.assign({}, existing.shifts[k]); });
      const empIdToKey = {};
      employees.forEach((e) => { empIdToKey['' + (e.id || '')] = dpEmpKey(e.id, e.name); });

      let key = empIdToKey[TRONG_ID];
      if (!key) {
        employees.push({ id: TRONG_ID, name: TRONG_NAME });
        key = dpEmpKey(TRONG_ID, TRONG_NAME);
        empIdToKey[TRONG_ID] = key;
      }
      if (!shifts[key]) shifts[key] = {};

      let cellsHere = 0;
      for (const seg of aufgabe.segments) {
        let cursor = new Date(seg.from + 'T00:00:00');
        const end = new Date(seg.to + 'T00:00:00');
        while (cursor <= end) {
          const dIso = iso(cursor);
          if (dIso.slice(0, 7) === ym) {
            const dow = cursor.getDay();
            if (dow !== 0 && !FEIERTAGE_NRW.has(dIso)) {
              const tag = WOCHENTAG_SPALTEN[dow];
              const zeit = (absentRow[tag] || '').trim();
              if (zeit && !shifts[key][dIso]) {
                shifts[key][dIso] = zeit;
                cellsHere++;
              }
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      if (cellsHere > 0) {
        await docRef.set({ employees, shifts });
        totalCells += cellsHere;
        console.log(`  ✓ ${aufgabe.filiale} / ${ym}: ${cellsHere} Vertretungs-Zellen geschrieben.`);
      }
    }
  }

  console.log(`\n✓ Fertig: ${totalCells} Vertretungs-Schichtzellen insgesamt eingetragen.`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
