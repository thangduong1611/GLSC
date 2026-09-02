// Loggt sich bei Welo/SuCi-Net ein (Playwright, wegen Session-Cookie-Auth)
// und synchronisiert zwei Dinge für alle Mitarbeiter/Filialen:
//
//  1. Personal-Stammdaten: Soll-Stunden/Woche (aus "Aktives Personal") +
//     Resturlaub/Genommen/Anspruch/Krank-Tage (aus der Jahresansicht jeder
//     einzelnen Person, /pf/jahresansicht/{PersonalNr}-{Jahr}.html — nicht
//     aus der "U/K Liste": deren drei Kategorien FS/MJ/TM ließen 11 von 61
//     Mitarbeitern komplett aus, siehe Projekt-Notiz vom 02.09.2026).
//  2. Tagesziel je Filiale: liest den Tagesumsatz von heute UND von genau
//     einem Jahr zuvor (Statistiken > Tagesumsätze — Seite ist datumsbasiert
//     aufrufbar und funktioniert auch rückwirkend, geprüft bis genau 1 Jahr
//     zurück; frühere Jahre haben für unsere Filialen keine Daten, weil sie
//     da noch nicht im System waren). Ziel = Vorjahreswert × ZIEL_FAKTOR
//     (Standard 1,25 — "Vorjahresumsatz + 25 %", per t.duong am 02.09.2026
//     bewusst als feste Formel statt Live-KI-Aufruf gewählt: kostenlos,
//     schnell, nachvollziehbar).
//
// Schreibt:
//   emp_welo/{PersonalNr} = {name, taetigkeit, marktNr, marktname, sollStd,
//     urlaubOffen, urlaubGenommen, urlaubAnspruch, krankTage, updatedAt}
//   tagesziel/{marktNr}_{YYYYMMDD} = {marktNr, marktname, datum,
//     umsatzHeute, umsatzVorjahr, ziel, updatedAt}
//
// Für den 05:00-Uhr-Cron-Lauf gedacht. Braucht Playwright + Chromium
// (bereits installiert für die Axonity-Skripte). page.goto() (echter
// Browser-Kontext) übersteht das kaputte TLS-Zwischenzertifikat von
// welo.sushi-circle.de automatisch (Chromium chased die AIA-Kette selbst),
// aber page.request.get() (für die CSV-Downloads) läuft über Node's eigenen
// TLS-Stack wie ein normales fetch() — braucht denselben
// NODE_EXTRA_CA_CERTS-Fix wie sync-welo-umsatz.js (siehe package.json /
// run-sync-welo-personal.bat). Per echtem Testlauf bestätigt (02.09.2026).
require('dotenv').config();
const { chromium } = require('playwright');
const { parse } = require('csv-parse/sync');
const { getDb, admin } = require('./firestore-client');
const { MARKTNR_ALIASES } = require('./branches');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;
const ZIEL_FAKTOR = parseFloat(process.env.WELO_ZIEL_FAKTOR || '1.25');
const EMP_COLLECTION = 'emp_welo';
const ZIEL_COLLECTION = 'tagesziel';

function parseGermanNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-' || s === 'k.A.') return null;
  const n = parseFloat(s.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function compactDate(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.locator('input[name="authuser"]').fill(USER);
  await page.locator('input[name="authpass"]').fill(PASSWORD);
  await page.locator('input[name="login"]').click();
  await page.waitForURL((url) => /^\/[A-Za-z0-9]+-[A-Za-z0-9]+\/index\.html/.test(url.pathname), { timeout: 15000 });
  const m = page.url().match(/^(https:\/\/[^/]+\/[A-Za-z0-9]+-[A-Za-z0-9]+)\//);
  if (!m) throw new Error('Session-Präfix nach Login nicht gefunden: ' + page.url());
  return m[1]; // z.B. https://welo.sushi-circle.de/de3bcae-518e741
}

function findCsvHref(html, base) {
  const m = html.match(/href="([^"]*\/export\/csv-[^"]+\.csv)"/i);
  if (!m) return null;
  return new URL(m[1], base).toString();
}

async function fetchCsv(page, url) {
  const res = await page.request.get(url);
  if (!res.ok()) throw new Error(`CSV-Abruf fehlgeschlagen (${res.status()}): ${url}`);
  const buf = await res.body();
  return new TextDecoder('windows-1252').decode(buf);
}

async function getPersonalRows(page, sessionBase) {
  await page.goto(`${sessionBase}/pf/aktives-personal/index.html`);
  const csvUrl = findCsvHref(await page.content(), sessionBase);
  if (!csvUrl) throw new Error('CSV-Link auf "Aktives Personal" nicht gefunden.');
  const records = parse(await fetchCsv(page, csvUrl), {
    delimiter: ';', quote: '"', columns: true, skip_empty_lines: true, trim: true,
  });
  const byId = {};
  for (const r of records) {
    const id = String(r['PersonalNr.'] || '').trim();
    if (!id) continue; // Summenzeilen pro Filiale haben keine PersonalNr.
    const marktNrRaw = String(r['MarktNr.'] || '').trim();
    byId[id] = {
      name: r['Name'] || '',
      taetigkeit: r['Tätigkeit'] || '',
      marktNr: MARKTNR_ALIASES[marktNrRaw] || marktNrRaw,
      marktname: r['Marktname'] || '',
      sollStd: parseGermanNumber(r['Soll Std.']),
    };
  }
  return byId;
}

// Frühere Version fragte die drei Sammel-CSVs unter /urlaubsliste/ ab (FS/MJ/
// TM getrennt, nicht überlappend) — 11 von 61 Mitarbeitern (u.a. GL, Springer,
// Shopleiterin, aber auch normales Personal) tauchten in KEINER der drei
// Listen auf, wurden also fälschlich als "keine Urlaubsdaten" markiert (siehe
// GLSC-App-Projektnotiz, entdeckt von t.duong am 02.09.2026). Die
// Jahresansicht jeder Person (/pf/jahresansicht/{PersonalNr}-{Jahr}.html,
// verlinkt von der Personalinfo-Seite als "Jahresansicht: 2026, 2025, …")
// deckt dagegen JEDE aktive Person einzeln ab, unabhängig von der
// Personalart — pro Mitarbeiter ein Seitenaufruf statt drei Sammel-Downloads,
// aber vollständig statt lückenhaft.
function extractLabelValue(html, label) {
  const re = new RegExp('>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<\\/td>\\s*<td[^>]*>([^<]*)<\\/td>', 'i');
  const m = html.match(re);
  return m ? m[1].trim() : null;
}
async function getUrlaubKrankRows(page, sessionBase, ids, year) {
  const merged = {};
  for (const id of ids) {
    await page.goto(`${sessionBase}/pf/jahresansicht/${id}-${year}.html`);
    const html = await page.content();
    const krankRaw = extractLabelValue(html, 'Krank:'); // "0,00 Tage"
    merged[id] = {
      urlaubOffen: parseGermanNumber(extractLabelValue(html, 'Offen:')),
      urlaubGenommen: parseGermanNumber(extractLabelValue(html, 'Genommen:')),
      urlaubAnspruch: parseGermanNumber(extractLabelValue(html, 'Jahr:')),
      krankTage: krankRaw ? parseGermanNumber(krankRaw.replace(/Tage/i, '')) : null,
    };
  }
  return merged;
}

// Tagesumsätze-Seite listet ALLE Filialen firmenweit (~300) — pro Zeile
// [MarktNr-00, "MarktNr: Name", Ort, Tagesumsatz, Gästezahl]. Kein Filter
// auf eigene Filialen nötig, wir picken uns unsere marktNr-Schlüssel aus der
// vollen Tabelle raus (DOM-Query, nicht Text-Regex — robuster gegen
// Layout-Änderungen an der umgebenden Seite).
async function getTagesumsatzAlle(page, sessionBase, date) {
  // Serverseitig gerendert (kein Client-JS befüllt die Tabelle nach) — page.goto()
  // wartet schon auf "load", ein zusätzliches waitFor() auf ein bestimmtes <td>
  // schlägt fehl, weil das allererste <td> im Seiten-Layout (Navigationsraster)
  // unsichtbar ist und Playwright standardmäßig auf Sichtbarkeit wartet.
  await page.goto(`${sessionBase}/statistiken/tagesumsaetze/${compactDate(date)}.html`);
  const rows = await page.$$eval('td', (tds) => {
    const out = [];
    for (const td of tds) {
      if (!/^\d{6}-\d{2}$/.test(td.textContent.trim())) continue;
      const tr = td.closest('tr');
      if (!tr) continue;
      out.push(Array.from(tr.children).map((c) => c.textContent.trim()));
    }
    return out;
  });
  const out = {};
  for (const cells of rows) {
    const marktNrRaw = cells[0].split('-')[0];
    const marktNr = marktNrRaw; // Tagesumsätze nutzt bereits die kanonische Nr, kein Alias nötig (611125 taucht dort separat auf)
    out[marktNr] = parseGermanNumber(cells[3]);
  }
  return out;
}

async function main() {
  if (!USER || !PASSWORD) {
    throw new Error('WELO_USER / WELO_PASSWORD fehlen in der .env-Datei.');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();

  try {
    console.log('Login bei Welo/SuCi-Net…');
    const sessionBase = await login(page);

    console.log('Lade Aktives Personal (Soll-Std.)…');
    const personal = await getPersonalRows(page, sessionBase);
    console.log(`  ${Object.keys(personal).length} aktive Mitarbeiter.`);

    const heute = new Date();
    const ids = Object.keys(personal);
    console.log(`Lade Urlaub/Krank für ${heute.getFullYear()} (${ids.length} Personen einzeln)…`);
    const urlaubKrank = await getUrlaubKrankRows(page, sessionBase, ids, heute.getFullYear());
    console.log(`  ${Object.keys(urlaubKrank).length} Urlaub/Krank-Datensätze.`);

    // Personal-Batch
    const empBatch = db.batch();
    let empCount = 0;
    for (const [id, p] of Object.entries(personal)) {
      const uk = urlaubKrank[id] || {};
      empBatch.set(
        db.collection(EMP_COLLECTION).doc(id),
        {
          name: p.name, taetigkeit: p.taetigkeit, marktNr: p.marktNr, marktname: p.marktname,
          sollStd: p.sollStd,
          urlaubOffen: uk.urlaubOffen ?? null,
          urlaubGenommen: uk.urlaubGenommen ?? null,
          urlaubAnspruch: uk.urlaubAnspruch ?? null,
          krankTage: uk.krankTage ?? null,
          updatedAt: now,
        },
        { merge: true }
      );
      empCount++;
    }
    await empBatch.commit();
    console.log(`✓ ${empCount} Mitarbeiter-Datensätze in "${EMP_COLLECTION}" geschrieben.`);

    // Tagesziel: heute + genau vor einem Jahr
    console.log('Lade Tagesumsatz heute…');
    const heuteUmsatz = await getTagesumsatzAlle(page, sessionBase, heute);
    const vorjahr = new Date(heute);
    vorjahr.setFullYear(vorjahr.getFullYear() - 1);
    console.log(`Lade Tagesumsatz Vorjahr (${isoDate(vorjahr)})…`);
    const vorjahrUmsatz = await getTagesumsatzAlle(page, sessionBase, vorjahr);

    const marktNrSet = new Set([...Object.values(personal).map((p) => p.marktNr)]);
    const zielBatch = db.batch();
    let zielCount = 0;
    for (const marktNr of marktNrSet) {
      const uHeute = heuteUmsatz[marktNr] ?? null;
      const uVorjahr = vorjahrUmsatz[marktNr] ?? null;
      const ziel = uVorjahr != null ? Math.round(uVorjahr * ZIEL_FAKTOR * 100) / 100 : null;
      const marktname = Object.values(personal).find((p) => p.marktNr === marktNr)?.marktname || '';
      zielBatch.set(
        db.collection(ZIEL_COLLECTION).doc(`${marktNr}_${compactDate(heute)}`),
        {
          marktNr, marktname, datum: isoDate(heute),
          umsatzHeute: uHeute, umsatzVorjahr: uVorjahr, zielFaktor: ZIEL_FAKTOR, ziel,
          updatedAt: now,
        },
        { merge: true }
      );
      zielCount++;
    }
    await zielBatch.commit();
    console.log(`✓ ${zielCount} Tagesziel-Datensätze in "${ZIEL_COLLECTION}" geschrieben.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('✗ Sync fehlgeschlagen:', err.message);
  if (err.cause) console.error('  Ursache:', err.cause.message || err.cause);
  process.exitCode = 1;
});
