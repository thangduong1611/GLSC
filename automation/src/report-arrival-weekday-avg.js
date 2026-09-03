// Einmaliges Analyse-Skript (kein Cron-Job): für ALLE aktiven Mitarbeiter
// (aus emp_welo) werden reale Kommen/Gehen-Zeiten aus Welo/SuCi-Time
// (/sn/edit/{YYYYMMDD}-{marktNr}/index.html) an zufällig ausgewählten Tagen
// gesammelt — pro Wochentag (Mo-So) 1 zufälliger Tag je Monat, über die
// letzten 3 vollen Kalendermonate (Juni-August 2026) — und daraus je
// Mitarbeiter/Wochentag eine DURCHSCHNITTLICHE Start-/Endzeit berechnet.
// Auftrag t.duong 03.09.2026: leichtere Stichprobe statt Vollerhebung (siehe
// report-arrival-pattern.js für die 90-Tage-Vollerhebung eines einzelnen
// Mitarbeiters, z.B. Frau Vu 330384), damit alle 61 Mitarbeiter in
// vertretbarer Zeit abgedeckt werden können. Nur die HAUPTFiliale
// (emp_welo.marktNr) wird abgefragt — Tage an einer Zweitfiliale werden
// dadurch nicht erfasst (bekannte Einschränkung).
//
// Output: CSV, eine Zeile pro Mitarbeiter, je Wochentag Durchschnitts-Start,
// Durchschnitts-Ende und Anzahl echter Stichproben (n).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getDb } = require('./firestore-client');
const { withWeloLock } = require('./sync-lock');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

// Letzte 3 volle Kalendermonate vor dem aktuellen Monat (heute = 03.09.2026 → Jun/Jul/Aug)
const MONTHS = [
  { y: 2026, m: 6 },
  { y: 2026, m: 7 },
  { y: 2026, m: 8 },
];
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; // JS getDay(): 0=So..6=Sa
const WOCHENTAG_SPALTEN = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']; // Ausgabe-Reihenfolge

async function login(page) {
  await page.goto(BASE_URL);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await Promise.all([page.waitForNavigation(), page.locator('input[name="login"]').click()]);
  const url = new URL(page.url());
  const m = url.pathname.match(/^\/[^/]+/);
  return `${url.origin}${m ? m[0] : ''}`;
}

