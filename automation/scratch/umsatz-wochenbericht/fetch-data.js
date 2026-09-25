// Holt die Rohdaten für den wöchentlichen Umsatz-Maßnahmenbericht:
// - monatliche Umsatzhistorie (filiale_umsatz, Welo) pro Filiale
// - tägliches Tagesziel (tagesziel) der letzten Wochen
// - tägliche Ist-Umsätze (filiale_produktion, Axonity) derselben Tage
//
// Aufruf:  node fetch-data.js <marktNr1,marktNr2,...> <ausgabe.json>
// Wiederverwendbar für jeden Wochenbericht — einfach dieselbe/eine neue
// Kostenstellen-Liste übergeben.
const fs = require('fs');
const path = require('path');
const { getDb } = require(path.join(__dirname, '..', '..', 'src', 'firestore-client'));

async function fetchStore(db, marktNr) {
  const [monthlySnap, tzSnap, prodSnap, metaDoc] = await Promise.all([
    db.collection('filiale_umsatz').where('marktNr', '==', marktNr).get(),
    db.collection('tagesziel').where('marktNr', '==', marktNr).get(),
    db.collection('filiale_produktion').where('marktNr', '==', marktNr).get(),
    db.collection('filialen_meta').doc(marktNr).get(),
  ]);
  const monthly = [];
  monthlySnap.forEach((d) => monthly.push(d.data()));
  monthly.sort((a, b) => (a.periode || '').localeCompare(b.periode || ''));

  const tagesziel = [];
  tzSnap.forEach((d) => tagesziel.push(d.data()));
  tagesziel.sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));

  const produktion = [];
  prodSnap.forEach((d) => produktion.push(d.data()));
  produktion.sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));

  const meta = metaDoc.exists ? metaDoc.data() : null;

  return {
    marktNr,
    name: (meta && meta.name) || (tagesziel[tagesziel.length - 1] || {}).marktname || marktNr,
    ort: meta && meta.ort,
    monthly: monthly.map((m) => ({ periode: m.periode, umsatz: m.umsatz, ertrag: m.ertrag, personalkosten: m.personalkosten, produktivitaet: m.produktivitaet })),
    tagesziel: tagesziel.map((t) => ({ datum: t.datum, ziel: t.ziel, produktionsziel: t.produktionsziel, umsatzVorjahr: t.umsatzVorjahr, effektiverFaktor: t.effektiverFaktor })),
    produktion: produktion.map((p) => ({ datum: p.datum, umsatzHeute: p.umsatzHeute, umsatz30Tage: p.umsatz30Tage })),
  };
}

async function main() {
  const [marktNrArg, outArg] = process.argv.slice(2);
  if (!marktNrArg || !outArg) {
    console.error('Aufruf: node fetch-data.js <marktNr1,marktNr2,...> <ausgabe.json>');
    process.exit(1);
  }
  const marktNrs = marktNrArg.split(',').map((s) => s.trim()).filter(Boolean);
  const db = getDb();
  const out = {};
  for (const nr of marktNrs) {
    out[nr] = await fetchStore(db, nr);
    console.log(`✓ ${nr}: ${out[nr].monthly.length} Monate, ${out[nr].tagesziel.length} Tagesziel-Tage, ${out[nr].produktion.length} Produktions-Tage`);
  }
  fs.writeFileSync(outArg, JSON.stringify(out, null, 2));
  console.log('geschrieben:', outArg);
  process.exit(0);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
