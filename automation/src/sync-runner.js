// Gemeinsame Logik zum Ausführen der drei Sync-Skripte als Kindprozesse —
// genutzt vom lokalen Watcher (watch-and-sync.js) UND vom Cloud-Run-Server
// (server.js). Ein Ort für "welches Skript, welche Env-Variablen".
const { execFile } = require('child_process');
const path = require('path');
const { getRegionSecrets } = require('./secrets-client');

// Reihenfolge bewusst: welo-personal + umsatz zuerst (schnell, stabil), die
// zwei Axonity-Skripte zuletzt (aktuell instabil, lange Retries bei
// Fehlern) — dieselbe Überlegung wie in run-catchup-all.bat.
const SCRIPTS = [
  { key: 'welo-personal', file: 'sync-welo-personal.js', label: 'Personal & Tagesziel (Welo)' },
  { key: 'umsatz', file: 'sync-welo-umsatz.js', label: 'Umsatz (Welo)' },
  { key: 'produktion', file: 'sync-axonity-produktion.js', label: 'Produktion (Axonity)' },
  { key: 'bestellungen', file: 'sync-axonity-bestellungen.js', label: 'Bestellungen (Axonity)' },
];

const NODE_EXE = process.execPath;
const AUTOMATION_DIR = path.resolve(__dirname, '..');

// Cloud-Run-Konto mit eigener REGION (K_SERVICE wird von Cloud Run selbst
// gesetzt, keine eigene Konfiguration nötig): die von diesem Gebietsleiter
// selbst über index.html eingetragenen Zugangsdaten aus Secret Manager VOR
// dem Start des Kindprozesses in dessen env einsetzen. Muss hier und nicht im
// jeweiligen Skript selbst passieren, da die Skripte ihre Zugangsdaten als
// Konstanten beim eigenen require() lesen — für den lokalen Betrieb (kein
// K_SERVICE, z.B. Ost/West) bleibt env unverändert.
async function buildEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  if (process.env.K_SERVICE && process.env.REGION) {
    Object.assign(env, await getRegionSecrets(process.env.REGION));
  }
  return env;
}

// Führt eine beliebige Datei in src/ als eigenen Kindprozess aus — genutzt
// sowohl für die vier täglichen SCRIPTS unten als auch für die on-demand-
// only Inventur-Skripte (siehe runFile-Aufrufe in server.js), die bewusst
// NICHT in SCRIPTS/runAll() stehen, damit sie nicht jeden Tag automatisch
// mitlaufen, sondern nur wenn im Inventur-Zeitraum explizit angestoßen.
// args (optional) werden 1:1 als CLI-Argumente an das Skript durchgereicht
// (z.B. die Vorschau-Doc-ID für sync-inventur-apply.js).
async function runFile(file, label, args, timeoutMs) {
  const env = await buildEnv(file === 'sync-welo-umsatz.js' || file === 'sync-welo-personal.js'
    ? { NODE_EXTRA_CA_CERTS: path.join(AUTOMATION_DIR, 'certs', 'globalsign-gcc-r6-alphassl-ca-2025.pem') }
    : null);
  const scriptPath = path.join(AUTOMATION_DIR, 'src', file);
  return new Promise((resolve) => {
    console.log(`  → ${label} …`);
    execFile(NODE_EXE, [scriptPath, ...(args || [])], { cwd: AUTOMATION_DIR, env, timeout: timeoutMs || 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      resolve({ ok: !err, error: err ? (stderr || err.message).trim() : null, stdout });
    });
  });
}

async function runScript(script) {
  const result = await runFile(script.file, script.label);
  return { key: script.key, ok: result.ok, error: result.error };
}

async function runOne(key) {
  const script = SCRIPTS.find((s) => s.key === key);
  if (!script) throw new Error(`Unbekanntes Sync-Skript: ${key}`);
  return runScript(script);
}

// onProgress(optional): wird VOR jedem Skript mit {step, total, label, key}
// aufgerufen (step ist 1-basiert) — damit das Dashboard einen echten
// Fortschrittsbalken zeigen kann statt nur "läuft gerade" (Auftrag t.duong
// 14.09.2026), statt erst nach ALLEN vier Skripten irgendeine Rückmeldung
// zu bekommen.
async function runAll(onProgress) {
  const results = [];
  for (let i = 0; i < SCRIPTS.length; i++) {
    const script = SCRIPTS[i];
    if (onProgress) { try { onProgress({ step: i + 1, total: SCRIPTS.length, label: script.label, key: script.key }); } catch (e) { /* Fortschritts-Callback darf den Lauf nie abbrechen */ } }
    results.push(await runScript(script));
  }
  return results;
}

module.exports = { SCRIPTS, runScript, runOne, runAll, runFile };
