// Sucht offene Wareneingang-Reklamationen für Lieferant "Schwan" und
// bereitet sie für den Assistenten (index.html, Panel Wareneingang) vor —
// holt pro Filiale (über die Kostenstellen-Nummer) die jüngsten Aufträge +
// deren Artikelkatalog von cms.schwan-asiafood.de und schreibt das Ergebnis
// als Vorschau nach schwan_matches/{wareneingangId} — OHNE irgendetwas auf
// Schwan zu erstellen (reine Leseaktion, wie sync-inventur-diff.js).
//
// Zwei Wege, wie eine Meldung hier landet:
//  1. Vollständiges Formular (Lieferant-Feld = "Schwan..." unscharf erkannt,
//     "Schawan Asia Food" eingeschlossen) — Auftrag wird über die HK-Nummer
//     aus lieferscheinNr gefunden, sonst über das nächstgelegene Versanddatum.
//  2. Schnellmeldung (nur Foto + Freitext-Notiz, kein Lieferant-Feld) — per
//     Claude-Vision (claude-vision.js) wird geprüft, ob das Foto ein echter
//     Schwan-Lieferschein ist (Mitarbeiter fotografieren den oft direkt statt
//     die Felder abzutippen); wenn ja, liefert das Foto meist die HK-Nummer
//     direkt mit. Ist es KEIN Lieferschein (z.B. Foto der beschädigten Ware),
//     wird die Meldung komplett übersprungen — kein Rätselraten (Auftrag
//     t.duong 11.09.2026: "Sử dụng AI để chọn đúng đơn hàng trong báo cáo
//     nhanh", aber nur wenn das Foto es wirklich hergibt).
//
// Der Gebietsleiter/Admin wählt danach im Assistenten aus den Vorschlägen
// den richtigen Auftrag + die richtigen Artikel aus — automatisches Raten
// wäre hier riskant, weil Schwan feste Artikel-Codes je Auftrag verlangt.
//
// "Ganze Lieferung fehlt"-Meldungen (kein Artikel-Bezug) bleiben weiterhin
// außen vor — dafür bräuchte es eine eigene Freitext-Artikelauswahl, siehe
// index.html/Assistent-Kommentar.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const schwan = require('./schwan-client');
const { extractLieferschein } = require('./claude-vision');

function isSchwan(lieferant) {
  const s = (lieferant || '').toLowerCase();
  return /sch.?wan/.test(s) || s.includes('asia food') || s.includes('asiafood');
}
function extractKostenstelle(filiale) {
  const m = /^(\d{6}):/.exec(filiale || '');
  return m ? m[1] : null;
}

async function buildCandidates(db) {
  const snap = await db.collection('wareneingang').where('status', '==', 'offen').get();
  const fullForm = [];
  const quick = [];
  snap.forEach((doc) => {
    const v = doc.data();
    const kostenstelle = extractKostenstelle(v.filiale);
    if (v.type === 'quick') {
      if ((v.photos || []).length) quick.push({ id: doc.id, data: v, kostenstelle });
      return;
    }
    if (v.ganzeLieferungFehlt) return; // kein Artikel-Bezug moeglich, bleibt manuell
    if (!isSchwan(v.lieferant)) return;
    if (!kostenstelle) { console.warn(`  – ${doc.id}: keine Kostenstelle aus "${v.filiale}" ableitbar, übersprungen.`); return; }
    fullForm.push({ id: doc.id, data: v, kostenstelle, hkFromReport: (/HK-(\d+)/.exec(v.lieferscheinNr || '') || [])[1] || null });
  });

  // Schnellmeldungen per Vision prüfen — NUR wenn das Foto wirklich ein
  // Schwan-Lieferschein ist, wird daraus ein Kandidat (kein Rätselraten bei
  // irrelevanten Fotos, per Nutzer-Entscheidung 11.09.2026). Ohne
  // ANTHROPIC_API_KEY (Nutzer wollte vorerst keine API-Credits kaufen, siehe
  // Gespräch 12.09.2026) wird dieser Schritt übersprungen, statt bei jedem
  // Lauf sinnlos fehlzuschlagen — Schnellmeldungen bleiben dann manuell, per
  // "✏️ Zu vollständiger Meldung ergänzen" im Wareneingang-Panel.
  const quickCandidates = [];
  if (!process.env.ANTHROPIC_API_KEY) {
    if (quick.length) console.log(`  (${quick.length} Schnellmeldung(en) mit Foto — ANTHROPIC_API_KEY fehlt, Fotoerkennung übersprungen, bitte manuell über "Zu vollständiger Meldung ergänzen" bearbeiten.)`);
    return fullForm;
  }
  for (const c of quick) {
    try {
      const ai = await extractLieferschein(c.data.photos[0]);
      if (!ai || ai.istSchwanLieferschein !== true) {
        console.log(`  – ${c.id}: Foto ist kein erkennbarer Schwan-Lieferschein, übersprungen.`);
        continue;
      }
      const kostenstelle = c.kostenstelle || ai.kostenstelle || null;
      if (!kostenstelle) { console.warn(`  – ${c.id}: Lieferschein erkannt, aber keine Kostenstelle ableitbar, übersprungen.`); continue; }
      quickCandidates.push({ id: c.id, data: c.data, kostenstelle, hkFromReport: ai.hkNummer || null, aiExtraction: ai, isAi: true });
      console.log(`  ✓ ${c.id}: Schwan-Lieferschein per Foto erkannt (HK ${ai.hkNummer || '?'}).`);
    } catch (err) {
      console.error(`  ✗ ${c.id}: Foto-Erkennung fehlgeschlagen:`, err.message);
    }
  }

  return fullForm.concat(quickCandidates);
}

