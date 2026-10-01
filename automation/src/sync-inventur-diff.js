// Phase 1 (nur Lesen): geht jede eigene Filiale (KOSTENSTELLEN dieses Kontos)
// auf der Welo-Manager-Übersichtsseite durch, vergleicht die dortigen Menge-
// Felder mit den in der GLSC-App eingegebenen Zählungen (inventur_counts) und
// schreibt das Ergebnis als Vorschau nach inventur_welo_preview — OHNE
// irgendetwas auf Welo zu verändern. Der Admin muss jede Filiale einzeln in
// index.html freigeben (sync-inventur-apply.js), bevor wirklich geschrieben
// wird — bewusst so nach dem Vorfall vom 07.09.2026 (siehe branches.js/
// sync-welo-personal.js: nie automatisch über Kontogrenzen hinweg wirken).
//
// WICHTIG: die Welo-Übersichtsseite (/marktpflege/inventur/uebersicht/...)
// zeigt firmenweite Daten, wenn man die "Alle"-Auswahl nimmt — genau wie
// Axonity /markets/ und /pickups/. Hier wird NIE die Gesamtliste abgefragt,
// sondern für jede Filiale gezielt die eigene Kostenstelle/Alias-Nummer
// aufgerufen (aus getBekannteKostenstellen()) — andere Gebietsleiter werden
// so nie berührt, unabhängig davon, was die Übersichtsseite sonst zeigen würde.
require('dotenv').config();
const { chromium } = require('playwright');
const { getDb, admin } = require('./firestore-client');
const { getBekannteKostenstellen, MARKTNR_ALIASES, resolveRegion } = require('./branches');
const { matchInventur } = require('./inventur-match');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;
const ITEMS_URL = 'https://thangduong1611.github.io/GLSC/inventur-data.js';

