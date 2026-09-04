// Einmaliges Ergänzungsskript (kein Cron-Job): trägt Zweitfiliale für die
// Mitarbeiter der 5 bislang "isolierten" West-Filialen ein (ohne jede
// Zweitfiliale-Verknüpfung), basierend auf der tatsächlich nächstgelegenen
// anderen West-Filiale (recherchiert über echte Adressen/Entfernungen,
// Auftrag t.duong 04.09.2026).
require('dotenv').config();
const { getDb } = require('./firestore-client');

const ZUORDNUNG = [
  { marktNr: '402363', zielFiliale: '402512: R-Remscheid-Wupperstraße', kmHinweis: '~37-48 km (naechste realistische Option)' },
  { marktNr: '402416', zielFiliale: '402422: E-Leverkusen-Pommernstraße', kmHinweis: '~10 km' },
  { marktNr: '402133', zielFiliale: '402422: E-Leverkusen-Pommernstraße', kmHinweis: '~8 km' },
  { marktNr: '402302', zielFiliale: '402167: R-Düsseldorf-Hauptstr.', kmHinweis: '~6,5 km' },
  { marktNr: '402414', zielFiliale: '402133: K-Köln-Thebäerstraße', kmHinweis: '~17 km' },
];

async function main() {
  const db = getDb();
  const empsSnap = await db.collection('emps').where('region', '==', 'west').where('active', '==', true).get();
  const targetMarktNrs = new Set(ZUORDNUNG.map((z) => z.marktNr));
  const zielByMarktNr = {};
  ZUORDNUNG.forEach((z) => { zielByMarktNr[z.marktNr] = z; });

  let updated = 0;
  const jobs = [];
  empsSnap.forEach((d) => {
    const v = d.data();
    const nr = (v.filiale || '').match(/^(\d+):/);
    if (!nr || !targetMarktNrs.has(nr[1])) return;
    const zuordnung = zielByMarktNr[nr[1]];
    const currentZweit = Array.isArray(v.zweit) ? v.zweit : [];
    if (currentZweit.includes(zuordnung.zielFiliale)) { console.log(`  = ${v.name} hat bereits ${zuordnung.zielFiliale} als Zweit.`); return; }
    const newZweit = currentZweit.concat([zuordnung.zielFiliale]);
    jobs.push(d.ref.update({ zweit: newZweit }).then(() => {
      console.log(`  ✓ ${v.name} (${v.filiale}) -> Zweit: ${zuordnung.zielFiliale} (${zuordnung.kmHinweis})`);
      updated++;
    }));
  });
  await Promise.all(jobs);
  console.log(`\n✓ ${updated} Mitarbeiter aktualisiert.`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
