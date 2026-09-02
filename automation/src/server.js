// HTTP-Server für Cloud Run — Ersatz für den lokalen Watcher, damit die
// Sync-Skripte laufen, ohne dass ein PC an sein muss.
//
// Zwei Arten von Aufrufern, zwei Auth-Mechanismen:
//  - Cloud Scheduler (3 feste Zeiten) ruft POST /internal/sync/:key auf,
//    abgesichert über einen geteilten Header-Wert (SYNC_SHARED_SECRET aus
//    Secret Manager) — Scheduler-Konfiguration ist nicht öffentlich einsehbar,
//    ein statisches Secret ist hier also ausreichend.
//  - Der "Jetzt aktualisieren"-Knopf im Dashboard (Browser, öffentlich
//    erreichbar) ruft POST /sync/all auf. Ein statisches Secret wäre dort im
//    Client-JS sichtbar — stattdessen wird das Firebase-ID-Token des
//    eingeloggten Managers geprüft (gleiche Logik wie isManager() in den
//    Firestore-Regeln: managers/{email}.regions muss nicht leer sein).
require('dotenv').config();
const express = require('express');
const { getDb, admin } = require('./firestore-client');
const { runOne, runAll } = require('./sync-runner');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SYNC_SHARED_SECRET = process.env.SYNC_SHARED_SECRET;

app.get('/health', (req, res) => res.status(200).send('ok'));

// ── Cloud Scheduler → einzelnes Skript ────────────────────────────────────
app.post('/internal/sync/:key', async (req, res) => {
  if (!SYNC_SHARED_SECRET || req.get('X-Sync-Secret') !== SYNC_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const key = req.params.key;
  try {
    console.log(`[scheduler] Starte ${key}…`);
    const result = await runOne(key);
    console.log(`[scheduler] ${key}: ${result.ok ? 'ok' : 'FEHLER — ' + result.error}`);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error(`[scheduler] ${key} fehlgeschlagen:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard-Button → alle drei Skripte ──────────────────────────────────
async function requireManager(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'missing bearer token' });

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const db = getDb();
    const managerDoc = await db.collection('managers').doc(decoded.email).get();
    const regions = (managerDoc.exists && managerDoc.data().regions) || [];
    if (!regions.length) return res.status(403).json({ error: 'not a manager' });
    req.managerEmail = decoded.email;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token: ' + err.message });
  }
}

app.post('/sync/all', requireManager, async (req, res) => {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('sync_triggers').doc('manual').set(
    { status: 'running', startedAt: now, requestedBy: req.managerEmail },
    { merge: true }
  );

  // Bewusst NICHT vorab antworten und im Hintergrund weiterlaufen: Cloud Run
  // drosselt die CPU standardmäßig, sobald die Antwort raus ist ("CPU is
  // only allocated during request processing") — Hintergrundarbeit nach
  // res.send() würde unzuverlässig laufen. Der Request bleibt offen, bis
  // alles fertig ist; das Dashboard wartet nicht auf diese Antwort (feuert
  // den fetch() und verfolgt den Fortschritt separat über den
  // Firestore-Listener auf sync_triggers/manual).
  try {
    console.log(`[manual] Update angefordert von ${req.managerEmail} — starte alle drei Sync-Skripte…`);
    const results = await runAll();
    const allOk = results.every((r) => r.ok);
    await db.collection('sync_triggers').doc('manual').set(
      { status: allOk ? 'done' : 'error', finishedAt: admin.firestore.FieldValue.serverTimestamp(), results },
      { merge: true }
    );
    console.log(`[manual] Fertig. ${results.filter((r) => r.ok).length}/${results.length} Skripte erfolgreich.`);
    res.status(200).json({ status: allOk ? 'done' : 'error', results });
  } catch (err) {
    console.error('[manual] Fehlgeschlagen:', err.message);
    await db.collection('sync_triggers').doc('manual').set(
      { status: 'error', finishedAt: admin.firestore.FieldValue.serverTimestamp(), error: err.message },
      { merge: true }
    );
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Filial Radar sync server läuft auf Port ${PORT}`);
});
