// Einmaliges Übernahmeskript (kein Cron-Job): trägt den bereits berechneten
// Dienstplan-Vorschlag (output/dienstplan_vorschlag.csv, siehe
// suggest-schedule.js) als echte Schichten in die Firestore-"plan"-Collection
// ein — dieselbe Collection, die index.html (dpPublishMonth/dpPublishWeek)
// nutzt. Auftrag t.duong 04.09.2026: "thêm luôn giờ làm đã gợi ý vào lịch từ
// tuần sau" — ab Montag 07.09.2026 bis 31.12.2026, für alle 71 Mitarbeiter
// (Ost + West).
//
// Regeln (aus dem bestehenden App-Verhalten übernommen, nicht neu erfunden):
// - Nur LEERE Zellen werden befüllt — vorhandene manuelle Einträge bleiben
//   unangetastet (dieselbe Regel wie dpAutofillFeiertage: "nur leere Zellen").
// - Sonntag existiert im Dienstplan-Raster gar nicht (dpGetWeeks liefert nur
//   Mo-Sa je Woche) — wird hier ebenso übersprungen.
// - Bundesweite Feiertage (Tag der Deutschen Einheit 03.10., 1./2.
//   Weihnachtstag 25./26.12.) werden ausgelassen (nicht beschrieben) — die
//   App füllt sie beim nächsten Öffnen des jeweiligen Filiale/Monats über
//   dpAutofillFeiertage() automatisch mit "Frei", das passiert nur bei
//   tatsächlich leeren Zellen.
// - Tage mit genehmigtem Urlaub (Status 'approved', beliebige Region) werden
//   nicht beschrieben — die App zeigt "🌴 Urlaub" ohnehin als Overlay
//   unabhängig vom gespeicherten Zellenwert (dpAbsenceFor()).
// - Mitarbeiter ohne verwertbares Muster für einen Wochentag (leerer Wert im
//   CSV) werden für diesen Tag ausgelassen.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const DRY_RUN = process.argv.includes('--dry-run');
const START = new Date('2026-09-07T00:00:00'); // Montag, "tuần sau" ab 04.09.2026
const ENDE = new Date('2026-12-31T00:00:00');
const MONATE = ['2026-09', '2026-10', '2026-11', '2026-12'];
const FEIERTAGE_BUNDESWEIT = new Set(['2026-10-03', '2026-12-25', '2026-12-26']);
const WOCHENTAG_SPALTEN = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; // Index = Date.getDay()

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function dpEmpKey(id, name) { return (id || 'x') + '-' + name; }
function overlaps(aFrom, aTo, bFrom, bTo) { return aFrom <= bTo && bFrom <= aTo; }

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

async function main() {
  const csvPath = path.join(__dirname, '..', 'output', 'dienstplan_vorschlag.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  console.log(`${rows.length} Mitarbeiter aus dienstplan_vorschlag.csv geladen.`);

  const byFiliale = {}; // filiale -> [{id,name,weekday:{Mo:'..',...}}]
  let ohneMuster = 0;
  rows.forEach((row) => {
    const weekday = {};
    let hatMuster = false;
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].forEach((tag) => {
      const val = (row[tag] || '').trim();
      weekday[tag] = val;
      if (val) hatMuster = true;
    });
    if (!hatMuster || !row.Filiale) { ohneMuster++; return; }
    (byFiliale[row.Filiale] = byFiliale[row.Filiale] || []).push({ id: row.PersonalNr, name: row.Name, weekday });
  });
  console.log(`  ${ohneMuster} Mitarbeiter ohne verwertbares Muster übersprungen.`);
  console.log(`  ${Object.keys(byFiliale).length} Filialen betroffen.`);

  const db = getDb();
  console.log('Lade bestehende Urlaubsbuchungen (alle Regionen) …');
  const urlaubSnap = await db.collectionGroup('urlaub').get();
  const urlaubByEmp = {}; // id -> [{from,to}]
  urlaubSnap.forEach((d) => {
    const v = d.data();
    if (v.status !== 'approved') return;
    if (v.to < iso(START)) return;
    (urlaubByEmp[v.empId] = urlaubByEmp[v.empId] || []).push({ from: v.from, to: v.to });
  });
  function isOnUrlaub(empId, dateIso) {
    return (urlaubByEmp[empId] || []).some((iv) => overlaps(dateIso, dateIso, iv.from, iv.to));
  }

  let totalCellsWritten = 0, totalDocsWritten = 0, totalDocsSkippedNoChange = 0;

  for (const filiale of Object.keys(byFiliale)) {
    const empsHere = byFiliale[filiale];
    for (const ym of MONATE) {
      const [y, m] = ym.split('-').map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      const rangeStart = monthStart > START ? monthStart : START;
      const rangeEnd = monthEnd < ENDE ? monthEnd : ENDE;
      if (rangeStart > rangeEnd) continue;

      const docRef = db.collection('plan').doc(fbSlug(filiale) + '__' + ym);
      const snap = await docRef.get();
      const existing = snap.exists ? (snap.data() || {}) : {};
      const employees = Array.isArray(existing.employees) ? existing.employees.slice() : [];
      const shifts = {};
      Object.keys(existing.shifts || {}).forEach((k) => { shifts[k] = Object.assign({}, existing.shifts[k]); });

      const empIdToKey = {};
      employees.forEach((e) => { empIdToKey['' + (e.id || '')] = dpEmpKey(e.id, e.name); });

      empsHere.forEach((csvEmp) => {
        let key = empIdToKey['' + csvEmp.id];
        if (!key) {
          employees.push({ id: csvEmp.id, name: csvEmp.name });
          key = dpEmpKey(csvEmp.id, csvEmp.name);
          empIdToKey['' + csvEmp.id] = key;
        }
        if (!shifts[key]) shifts[key] = {};
      });

      let cellsWrittenHere = 0;
      const cursor = new Date(rangeStart);
      while (cursor <= rangeEnd) {
        const dow = cursor.getDay();
        if (dow !== 0) { // Sonntag existiert im Raster nicht
          const dIso = iso(cursor);
          if (!FEIERTAGE_BUNDESWEIT.has(dIso)) {
            const tag = WOCHENTAG_SPALTEN[dow];
            empsHere.forEach((csvEmp) => {
              const suggested = csvEmp.weekday[tag];
              if (!suggested) return;
              if (isOnUrlaub(csvEmp.id, dIso)) return;
              const key = empIdToKey['' + csvEmp.id];
              if (shifts[key][dIso]) return; // bereits belegt -> nicht ueberschreiben
              shifts[key][dIso] = suggested;
              cellsWrittenHere++;
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      if (cellsWrittenHere > 0) {
        if (!DRY_RUN) await docRef.set({ employees, shifts });
        totalDocsWritten++;
        totalCellsWritten += cellsWrittenHere;
        console.log(`  ${DRY_RUN ? '(würde schreiben)' : '✓'} ${filiale} / ${ym}: ${cellsWrittenHere} Zellen.`);
      } else {
        totalDocsSkippedNoChange++;
      }
    }
  }

  console.log(`\n${DRY_RUN ? '(Nur Vorschau, NICHTS gespeichert.)' : '✓ Fertig:'} ${totalCellsWritten} Schicht-Zellen in ${totalDocsWritten} Filiale/Monat-Dokumenten ${DRY_RUN ? 'würden geschrieben' : 'geschrieben'}.`);
  console.log(`  ${totalDocsSkippedNoChange} Filiale/Monat-Kombinationen ohne Änderung (nichts zu ergänzen).`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