async function main() {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();

  console.log('Prüfe offene Wareneingang-Meldungen (Formular + Schnellmeldungen mit Foto) …');
  const candidates = await buildCandidates(db);
  console.log(`\n${candidates.length} offene Schwan-Wareneingang-Reklamation(en) insgesamt gefunden.`);
  if (!candidates.length) return;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  try {
    console.log('Login bei Schwan …');
    await schwan.login(page);

    for (const c of candidates) {
      try {
        console.log(`\n→ ${c.id} (${c.data.filiale}, Kostenstelle ${c.kostenstelle}${c.isAi ? ', per Foto/KI erkannt' : ''}) …`);
        await schwan.openNewComplaintModal(page);
        const kundeLabel = await schwan.selectCustomerByKostenstelle(page, c.kostenstelle);
        console.log('  Kunde:', kundeLabel);
        const auftraege = await schwan.readAuftragCandidates(page, { scan: 30 });
        console.log(`  ${auftraege.length} Auftrag-Kandidaten gelesen.`);

        // Empfehlung für den Standard-Auftrag: zuerst über die HK-Nummer
        // (aus lieferscheinNr ODER aus der KI-Foto-Erkennung) versuchen —
        // exakt, live bestätigt 11.09.2026, dass diese Nummer 1:1 der
        // HK-Referenz im Schwan-Auftrag entspricht — sonst über das zum
        // Lieferdatum am nächsten liegende Versanddatum.
        let artikelOptions = [];
        let empfohlenerAuftrag = null;
        if (auftraege.length) {
          if (c.hkFromReport) empfohlenerAuftrag = auftraege.find((a) => a.hkNr === c.hkFromReport) || null;
          if (empfohlenerAuftrag) console.log('  Auftrag über HK-Nummer gefunden:', empfohlenerAuftrag.auftragNr);

          if (!empfohlenerAuftrag) {
            const ziel = c.data.lieferdatum || (c.aiExtraction && c.aiExtraction.lieferdatum) || '';
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

        const reportedItems = (c.data.items && c.data.items.length)
          ? c.data.items.map((it) => ({
              artikel: it.artikel || '', fehlerart: it.fehlerart || '', beschreibung: it.beschreibung || '',
              mengeBestellt: it.mengeBestellt != null ? it.mengeBestellt : null,
              mengeErhalten: it.mengeErhalten != null ? it.mengeErhalten : null,
              img: it.img || null,
            }))
          // Schnellmeldung: kein items[]-Array — 1 Pseudo-Artikel aus der
          // Freitext-Notiz, der Admin wählt den echten Schwan-Artikel manuell.
          : [{ artikel: c.data.note || '', fehlerart: '', beschreibung: c.data.note || '', mengeBestellt: null, mengeErhalten: null, img: null }];

        await db.collection('schwan_matches').doc(c.id).set({
          wareneingangId: c.id,
          empId: c.data.empId || null, empName: c.data.empName || null,
          filiale: c.data.filiale || null, region: c.data.region || null,
          kostenstelle: c.kostenstelle,
          lieferant: c.data.lieferant || null, lieferdatum: c.data.lieferdatum || null,
          lieferscheinNr: c.data.lieferscheinNr || null,
          reportedItems,
          lieferscheinImg: c.data.lieferscheinImg || (c.isAi ? c.data.photos[0] : null) || null,
          kundeLabel: kundeLabel || null,
          auftragCandidates: auftraege,
          empfohlenerAuftrag: empfohlenerAuftrag ? { auftragNr: empfohlenerAuftrag.auftragNr, versanddatum: empfohlenerAuftrag.versanddatum } : null,
          artikelOptions: artikelOptions,
          source: c.isAi ? 'ai_photo' : 'form',
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
