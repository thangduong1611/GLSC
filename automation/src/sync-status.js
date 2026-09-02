// Gemeinsamer Helfer: jedes Sync-Skript schreibt am Ende seines Laufs (egal
// ob erfolgreich oder nicht) einen Status-Datensatz nach sync_status/{key}
// — unabhängig vom eigentlichen Datenergebnis. Grund: Axonity ändert seine
// Seitenstruktur öfters ohne Ankündigung (siehe Vorfall vom 25.08.2026), und
// ein kaputter Scraper schreibt sonst entweder gar nichts (fällt erst auf,
// wenn im Dashboard veraltete Zahlen stehen) oder überspringt einzelne
// Filialen still. Mit diesem Status-Dokument kann das Dashboard sofort
// "⚠️ Sync kaputt" anzeigen statt falsche/alte Zahlen unkommentiert zu zeigen.
const { admin } = require('./firestore-client');

// status: 'ok' | 'warn' (einzelne Ausfälle) | 'error' (Sync komplett oder
// mutmaßlich strukturell kaputt). lastOkAt wird nur bei status 'ok'
// mitgeschrieben (via merge bleibt der alte Wert sonst erhalten) — so zeigt
// das Dashboard auch im Fehlerfall "letzter erfolgreicher Lauf: ...".
async function writeSyncStatus(db, key, { status, message, total = null, succeeded = null, failed = null, failedDetails = null }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = { key, status, message, total, succeeded, failed, ranAt: now };
  // Explizit löschen statt weglassen: mit {merge:true} bliebe sonst die
  // failedDetails-Liste eines früheren fehlgeschlagenen Laufs für immer
  // stehen, auch nachdem der aktuelle Lauf wieder sauber durchlief.
  payload.failedDetails = (failedDetails && failedDetails.length) ? failedDetails.slice(0, 20) : admin.firestore.FieldValue.delete();
  if (status === 'ok') payload.lastOkAt = now;
  await db.collection('sync_status').doc(key).set(payload, { merge: true });
}

module.exports = { writeSyncStatus };
