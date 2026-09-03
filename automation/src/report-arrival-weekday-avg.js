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

async function main() {
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
  const LIMIT = parseInt(process.argv[2] || '0', 10); // nur zum Testen, 0 = alle
  if (LIMIT > 0) employees = employees.slice(0, LIMIT);

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
          let row = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              row = await getDayRow(page, sessionBase, datum, emp.marktNr, emp.id);
              break;
            } catch (e) {
              if (e instanceof SessionExpired && attempt < 2) {
                console.log('  ⚠ Session abgelaufen — logge neu ein…');
                sessionBase = await login(page);
                continue;
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
  const lines = [headerCols.join(';')];
  for (const rec of results) {
    const row = [rec.id, rec.name, rec.marktname];
    for (const spalte of WOCHENTAG_SPALTEN) row.push(rec[spalte + '_Start'], rec[spalte + '_Ende'], rec[spalte + '_n']);
    lines.push(row.join(';'));
  }
  fs.writeFileSync(outPath, '﻿' + lines.join('\n'), 'utf8');
  console.log(`\n✓ ${results.length} Mitarbeiter geschrieben nach: ${outPath}`);
}

main().catch((err) => {
  console.error('FEHLER:', err);
  process.exit(1);
});
