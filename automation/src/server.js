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
const { runOne, runAll, runFile } = require('./sync-runner');
const { setSecret } = require('./secrets-client');
const { cleanupKrankmeldungFotos } = require('./cleanup-krankmeldung');
const { cleanupDepartedEmployees } = require('./cleanup-departed-employees');
const { employeeLogin } = require('./employee-auth');

// getDb() ruft intern admin.initializeApp() auf — muss VOR dem ersten
// admin.auth()-Aufruf passiert sein (sonst "default Firebase app does not
// exist" bei jedem frischen Cold-Start), daher hier sofort beim Start
// erzwungen statt erst lazy beim ersten Firestore-Zugriff.
getDb();

const app = express();
app.use(express.json());
// dashboard.html (GitHub Pages, andere Domain) ruft /sync/all direkt per
// fetch() auf — ohne CORS-Header blockt der Browser das serverseitig, bevor
// die eigentliche Auth-Prüfung (Bearer-Token unten) überhaupt greift. Der
// echte Schutz ist ohnehin die Token-/Secret-Prüfung pro Route, nicht die
// Herkunft der Anfrage — daher hier bewusst offen statt auf eine Domain fixiert.
app.use(function(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Sync-Secret');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const PORT = process.env.PORT || 8080;
const SYNC_SHARED_SECRET = process.env.SYNC_SHARED_SECRET;
// Siehe gleichnamige Konstante in watch-and-sync.js: ein zweites, eigenes
// Automation-Konto (eigene REGION in seiner .env) braucht sein eigenes
// sync_triggers-Dokument, sonst überschreiben sich zwei parallel deployte
// Instanzen gegenseitig den Fortschritt. Ohne REGION bleibt die Doc-ID 'manual'.
const REGION = process.env.REGION || null;
const TRIGGER_ID = REGION ? 'manual__' + REGION : 'manual';

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
    req.managerRegions = regions;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token: ' + err.message });
  }
}

