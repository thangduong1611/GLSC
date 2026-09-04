// Wiederverwendbares Skript (kein Cron-Job): berechnet für Mitarbeiter mit
// bekannter Wohnadresse (emp_welo.strasse/plz/ort, siehe
// sync-employee-address.js) die nächstgelegene Filiale (aus filialen_meta)
// per echter Luftlinien-Entfernung (Geocoding via OpenStreetMap Nominatim,
// kostenlos, kein API-Key nötig — Nutzungsrichtlinie: max. 1 Anfrage/Sek.,
// eigener User-Agent).
//
// Aufruf:
//   node compute-nearest-filiale.js                 -> alle Mitarbeiter ohne Zweitfiliale
//   node compute-nearest-filiale.js 340301 350153    -> nur diese Personal-Nrn.
//   node compute-nearest-filiale.js --apply          -> Ergebnis zusätzlich als
//                                                        emps.zweit eintragen (nur
//                                                        wenn noch KEINE Zweitfiliale
//                                                        gesetzt ist, sonst nur Vorschlag)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'GLSC-Filial-Radar/1.0 (internal HR tool, contact: t.duong)';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function geocodeQuery(q) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} fuer "${q}"`);
  const arr = await res.json();
  if (!arr.length) return null;
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display: arr[0].display_name, praezise: true };
}
// Erst Straße+Hausnummer versuchen; wenn die (z.B. bei sehr kleinen/ländlichen
// Straßen) nicht gefunden wird, auf PLZ+Ort zurückfallen (Stadt-Mittelpunkt -
// für den Zweck "welche Filiale ist am nächsten" reicht diese Genauigkeit).
async function geocode(strasse, plz, ort, land = 'Deutschland') {
  const q1 = [strasse, `${plz} ${ort}`, land].filter(Boolean).join(', ');
  const g1 = await geocodeQuery(q1);
  if (g1) return g1;
  await sleep(1100);
  const q2 = [`${plz} ${ort}`, land].filter(Boolean).join(', ');
  const g2 = await geocodeQuery(q2);
  if (g2) return { ...g2, praezise: false };
  return null;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function main() {
  const db = getDb();
  const APPLY = process.argv.includes('--apply');
  const nurDiese = process.argv.slice(2).filter((a) => /^\d+$/.test(a));

  console.log('Lade Filialen (filialen_meta) …');
  const filSnap = await db.collection('filialen_meta').get();
  const filialen = [];
  filSnap.forEach((d) => filialen.push(d.data()));
  console.log(`  ${filialen.length} Filialen gefunden.`);

  // Filial-Koordinaten geocodieren (mit Cache in filialen_meta.lat/lon, falls schon vorhanden)
  console.log('Geocodiere Filialen-Adressen …');
  for (const f of filialen) {
    if (f.lat != null && f.lon != null) continue;
    const g = await geocode(f.strasse, f.plz, f.ort);
    if (g) { f.lat = g.lat; f.lon = g.lon; await db.collection('filialen_meta').doc(f.marktNr).set({ lat: g.lat, lon: g.lon }, { merge: true }); }
    else console.warn(`  ⚠ Keine Koordinaten fuer Filiale ${f.marktNr} (${f.name})`);
    await sleep(1100);
  }

  console.log('Lade Mitarbeiter mit Adresse (emp_welo) …');
  const weloSnap = await db.collection('emp_welo').get();
  const empsSnap = await db.collection('emps').get();
  const empsById = {};
  empsSnap.forEach((d) => { empsById[d.id] = d.data(); });

  // Regional-/Gebietsleiter-Rollen sind nicht an 1 Filiale gebunden -> eine
  // einzelne "nächste Filiale" ergibt für sie keinen Sinn (Auftrag t.duong
  // 04.09.2026: Herr Chu 550042 "Region Ost - GL + QMB" und Herr Nguyen,
  // Viet Hoang 550198 "Gebietsleiter" gehören nicht in diese Zuordnung).
  // Erkennung ueber emp_welo.taetigkeit statt einer festen ID-Liste, damit
  // zukünftige GL-Rollen automatisch mit erkannt werden.
  const GEBIETSLEITER_MUSTER = /\bGL\b|Gebietsleiter/i;
  let kandidaten = [];
  let uebersprungenGL = [];
  weloSnap.forEach((d) => {
    const v = d.data();
    const e = empsById[d.id];
    if (!e || e.active === false) return;
    if (GEBIETSLEITER_MUSTER.test(v.taetigkeit || '')) { uebersprungenGL.push(v.name); return; }
    if (nurDiese.length && !nurDiese.includes(d.id)) return;
    if (!nurDiese.length && Array.isArray(e.zweit) && e.zweit.length) return; // schon zugeordnet -> ueberspringen (ausser explizit angegeben)
    if (!v.strasse && !v.ort) return; // keine Adresse bekannt
    kandidaten.push({ id: d.id, name: v.name, strasse: v.strasse, plz: v.plz, ort: v.ort, filiale: e.filiale, region: e.region });
  });
  if (uebersprungenGL.length) console.log(`  ${uebersprungenGL.length} Gebietsleiter-Rolle(n) uebersprungen (nicht an 1 Filiale gebunden): ${uebersprungenGL.join(', ')}`);
  console.log(`  ${kandidaten.length} Mitarbeiter zu berechnen.`);

  const ergebnisse = [];
  for (const k of kandidaten) {
    const g = await geocode(k.strasse, k.plz, k.ort);
    await sleep(1100);
    if (!g) { console.warn(`  ⚠ Keine Koordinaten fuer ${k.name} (${k.strasse}, ${k.plz} ${k.ort})`); continue; }
    const kandidatenFilialen = filialen.filter((f) => f.lat != null && f.name !== k.filiale && f.region === k.region);
    const distances = kandidatenFilialen.map((f) => ({ filiale: f.name, marktNr: f.marktNr, km: haversineKm(g, f) })).sort((a, b) => a.km - b.km);
    const naechste = distances[0];
    ergebnisse.push({ id: k.id, name: k.name, filiale: k.filiale, wohnort: `${k.plz} ${k.ort}`, praezise: g.praezise, naechsteFiliale: naechste ? naechste.filiale : null, km: naechste ? Math.round(naechste.km * 10) / 10 : null, top3: distances.slice(0, 3) });
    console.log(`  ${k.name} (${k.ort}${g.praezise ? '' : ', Stadt-Mittelpunkt'}) -> ${naechste ? naechste.filiale + ' (' + Math.round(naechste.km * 10) / 10 + ' km)' : 'keine Filiale gefunden'}`);
  }

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'naechste_filiale_vorschlag.json'), JSON.stringify(ergebnisse, null, 2), 'utf8');
  console.log(`\n✓ ${ergebnisse.length} Ergebnisse geschrieben nach output/naechste_filiale_vorschlag.json`);

  if (APPLY) {
    console.log('\n⏳ Trage als Zweitfiliale ein (nur wenn noch keine gesetzt) …');
    let applied = 0;
    for (const erg of ergebnisse) {
      if (!erg.naechsteFiliale) continue;
      const ref = db.collection('emps').doc(erg.id);
      const doc = await ref.get();
      const cur = doc.data();
      const curZweit = Array.isArray(cur.zweit) ? cur.zweit : [];
      if (curZweit.length) { console.log(`  = ${erg.name} hat bereits eine Zweitfiliale, ueberspringe.`); continue; }
      await ref.update({ zweit: [erg.naechsteFiliale] });
      applied++;
      console.log(`  ✓ ${erg.name} -> Zweit: ${erg.naechsteFiliale}`);
    }
    console.log(`\n✓ ${applied} Mitarbeiter aktualisiert.`);
  } else {
    console.log('\n(Nur Vorschlag berechnet, NICHTS in emps geschrieben. Mit --apply erneut aufrufen zum Eintragen.)');
  }
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
