// Sucht offene, vollständig ausgefüllte Wareneingang-Reklamationen mit
// Lieferant "Schwan" (Freitext, daher unscharf abgeglichen — bekannte
// Schreibweisen in der Praxis: "Schwan Asia Food", "Schawan Asia Food"),
// holt pro Filiale (über die Kostenstellen-Nummer) die jüngsten Aufträge +
// deren Artikelkatalog von cms.schwan-asiafood.de und schreibt das Ergebnis
// als Vorschau nach schwan_matches/{wareneingangId} — OHNE irgendetwas auf
// Schwan zu erstellen (reine Leseaktion, wie sync-inventur-diff.js).
//
// Der Gebietsleiter/Admin wählt danach im Assistenten (index.html, Panel
// Wareneingang) aus den Vorschlägen den richtigen Auftrag + die richtigen
// Artikel aus — automatisches Raten wäre hier riskant, weil die Artikel im
// App-Bericht Freitext sind, Schwan aber feste Artikel-Codes je Auftrag
// verlangt (Auftrag t.duong 11.09.2026).
//
// "Schnellmeldungen" (type:'quick', nur Foto+Notiz) werden bewusst NICHT
// erfasst — ohne Lieferant/Artikel/Menge lässt sich dafür kein Schwan-
// Formular sinnvoll vorbereiten; die bleiben wie bisher für manuelle
// Bearbeitung im Wareneingang-Panel.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const schwan = require('./schwan-client');

function isSchwan(lieferant) {
  const s = (lieferant || '').toLowerCase();
  return /sch.?wan/.test(s) || s.includes('asia food') || s.includes('asiafood');
}
function extractKostenstelle(filiale) {
  const m = /^(\d{6}):/.exec(filiale || '');
  return m ? m[1] : null;
}

async function main() {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const snap = await db.collection('wareneingang').where('status', '==', 'offen').get();
  const candidates = [];
  snap.forEach((doc) => {
    const v = doc.data();
    if (v.type === 'quick') return;
    if (v.ganzeLieferungFehlt) return; // kein Artikel-Bezug moeglich, bleibt manuell
    if (!isSchwan(v.lieferant)) return;
    const kostenstelle = extractKostenstelle(v.filiale);
    if (!kostenstelle) { console.warn(`  – ${doc.id}: keine Kostenstelle aus "${v.filiale}" ableitbar, übersprungen.`); return; }
    candidates.push({ id: doc.id, data: v, kostenstelle });
  });

  console.log(`${candidates.length} offene Schwan-Wareneingang-Reklamation(en) gefunden.`);
  if (!candidates.length) return;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  try {
    console.log('Login bei Schwan …');
    await schwan.login(page);

    for (const c of candidates) {
      try {
        console.log(`\n→ ${c.id} (${c.data.filiale}, Kostenstelle ${c.kostenstelle}) …`);
        await schwan.openNewComplaintModal(page);
        const kundeLabel = await schwan.selectCustomerByKostenstelle(page, c.kostenstelle);
        console.log('  Kunde:', kundeLabel);
        const auftraege = await schwan.readAuftragCandidates(page, { scan: 30 });
        console.log(`  ${auftraege.length} Auftrag-Kandidaten gelesen.`);

        // Empfehlung für den Standard-Auftrag: zuerst über die HK-Nummer aus
        // lieferscheinNr versuchen (exakt, wenn der Mitarbeiter sie im
        // Format "HK-XXXXXX" eingetragen hat — live bestätigt 11.09.2026,
        // dass diese Nummer 1:1 der HK-Referenz im Schwan-Auftrag entspricht),
        // sonst über das zum Lieferdatum am nächsten liegende Versanddatum.
        let artikelOptions = [];
        let empfohlenerAuftrag = null;
        if (auftraege.length) {
          const hkMatch = /HK-(\d+)/.exec(c.data.lieferscheinNr || '');
          if (hkMatch) empfohlenerAuftrag = auftraege.find((a) => a.hkNr === hkMatch[1]) || null;
          if (empfohlenerAuftrag) console.log('  Auftrag über HK-Nummer gefunden:', empfohlenerAuftrag.auftragNr);

          if (!empfohlenerAuftrag) {
            const ziel = c.data.lieferdatum || '';
            empfohlenerAuftrag = auftraege.reduce((best, a) => {
              if (!ziel) return best;
              const diff = Math.abs(new Date(a.versanddatum) - new Date(ziel));
              if (!best || diff < best._diff) return Object.assign({}, a, { _diff: diff });
              return best;
            }, null) || auftraege[0];
          }

          await schwan.selectAuftragByNumber(page, empfohlenerAuftrag.auftragNr);
          await schwan.addArtikelRow(page);
          artikelOptions = await schwan.readArtikelCandidates(page, { scan: 40 });
          console.log(`  ${artikelOptions.length} Artikel-Optionen für Auftrag ${empfohlenerAuftrag.auftragNr} gelesen.`);
        }

        await db.collection('schwan_matches').doc(c.id).set({
          wareneingangId: c.id,
          empId: c.data.empId || null, empName: c.data.empName || null,
          filiale: c.data.filiale || null, region: c.data.region || null,
          kostenstelle: c.kostenstelle,
          lieferant: c.data.lieferant || null, lieferdatum: c.data.lieferdatum || null,
          lieferscheinNr: c.data.lieferscheinNr || null,
          reportedItems: (c.data.items || []).map((it) => ({
            artikel: it.artikel || '', fehlerart: it.fehlerart || '', beschreibung: it.beschreibung || '',
            mengeBestellt: it.mengeBestellt != null ? it.mengeBestellt : null,
            mengeErhalten: it.mengeErhalten != null ? it.mengeErhalten : null,
            img: it.img || null,
          })),
          lieferscheinImg: c.data.lieferscheinImg || null,
          kundeLabel: kundeLabel || null,
          auftragCandidates: auftraege,
          empfohlenerAuftrag: empfohlenerAuftrag ? { auftragNr: empfohlenerAuftrag.auftragNr, versanddatum: empfohlenerAuftrag.versanddatum } : null,
          artikelOptions: artikelOptions,
          status: 'ready_for_review',
          checkedAt: now,
        }, { merge: true });
        console.log('  ✓ Vorschau gespeichert.');
      } catch (err) {
        console.error(`  ✗ ${c.id} fehlgeschlagen:`, err.message);
        await db.collection('schwan_matches').doc(c.id).set({
          wareneingangId: c.id, kostenstelle: c.kostenstelle,
          filiale: c.data.filiale || null, region: c.data.region || null,
          status: 'lookup_error', lookupError: err.message, checkedAt: now,
        }, { merge: true });
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\n✓ Fertig.');
}

module.exports = { main, isSchwan, extractKostenstelle };
if (require.main === module) {
  main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
}
