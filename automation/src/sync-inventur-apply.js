// Phase 2 (schreibt wirklich auf Welo): wird NUR aufgerufen, nachdem ein
// Admin die Vorschau aus sync-inventur-diff.js für GENAU EINE Filiale/Monat
// in index.html geprüft und freigegeben hat (kein "alle freigeben" — bewusst
// pro Filiale einzeln, siehe Plan-Notiz nach dem Vorfall vom 07.09.2026).
// Liest die bereits geprüften Werte aus inventur_welo_preview (rechnet NICHT
// neu, damit exakt das geschrieben wird, was der Admin gesehen hat), öffnet
// die gespeicherte Welo-URL erneut und füllt nur die geänderten Felder aus —
// genau wie das bewährte Tampermonkey-Script (Wert setzen + "focusout"-Event,
// keine eigene Speichern-Schaltfläche nötig). Bestätigt/„Inventur
// abschließen" wird NIE automatisch geklickt — das bleibt bewusst manuell.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const { fmtWeloVal } = require('./inventur-match');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.waitForURL((url) => /^\/[A-Za-z0-9]+-[A-Za-z0-9]+\/index\.html/.test(url.pathname), { timeout: 15000 });
  const m = page.url().match(/^(https:\/\/[^/]+\/[A-Za-z0-9]+-[A-Za-z0-9]+)\//);
  if (!m) throw new Error('Session-Präfix nach Login nicht gefunden: ' + page.url());
  return m[1];
}

async function applyInventur(previewId) {
  if (!USER || !PASSWORD) throw new Error('WELO_USER/WELO_PASSWORD fehlen.');
  const db = getDb();
  const ref = db.collection('inventur_welo_preview').doc(previewId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error(`inventur_welo_preview/${previewId} nicht gefunden — bitte zuerst Vorschau laufen lassen.`);
  const d = doc.data();
  if (d.applied) throw new Error(`${d.filiale} (${d.month}) wurde bereits übernommen (${d.appliedAt ? d.appliedAt.toDate().toISOString() : '?'}) — kein erneutes Ausfüllen, um Duplikate zu vermeiden.`);
  if (!d.changes || !d.changes.length) throw new Error(`Keine Änderungen für ${d.filiale} (${d.month}) in der Vorschau — nichts zu tun.`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const sessionBase = await login(page);
    // WICHTIG: die in der Vorschau gespeicherte weloUrl enthält das
    // Session-Präfix vom damaligen Login (z.B. /e4dafda-518dfa3/) - dieses
    // Präfix ist an genau diese Login-Sitzung gebunden und wird von Welo
    // nach deren Ende als abgelaufen behandelt ("Sitzungskennung ist
    // abgelaufen"), unabhängig davon, ob die Inventur der Filiale wirklich
    // noch offen ist. Deshalb hier die URL mit dem FRISCHEN Session-Präfix
    // neu zusammensetzen statt d.weloUrl erneut aufzurufen.
    const yyyymm = d.month.replace('-', '');
    const url = `${sessionBase}/marktpflege/inventur/uebersicht/${d.weloNr}-${yyyymm}.html`;
    await page.goto(url);

    // Frisch prüfen, ob die Felder JETZT noch offen sind (könnte sich seit
    // der Vorschau geändert haben, z.B. wenn die Filiale zwischenzeitlich
    // selbst schon final abgeschlossen hat).
    const nochOffen = await page.locator('table.inventur-table input.inp:not([disabled])').count();
    if (!nochOffen) {
      await browser.close();
      throw new Error(`${d.filiale}: Inventur ist inzwischen nicht mehr offen (evtl. bereits abgeschlossen) — nichts geschrieben.`);
    }

    // WICHTIG: ein synthetisches `dispatchEvent(new Event('focusout'))` löst
    // Welos eigenen jQuery-Handler NICHT aus (live getestet 30.09.2026 - kein
    // einziger Request an /export/inventur.json, obwohl das Element korrekt
    // gefunden wurde). Welo speichert jedes Feld einzeln per AJAX im
    // `focusout`-Handler (save_menge()); nur ein ECHTES Fokus/Blur - wie ein
    // Mensch, der tippt und dann wegklickt - löst das zuverlässig aus. Playwright
    // erzeugt das über locator.fill() (echter Fokus + Eingabe) gefolgt von
    // Tab (echtes Blur), live bestätigt: {"success":true,"menge":80}.
    let gefuellt = 0, uebersprungen = 0;
    for (const change of d.changes) {
      if (!change.weloName) { uebersprungen++; continue; }
      const loc = page.locator(`input.inp[name="${change.weloName}"]`);
      if (!(await loc.count()) || await loc.isDisabled()) { uebersprungen++; continue; }
      const val = fmtWeloVal(change.newVal);
      try {
        const [resp] = await Promise.all([
          page.waitForResponse((r) => r.url().includes('/export/inventur.json'), { timeout: 10000 }),
          loc.fill(val).then(() => page.keyboard.press('Tab')),
        ]);
        const body = await resp.json().catch(() => null);
        if (resp.ok() && body && body.success) { gefuellt++; } else { uebersprungen++; }
      } catch (e) {
        uebersprungen++;
      }
    }

    await ref.set({
      applied: true, appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedCount: gefuellt, skippedCount: uebersprungen,
    }, { merge: true });

    console.log(`✓ ${d.filiale} (${d.month}): ${gefuellt} Felder ausgefüllt, ${uebersprungen} übersprungen. Bitte in Welo prüfen und "Inventur abschließen" von Hand bestätigen.`);
    return { filiale: d.filiale, month: d.month, gefuellt, uebersprungen };
  } finally {
    await browser.close();
  }
}

module.exports = { applyInventur };
if (require.main === module) {
  const previewId = process.argv[2];
  if (!previewId) { console.error('Aufruf: node sync-inventur-apply.js <month>__<filiale-slug>'); process.exit(1); }
  applyInventur(previewId).catch((e) => { console.error('✗', e.message); process.exit(1); });
}
