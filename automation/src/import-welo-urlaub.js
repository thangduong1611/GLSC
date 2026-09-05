// Importiert die in Welo bereits gebuchten, aber in der App fehlenden
// Urlaub-Zeitraeume (siehe compare-welo-urlaub.js) als neue Urlaub-Dokumente
// (Auftrag t.duong 05.09.2026: "cac urlaub duoc duyet do phai duoc luu trong
// app"). source:'welo' (NICHT 'hr') - klar von automatisch geplanten
// (Gebietsleiter-Vorschlag) und selbst beantragten Urlauben unterschieden,
// damit die App den richtigen Hinweis zeigt ("Aus Welo übernommen" statt
// "Vorschlag Gebietsleiter").
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const IN_PATH = path.join(__dirname, '..', 'output', 'welo_vs_app_vergleich.json');
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }

async function main() {
  const db = getDb();
  const APPLY = process.argv.includes('--apply');
  const report = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));

  const empsSnap = await db.collection('emps').get();
  const empsById = {}; empsSnap.forEach((d) => { empsById[d.id] = d.data(); });

  let anzahl = 0;
  for (const [id, r] of Object.entries(report)) {
    if (!r.fehlendInApp.length) continue;
    const e = empsById[id];
    if (!e) { console.warn(`  ⚠ ${r.name} (${id}): kein emps-Dokument gefunden, uebersprungen.`); continue; }
    for (const block of r.fehlendInApp) {
      anzahl++;
      const docId = `${id}_${block.from}_${block.to}`;
      const doc = {
        empId: id, name: r.name.replace(/(Sushi Shop MA|Shop MA|Sushi Shopleiterin)$/, '').trim(),
        filiale: e.filiale, region: e.region,
        from: block.from, to: block.to, status: 'approved',
        created: new Date().toISOString(), decidedAt: new Date().toISOString(),
        source: 'welo', note: 'Aus Welo übernommen (bereits dort gebucht, Auftrag t.duong 05.09.2026)',
      };
      console.log(`${APPLY ? '✓' : '(Vorschau)'} ${doc.name} (${id}) -> ${block.from} - ${block.to}  [${e.filiale}]`);
      if (APPLY) {
        await db.collection('filialen').doc(fbSlug(e.filiale)).collection('urlaub').doc(docId).set(doc);
      }
    }
  }
  console.log(`\n${anzahl} Eintraege ${APPLY ? 'importiert' : 'wuerden importiert (Vorschau, --apply zum Schreiben)'}.`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
