// Einmalig (20.09.2026): verschiebt die bcrypt-PIN-Hashes aus emps/{pid}.pinHash
// nach emp_pins/{pid} (für Clients unlesbar, s. Kommentar in employee-auth.js)
// und lässt in emps nur den Marker PIN_MARKER stehen. Idempotent: bereits
// migrierte Dokumente (Marker statt Hash) werden übersprungen, mehrfaches
// Ausführen ist unschädlich.
//
// Jedes Dokument läuft in einer eigenen Transaktion — läuft parallel ein Login
// oder ein Reset auf demselben Mitarbeiter, wird die Transaktion wiederholt,
// statt einen frischen PIN mit dem alten Hash zu überschreiben.
//
// Aufruf:  node src/migrate-pin-hashes.js [--dry-run] [--only=pid1,pid2] [--backup=datei.json]
//   --dry-run  nur zählen, nichts schreiben
//   --only     nur diese Personalnummern (z.B. für Tests mit Fake-Dokumenten)
//   --backup   schreibt vorab {pid:{pinHash,pinSetAt}} in diese Datei (enthält
//              echte Hashes — nach erfolgreicher Prüfung wieder löschen)
require('dotenv').config();
const fs = require('fs');
const { getDb, admin } = require('./firestore-client');
const { PIN_MARKER } = require('./employee-auth');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)) : null;
const backupArg = args.find((a) => a.startsWith('--backup='));
const BACKUP = backupArg ? backupArg.slice(9) : null;

async function migrateOne(db, pid) {
  const ref = db.collection('emps').doc(pid);
  const pinRef = db.collection('emp_pins').doc(pid);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const d = doc.data() || {};
    if (!d.pinHash || d.pinHash === PIN_MARKER) return null;
    tx.set(pinRef, {
      pinHash: d.pinHash,
      pinSetAt: d.pinSetAt || admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(ref, { pinHash: PIN_MARKER, pinSetAt: admin.firestore.FieldValue.delete() });
    return d.pinHash;
  });
}

async function main() {
  const db = getDb();
  const snap = await db.collection('emps').get();
  let markerSchon = 0, keinPin = 0;
  const kandidaten = [];
  snap.forEach((doc) => {
    if (ONLY && !ONLY.has(doc.id)) return;
    const d = doc.data() || {};
    if (!d.pinHash) keinPin++;
    else if (d.pinHash === PIN_MARKER) markerSchon++;
    else kandidaten.push({ pid: doc.id, hash: d.pinHash, setAt: d.pinSetAt && d.pinSetAt.toDate ? d.pinSetAt.toDate().toISOString() : null });
  });
  console.log(`emps geprüft: ${ONLY ? 'nur ' + ONLY.size + ' ausgewählte' : snap.size}, ohne PIN: ${keinPin}, schon migriert (Marker): ${markerSchon}, noch mit Hash in emps: ${kandidaten.length}`);
  if (DRY) { console.log('--dry-run: nichts geschrieben.'); return; }
  if (!kandidaten.length) { console.log('Nichts zu tun.'); return; }

  if (BACKUP) {
    const obj = {};
    kandidaten.forEach((k) => { obj[k.pid] = { pinHash: k.hash, pinSetAt: k.setAt }; });
    fs.writeFileSync(BACKUP, JSON.stringify(obj, null, 2));
    console.log(`Backup geschrieben: ${BACKUP} (${kandidaten.length} Einträge)`);
  }

  let ok = 0, fehler = 0, uebersprungen = 0;
  for (const k of kandidaten) {
    try {
      const hash = await migrateOne(db, k.pid);
      if (hash === null) { uebersprungen++; continue; } // zwischenzeitlich schon geändert/zurückgesetzt
      const [pinDoc, empDoc] = await Promise.all([db.collection('emp_pins').doc(k.pid).get(), db.collection('emps').doc(k.pid).get()]);
      const gut = pinDoc.exists && pinDoc.data().pinHash === hash && empDoc.data().pinHash === PIN_MARKER && empDoc.data().pinSetAt === undefined;
      if (!gut) { fehler++; console.error(`✗ ${k.pid}: Verifikation fehlgeschlagen`); }
      else ok++;
    } catch (e) {
      fehler++; console.error(`✗ ${k.pid}: ${e.message}`);
    }
  }
  console.log(`Ergebnis: ${ok} migriert und verifiziert, ${uebersprungen} übersprungen (zwischenzeitlich geändert), ${fehler} Fehler.`);
  if (fehler) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => { console.error('✗ Migration fehlgeschlagen:', e.message); process.exit(1); });
