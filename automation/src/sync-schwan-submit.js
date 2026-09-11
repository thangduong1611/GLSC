// Erstellt eine ECHTE Reklamation auf cms.schwan-asiafood.de — nur nachdem
// ein Manager im Assistenten (index.html, Panel Wareneingang) die Vorschau
// aus sync-schwan-lookup.js geprüft und seine Auswahl bestätigt hat
// (schwan_matches/{id}.confirmedSelection, von index.html geschrieben,
// genau wie bei sync-inventur-apply.js — Auftrag t.duong 11.09.2026: nie
// automatisch über Kontogrenzen/externe Systeme hinweg schreiben, immer
// mit expliziter Freigabe pro Bericht).
//
// Aufruf: node src/sync-schwan-submit.js <wareneingangId>
//
// confirmedSelection-Form (von index.html geschrieben):
// {
//   auftragNr: '104886',
//   items: [ { artikelCode: 'AF10000', anzahl: 1, notiz: '' } ],
//   reklamationsgrund: 'Fehlmenge',   // muss exakt einer der 5 Schwan-Optionen sein
//   beschreibung: '...',
//   bilder: ['data:image/jpeg;base64,...', ...]   // optional
// }
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const schwan = require('./schwan-client');

async function main() {
  const wareneingangId = process.argv[2];
  if (!wareneingangId) throw new Error('Aufruf: node src/sync-schwan-submit.js <wareneingangId>');

  const db = getDb();
  const matchRef = db.collection('schwan_matches').doc(wareneingangId);
  const matchDoc = await matchRef.get();
  if (!matchDoc.exists) throw new Error(`schwan_matches/${wareneingangId} existiert nicht — zuerst sync-schwan-lookup.js laufen lassen.`);
  const match = matchDoc.data();
  const sel = match.confirmedSelection;
  if (!sel || !sel.auftragNr || !sel.items || !sel.items.length || !sel.reklamationsgrund) {
    throw new Error(`schwan_matches/${wareneingangId}.confirmedSelection fehlt oder unvollständig — Admin muss im Assistenten erst Auftrag, Artikel und Reklamationsgrund bestätigen.`);
  }
  if (match.status === 'submitted') {
    throw new Error(`schwan_matches/${wareneingangId} wurde bereits eingereicht (submittedAt: ${match.submittedAt}) — kein zweites Mal senden.`);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  try {
    console.log('Login bei Schwan …');
    await schwan.login(page);
    await schwan.openNewComplaintModal(page);

    console.log('Kunde wählen (Kostenstelle', match.kostenstelle, ') …');
    await schwan.selectCustomerByKostenstelle(page, match.kostenstelle);

    console.log('Auftrag wählen (', sel.auftragNr, ') …');
    await schwan.selectAuftragByNumber(page, sel.auftragNr);

    for (const item of sel.items) {
      console.log('Artikel hinzufügen:', item.artikelCode, 'Anzahl', item.anzahl);
      await schwan.addArtikelRow(page);
      await schwan.selectArtikelInLastRow(page, item.artikelCode);
      await schwan.setAnzahlInLastRow(page, item.anzahl);
      await schwan.setNotizInLastRow(page, item.notiz);
    }

    console.log('Reklamationsgrund:', sel.reklamationsgrund);
    await schwan.selectReklamationsgrund(page, sel.reklamationsgrund);

    if (sel.bilder && sel.bilder.length) {
      console.log(sel.bilder.length, 'Bild(er) hochladen …');
      await schwan.uploadBilder(page, sel.bilder);
    }

    if (sel.beschreibung) {
      console.log('Beschreibung setzen …');
      await schwan.setBeschreibung(page, sel.beschreibung);
    }

    if (process.env.SCHWAN_DRY_RUN === '1') {
      console.log('SCHWAN_DRY_RUN=1 gesetzt — breche VOR "Speichern" ab, nichts wird angelegt.');
      await page.screenshot({ path: require('path').join(__dirname, '..', 'output', `schwan-dry-run-${wareneingangId}.png`), fullPage: true });
      await browser.close();
      return;
    }

    console.log('Speichern …');
    await page.getByText('Speichern', { exact: true }).click();
    await page.waitForTimeout(3000);

    const now = admin.firestore.FieldValue.serverTimestamp();
    await matchRef.set({ status: 'submitted', submittedAt: now }, { merge: true });
    await db.collection('wareneingang').doc(wareneingangId).set({ status: 'gemeldet', gemeldetAt: new Date().toISOString() }, { merge: true });
    console.log('✓ Reklamation erstellt und in Firestore vermerkt.');
  } catch (err) {
    console.error('FEHLER beim Einreichen:', err.message);
    await matchRef.set({ status: 'submit_error', submitError: err.message }, { merge: true }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { main };
if (require.main === module) {
  main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
}
