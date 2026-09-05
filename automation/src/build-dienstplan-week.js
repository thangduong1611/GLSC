// Baut einen konkreten Wochen-Dienstplan (Auftrag t.duong 05.09.2026) fuer
// die Woche ab WOCHE_START, passend zu den Vertragsstunden (emp_welo.sollStd
// via dienstplan_vorschlag.csv) und mit mehr Stunden an "vollen" Wochentagen
// (Auftrag t.duong: "thường là thứ 2 thứ 5 thứ 6, thứ 7" = Mo/Do/Fr/Sa).
//
// Basis: dienstplan_vorschlag.csv (reale, historisch häufigste Schicht-
// Startzeiten je Mitarbeiter/Wochentag, aus Welo). Nur die SCHICHTLAENGE wird
// angepasst (spaeteres Ende), die gewohnte Startzeit bleibt erhalten.
//
// Algorithmus je Mitarbeiter:
// 1. Arbeitstage = die N=ArbeitstageProWoche Wochentage (Mo-Sa, So nie) mit
//    der hoechsten Haeufigkeit (_n-Spalte) in der CSV.
// 2. "Volle" Tage = Schnittmenge {Mo,Do,Fr,Sa} ∩ Arbeitstage, Rest = "ruhige" Tage.
// 3. Basis-Std/Tag = floor(SollStd / Arbeitstage) auf volle Stunde; Rest wird
//    zu gleichen Teilen (aufgerundet auf 15-Min-Schritte) auf die vollen Tage
//    verteilt -> Wochensumme ist IMMER >= SollStd, nie darunter.
// 4. Pause nach ArbZG: >6 Std Netto-Arbeit -> +30 Min, >9 Std -> +45 Min,
//    addiert auf die Netto-Zielstunden -> Brutto-Schichtspanne (Ende-Zeit).
// 5. Restliche Wochentage (nicht Arbeitstag) -> "Frei".
//
// Mitarbeiter ohne Schicht-Historie (ArbeitstageProWoche=0 in der CSV, meist
// Gebietsleiter-Rollen oder Datenluecke) werden uebersprungen und im Report
// als "uebersprungen" gelistet statt geraten zu werden.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'output', 'dienstplan_vorschlag.csv');
const OUT_PATH = path.join(__dirname, '..', 'output', 'dienstplan_woche_vorschlag.json');
const WOCHE_START = '2026-09-21'; // Montag
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; // So wird nie geplant
const VOLLE_TAGE = new Set(['Mo', 'Do', 'Fr', 'Sa']);

function parseCsvLine(line) {
  return line.split(';');
}
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}
function fmtHHMM(hours) {
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) { m = 0; h += 1; }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function roundUpQuarter(h) { return Math.ceil(h * 4) / 4; }

function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(raw[0]);
  const rows = raw.slice(1).map(parseCsvLine);

  const ergebnisse = [];
  const uebersprungen = [];

  rows.forEach((r) => {
    const id = r[0], name = r[1], filiale = r[2];
    const sollStd = parseFloat(r[3]);
    const arbeitstage = parseInt(r[4], 10);
    if (!sollStd || !arbeitstage) { uebersprungen.push({ id, name, filiale, grund: 'keine Schicht-Historie (ArbeitstageProWoche=0)' }); return; }

    // Pro Wochentag: Startzeit (erstes Feld) + Haeufigkeit (zweites Feld), Spalten ab Index 5, 2 pro Tag, Reihenfolge Mo,Di,Mi,Do,Fr,Sa,So
    const tagesInfo = {};
    TAGE.forEach((t, i) => {
      const startCol = 5 + i * 2, freqCol = startCol + 1;
      const range = r[startCol] || '';
      const freq = parseInt(r[freqCol], 10) || 0;
      const start = range.includes('-') ? parseHHMM(range.split('-')[0]) : null;
      tagesInfo[t] = { start, freq };
    });

    // Arbeitstage bestimmen: die `arbeitstage` Wochentage mit hoechster Haeufigkeit (nur wo eine Startzeit bekannt ist)
    const kandidaten = TAGE.filter((t) => tagesInfo[t].start != null);
    const sortiert = kandidaten.slice().sort((a, b) => tagesInfo[b].freq - tagesInfo[a].freq);
    const arbeitstageListe = sortiert.slice(0, Math.min(arbeitstage, sortiert.length));
    if (!arbeitstageListe.length) { uebersprungen.push({ id, name, filiale, grund: 'keine gueltige Startzeit in der CSV' }); return; }
    const N = arbeitstageListe.length;

    const volleTage = arbeitstageListe.filter((t) => VOLLE_TAGE.has(t));
    const ruhigeTage = arbeitstageListe.filter((t) => !VOLLE_TAGE.has(t));
    const nVoll = volleTage.length, nRuhig = ruhigeTage.length;

    const basis = Math.floor(sollStd / N); // volle Stunde
    let rest = sollStd - basis * N;
    let bumpProVollemTag = 0;
    if (nVoll > 0) bumpProVollemTag = roundUpQuarter(rest / nVoll);
    else if (nRuhig > 0) bumpProVollemTag = 0; // Rest wird unten gleich auf alle verteilt (Fallback)

    const tage = {};
    let summe = 0;
    TAGE.forEach((t) => {
      if (!arbeitstageListe.includes(t)) { tage[t] = 'Frei'; return; }
      let netto = basis + (VOLLE_TAGE.has(t) && nVoll > 0 ? bumpProVollemTag : 0);
      if (nVoll === 0 && nRuhig > 0) netto = basis + roundUpQuarter(rest / nRuhig); // Fallback: keine "vollen" Tage in den Arbeitstagen
      const pause = netto > 9 ? 0.75 : (netto > 6 ? 0.5 : 0);
      const brutto = netto + pause;
      const start = tagesInfo[t].start;
      const ende = start + brutto;
      tage[t] = fmtHHMM(start) + '-' + fmtHHMM(ende);
      summe += netto;
    });

    ergebnisse.push({ id, name, filiale, sollStd, arbeitstage: N, tage, wochensumme: Math.round(summe * 100) / 100 });
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify({ wocheStart: WOCHE_START, ergebnisse, uebersprungen }, null, 2), 'utf8');
  console.log(`${ergebnisse.length} Mitarbeiter geplant, ${uebersprungen.length} uebersprungen.`);
  console.log('Uebersprungen:', uebersprungen.map((u) => u.name + ' (' + u.grund + ')').join('; '));
  const unter = ergebnisse.filter((e) => e.wochensumme < e.sollStd - 0.01);
  console.log(`Pruefung: ${unter.length} Faelle unter SollStd (sollte 0 sein).`);
  console.log('Gespeichert:', OUT_PATH);
}

main();
