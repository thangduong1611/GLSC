// Gemeinsame Login- und Formular-Hilfsfunktionen für cms.schwan-asiafood.de
// (Reklamations-Management, Keycloak-SSO über sso.cloud.prutheus.com).
// Genutzt von sync-schwan-lookup.js (nur lesen) und sync-schwan-submit.js
// (schreibt eine echte Reklamation — nur nach ausdrücklicher Freigabe im
// Wareneingang-Assistenten in index.html, Auftrag t.duong 11.09.2026).
//
// WICHTIG (live am 11.09.2026 ausführlich erkundet): die CMS-Oberfläche ist
// nachweislich manchmal langsam/fehlerhaft beim Laden ihrer eigenen Listen
// (z.B. "Fehler beim Laden" beim Gebiets-Feld, das Auftrags-Dropdown
// braucht gelegentlich einen zweiten Öffnungsversuch). Das ist KEIN Bug in
// diesem Skript, sondern eine echte Eigenschaft der fremden Seite — jede
// Dropdown-Interaktion hier ist deshalb bewusst mit mehreren Versuchen
// abgesichert (openAndClickVisible), nicht mit einem einzelnen Klick.
//
// Struktur der Custom-Dropdowns (Kunde/Auftrag/Artikel/Reklamationsgrund):
// alle folgen demselben Muster — ein Button ("... auswählen..."), nach dem
// Öffnen erscheinen die Optionen als reine <span>/<div>-Textknoten (kein
// role="option"), teils virtualisiert (nur ein Ausschnitt tatsächlich
// sichtbar, auch wenn mehr im DOM "attached" ist) — deshalb wird nie
// stur das erste DOM-Element geklickt, sondern das erste WIRKLICH
// sichtbare unter den ersten `scan` Treffern.

const BASE_URL = process.env.SCHWAN_BASE_URL || 'https://cms.schwan-asiafood.de';
const USER = process.env.SCHWAN_USER;
const PASSWORD = process.env.SCHWAN_PASSWORD;

async function login(page) {
  if (!USER || !PASSWORD) throw new Error('SCHWAN_USER/SCHWAN_PASSWORD fehlen in .env');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(USER);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  if (!/cms\.schwan-asiafood\.de/.test(page.url())) {
    throw new Error('Login bei Schwan fehlgeschlagen — URL nach Login: ' + page.url());
  }
}

async function openNewComplaintModal(page) {
  await page.getByText('Neue Reklamation', { exact: true }).click();
  await page.waitForTimeout(1500);
}

