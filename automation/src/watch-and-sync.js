// Läuft dauerhaft (bis manuell beendet) auf dem Rechner, solange er an ist.
// Hört auf Firestore-Dokument sync_triggers/manual — sobald das Dashboard
// den "Jetzt aktualisieren"-Knopf schreibt, laufen sofort alle drei
// Sync-Skripte nacheinander, statt auf die nächste feste Uhrzeit zu warten.
// Schreibt den Fortschritt zurück nach sync_triggers/manual, damit das
// Dashboard "läuft gerade…" / "fertig um HH:MM" anzeigen kann.
// HINWEIS (2026-08-25): seit dem Umzug auf Cloud Run übernimmt server.js
// diese Rolle in der Produktion — dieser lokale Watcher ist nur noch als
// Fallback fürs Testen auf dem eigenen Rechner behalten. STAND 03.09.2026:
// Cloud Run ist noch NICHT deployed, dieser lokale Watcher ist also aktuell
// der einzige Weg, wie "Jetzt aktualisieren" überhaupt funktioniert.
require('dotenv').config();
const { getDb, admin } = require('./firestore-client');
const { runAll: runAllScripts, runOne } = require('./sync-runner');

// EIN gemeinsames "läuft gerade"-Flag für BEIDE Auslöser (manueller Knopf +
// automatische Umsatz-Auffrischung unten) — sonst könnten beide gleichzeitig
// eine eigene Welo-Sitzung öffnen und sich gegenseitig aus der Session
// werfen (genau der Bug, der beim Wochentags-Ankunftsmuster-Report am
// 03.09.2026 44 von 71 Mitarbeitern fälschlich auf "0 Stichproben" gesetzt
// hat, weil zwei sync-welo-personal.js-Läufe parallel liefen).
let irgendeinSyncLaeuft = false;

// Zusätzlich zum manuellen "Jetzt aktualisieren"-Knopf: automatische
// Umsatz-Auffrischung zu festen Uhrzeiten, NUR für sync-welo-personal
// (Tagesziel/umsatzHeute — die anderen drei Skripte betreffen andere
// Dashboard-Reiter und müssen dafür nicht mitlaufen). Auftrag t.duong
// 03.09.2026: der Ziel-Fortschrittsbalken (grün bei Zielerreichung) war
// sonst den ganzen Tag nutzlos, weil umsatzHeute nur einmal um 5 Uhr früh
// (noch praktisch 0 €) gecacht wurde. Windows Task Scheduler mit fester
// Uhrzeit bräuchte Admin-Rechte (dieselbe Einschränkung wie beim
// Startup-Catchup) — deshalb hier im ohnehin dauerhaft laufenden Watcher
// gelöst statt über einen zusätzlichen Scheduled Task.
const ZIEL_REFRESH_ZEITEN = (process.env.ZIEL_REFRESH_ZEITEN || '10:00,14:00,18:00')
  .split(',').map((s) => s.trim()).filter(Boolean);
let zielRefreshTag = null; // 'YYYY-MM-DD' — pro Kalendertag neu
let zielRefreshErledigt = new Set();

function pruefeZielRefresh() {
  if (irgendeinSyncLaeuft) return;
  const jetzt = new Date();
  const heuteStr = jetzt.getFullYear() + '-' + String(jetzt.getMonth() + 1).padStart(2, '0') + '-' + String(jetzt.getDate()).padStart(2, '0');
  if (heuteStr !== zielRefreshTag) { zielRefreshTag = heuteStr; zielRefreshErledigt = new Set(); }
  const hhmm = String(jetzt.getHours()).padStart(2, '0') + ':' + String(jetzt.getMinutes()).padStart(2, '0');
  // Der erste noch nicht erledigte Slot, dessen Uhrzeit schon erreicht ist —
  // absichtlich nur EINER pro Aufruf, damit ein sehr später Watcher-Start
  // (z.B. erst um 20 Uhr) nicht alle drei verpassten Slots sofort
  // hintereinander abfeuert.
  const faelligerSlot = ZIEL_REFRESH_ZEITEN.find((slot) => !zielRefreshErledigt.has(slot) && hhmm >= slot);
  if (!faelligerSlot) return;
  zielRefreshErledigt.add(faelligerSlot);
  irgendeinSyncLaeuft = true;
  console.log(`\n[${jetzt.toLocaleString('de-DE')}] Automatische Umsatz-Aktualisierung (Slot ${faelligerSlot}) — starte sync-welo-personal…`);
  runOne('welo-personal')
    .then((r) => {
      console.log(`[${new Date().toLocaleString('de-DE')}] Automatische Aktualisierung ${r.ok ? 'erfolgreich' : 'FEHLER: ' + r.error}.\n`);
    })
    .catch((err) => console.error('✗ Automatische Aktualisierung fehlgeschlagen:', err.message))
    .finally(() => { irgendeinSyncLaeuft = false; });
}

async function runAll(db, requestedBy) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('sync_triggers').doc('manual').set(
    { status: 'running', startedAt: now, requestedBy: requestedBy || null },
    { merge: true }
  );

  console.log(`\n[${new Date().toLocaleString('de-DE')}] Update angefordert${requestedBy ? ' von ' + requestedBy : ''} — starte alle drei Sync-Skripte…`);
  const results = await runAllScripts();

  const allOk = results.every((r) => r.ok);
  await db.collection('sync_triggers').doc('manual').set(
    {
      status: allOk ? 'done' : 'error',
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      results,
    },
    { merge: true }
  );
  console.log(`[${new Date().toLocaleString('de-DE')}] Fertig. ${results.filter((r) => r.ok).length}/${results.length} Skripte erfolgreich.\n`);
}

async function main() {
  const db = getDb();
  console.log('Watcher läuft. Wartet auf sync_triggers/manual … (zum Beenden: Fenster schließen oder Strg+C)');
  console.log(`Automatische Umsatz-Aktualisierung (nur sync-welo-personal) täglich um: ${ZIEL_REFRESH_ZEITEN.join(', ')} Uhr.`);

  let lastHandledMs = 0;

  db.collection('sync_triggers').doc('manual').onSnapshot(async (doc) => {
    if (!doc.exists) return;
    const data = doc.data();
    if (data.status !== 'requested') return; // eigene Statuswechsel (running/done) nicht erneut auslösen
    const requestedAtMs = data.requestedAt && data.requestedAt.toMillis ? data.requestedAt.toMillis() : 0;
    if (requestedAtMs <= lastHandledMs) return;
    if (irgendeinSyncLaeuft) return;

    lastHandledMs = requestedAtMs;
    irgendeinSyncLaeuft = true;
    try {
      await runAll(db, data.requestedBy);
    } catch (err) {
      console.error('✗ Fehler beim Ausführen:', err.message);
    } finally {
      irgendeinSyncLaeuft = false;
    }
  });

  // Alle 3 Minuten prüfen, ob eine der festen Uhrzeiten erreicht ist.
  setInterval(pruefeZielRefresh, 3 * 60 * 1000);
  pruefeZielRefresh(); // auch sofort beim Start prüfen (Nachholen verpasster Slots)
}

main().catch((err) => {
  console.error('✗ Watcher fehlgeschlagen:', err.message);
  process.exitCode = 1;
});
