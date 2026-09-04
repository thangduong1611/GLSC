// Einmaliges Ergänzungsskript (kein Cron-Job): trägt für die 3 Ost-Filialen
// mit nur 1 Stammkraft eine Vertretung in den Dienstplan (Firestore "plan")
// ein, für genau die Tage, an denen die Stammkraft laut genehmigtem Urlaub
// fehlt. Auftrag t.duong 04.09.2026: "trong lịch làm của những tiệm 1
// người, chưa có ai để thay thế, hãy thêm cả tên nhân viên cơ sở khác đến
// làm giúp hoặc springer đến".
//
// Zuordnung (2. Fassung, nach Sonntag-Korrektur neu berechnet — die
// Urlaubs-Zeiträume haben sich dadurch verschoben; siehe Konversation):
// - T-Bad Hersfeld (14.09.-09.10., durchgehend): Herr Kieu, Van Khang
//   (Springer), komplett frei in diesem Zeitraum, keine Aufteilung nötig.
// - R-Kirchheim (24.09.-02.10.): Frau Roth, Diem Thi Thanh (Baunatal, in
//   diesem Zeitraum komplett frei) — Khang ist zeitgleich in Bad Hersfeld.
// - E-Bovenden (23.-29.09. UND 09.-15.10., zwei getrennte Lücken): Frau
//   Nguyen, Thi Lan Anh hat Bovenden bereits als Zweitfiliale eingetragen
//   und ist in beiden Zeiträumen frei.
//
// Vor dem Schreiben werden zuerst ALLE zuvor von diesem Skript eingetragenen
// Helfer-Zellen (alte, jetzt falsche Daten) in den 3 Ziel-Filialen entfernt.
//
// Uhrzeiten: die Schicht der ABWESENDEN Stammkraft (aus
// dienstplan_vorschlag.csv, wochentagsbasiert) wird für die Vertretung
// übernommen — das bildet den tatsächlichen Personalbedarf der Filiale ab,
// nicht das Muster der vertretenden Person. Feiertage (Bundesland-abhängig)
// werden ausgelassen.
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
const FEIERTAGE_HE = new Set(['2026-10-03', '2026-12-25', '2026-12-26']);
const FEIERTAGE_NI = new Set(['2026-10-03', '2026-10-31', '2026-12-25', '2026-12-26']);

// { filiale, absentPersonalNr (fuer die Uhrzeiten), feiertage, segments: [{from,to,helperId,helperName}] }
const AUFGABEN = [
  {
    filiale: '402254: R-Kirchheim-Industriestraße - Messerschmidt',
    absentId: '341495',
    feiertage: FEIERTAGE_HE,
    segments: [{ from: '2026-09-24', to: '2026-10-02', helperId: '370116', helperName: 'Diem Thi Thanh Roth' }],
  },
  {
    filiale: '402146: T-Bad Hersfeld-Heinrich-von-Stephan-Straße',
    absentId: '410001',
    feiertage: FEIERTAGE_HE,
    segments: [{ from: '2026-09-14', to: '2026-10-09', helperId: '550152', helperName: 'Van Khang Kieu' }],
  },
  {
    filiale: '402207: E-Bovenden-Industriestraße',
    absentId: '330697',
    feiertage: FEIERTAGE_NI,
    segments: [
      { from: '2026-09-23', to: '2026-09-29', helperId: '350561', helperName: 'Thi Lan Anh Nguyen' },
      { from: '2026-10-09', to: '2026-10-15', helperId: '350561', helperName: 'Thi Lan Anh Nguyen' },
    ],
  },
];

async function main() {
  const db = getDb();
  const csvPath = path.join(__dirname, '..', 'output', 'dienstplan_vorschlag.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const rowById = {};
  rows.forEach((r) => { rowById[r.PersonalNr] = r; });

  // ---- Zuerst alle vorher eingetragenen Helfer-Zellen entfernen (alte,
  // durch die Sonntag-Korrektur jetzt falsche Daten) ----
  // WICHTIG: nicht nur die AKTUELLEN Helfer dieser Aufgabe bereinigen,
  // sondern alle jemals in einem frueheren Lauf moeglichen Helfer (sonst
  // bleiben Zellen einer inzwischen ge?nderten Zuordnung als Karteileiche
  // stehen - z.B. Diem war vorher fuer Bad Hersfeld eingetragen, jetzt nur
  // noch Khang).
  const ALLE_MOEGLICHEN_HELFER = new Set(['550152', '370116', '350561']);
  const alleMonate = ['2026-09', '2026-10', '2026-11', '2026-12'];
  for (const aufgabe of AUFGABEN) {
    const helperIds = ALLE_MOEGLICHEN_HELFER;
    for (const ym of alleMonate) {
      const docRef = db.collection('plan').doc(fbSlug(aufgabe.filiale) + '__' + ym);
      const snap = await docRef.get();
      if (!snap.exists) continue;
      const existing = snap.data() || {};
      const employees = Array.isArray(existing.employees) ? existing.employees : [];
      const shifts = Object.assign({}, existing.shifts || {});
      let changed = false;
      employees.forEach((e) => {
        if (!helperIds.has('' + (e.id || ''))) return;
        const key = dpEmpKey(e.id, e.name);
        if (shifts[key] && Object.keys(shifts[key]).length) { shifts[key] = {}; changed = true; }
      });
      if (changed) {
        await docRef.set({ employees, shifts });
        console.log(`  🧹 ${aufgabe.filiale} / ${ym}: alte Helfer-Zellen entfernt.`);
      }
    }
  }

  let totalCells = 0;
  for (const aufgabe of AUFGABEN) {
    const absentRow = rowById[aufgabe.absentId];
    if (!absentRow) { console.warn('  ⚠ Keine Vorschlagsdaten fuer', aufgabe.absentId, '- ueberspringe', aufgabe.filiale); continue; }

    // betroffene Monate ermitteln
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

      let cellsHere = 0;
      for (const seg of aufgabe.segments) {
        let key = empIdToKey['' + seg.helperId];
        if (!key) {
          employees.push({ id: seg.helperId, name: seg.helperName });
          key = dpEmpKey(seg.helperId, seg.helperName);
          empIdToKey['' + seg.helperId] = key;
        }
        if (!shifts[key]) shifts[key] = {};

        let cursor = new Date(seg.from + 'T00:00:00');
        const end = new Date(seg.to + 'T00:00:00');
        while (cursor <= end) {
          const dIso = iso(cursor);
          if (dIso.slice(0, 7) === ym) {
            const dow = cursor.getDay();
            if (dow !== 0 && !aufgabe.feiertage.has(dIso)) {
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
