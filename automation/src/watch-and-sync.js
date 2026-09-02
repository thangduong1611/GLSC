// Läuft dauerhaft (bis manuell beendet) auf dem Rechner, solange er an ist.
// Hört auf Firestore-Dokument sync_triggers/manual — sobald das Dashboard
// den "Jetzt aktualisieren"-Knopf schreibt, laufen sofort alle drei
// Sync-Skripte nacheinander, statt auf die nächste feste Uhrzeit zu warten.
// Schreibt den Fortschritt zurück nach sync_triggers/manual, damit das
// Dashboard "läuft gerade…" / "fertig um HH:MM" anzeigen kann.
// HINWEIS (2026-08-25): seit dem Umzug auf Cloud Run übernimmt server.js
// diese Rolle in der Produktion — dieser lokale Watcher ist nur noch als
// Fallback fürs Testen auf dem eigenen Rechner behalten.
require('dotenv').config();
const { getDb, admin } = require('./firestore-client');
const { runAll: runAllScripts } = require('./sync-runner');

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

  let lastHandledMs = 0;
  let running = false;

  db.collection('sync_triggers').doc('manual').onSnapshot(async (doc) => {
    if (!doc.exists) return;
    const data = doc.data();
    if (data.status !== 'requested') return; // eigene Statuswechsel (running/done) nicht erneut auslösen
    const requestedAtMs = data.requestedAt && data.requestedAt.toMillis ? data.requestedAt.toMillis() : 0;
    if (requestedAtMs <= lastHandledMs) return;
    if (running) return;

    lastHandledMs = requestedAtMs;
    running = true;
    try {
      await runAll(db, data.requestedBy);
    } catch (err) {
      console.error('✗ Fehler beim Ausführen:', err.message);
    } finally {
      running = false;
    }
  });
}

main().catch((err) => {
  console.error('✗ Watcher fehlgeschlagen:', err.message);
  process.exitCode = 1;
});
