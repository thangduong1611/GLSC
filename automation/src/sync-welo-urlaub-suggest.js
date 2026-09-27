// Urlaub-Vorschläge aus Welo für den Dienstplan (index.html, Panel Dienstplan,
// Knopf "📡 Urlaub aus Welo aktualisieren"). Liest für eine Liste konkreter
// Mitarbeiter (die aktuelle Filiale/Team im Dienstplan) die Welo-Jahresansicht
// und schreibt NUR die Urlaub-Tage nach welo_urlaub_suggest/{empId}-{jahr} —
// eine reine Anzeige-/Vorschlags-Quelle, kein Ersatz für die App-Genehmigung
// (dpAbsenceFor() in index.html bleibt unverändert die einzige Quelle für
// gesperrte Urlaub/Krank-Zellen). Schreibt NIE etwas auf Welo.
//
// Aufruf: node sync-welo-urlaub-suggest.js <jahr> <personalnr1,personalnr2,...>
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const { login, makeYearCache } = require('./welo-jahresansicht');

async function main() {
  if (!process.env.WELO_USER || !process.env.WELO_PASSWORD) throw new Error('WELO_USER/WELO_PASSWORD fehlen.');
  const year = process.argv[2];
  const empIdsArg = process.argv[3] || '';
  const empIds = empIdsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (!year || !empIds.length) throw new Error('Aufruf: node sync-welo-urlaub-suggest.js <jahr> <personalnr1,personalnr2,...>');

  const db = getDb();
  const empDocs = await Promise.all(empIds.map((id) => db.collection('emps').doc(id).get()));
  const empInfo = {};
  empDocs.forEach((doc, i) => {
    if (!doc.exists) { console.warn(`  ⚠ emps/${empIds[i]} nicht gefunden — wird übersprungen.`); return; }
    const v = doc.data();
    empInfo[empIds[i]] = { name: v.name || '', region: v.region || null };
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const results = [];
  try {
    console.log('Login bei Welo …');
    const sessionBase = await login(page);
    const getYear = makeYearCache(page, sessionBase);

    for (const empId of empIds) {
      if (!empInfo[empId]) continue;
      const dayMap = await getYear(empId, year);
      const days = Object.keys(dayMap).filter((iso) => dayMap[iso] === 'Urlaub').sort();
      results.push({ empId, year, ...empInfo[empId], days });
    }
  } finally {
    await browser.close();
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  results.forEach((r) => {
    batch.set(db.collection('welo_urlaub_suggest').doc(`${r.empId}-${r.year}`), { ...r, updatedAt: now });
  });
  await batch.commit();

  const totalDays = results.reduce((n, r) => n + r.days.length, 0);
  console.log(`✓ Fertig. ${results.length} Mitarbeiter verarbeitet, ${totalDays} Urlaub-Tag(e) für ${year} in welo_urlaub_suggest gespeichert.`);
}

module.exports = { main };
if (require.main === module) {
  main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
}
