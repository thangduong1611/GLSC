// Einmaliges Auswertungs-Skript (kein Cron-Job): baut aus dem realen
// Ankunftsmuster (output/ankunftsmuster_alle_wochentage.csv, siehe
// report-arrival-weekday-avg.js) + den Vertrags-Sollstunden (emp_welo)
// einen KONKRETEN Dienstplan-Vorschlag je Mitarbeiter/Wochentag.
// Auftrag t.duong 03.09.2026: "làm tròn giờ và dựa vào số giờ theo hợp đồng
// mà đưa ra lịch làm gợi ý" — Startzeit gerundet aus dem Beobachtungs-
// muster, Schichtlänge so verteilt, dass die Wochensumme genau den
// Vertrags-Sollstunden entspricht (nicht einfach das beobachtete Muster
// fortschreiben, das teils schon zu Über-/Unterstunden geführt hat).
//
// Logik pro Mitarbeiter:
//  1. Arbeitstage = alle Wochentage mit mind. 1 echter Stichprobe (n>=1) in
//     der Ankunftsmuster-Datei — Tage ohne jede Stichprobe (meist "So") sind
//     erkennbar freie Tage, werden nicht verplant.
//  2. Tagesstunden = Soll-Std./Woche ÷ Anzahl Arbeitstage (gleichmäßig
//     verteilt — es gibt keine verlässliche Grundlage, sie ungleich
//     aufzuteilen).
//  3. Startzeit = beobachteter Durchschnitt für diesen Wochentag, auf 15 Min.
//     gerundet.
//  4. Pause: >6 Std. 30 Min., >9 Std. 45 Min. (dieselbe Regel, die dp-Karten
//     im HR-Manager-Dienstplan schon anzeigen) — wird zur Tagesstunden-Länge
//     addiert, um die tatsächliche Kommen-bis-Gehen-Spanne zu erhalten.
//  5. Endzeit = Startzeit + Tagesstunden + Pause.
// n (Stichprobenzahl) wird je Tag mit ausgegeben, damit erkennbar bleibt,
// wie verlässlich das beobachtete Muster für diesen Tag ist.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const WOCHENTAG_SPALTEN = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function timeToMin(hhmm) {
  const m = (hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}
function minToTime(min) {
  if (min == null) return '';
  const total = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60), m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function roundToQuarter(min) {
  return Math.round(min / 15) * 15;
}
function breakMinutes(hours) {
  if (hours > 9) return 45;
  if (hours > 6) return 30;
  return 0;
}

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
  const csvPath = path.join(__dirname, '..', 'output', 'ankunftsmuster_alle_wochentage.csv');
  if (!fs.existsSync(csvPath)) throw new Error(`Nicht gefunden: ${csvPath} — zuerst report-arrival-weekday-avg.js laufen lassen.`);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  console.log(`${rows.length} Mitarbeiter aus Ankunftsmuster-Datei geladen.`);

  const db = getDb();
  const empSnap = await db.collection('emp_welo').get();
  const sollStdById = {};
  empSnap.forEach((doc) => { sollStdById[doc.id] = doc.data().sollStd; });
  console.log(`${Object.keys(sollStdById).length} Soll-Std.-Werte aus emp_welo geladen.`);

  const out = [];
  let ohneSoll = 0;
  for (const row of rows) {
    const id = row.PersonalNr;
    const sollStd = sollStdById[id];
    if (sollStd == null) { ohneSoll++; }

    const arbeitstage = WOCHENTAG_SPALTEN.filter((tag) => parseInt(row[tag + '_n'], 10) > 0);
    const tagesstunden = sollStd != null && arbeitstage.length ? sollStd / arbeitstage.length : null;

    const rec = { id, name: row.Name, filiale: row.Filiale, sollStd: sollStd ?? '', arbeitstageAnzahl: arbeitstage.length };
    for (const tag of WOCHENTAG_SPALTEN) {
      const n = parseInt(row[tag + '_n'], 10) || 0;
      if (n === 0 || tagesstunden == null) {
        rec[tag] = ''; rec[tag + '_n'] = n;
        continue;
      }
      const startMin = timeToMin(row[tag + '_Start']);
      if (startMin == null) { rec[tag] = ''; rec[tag + '_n'] = n; continue; }
      const startRounded = roundToQuarter(startMin);
      const pause = breakMinutes(tagesstunden);
      const endeMin = startRounded + tagesstunden * 60 + pause;
      rec[tag] = `${minToTime(startRounded)}-${minToTime(endeMin)}`;
      rec[tag + '_n'] = n;
    }
    out.push(rec);
  }
  if (ohneSoll) console.log(`  ⚠ ${ohneSoll} Mitarbeiter ohne Soll-Std.-Wert in emp_welo — Vorschlag bleibt für sie leer.`);

  const outPath = path.join(__dirname, '..', 'output', 'dienstplan_vorschlag.csv');
  const headerCols = ['PersonalNr', 'Name', 'Filiale', 'SollStdWoche', 'ArbeitstageProWoche'];
  for (const tag of WOCHENTAG_SPALTEN) headerCols.push(tag, tag + '_n');
  const lines = [headerCols.join(';')];
  for (const rec of out) {
    const row = [rec.id, rec.name, rec.filiale, rec.sollStd, rec.arbeitstageAnzahl];
    for (const tag of WOCHENTAG_SPALTEN) row.push(rec[tag], rec[tag + '_n']);
    lines.push(row.join(';'));
  }
  fs.writeFileSync(outPath, '﻿' + lines.join('\n'), 'utf8');
  console.log(`\n✓ ${out.length} Mitarbeiter geschrieben nach: ${outPath}`);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
