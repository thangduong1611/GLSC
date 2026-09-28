// "Daten aus Welo aktualisieren" für den Dienstplan (index.html, Panel
// Dienstplan, Knopf "📡 Daten aus Welo aktualisieren"). Liest für eine Liste
// konkreter Mitarbeiter (die aktuelle Filiale/Team im Dienstplan):
//  - Urlaub + Krank aus der Welo-Jahresansicht (pro Mitarbeiter)
//  - Arbeitserlaubnis-/Vertrags-Fristen aus der firmenweiten Fristenliste
//    (EIN Seitenaufruf für alle Mitarbeiter, danach auf die angefragte Liste
//    gefiltert — die Originalseite zeigt Personal aller Gebiete gemischt)
// Reine Anzeige-/Vorschlagsquelle, kein Ersatz für die App-Genehmigung
// (dpAbsenceFor() in index.html bleibt unverändert die einzige Quelle für
// gesperrte Urlaub/Krank-Zellen). Schreibt NIE etwas auf Welo.
//
// Aufruf: node sync-welo-urlaub-suggest.js <jahr> <personalnr1,personalnr2,...>
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const { login, makeYearCache } = require('./welo-jahresansicht');

// Liest die firmenweite "Personal Fristenliste" (Arbeitserlaubnis-/Vertrags-
// Fristen) und gibt NUR die Einträge zurück, deren Personalnummer in
// wantedIds vorkommt. Die Seite ist alte, tief verschachtelte DynaForm-
// Tabellenware OHNE saubere <td>-Zellgrenzen (live verifiziert 28.09.2026:
// ein DOM-Ansatz über querySelectorAll('td') scheitert, weil "P-Nr." als
// eigene Zelle nicht auffindbar ist — der gesamte Tabelleninhalt hängt an
// wenigen riesigen Layout-<td>s). Robuster: den sichtbaren Text der Seite
// nehmen (document.body.innerText, dort sind Datensätze zuverlässig
// tab-getrennt) und direkt mit Regex parsen: "{P-Nr}\t...\t{B|V}:{datum}".
// "B:29.09.2026" == Feld "AE-Frist" (Arbeitserlaubnis), "V:14.10.2026" ==
// Feld "Austritt" (befristeter Vertrag läuft ab) — gegen die Stammdaten von
// 2 Beispiel-Mitarbeitern (341476, 341409) exakt verifiziert.
async function readFristenliste(page, sessionBase, wantedIds) {
  await page.goto(`${sessionBase}/pf/fristenliste/index.html`);
  const text = await page.evaluate(() => document.body.innerText);
  const wanted = new Set(wantedIds);
  const byEmp = {};
  const re = /(\d{4,8})\t[^\t\n]+\t([BV]):(\d{2})\.(\d{2})\.(\d{4})/g;
  let m;
  while ((m = re.exec(text))) {
    const [, pNr, typ, dd, mm, yyyy] = m;
    if (!wanted.has(pNr)) continue;
    const iso = `${yyyy}-${mm}-${dd}`;
    const entry = byEmp[pNr] || (byEmp[pNr] = { aeFrist: null, vertragsEnde: null });
    if (typ === 'B') entry.aeFrist = iso; else entry.vertragsEnde = iso;
  }
  return byEmp;
}

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
  let fristen = {};
  try {
    console.log('Login bei Welo …');
    const sessionBase = await login(page);
    const getYear = makeYearCache(page, sessionBase);

    for (const empId of empIds) {
      if (!empInfo[empId]) continue;
      const dayMap = await getYear(empId, year);
      const urlaub = Object.keys(dayMap).filter((iso) => dayMap[iso] === 'Urlaub').sort();
      const krank = Object.keys(dayMap).filter((iso) => dayMap[iso] === 'Krank').sort();
      results.push({ empId, year, ...empInfo[empId], urlaub, krank });
    }

    console.log('Lese Fristenliste (Arbeitserlaubnis/Vertrag) …');
    fristen = await readFristenliste(page, sessionBase, empIds.filter((id) => empInfo[id]));
  } finally {
    await browser.close();
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  results.forEach((r) => {
    batch.set(db.collection('welo_urlaub_suggest').doc(`${r.empId}-${r.year}`), { ...r, updatedAt: now });
  });
  let fristenCount = 0;
  Object.keys(fristen).forEach((empId) => {
    if (!empInfo[empId]) return;
    const f = fristen[empId];
    if (!f.aeFrist && !f.vertragsEnde) return;
    fristenCount++;
    batch.set(db.collection('welo_fristen').doc(empId), {
      empId, name: empInfo[empId].name, region: empInfo[empId].region,
      aeFrist: f.aeFrist, vertragsEnde: f.vertragsEnde, updatedAt: now,
    });
  });
  await batch.commit();

  const urlaubTage = results.reduce((n, r) => n + r.urlaub.length, 0);
  const krankTage = results.reduce((n, r) => n + r.krank.length, 0);
  console.log(`✓ Fertig. ${results.length} Mitarbeiter verarbeitet: ${urlaubTage} Urlaub-Tag(e), ${krankTage} Krank-Tag(e), ${fristenCount} mit bald ablaufender Arbeitserlaubnis/Vertrag.`);
}

module.exports = { main };
if (require.main === module) {
  main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
}
