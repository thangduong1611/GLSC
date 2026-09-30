// Lädt offene Belege (receipts/{id}.status=='new') einer Region automatisiert
// zu Skovik hoch, in Batches von maximal SKOVIK_BATCH_SIZE (Skovik selbst
// erlaubt nicht mehr auf einmal - vom Nutzer live bestätigt 30.09.2026).
// Danach nur status:'skovik' setzen - die eigentliche Zuordnung "Buchungsort"
// bleibt bewusst manuelle Arbeit in Skovik selbst (Auftrag t.duong
// 30.09.2026: "tôi chỉ cần bước tải lên là xong").
//
// Aufruf: node sync-skovik-upload.js <region>
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { getDb } = require('./firestore-client');
const { writeSyncStatus } = require('./sync-status');

const BASE_URL = process.env.SKOVIK_BASE_URL || 'https://skovik.com';
const USER = process.env.SKOVIK_USER;
const PASSWORD = process.env.SKOVIK_PASSWORD;
const SKOVIK_BATCH_SIZE = 10;
const SYNC_KEY = 'skovik-upload';

// Zweistufiges Login (Ember-App, live verifiziert 30.09.2026): erst nur
// E-Mail + "Next", danach erscheint erst das Passwort-Feld + "Log in".
async function login(page) {
  await page.goto(`${BASE_URL}/cl/login`);
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ timeout: 15000 });
  await emailInput.fill(USER);
  await page.getByRole('button', { name: 'Next' }).click();
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ timeout: 15000 });
  await pwInput.fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
}

// Erzeugt denselben Dateinamen wie blImgFilename() in index.html
// (Beleg_{Name}_{Datum}.jpg), inkl. Kollisionsschutz bei mehreren Belegen
// desselben Mitarbeiters am selben Tag.
function receiptFilename(d, ext, usedNames) {
  const base = 'Beleg_' + (d.empName || 'MA').replace(/\s+/g, '_') + '_' + (d.createdAt || '').slice(0, 10);
  let name = base + '.' + ext;
  let n = 1;
  while (usedNames.has(name)) { n++; name = base + '_' + n + '.' + ext; }
  usedNames.add(name);
  return name;
}

async function main() {
  const region = process.argv[2];
  if (!region) throw new Error('Aufruf: node sync-skovik-upload.js <region>');
  if (!USER || !PASSWORD) throw new Error('SKOVIK_USER/SKOVIK_PASSWORD fehlen in .env');

  const db = getDb();
  const snap = await db.collection('receipts').where('status', '==', 'new').where('region', '==', region).get();
  const items = [];
  snap.forEach((doc) => items.push({ ref: doc.ref, id: doc.id, d: doc.data() || {} }));

  if (!items.length) {
    console.log(`Keine offenen Belege für Region "${region}".`);
    await writeSyncStatus(db, SYNC_KEY, { status: 'ok', message: 'Keine offenen Belege.', total: 0, succeeded: 0, failed: 0 });
    return;
  }
  console.log(`${items.length} offene(r) Beleg(e) für Region "${region}" gefunden, lade in Batches von ${SKOVIK_BATCH_SIZE} hoch…`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skovik-upload-'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const usedNames = new Set();
  let uploaded = 0;
  const failedDetails = [];

  try {
    await login(page);
    await page.goto(`${BASE_URL}/cl/receipts`);
    await page.getByText('Dateien hochladen').first().waitFor({ timeout: 15000 });

    for (let i = 0; i < items.length; i += SKOVIK_BATCH_SIZE) {
      const batch = items.slice(i, i + SKOVIK_BATCH_SIZE);
      const batchNo = Math.floor(i / SKOVIK_BATCH_SIZE) + 1;
      console.log(`  Batch ${batchNo}: ${batch.length} Beleg(e)…`);
      const filePaths = [];
      for (const it of batch) {
        const m = /^data:image\/(\w+);base64,(.+)$/.exec(it.d.img || '');
        if (!m) { failedDetails.push({ id: it.id, reason: 'kein gültiges Bild (img fehlt/kein data:-URL)' }); continue; }
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const name = receiptFilename(it.d, ext, usedNames);
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
        filePaths.push({ filePath, it });
      }
      if (!filePaths.length) continue;

      // Erfolgs-Signal live verifiziert (30.09.2026, echter Upload-Test mit
      // 2 echten Belegen): jede neu hochgeladene Quittung bekommt sofort
      // eine "Ausgabe registrieren"-Kachel unter "Nicht verknüpfte
      // Quittungen" (auch während die OCR "Lesen …%" noch läuft) - die
      // Anzahl dieser Kacheln steigt zuverlässig um genau die Batch-Größe.
      // Statt eines festen Wartepuffers wird darauf gepollt (max. 60s).
      const registerBtnText = 'Ausgabe registrieren';
      const beforeCount = await page.getByText(registerBtnText).count();
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(filePaths.map((f) => f.filePath));
      const expectedCount = beforeCount + filePaths.length;
      let confirmed = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        await page.waitForTimeout(2000);
        const nowCount = await page.getByText(registerBtnText).count();
        if (nowCount >= expectedCount) { confirmed = true; break; }
      }
      if (!confirmed) {
        filePaths.forEach((f) => failedDetails.push({ id: f.it.id, reason: 'Upload-Bestätigung von Skovik nicht innerhalb 60s erhalten' }));
        continue;
      }

      const fsBatch = db.batch();
      const now = new Date().toISOString();
      filePaths.forEach((f) => { fsBatch.update(f.it.ref, { status: 'skovik', skovikAt: now }); });
      await fsBatch.commit();
      uploaded += filePaths.length;

      filePaths.forEach((f) => { try { fs.unlinkSync(f.filePath); } catch (e) { /* egal, tmpDir wird am Ende komplett gelöscht */ } });
    }
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const message = `${uploaded}/${items.length} Belege hochgeladen` + (failedDetails.length ? `, ${failedDetails.length} übersprungen` : '');
  await writeSyncStatus(db, SYNC_KEY, {
    status: failedDetails.length ? 'warn' : 'ok', message,
    total: items.length, succeeded: uploaded, failed: failedDetails.length, failedDetails,
  });
  console.log('✓', message);
}

module.exports = { main };
if (require.main === module) {
  main().catch((err) => {
    console.error('✗ Sync fehlgeschlagen:', err.message);
    process.exitCode = 1;
  });
}
