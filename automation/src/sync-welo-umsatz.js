// Liest den persönlichen CSV-Export von Welo/SuCi-Net (Statistiken > Statistik
// Exporter) und schreibt die Umsatzdaten pro Filiale/Monat nach Firestore.
//
// Braucht keinen Browser — reiner HTTP-GET + CSV-Parsing. Für den täglichen
// Cron-Lauf gedacht (Welo aktualisiert die laufende Periode "tagesaktuell").
require('dotenv').config();
const { parse } = require('csv-parse/sync');
const { getDb, admin } = require('./firestore-client');

const CSV_URL = process.env.WELO_STATISTIK_URL;
const COLLECTION = 'filiale_umsatz';

// Welo führt diese eine Filiale unter ihrer SushiTime-Nummer statt der
// Axonity-Kostenstelle (vermutlich wegen der EDEKA-Hessenring-Regie-Struktur
// dieses Standorts) — manuell bestätigt von t.duong am 2026-08-22: 401125
// (Ratio Baunatal, Axonity-Kostenstelle) ist die richtige, kanonische Nummer.
const MARKTNR_ALIASES = {
  '611125': '401125', // Ratio Baunatal
};

function parseGermanNumber(raw) {
  if (raw == null || raw === '') return 0;
  const n = parseFloat(String(raw).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Welo-Export antwortete mit HTTP ${res.status}`);
  }
  return res.text();
}

function parseRows(csvText) {
  const records = parse(csvText, {
    delimiter: ';',
    quote: '"',
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records
    .filter((r) => r['Marktnummer'] && r['Periode'])
    .map((r) => {
      const periode = String(r['Periode']).slice(0, 7); // "2026-07-01" -> "2026-07"
      const marktNrRaw = String(r['Marktnummer']).trim();
      const marktNr = MARKTNR_ALIASES[marktNrRaw] || marktNrRaw;
      return {
        docId: `${marktNr}_${periode}`,
        marktNr,
        periode,
        kundengruppe: r['Kundengruppe-Name'] || '',
        teammanager: r['TM'] || '',
        umsatz: parseGermanNumber(r['Umsatz']),
        personalkosten: parseGermanNumber(r['Personalkosten Gesamt']),
        ertrag: parseGermanNumber(r['Ertrag']),
        produktivitaet: parseGermanNumber(r['Produktivität']),
        qualitaetMonat: parseGermanNumber(r['Qualität M']),
      };
    });
}

async function main() {
  if (!CSV_URL) {
    throw new Error('WELO_STATISTIK_URL fehlt in der .env-Datei.');
  }

  console.log('Lade Welo-Statistik-Export…');
  const csvText = await fetchCsv(CSV_URL);
  const rows = parseRows(csvText);
  console.log(`${rows.length} Zeilen geparst.`);

  const db = getDb();
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  rows.forEach((row) => {
    const ref = db.collection(COLLECTION).doc(row.docId);
    batch.set(
      ref,
      {
        marktNr: row.marktNr,
        periode: row.periode,
        kundengruppe: row.kundengruppe,
        teammanager: row.teammanager,
        umsatz: row.umsatz,
        personalkosten: row.personalkosten,
        ertrag: row.ertrag,
        produktivitaet: row.produktivitaet,
        qualitaetMonat: row.qualitaetMonat,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  await batch.commit();
  console.log(`✓ ${rows.length} Filiale/Monat-Datensätze in "${COLLECTION}" geschrieben.`);
}

main().catch((err) => {
  console.error('✗ Sync fehlgeschlagen:', err.message);
  if (err.cause) console.error('  Ursache:', err.cause.message || err.cause);
  process.exitCode = 1;
});
