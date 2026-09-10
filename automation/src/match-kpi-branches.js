// Ordnet Kostenstellen aus dem BWA/KPI-PDF (z.B. "20XX_XX_XX Auswertung KPI
// X Monate.pdf") den ECHTEN emps.filiale-Werten zu, damit Kurznachrichten
// pro Filiale (news-Collection, Feld "filiale") wirklich bei den richtigen
// Mitarbeitern ankommen. Siehe .claude/skills/kpi-auswertung-nachrichten/SKILL.md.
//
// Warum nötig: das PDF nennt Filialen oft anders/kürzer als die App
// (z.B. "Bovenden-Industriestraße" im PDF vs. "402207: E-Bovenden-
// Industriestraße" in emps.filiale) — teils auch mit echten Namens-
// Unterschieden ("Friederichs" im PDF vs. "Friedrich" echt, Kostenstelle
// 402302, live festgestellt 08.09.2026). Ohne exakten Match landet eine
// Nachricht bei niemandem, weil mitarbeiter.html streng auf Gleichheit
// filtert (siehe maStartFbNews in mitarbeiter.html).
//
// Aufruf: node src/match-kpi-branches.js <input.json> [output.json]
// input.json: [{ kostenstelle, pdfName, ...beliebige weitere Felder z.B. months }]
// output.json: dieselben Objekte + { filiale (echter emps.filiale-String),
// region, matched: true|false }. Unmatched-Einträge NICHT automatisch
// weiterverwenden — vor dem Versenden von Hand klären (z.B. Kostenstelle im
// PDF falsch abgetippt, oder Filiale in der App unter anderer Nummer/noch
// nicht angelegt).
require('dotenv').config();
const fs = require('fs');
const { getDb } = require('./firestore-client');

async function loadFilialeMap() {
  const db = getDb();
  const snap = await db.collection('emps').where('active', '==', true).get();
  const map = {}; // kostenstelle -> { filiale, region }
  snap.forEach((doc) => {
    const v = doc.data();
    const m = /^(\d{6}):\s*/.exec(v.filiale || '');
    if (!m) return;
    map[m[1]] = { filiale: v.filiale, region: v.region || null };
  });
  return map;
}

async function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3] || inPath.replace(/\.json$/, '') + '_matched.json';
  if (!inPath) throw new Error('Aufruf: node src/match-kpi-branches.js <input.json> [output.json]');

  const input = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const filialeMap = await loadFilialeMap();

  const result = input.map((entry) => {
    const kst = String(entry.kostenstelle || '').trim();
    const hit = filialeMap[kst];
    return {
      ...entry,
      filiale: hit ? hit.filiale : null,
      region: hit ? hit.region : null,
      matched: !!hit,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  const unmatched = result.filter((r) => !r.matched);
  console.log(`✓ ${result.length - unmatched.length}/${result.length} Kostenstellen erfolgreich zugeordnet.`);
  if (unmatched.length) {
    console.log(`⚠ ${unmatched.length} NICHT gefunden — von Hand prüfen, bevor Nachrichten dafür verschickt werden:`);
    unmatched.forEach((u) => console.log(`   Kostenstelle ${u.kostenstelle} ("${u.pdfName || '?'}") — keine passende emps.filiale gefunden.`));
  }
  console.log('Gespeichert:', outPath);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