// Gemeinsame Logik für "alle vier Skripte nacheinander, mit Fortschritt in
// sync_triggers" — genutzt vom Dashboard-Button (/sync/all, Manager-Login)
// UND vom Cloud-Scheduler-Cron (/internal/sync-all, geteiltes Secret).
async function runAllAndTrackStatus(requestedBy, res) {
  const db = getDb();
  const triggerRef = db.collection('sync_triggers').doc(TRIGGER_ID);

  // Schutz gegen mehrfaches Klicken/gleichzeitige Anfragen (Dashboard-Button
  // + Scheduler, oder der Button mehrfach hintereinander geklickt): ein
  // bereits laufender Sync würde sonst ein zweites Mal parallel im selben
  // Container starten — das hat am 07.09.2026 den Speicher gesprengt
  // (Container-Kill mitten im Lauf) UND ist derselbe Risiko-Typ wie der
  // Ost/West-Vorfall (zwei gleichzeitige Welo/Axonity-Logins auf demselben
  // Konto können sich gegenseitig aus der Sitzung werfen). 25 Min. Schwelle,
  // weit über der realistischen Laufzeit (jedes Skript hat 5 Min. Timeout,
  // 4 Skripte nacheinander), damit ein wirklich abgestürzter alter Lauf
  // (Container-Kill, ohne dass 'done'/'error' je geschrieben wurde) nicht für
  // immer blockiert.
  const existing = await triggerRef.get();
  if (existing.exists) {
    const d = existing.data();
    const startedMs = d.startedAt && d.startedAt.toMillis ? d.startedAt.toMillis() : 0;
    const laeuftNoch = d.status === 'running' && (Date.now() - startedMs) < 25 * 60 * 1000;
    if (laeuftNoch) {
      res.status(409).json({ error: 'Ein Sync läuft bereits — bitte warten, bis er fertig ist (max. ~20 Min.), statt erneut zu klicken.' });
      return;
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await triggerRef.set(
    { status: 'running', startedAt: now, requestedBy, region: REGION },
    { merge: true }
  );
  // Bewusst NICHT vorab antworten und im Hintergrund weiterlaufen: Cloud Run
  // drosselt die CPU standardmäßig, sobald die Antwort raus ist ("CPU is
  // only allocated during request processing") — Hintergrundarbeit nach
  // res.send() würde unzuverlässig laufen. Der Request bleibt offen, bis
  // alles fertig ist; Dashboard/Scheduler warten nicht auf diese Antwort,
  // sondern verfolgen den Fortschritt separat über den Firestore-Listener.
  try {
    console.log(`[sync-all] Angefordert von ${requestedBy} — starte alle vier Sync-Skripte…`);
    const results = await runAll();
    const allOk = results.every((r) => r.ok);
    await db.collection('sync_triggers').doc(TRIGGER_ID).set(
      { status: allOk ? 'done' : 'error', finishedAt: admin.firestore.FieldValue.serverTimestamp(), results, region: REGION },
      { merge: true }
    );
    console.log(`[sync-all] Fertig. ${results.filter((r) => r.ok).length}/${results.length} Skripte erfolgreich.`);
    res.status(200).json({ status: allOk ? 'done' : 'error', results });
  } catch (err) {
    console.error('[sync-all] Fehlgeschlagen:', err.message);
    await db.collection('sync_triggers').doc(TRIGGER_ID).set(
      { status: 'error', finishedAt: admin.firestore.FieldValue.serverTimestamp(), error: err.message, region: REGION },
      { merge: true }
    );
    res.status(500).json({ error: err.message });
  }
}

app.post('/sync/all', requireManager, async (req, res) => {
  await runAllAndTrackStatus(req.managerEmail, res);
});

// ── Cloud Scheduler → alle vier Skripte in einem Lauf (1x/Tag statt 5
// Einzel-Jobs — jeder Cloud-Scheduler-Job über die ersten 3 pro Projekt
// kostet $0.10/Monat, ein gebündelter täglicher Lauf spart das). ─────────
app.post('/internal/sync-all', async (req, res) => {
  if (!SYNC_SHARED_SECRET || req.get('X-Sync-Secret') !== SYNC_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  await runAllAndTrackStatus('cloud-scheduler', res);
});

// ── Gebietsleiter trägt seine eigenen Axonity/Welo-Zugangsdaten ein ────────
// Aufgerufen aus index.html (Settings-Panel), sobald diese Region ein
// eigenes Cloud-Run-Konto hat. REGION kommt bewusst aus der eigenen .env
// dieser Instanz (nicht vom Client) — ein Manager kann so nur Secrets für
// GENAU die Region schreiben, die diese Instanz bedient.
app.post('/credentials', requireManager, async (req, res) => {
  if (!REGION || !req.managerRegions.includes(REGION)) {
    return res.status(403).json({ error: 'not authorized for this region' });
  }
  const b = req.body || {};
  const map = {
    AXONITY_USER: b.axonityUser,
    AXONITY_PASSWORD: b.axonityPassword,
    WELO_USER: b.weloUser,
    WELO_PASSWORD: b.weloPassword,
    WELO_STATISTIK_URL: b.weloStatistikUrl,
    GEBIETSLEITER_NAME: b.gebietsleiterName,
    KOSTENSTELLEN: b.kostenstellen,
  };
  try {
    for (const [key, val] of Object.entries(map)) {
      if (val) await setSecret(`${REGION}-${key}`, String(val));
    }
    console.log(`[credentials] ${req.managerEmail} hat Zugangsdaten für Region "${REGION}" aktualisiert.`);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[credentials] Fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Inventur: Vorschau abrufen (nur lesen, schreibt nie auf Welo) ─────────
// Manuell aus index.html angestoßen ("🔄 Chạy so sánh mới"), NICHT Teil von
// runAll()/dem täglichen Zeitplan — Inventur ist nur ein paar Tage im Monat
// relevant, jeden Tag mitlaufen zu lassen wäre unnötige Login-Versuche.
app.post('/internal/inventur-diff', requireManager, async (req, res) => {
  try {
    const result = await runFile('sync-inventur-diff.js', 'Inventur-Vorschau', [], 15 * 60 * 1000);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Inventur: EINE Filiale/Monat wirklich in Welo eintragen ───────────────
// Nur nachdem ein Manager die Vorschau für GENAU DIESE previewId geprüft und
// freigegeben hat (kein "alle freigeben" — bewusst pro Filiale einzeln).
app.post('/internal/inventur-apply', requireManager, async (req, res) => {
  if (!REGION || !req.managerRegions.includes(REGION)) {
    return res.status(403).json({ error: 'not authorized for this region' });
  }
  const previewId = req.body && req.body.previewId;
  if (!previewId) return res.status(400).json({ error: 'previewId fehlt' });
  try {
    const result = await runFile('sync-inventur-apply.js', `Inventur anwenden (${previewId})`, [previewId], 5 * 60 * 1000);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Schwan-Reklamation: Vorschau anstoßen (liest nur), Freigabe abschicken ──
// Zwei Stufen wie beim Inventur-Welo-Abgleich: sync-schwan-lookup.js liest
// nur und schreibt eine Vorschau (kostenstellen-genau, per Auftrag/Artikel-
// Kandidaten), sync-schwan-submit.js erstellt danach die ECHTE Reklamation
// bei Schwan — aber NUR für genau die eine wareneingangId, deren Auswahl
// der Manager im Assistenten (index.html, Panel Wareneingang) zuvor selbst
// bestätigt hat (schwan_matches/{id}.confirmedSelection) — kein "alle
// senden" (Auftrag t.duong 11.09.2026, gleiche Vorsicht wie bei Inventur).
app.post('/internal/schwan-lookup', requireManager, async (req, res) => {
  try {
    const result = await runFile('sync-schwan-lookup.js', 'Schwan-Reklamation Vorschau', [], 10 * 60 * 1000);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/internal/schwan-submit', requireManager, async (req, res) => {
  const wareneingangId = req.body && req.body.wareneingangId;
  if (!wareneingangId) return res.status(400).json({ error: 'wareneingangId fehlt' });
  try {
    const result = await runFile('sync-schwan-submit.js', `Schwan-Reklamation einreichen (${wareneingangId})`, [wareneingangId], 5 * 60 * 1000);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Wochen-Check: Urlaub/Krankmeldung dieser Woche vs. Welo (nur lesen) ───
// Manuell aus index.html angestoßen ("🔄 Vergleich neu laufen lassen"),
// NICHT Teil von runAll()/dem täglichen Zeitplan — läuft nur, wenn ein
// Manager es explizit prüfen will (Auftrag t.duong 10.09.2026).
app.post('/internal/week-welo-check', requireManager, async (req, res) => {
  try {
    const result = await runFile('sync-week-welo-check.js', 'Wochen-Check (Urlaub/Krank vs. Welo)', [], 10 * 60 * 1000);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Datenschutz: Krankmeldungs-Fotos automatisch nach 30 Tagen löschen ────
// Region-unabhängig (gilt für alle Gebiete gleich, s. cleanup-krankmeldung.js)
// — bewusst der gleiche Shared-Secret-Mechanismus wie die anderen
// Scheduler-Routen, kein Mensch soll das manuell auslösen müssen.
app.post('/internal/cleanup-krankmeldung-fotos', async (req, res) => {
  if (!SYNC_SHARED_SECRET || req.get('X-Sync-Secret') !== SYNC_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const result = await cleanupKrankmeldungFotos();
    res.status(200).json({ status: 'ok', ...result });
  } catch (err) {
    console.error('[cleanup-krankmeldung] Fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Mitarbeiter-Login: PID + PIN statt anonym + PID ───────────────────────
// Bewusst ohne requireManager/Shared-Secret — Mitarbeiter sind an dieser
// Stelle noch nicht angemeldet. Der Schutz gegen Erraten ist die
// PIN-Sperre in employee-auth.js (5 Fehlversuche → 15 Min. Sperre pro PID),
// nicht ein Header-Geheimnis. Region-unabhängig: läuft egal auf welcher der
// beiden Cloud-Run-Instanzen, da Admin SDK ohnehin alle Regionen sieht.
app.post('/employee/login', async (req, res) => {
  const b = req.body || {};
  const pid = typeof b.pid === 'string' ? b.pid.trim().slice(0, 40) : '';
  const pin = typeof b.pin === 'string' ? b.pin.trim() : '';
  try {
    const result = await employeeLogin(pid, pin);
    res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('[employee-login] Fehlgeschlagen:', err.message);
    res.status(status).json({ error: err.message, attemptsLeft: err.attemptsLeft });
  }
});

// ── Datenschutz: App-eigene Meldedaten ausgeschiedener Mitarbeiter löschen ──
// Region-unabhängig, gleicher Shared-Secret-Mechanismus wie die anderen
// Scheduler-Routen (siehe cleanup-departed-employees.js für die Begründung).
app.post('/internal/cleanup-departed-employees', async (req, res) => {
  if (!SYNC_SHARED_SECRET || req.get('X-Sync-Secret') !== SYNC_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const result = await cleanupDepartedEmployees();
    res.status(200).json({ status: 'ok', ...result });
  } catch (err) {
    console.error('[cleanup-departed-employees] Fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Manager-Schnellzugriff: Mitarbeiter-App als bestimmter Mitarbeiter öffnen ──
// Seit der PIN-Pflicht (employee-auth.js) funktioniert der frühere Workflow
// "Personalnummer in der Mitarbeiter-App eintippen" nicht mehr ohne den PIN
// des jeweiligen Mitarbeiters — dieser Endpunkt ersetzt ihn für den
// Gebietsleiter (Fehlerprüfung, AZ-Konto-Minusstunden schnell checken).
// Region-geprüft: ein Manager bekommt nur für Mitarbeiter der eigenen
// Region(en) ein Token, genau wie bei /credentials.
app.post('/internal/impersonate-employee', requireManager, async (req, res) => {
  const pid = req.body && req.body.pid ? String(req.body.pid).trim() : '';
  if (!pid) return res.status(400).json({ error: 'pid fehlt' });
  try {
    const db = getDb();
    const doc = await db.collection('emps').doc(pid).get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    const d = doc.data() || {};
    if (!req.managerRegions.includes(d.region)) {
      return res.status(403).json({ error: 'not authorized for this employee\'s region' });
    }
    const token = await admin.auth().createCustomToken('emp_' + pid, { pid });
    // Leichtes Audit-Log — nachvollziehbar, wer wann welchen Mitarbeiter-Account
    // zu Prüfzwecken geöffnet hat (kein Zugriff nötig, um es einzusehen — reine
    // Nachvollziehbarkeit, keine aktive Überwachungsfunktion).
    await db.collection('manager_impersonation_log').add({
      managerEmail: req.managerEmail, pid, empName: d.name || '', region: d.region || '',
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ token, name: d.name || '', filiale: d.filiale || '' });
  } catch (err) {
    console.error('[impersonate-employee] Fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Filial Radar sync server läuft auf Port ${PORT}`);
});