function compactDate(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Für einen Monat + Zielwochentag (0=So..6=Sa): alle passenden Kalendertage,
// dann EINEN zufällig auswählen. today-or-later wird ausgeschlossen (noch
// keine Daten).
function pickRandomDateForWeekday(year, month, targetDow, notAfter) {
  const dim = new Date(year, month, 0).getDate();
  const candidates = [];
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getDay() === targetDow && dt <= notAfter) candidates.push(dt);
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function timeToMin(hhmm) {
  const m = (hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}
function minToTime(min) {
  if (min == null) return '';
  const total = Math.round(min); // erst runden, dann aufteilen — sonst z.B. "06:60" statt "07:00"
  const h = Math.floor(total / 60), m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Bei einer sehr langen Laufzeit (mehrere Stunden für alle Mitarbeiter)
// läuft die Welo-Session zwischendurch ab — Welo leitet dann still auf die
// Login-Seite um (kein Fehler, kein Redirect-Error), wodurch getDayRow ohne
// diese Prüfung fälschlich "kein Eintrag" zurückgeben würde, obwohl in
// Wirklichkeit nur die Session tot ist. Deshalb explizit auf das
// Login-Formular prüfen und bei Bedarf neu einloggen (siehe SessionExpired
// unten) — entdeckt beim ersten Voll-Lauf über alle 61 Mitarbeiter am
// 03.09.2026: ab Mitarbeiter 2 kamen durchgehend 0 Treffer, weil die Session
// nach Mitarbeiter 1 (~ mehrere Minuten) bereits abgelaufen war.
class SessionExpired extends Error {}

async function getDayRow(page, sessionBase, date, marktNr, personalNr) {
  const url = `${sessionBase}/sn/edit/${compactDate(date)}-${marktNr}/index.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (await page.locator('input[name="authuser"]').count()) {
    throw new SessionExpired('Auf Login-Seite umgeleitet — Session abgelaufen.');
  }
  try {
    await page.waitForFunction(() => !document.body.innerText.includes('(wartet...)'), { timeout: 8000 });
  } catch (e) { /* trotzdem versuchen */ }
  await page.waitForTimeout(250);
  return page.evaluate((pnr) => {
    const inputs = Array.from(document.querySelectorAll('input[name^="pnr["]'));
    const hit = inputs.find((i) => i.value === pnr);
    if (!hit) return null;
    const m = hit.name.match(/pnr\[(\d+)\]/);
    if (!m) return null;
    const idx = m[1];
    const start = document.querySelector(`input[name="start[${idx}]"]`);
    const ende = document.querySelector(`input[name="ende[${idx}]"]`);
    return { start: start ? start.value : null, ende: ende ? ende.value : null };
  }, personalNr);
}

// Teilt sich denselben Lock wie sync-welo-personal.js — dieses Skript hier
// löste den Bug am 03.09.2026 überhaupt erst aus (parallel zum Startup-
// Catchup gelaufen, 44/71 Mitarbeiter fälschlich auf "0 Stichproben").
async function main() {
  return withWeloLock('welo', syncAll);
}

async function syncAll() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER / WELO_PASSWORD fehlen in der .env-Datei.');

  const db = getDb();
  console.log('Lade Mitarbeiterliste aus emp_welo…');
  const empSnap = await db.collection('emp_welo').get();
  let employees = [];
  empSnap.forEach((doc) => {
    const d = doc.data();
    if (d.marktNr) employees.push({ id: doc.id, name: d.name || '', marktNr: d.marktNr, marktname: d.marktname || '' });
  });
  console.log(`  ${employees.length} Mitarbeiter mit Filiale gefunden.`);
  // Zweiter Zweck neben dem Testen mit wenigen Leuten: ein Nachtrag NUR für
  // neu hinzugekommene Mitarbeiter (z.B. nach einem emps-Sync mit neuen
  // Filialen, während der Voll-Lauf für alle anderen schon läuft/gelaufen
  // ist), ohne alle anderen erneut zu scrapen. Zwei Formen:
  //   Zahl (z.B. "5")        -> nur die ersten N (zum schnellen Testen)
  //   Kommaliste (z.B. "330485,340301") -> nur genau diese PersonalNr.
  const arg = process.argv[2] || '';
  if (arg) {
    if (/^\d+$/.test(arg)) {
      employees = employees.slice(0, parseInt(arg, 10));
    } else {
      const ids = new Set(arg.split(',').map((s) => s.trim()).filter(Boolean));
      employees = employees.filter((e) => ids.has(e.id));
      console.log(`  Eingeschränkt auf ${employees.length} explizit angegebene Mitarbeiter.`);
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const gestern = new Date();
  gestern.setDate(gestern.getDate() - 1);

  const results = [];
  try {
    console.log('Login bei Welo/SuCi-Net…');
    let sessionBase = await login(page);

    let empDone = 0;
    for (const emp of employees) {
      empDone++;
      // Sammel-Objekt: pro Wochentag eine Liste von {start,ende}-Minuten
      const perDow = { Mo: [], Di: [], Mi: [], Do: [], Fr: [], Sa: [], So: [] };
      for (const { y, m } of MONTHS) {
        for (let dow = 0; dow <= 6; dow++) {
          const spalte = WOCHENTAGE[dow];
          const datum = pickRandomDateForWeekday(y, m, dow, gestern);
          if (!datum) continue;
          // Bis zu 4 Versuche statt 1 Retry: bei mehreren PARALLEL laufenden
          // Welo-Sitzungen (z.B. gleichzeitig laufendes sync-welo-personal.js)
          // kann eine Session mehrfach hintereinander sofort wieder abgelaufen
          // sein — ein einzelner Retry reichte dann nicht (siehe Notiz oben:
          // ab einem bestimmten Mitarbeiter kamen reihenweise 0 Treffer, weil
          // die Session nach jedem Neu-Login sofort wieder invalidiert wurde).
          let row = null;
          for (let attempt = 1; attempt <= 4; attempt++) {
            try {
              row = await getDayRow(page, sessionBase, datum, emp.marktNr, emp.id);
              break;
            } catch (e) {
              if (e instanceof SessionExpired && attempt < 4) {
                console.log(`  ⚠ Session abgelaufen (Versuch ${attempt}/4) — logge neu ein…`);
                await new Promise((r) => setTimeout(r, 2000));
                sessionBase = await login(page);
                continue;
              }
              if (e instanceof SessionExpired) {
                console.log(`  ✗ Session bleibt nach 4 Versuchen abgelaufen — überspringe diesen Tag (evtl. läuft eine zweite Welo-Sitzung parallel).`);
              }
              row = null;
              break;
            }
          }
          if (row && row.start) {
            perDow[spalte].push({ start: timeToMin(row.start), ende: timeToMin(row.ende) });
          }
        }
      }
      const rec = { id: emp.id, name: emp.name, marktname: emp.marktname };
      for (const spalte of WOCHENTAG_SPALTEN) {
        const samples = perDow[spalte];
        const n = samples.length;
        const avgStart = n ? samples.reduce((s, x) => s + x.start, 0) / n : null;
        const endeSamples = samples.filter((x) => x.ende != null);
        const avgEnde = endeSamples.length ? endeSamples.reduce((s, x) => s + x.ende, 0) / endeSamples.length : null;
        rec[spalte + '_Start'] = minToTime(avgStart);
        rec[spalte + '_Ende'] = minToTime(avgEnde);
        rec[spalte + '_n'] = n;
      }
      results.push(rec);
      console.log(`  [${empDone}/${employees.length}] ${emp.name} (${emp.id}) fertig.`);
    }
  } finally {
    await browser.close();
  }

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'ankunftsmuster_alle_wochentage.csv');
  const headerCols = ['PersonalNr', 'Name', 'Filiale'];
  for (const spalte of WOCHENTAG_SPALTEN) headerCols.push(spalte + '_Start', spalte + '_Ende', spalte + '_n');

  // MERGEN statt Überschreiben: falls die Datei schon existiert (z.B. vom
  // Voll-Lauf für die anderen Mitarbeiter), werden nur die Zeilen der hier
  // neu berechneten PersonalNr ersetzt/ergänzt — alle anderen bleiben
  // unangetastet erhalten.
  const byId = {};
  if (fs.existsSync(outPath)) {
    const prevRaw = fs.readFileSync(outPath, 'utf8').replace(/^﻿/, '');
    const prevLines = prevRaw.split('\n').filter((l) => l.trim());
    for (let i = 1; i < prevLines.length; i++) {
      const cols = prevLines[i].split(';');
      if (cols[0]) byId[cols[0]] = cols;
    }
    console.log(`  Bestehende Datei gefunden mit ${Object.keys(byId).length} Mitarbeiter(n) — werde gemergt.`);
  }
  for (const rec of results) {
    const row = [rec.id, rec.name, rec.marktname];
    for (const spalte of WOCHENTAG_SPALTEN) row.push(rec[spalte + '_Start'], rec[spalte + '_Ende'], rec[spalte + '_n']);
    byId[rec.id] = row;
  }
  const lines = [headerCols.join(';')];
  Object.values(byId).forEach((row) => lines.push(row.join(';')));
  fs.writeFileSync(outPath, '﻿' + lines.join('\n'), 'utf8');
  console.log(`  Datei enthält jetzt insgesamt ${Object.keys(byId).length} Mitarbeiter.`);
  console.log(`\n✓ ${results.length} Mitarbeiter geschrieben nach: ${outPath}`);
}

main().catch((err) => {
  console.error('FEHLER:', err);
  process.exit(1);
});