// Die Inventur-Periode eines Monats läuft laut inventur_period (sichtbar bis
// "end") immer bis zum 1. des Folgemonats weiter (z.B. 2026-09: end
// 2026-10-01) - am 1. eines Monats gehört die Abgleich-Prüfung deshalb noch
// zum VORMONAT, sonst würde sie am 1. still auf den neuen (leeren) Monat
// umschalten, während die Filialen den alten noch abschließen (live bemerkt
// am 01.10.2026).
function relevantesMonatsdatum() {
  const d = new Date();
  if (d.getDate() === 1) d.setDate(0); // letzter Tag des Vormonats
  return d;
}
function heuteYYYYMM() {
  const d = relevantesMonatsdatum();
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
}
function heuteMonthISO() {
  const d = relevantesMonatsdatum();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function fbSlug(s) {
  return String(s || '').replace(/\s+/g, '_').toLowerCase();
}

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

// Axonity-Kostenstelle -> Welo-eigene Nummer für die Inventur-URL (Welo führt
// manche Filialen unter einer eigenen SushiTime-Nummer, siehe MARKTNR_ALIASES
// in branches.js — dieselbe Übersetzung wie bei den Umsatz-Skripten, nur in
// die andere Richtung: Axonity-Nr -> Welo-Nr statt Welo-Nr -> Axonity-Nr).
function toWeloNr(axonityNr) {
  const eintrag = Object.entries(MARKTNR_ALIASES).find(([, ax]) => ax === axonityNr);
  return eintrag ? eintrag[0] : axonityNr;
}

async function loadItemLabels() {
  try {
    const res = await fetch(ITEMS_URL);
    if (!res.ok) return {};
    const txt = await res.text();
    const m = txt.match(/window\.INVENTUR_ITEMS\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!m) return {};
    const items = JSON.parse(m[1]);
    const out = {};
    items.forEach((it) => { out[String(it[0]).replace(/\s+/g, '').toUpperCase()] = it[3]; });
    return out;
  } catch (e) {
    console.warn('Artikelnamen konnten nicht geladen werden:', e.message);
    return {};
  }
}

// Liest eine Übersichtsseite: [{artNr, currentVal, weloName, disabled}], plus
// ob überhaupt eine Inventur-Tabelle existiert (Seite kann für eine Filiale
// ohne begonnene Inventur leer/anders aussehen).
async function readInventurSeite(page, weloNr, yyyymm, sessionBase) {
  const url = `${sessionBase}/marktpflege/inventur/uebersicht/${weloNr}-${yyyymm}.html`;
  await page.goto(url);
  const hatTabelle = await page.locator('table.inventur-table').count();
  if (!hatTabelle) return { url, rows: [], offen: false, existiert: false };
  const rows = await page.$$eval('table.inventur-table tr', (trs) =>
    trs.map((tr) => {
      const tds = tr.querySelectorAll('td');
      const inp = tr.querySelector('input.inp');
      if (!inp || !tds.length) return null;
      return {
        artNr: tds[0].textContent.trim(),
        currentVal: (inp.value || '0').trim(),
        weloName: inp.getAttribute('name'),
        disabled: inp.disabled,
      };
    }).filter(Boolean)
  );
  const offen = rows.length > 0 && rows.some((r) => !r.disabled);
  return { url, rows, offen, existiert: true };
}

async function main() {
  if (!USER || !PASSWORD) throw new Error('WELO_USER/WELO_PASSWORD fehlen.');
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const yyyymm = heuteYYYYMM();
  const monthISO = heuteMonthISO();

  const kostenstellen = [...getBekannteKostenstellen()];
  console.log(`Prüfe ${kostenstellen.length} eigene Filialen für Inventur-Periode ${monthISO}…`);

  const labelByArt = await loadItemLabels();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let sessionBase;
  try {
    sessionBase = await login(page);
  } catch (err) {
    await browser.close();
    throw new Error('Login bei Welo fehlgeschlagen: ' + err.message);
  }

  const storeMapDoc = await db.collection('inventur_storemap').doc('map').get();
  const storeMap = storeMapDoc.exists ? storeMapDoc.data() : {};

  let geprueft = 0, offenGefunden = 0, fehler = 0;
  const batch = db.batch();
  let batchOps = 0;

  for (const axonityNr of kostenstellen) {
    const weloNr = toWeloNr(axonityNr);
    try {
      const seite = await readInventurSeite(page, weloNr, yyyymm, sessionBase);
      geprueft++;
      if (!seite.existiert || !seite.offen) continue;
      offenGefunden++;

      const filiale = storeMap[axonityNr] || storeMap[weloNr] || null;
      if (!filiale) {
        console.warn(`  ⚠ Keine Filialen-Zuordnung für Kostenstelle ${axonityNr} (Welo ${weloNr}) in inventur_storemap — übersprungen.`);
        continue;
      }
      const slug = fbSlug(filiale);
      const countsDoc = await db.collection('inventur_counts').doc(`${monthISO}__${slug}`).get();
      const countsData = countsDoc.exists ? countsDoc.data() : null;
      if (!countsData || !countsData.counts) {
        console.log(`  – ${filiale}: noch keine Zählung in der App eingereicht, überspringe.`);
        continue;
      }

      const { changed, missing, conflicts } = matchInventur(
        seite.rows.map((r) => ({ artNr: r.artNr, currentVal: r.currentVal, weloName: r.weloName })),
        countsData.counts,
        labelByArt
      );

      const region = resolveRegion(axonityNr) || countsData.region || null;
      const previewId = `${monthISO}__${slug}`;
      batch.set(db.collection('inventur_welo_preview').doc(previewId), {
        filiale, marktNr: axonityNr, weloNr, month: monthISO, weloUrl: seite.url,
        changedCount: changed.length, changes: changed, missing, conflicts,
        submitted: countsData.submitted !== false,
        applied: false, region, checkedAt: now,
      }, { merge: true });
      batchOps++;

      // Ersetzt den bisherigen manuellen "Welo-Links einfügen"-Schritt für
      // diese Filiale/Monat/Region.
      const linksRef = db.collection('inventur_links').doc(`${monthISO}__${region}`);
      batch.set(linksRef, { links: { [axonityNr]: seite.url }, region }, { merge: true });
      batchOps++;

      console.log(`  ✓ ${filiale}: offen, ${changed.length} Artikel würden geändert, ${missing.length} fehlen, ${conflicts.length} Konflikte.`);
    } catch (err) {
      fehler++;
      console.error(`  ✗ Kostenstelle ${axonityNr} fehlgeschlagen:`, err.message);
    }
  }

  if (batchOps) await batch.commit();
  await browser.close();
  console.log(`✓ Fertig. ${geprueft} Filialen geprüft, ${offenGefunden} mit offener Inventur, ${fehler} Fehler.`);
}

module.exports = { main, readInventurSeite, toWeloNr };
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
