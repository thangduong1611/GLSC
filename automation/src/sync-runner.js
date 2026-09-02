// Gemeinsame Logik zum Ausführen der drei Sync-Skripte als Kindprozesse —
// genutzt vom lokalen Watcher (watch-and-sync.js) UND vom Cloud-Run-Server
// (server.js). Ein Ort für "welches Skript, welche Env-Variablen".
const { execFile } = require('child_process');
const path = require('path');

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

function runScript(script) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (script.key === 'umsatz' || script.key === 'welo-personal') {
      env.NODE_EXTRA_CA_CERTS = path.join(AUTOMATION_DIR, 'certs', 'globalsign-gcc-r6-alphassl-ca-2025.pem');
    }
    const scriptPath = path.join(AUTOMATION_DIR, 'src', script.file);
    console.log(`  → ${script.label} …`);
    execFile(NODE_EXE, [scriptPath], { cwd: AUTOMATION_DIR, env, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      resolve({ key: script.key, ok: !err, error: err ? err.message : null });
    });
  });
}

async function runOne(key) {
  const script = SCRIPTS.find((s) => s.key === key);
  if (!script) throw new Error(`Unbekanntes Sync-Skript: ${key}`);
  return runScript(script);
}

async function runAll() {
  const results = [];
  for (const script of SCRIPTS) {
    results.push(await runScript(script));
  }
  return results;
}

module.exports = { SCRIPTS, runScript, runOne, runAll };
