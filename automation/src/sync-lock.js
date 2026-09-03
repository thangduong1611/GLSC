// Verhindert, dass zwei Welo-Sync-Läufe gleichzeitig dieselbe Welo-Sitzung
// benutzen. Vorfall 03.09.2026: nach einem PC-Neustart liefen der
// Startup-Catchup (run-catchup-all.bat) UND watch-and-sync.js's neue
// automatische Umsatz-Auffrischung gleichzeitig los — beide starteten eine
// eigene Playwright/Welo-Session für denselben Account. Welo scheint keine
// zwei parallelen Sitzungen desselben Kontos zu vertragen: dieselbe Ursache
// hatte schon einmal 44 von 71 Mitarbeitern beim Wochentags-Ankunftsmuster-
// Report fälschlich auf "0 Stichproben" gesetzt (siehe report-arrival-
// weekday-avg.js). Diesmal blieb es glimpflich (Daten am Ende plausibel),
// aber verlassen kann man sich darauf nicht — deshalb hier ein
// dateibasierter, prozessübergreifender Lock, der VOR jedem Welo-Login
// geprüft wird, egal von wo das Skript gestartet wurde (Startup-Catchup,
// manueller Doppelklick, oder der automatische Umsatz-Refresh im Watcher).
const fs = require('fs');
const path = require('path');

async function withWeloLock(name, fn) {
  const lockPath = path.join(__dirname, '..', `.lock-${name}`);
  const maxAgeMs = 20 * 60 * 1000; // verwaiste Lock-Datei (z.B. nach Absturz/Neustart) nach 20 Min. ignorieren
  const maxWaitMs = 15 * 60 * 1000;
  const pollMs = 5000;
  const start = Date.now();

  for (;;) {
    if (fs.existsSync(lockPath)) {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age < maxAgeMs) {
        if (Date.now() - start > maxWaitMs) {
          throw new Error(`Konnte Lock "${name}" nicht bekommen (belegt seit ${Math.round(age / 60000)} Min.) — abgebrochen nach ${Math.round(maxWaitMs / 60000)} Min. Warten. Vermutlich läuft bereits ein anderer Welo-Sync (z.B. Startup-Catchup oder automatische Umsatz-Auffrischung).`);
        }
        console.log(`  ⏳ Ein anderer Welo-Sync läuft bereits (Lock "${name}", seit ${Math.round(age / 1000)}s) — warte, um keine Session-Kollision zu riskieren…`);
        await new Promise((r) => setTimeout(r, pollMs));
        continue;
      }
      console.log(`  ⚠ Verwaiste Lock-Datei "${name}" (${Math.round(age / 60000)} Min. alt, vermutlich nach Absturz/Neustart übrig geblieben) — wird ignoriert.`);
    }
    try {
      // 'wx' = nur anlegen, wenn die Datei noch nicht existiert — schließt
      // ein Race zwischen zwei gleichzeitig startenden Prozessen aus.
      fs.writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}\n`, { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code === 'EEXIST') { await new Promise((r) => setTimeout(r, 500)); continue; }
      throw e;
    }
  }

  try {
    return await fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch (e) { /* schon weg */ }
  }
}

module.exports = { withWeloLock };
