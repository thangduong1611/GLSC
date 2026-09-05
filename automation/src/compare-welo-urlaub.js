// Vergleicht die aus Welo gescannten Urlaub-Bloecke (welo_urlaub_scan.json,
// siehe scrape-welo-urlaub.js) mit den in der App gespeicherten Urlaub-
// Buchungen (Firestore collectionGroup 'urlaub') fuer Sep-Dez 2026 (Auftrag
// t.duong 05.09.2026).
//
// Vor dem Vergleich werden Welo-Urlaub-Bloecke, die nur durch einen
// 1-Tages-"Unbezahlt"-Eintrag an einem SONNTAG getrennt sind, zu einem
// durchgehenden Zeitraum verschmolzen - Welo markiert den Sonntag innerhalb
// eines Urlaubs separat als "Unbezahlt" (live bestaetigt), waehrend die App
// denselben Sonntag einfach unbezahlt "durchlaufen" laesst, ohne ihn als
// eigenen Block zu fuehren (siehe endForChargedDays in den Planungsskripten).
// Ohne dieses Verschmelzen wuerde jede echte mehrwoechige Welo-Buchung
// faelschlich als viele kurze, "fehlende" Bloecke erscheinen.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const IN_PATH = path.join(__dirname, '..', 'output', 'welo_urlaub_scan.json');
const OUT_PATH = path.join(__dirname, '..', 'output', 'welo_vs_app_vergleich.json');

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function isSonntag(iso) { return new Date(iso + 'T00:00:00').getDay() === 0; }
function overlaps(a1, a2, b1, b2) { return a1 <= b2 && b1 <= a2; }

function mergeUrlaubBloecke(bloecke) {
  const urlaub = bloecke.filter((b) => b.kategorie === 'Urlaub').map((b) => ({ ...b }));
  const unbezahlt = bloecke.filter((b) => b.kategorie === 'Unbezahlt');
  urlaub.sort((a, b) => a.from.localeCompare(b.from));
  const merged = [];
  urlaub.forEach((b) => {
    const last = merged[merged.length - 1];
    if (last) {
      const gapStart = isoOf(addDays(new Date(last.to + 'T00:00:00'), 1));
      const gapEnd = isoOf(addDays(new Date(b.from + 'T00:00:00'), -1));
      const luecke = unbezahlt.find((u) => u.from === gapStart && u.to === gapEnd && isSonntag(gapStart) && gapStart === gapEnd);
      if (luecke) { last.to = b.to; return; }
    }
    merged.push({ from: b.from, to: b.to });
  });
  return merged;
}

async function main() {
  const scan = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
  const db = getDb();

  const urlSnap = await db.collectionGroup('urlaub').get();
  const appByEmp = {};
  urlSnap.forEach((d) => {
    const v = d.data();
    if (v.status === 'rejected') return;
    if (v.to < '2026-09-01' || v.from > '2026-12-31') return;
    (appByEmp[v.empId] = appByEmp[v.empId] || []).push({ from: v.from, to: v.to, status: v.status, source: v.source });
  });

  const report = {};
  Object.entries(scan).forEach(([id, v]) => {
    const weloUrlaub = mergeUrlaubBloecke(v.bloecke);
    if (!weloUrlaub.length) return;
    const appEntries = appByEmp[id] || [];
    const fehlend = weloUrlaub.filter((w) => !appEntries.some((a) => overlaps(w.from, w.to, a.from, a.to)));
    const sonstigeKategorien = v.bloecke.filter((b) => b.kategorie !== 'Urlaub' && b.kategorie !== 'Unbezahlt');
    report[id] = {
      name: v.name,
      weloUrlaub,
      appEntries,
      fehlendInApp: fehlend,
      sonstigeKategorien,
    };
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
  const mitFehlend = Object.values(report).filter((r) => r.fehlendInApp.length);
  console.log(`${Object.keys(report).length} Mitarbeiter mit Welo-Urlaub Sep-Dez verglichen.`);
  console.log(`${mitFehlend.length} davon haben mind. 1 Welo-Urlaub-Zeitraum, der NICHT in der App zu finden ist:\n`);
  mitFehlend.forEach((r) => {
    console.log(r.name);
    r.fehlendInApp.forEach((f) => console.log('   FEHLT:', f.from, '-', f.to));
    if (r.appEntries.length) r.appEntries.forEach((a) => console.log('   (App hat:', a.from, '-', a.to, a.source || 'self', ')'));
  });
  console.log('\nGespeichert:', OUT_PATH);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