// Öffnet ein Dropdown, sucht unter den ersten `scan` Treffern von `regex`
// das erste sichtbare und klickt es. Wiederholt bis zu `cycles`-mal, falls
// (noch) nichts sichtbar ist. Gibt den Text des geklickten Elements zurück.
async function openAndClickVisible(page, openFn, regex, label, opts) {
  opts = opts || {};
  const scan = opts.scan || 30;
  const cycles = opts.cycles || 5;
  for (let c = 0; c < cycles; c++) {
    await openFn();
    await page.waitForTimeout(1800);
    const count = await page.getByText(regex).count();
    for (let idx = 0; idx < Math.min(count, scan); idx++) {
      const opt = page.getByText(regex).nth(idx);
      if (await opt.isVisible().catch(() => false)) {
        const text = (await opt.textContent() || '').trim();
        await opt.click({ force: true });
        return text;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(label + ': kein sichtbares Element für ' + regex + ' gefunden nach ' + cycles + ' Versuchen.');
}

// Wählt den Kunden über die Kostenstellen-Nummer (zuverlässiger Anker,
// siehe schwan-week-check-artige Erfahrung mit Namensabweichungen — der
// hier angezeigte "Kundenname" ist oft der Name des Gastmarkts, z.B.
// "Rewe Huppert Heilbad Heiligenstadt", NICHT "Sushi Circle", aber die
// Kostenstellen-Nummer in Klammern stimmt IMMER mit emps.filiale überein).
async function selectCustomerByKostenstelle(page, kostenstelle) {
  return openAndClickVisible(page,
    async () => {
      await page.getByRole('button', { name: 'Kunde auswählen...' }).click();
      await page.waitForTimeout(500);
      const s = page.locator('input[placeholder="Suchen..."]:visible').first();
      if (await s.count()) await s.fill(kostenstelle);
    },
    new RegExp('^SC\\d+\\s*-.*' + kostenstelle), 'Kunde');
}

// Liest die sichtbaren (jüngsten) Aufträge des aktuell gewählten Kunden aus,
// OHNE einen davon auszuwählen — für die Vorschau (sync-schwan-lookup.js).
// Format je Eintrag im Dropdown: "{Auftragsnummer} - HK-{Nr} - {DD.MM.YYYY}".
async function readAuftragCandidates(page, opts) {
  opts = opts || {};
  const scan = opts.scan || 30;
  for (let c = 0; c < 5; c++) {
    await page.getByRole('button', { name: 'Auftrag auswählen...' }).click();
    await page.waitForTimeout(1800);
    const texts = await page.evaluate((maxScan) => {
      const re = /^\d+ - HK-\d+ - \d{2}\.\d{2}\.\d{4}$/;
      const out = [];
      document.querySelectorAll('span, div').forEach((el) => {
        if (out.length >= maxScan) return;
        if (el.children.length > 0) return;
        const t = (el.textContent || '').trim();
        if (re.test(t) && el.offsetParent !== null) out.push(t);
      });
      return out;
    }, scan);
    if (texts.length) {
      return texts.map((t) => {
        const m = t.match(/^(\d+) - HK-(\d+) - (\d{2})\.(\d{2})\.(\d{4})$/);
        return { raw: t, auftragNr: m[1], hkNr: m[2], versanddatum: m[5] + '-' + m[4] + '-' + m[3] };
      });
    }
    await page.waitForTimeout(1000);
  }
  return [];
}

async function selectAuftragByNumber(page, auftragNr) {
  return openAndClickVisible(page,
    async () => { await page.getByRole('button', { name: 'Auftrag auswählen...' }).click(); },
    new RegExp('^' + auftragNr + ' - HK-'), 'Auftrag');
}

// Fügt eine neue "Reklamierte Artikel"-Zeile hinzu (Klick auf "Artikel
// hinzufügen" — WICHTIG: nur EINMAL pro gewünschtem Artikel klicken, jeder
// Klick fügt eine eigene Zeile mit eigenem Artikel-Picker hinzu; erneutes
// Klicken auf denselben Button ist NICHT idempotent).
async function addArtikelRow(page) {
  await page.getByText('Artikel hinzufügen', { exact: true }).click();
  await page.waitForTimeout(2000);
}

// Liest die Artikel-Optionen der zuletzt hinzugefügten Zeile, OHNE eine
// davon auszuwählen (für die Vorschau). Format: "{AF-Code} - {Beschreibung}".
async function readArtikelCandidates(page, opts) {
  opts = opts || {};
  const scan = opts.scan || 40;
  for (let c = 0; c < 5; c++) {
    // Die "Artikel auswählen..."-Buttons der bereits hinzugefügten Zeilen —
    // der letzte ist die gerade neu hinzugefügte, noch leere Zeile.
    const buttons = page.getByRole('button', { name: 'Artikel auswählen...' });
    const n = await buttons.count();
    if (n === 0) { await page.waitForTimeout(1000); continue; }
    await buttons.nth(n - 1).click();
    await page.waitForTimeout(1800);
    const texts = await page.evaluate((maxScan) => {
      const re = /^AF[\w-]+ - .+/;
      const out = [];
      document.querySelectorAll('span, div').forEach((el) => {
        if (out.length >= maxScan) return;
        if (el.children.length > 0) return;
        const t = (el.textContent || '').trim();
        if (re.test(t) && el.offsetParent !== null) out.push(t);
      });
      return out;
    }, scan);
    if (texts.length) {
      // Dropdown wieder schließen (Escape), ohne etwas auszuwählen — der
      // Aufrufer entscheidet erst nach Review, welcher Artikel es wird.
      await page.keyboard.press('Escape').catch(() => {});
      return texts.map((t) => {
        const i = t.indexOf(' - ');
        return { raw: t, code: t.slice(0, i), label: t.slice(i + 3) };
      });
    }
    await page.waitForTimeout(1000);
  }
  return [];
}

// Wählt in der ZULETZT hinzugefügten Zeile den Artikel mit genau diesem Code.
async function selectArtikelInLastRow(page, artikelCode) {
  const buttons = page.getByRole('button', { name: 'Artikel auswählen...' });
  const n = await buttons.count();
  if (n === 0) throw new Error('Keine "Artikel auswählen..."-Zeile vorhanden — zuerst addArtikelRow() aufrufen.');
  return openAndClickVisible(page,
    async () => { await buttons.nth(n - 1).click(); },
    new RegExp('^' + artikelCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' - '), 'Artikel');
}

// Setzt die Anzahl in der zuletzt hinzugefügten Artikel-Zeile. "Anzahl" ist
// KEIN <input>, sondern derselbe Custom-Dropdown wie Kunde/Auftrag/Artikel
// (Button mit aktuellem Zahlenwert + Chevron, live verifiziert 11.09.2026:
// Optionen sind einfache Ziffern-Texte "0","1","2",... — kein Suchfeld).
async function setAnzahlInLastRow(page, anzahl) {
  const label = page.locator('label', { hasText: 'Anzahl' }).last();
  const btn = label.locator('xpath=following-sibling::div[1]//button');
  if (!(await btn.count())) throw new Error('Kein Anzahl-Button gefunden.');
  const target = String(anzahl);
  for (let c = 0; c < 4; c++) {
    await btn.click();
    await page.waitForTimeout(1000);
    const opt = page.getByText(target, { exact: true }).last();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click({ force: true });
      await page.waitForTimeout(500);
      return;
    }
    await page.waitForTimeout(800);
  }
  throw new Error(`Anzahl-Option "${target}" nicht gefunden/sichtbar geworden.`);
}
async function setNotizInLastRow(page, text) {
  if (!text) return;
  const inputs = page.locator('input[placeholder="Optionale Notizen..."]:visible, textarea[placeholder="Optionale Notizen..."]:visible');
  const n = await inputs.count();
  if (!n) return;
  await inputs.nth(n - 1).fill(text);
}

async function selectReklamationsgrund(page, grundLabel) {
  return openAndClickVisible(page,
    async () => { await page.getByRole('button', { name: 'Grund auswählen...' }).click(); },
    new RegExp('^' + grundLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), 'Reklamationsgrund');
}

// dataUrls: Array von data:image/...;base64,... Strings (wie in Firestore
// gespeichert) — werden als temporäre Dateien geschrieben und hochgeladen.
async function uploadBilder(page, dataUrls) {
  if (!dataUrls || !dataUrls.length) return;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Dateien auswählen', { exact: true }).click();
  const chooser = await fileChooserPromise;
  const tmpFiles = dataUrls.map((durl, i) => {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(durl);
    if (!m) return null;
    const ext = m[1].split('/')[1] || 'jpg';
    const p = path.join(os.tmpdir(), `schwan-upload-${Date.now()}-${i}.${ext}`);
    fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
    return p;
  }).filter(Boolean);
  await chooser.setFiles(tmpFiles);
  await page.waitForTimeout(1500);
  tmpFiles.forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} });
}

async function setBeschreibung(page, text) {
  if (!text) return;
  await page.locator('textarea[placeholder="Optionale Beschreibung der Reklamation..."]').fill(text);
}

module.exports = {
  login, openNewComplaintModal, selectCustomerByKostenstelle,
  readAuftragCandidates, selectAuftragByNumber,
  addArtikelRow, readArtikelCandidates, selectArtikelInLastRow, setAnzahlInLastRow, setNotizInLastRow,
  selectReklamationsgrund, uploadBilder, setBeschreibung,
};
