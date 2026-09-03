// Loggt sich bei Welo/SuCi-Net ein (Playwright, wegen Session-Cookie-Auth)
// und synchronisiert zwei Dinge für alle Mitarbeiter/Filialen:
//
//  1. Personal-Stammdaten: Soll-Stunden/Woche (aus "Aktives Personal") +
//     Resturlaub/Genommen/Anspruch/Krank-Tage (aus der Jahresansicht jeder
//     einzelnen Person, /pf/jahresansicht/{PersonalNr}-{Jahr}.html — nicht
//     aus der "U/K Liste": deren drei Kategorien FS/MJ/TM ließen 11 von 61
//     Mitarbeitern komplett aus, siehe Projekt-Notiz vom 02.09.2026).
//  2. Stunden-Vergleich: tatsächlich gearbeitete Stunden (Ist, aus derselben
//     Jahresansicht-Seite) gegen den eigenen Dienstplan (Soll, aus der
//     plan-Collection) — für "gestern" (Welo aktualisiert Ist immer erst mit
//     einem Tag Verzug) und für den laufenden Monat kumuliert. Auftrag
//     t.duong 03.09.2026: Warnhinweis + Monatsstunden auf der Dienstplan-
//     Seite der Mitarbeiter-App, direkt unter Stammfiliale/Zweitfiliale.
//     Zusätzlich: AZ-Konto (laufender Über-/Unterstunden-Saldo seit Beginn,
//     nur bei Monatslohn-Verträgen) — ebenfalls von der Jahresansicht-Seite,
//     dem Mitarbeiter selbst gezeigt UND dem Gebietsleiter beim
//     Dienstplan-Erstellen als Klammerwert (Auftrag t.duong 03.09.2026).
//  3. Tagesziel je Filiale: Statistiken > Tagesumsätze, datumsbasiert
//     aufrufbar, funktioniert rückwirkend bis mind. 2 Jahre (frühere Jahre
//     haben für neuere Filialen keine Daten, weil sie da noch nicht im
//     System waren). Ziel = robuste Vorjahres-Basis × effektiver Faktor
//     (Details bei N1_GLAETTUNG_OFFSETS/TREND_TAGE weiter unten — kurz:
//     Durchschnitt über 5 Vorjahres-Wochentage statt nur 1 Einzeltag, mit
//     Fallback über 2 Jahre zurück skaliert per aktueller Wachstumsrate, falls
//     die Vorjahreswoche selbst durch einen mehrtägigen Ausfall unbrauchbar
//     ist — live bestätigt am 03.09.2026: Bad Hersfeld 402146 hatte
//     28.08.-03.09.2025 einen ~einwöchigen Kassenausfall, 2024 lief derselbe
//     Tag normal). Der effektive Faktor ist mindestens ZIEL_FAKTOR (Standard
//     1,25, "Vorjahresumsatz + 25 %", per t.duong 02.09.2026 bewusst als
//     feste Formel statt Live-KI-Aufruf gewählt), kann aber höher ausfallen,
//     wenn eine Filiale laut den letzten 28 Tagen real schneller wächst —
//     GEDÄMPFT um WACHSTUM_DAEMPFUNG (Standard 10 % des Anteils über 1,25
//     hinaus, nicht das volle Wachstum): Auftrag t.duong 03.09.2026, ein zu
//     schneller Ziel-Sprung lässt dem Personal keine Zeit, produktionsseitig
//     mitzuziehen. Zusätzlich Produktionsziel = ziel ÷
//     (1 − WASTE_FAKTOR) (Standard 25 % Waste — bei frisch zubereitetem
//     Sushi wird ein Teil nicht verkauft; Waste ist 25 % der PRODUKTION,
//     nicht 25 % oben auf das Ziel draufgerechnet — per t.duong 03.09.2026).
//
// Schreibt:
//   emp_welo/{PersonalNr} = {name, taetigkeit, marktNr, marktname, sollStd,
//     urlaubOffen, urlaubGenommen, urlaubAnspruch, krankTage, azKonto,
//     updatedAt, stunden: {gesternDatum, gesternIst, gesternSoll, gesternDiff,
//       monatIst, monatSoll, monatMinus}}
//   azKonto: null = kein AZ-Konto (Stundenlohn-Vertrag), sonst aktueller
//     Saldo in Stunden (negativ = Minusstunden, positiv = Plusstunden).
//   tagesziel/{marktNr}_{YYYYMMDD} = {marktNr, marktname, datum, umsatzHeute,
//     umsatzVorjahrRoh, umsatzVorjahr, vorjahrMethode, wachstumsrate,
//     zielFaktor, effektiverFaktor, ziel, wasteFaktor, produktionsziel,
//     umsatzHeuteVerdaechtig, umsatzVorjahrVerdaechtig, updatedAt}
//   umsatzVorjahrRoh: reiner Einzeltageswert vor genau 1 Jahr, NUR zur
//     Transparenz — für ziel wird stattdessen umsatzVorjahr (die robuste
//     Basis) verwendet.
//   vorjahrMethode: 'geglaettet' (Normalfall, Durchschnitt über 5
//     Vorjahres-Wochentage) | 'n2-skaliert' (Vorjahreswoche unbrauchbar,
//     2-Jahre-Wert × Wachstumsrate verwendet) | 'einzeltag' (letzter
//     Fallback, roher Einzeltageswert) | null (keine robuste Basis
//     berechenbar → ziel/produktionsziel bleiben null).
//   wachstumsrate: Summe der letzten 28 Tage ÷ Summe derselben 28 Tage vor
//     einem Jahr, nur mit genug plausiblen Tagen berechnet, sonst null.
//   *Verdaechtig-Felder: nur gesetzt, wenn Welo selbst einen unplausibel
//     niedrigen Tagesumsatz gemeldet hat (< WELO_UMSATZ_MIN_PLAUSIBEL, Standard
//     100 €) — enthalten den rohen (verworfenen) Wert zur Kontrolle.
//  4. emps-Sync: schreibt Name/Filiale/FilialeNr/active/region für jeden
//     aktiven Mitarbeiter direkt in die "emps"-Collection, die index.html's
//     empsSyncListener() (live onSnapshot, region-gefiltert) sowieso schon
//     beobachtet — die manuelle CSV-Import+Veröffentlichen-Runde entfällt für
//     Neuzugänge/Abgänge damit komplett (Auftrag t.duong 03.09.2026: Liste
//     ändert sich laufend, soll automatisch aktuell bleiben). Schreibt NUR
//     name/filiale/filialeNr/active/region — zweit/shopleiter/vize/eintritt/
//     austritt (rein GLSC-eigene Felder, die Welo nicht kennt) bleiben dank
//     {merge:true} unangetastet. region wird, falls das emps-Dokument schon
//     existiert, NIE verändert (nur beim allerersten Anlegen per
//     MARKTNR_REGION gesetzt) — dieselbe Vorsicht wie bei fbPublish() in
//     index.html, das aus genau demselben Grund (CSV mit gemischten Gebieten
//     verschob sonst halbe Belegschaft ins falsche Postfach) die bestehende
//     Region niemals überschreibt. Mitarbeiter, die aus der aktuellen
//     Welo-Liste verschwinden (Austritt), werden auf active:false gesetzt —
//     genau wie es der bisherige manuelle CSV-Import auch schon tat.
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
const { MARKTNR_ALIASES, MARKTNR_REGION } = require('./branches');
const { withWeloLock } = require('./sync-lock');

const BASE_URL = process.env.WELO_BASE_URL || 'https://welo.sushi-circle.de';
const USER = process.env.WELO_USER;
const PASSWORD = process.env.WELO_PASSWORD;
const ZIEL_FAKTOR = parseFloat(process.env.WELO_ZIEL_FAKTOR || '1.25');
// Waste-Anteil: bei frisch zubereiteter Ware (Sushi) wird ein Teil der
// Produktion nicht verkauft und muss entsorgt werden. Per t.duong 03.09.2026:
// Waste liegt bei ca. 25% DER GESAMTEN PRODUKTION (nicht 25% des Ziels
// obendrauf) — um das Umsatzziel (ziel) tatsächlich zu erreichen, muss also
// für ziel = 0,75 × Produktion produziert werden, d.h.
// Produktionsziel = ziel ÷ (1 − WASTE_FAKTOR).
const WASTE_FAKTOR = parseFloat(process.env.WELO_WASTE_FAKTOR || '0.25');
// Plausibilitäts-Grenze für Tagesumsatz: alles darunter ist für einen ganzen
// Verkaufstag technisch unmöglich (schon eine einzelne 6-Std.-Schicht sollte
// laut t.duong mind. ~500 € erwirtschaften) und damit ein Datenfehler auf
// Welo-Seite, kein echter Umsatz — live bestätigt am 03.09.2026: Bad Hersfeld
// (402146) zeigte für den Vorjahresvergleich "8,38 €", was Welo selbst so
// eingetragen hat (kein Scraping-Bug). Solche Werte werden NICHT stillschweigend
// verworfen, sondern als *Verdaechtig-Feld dokumentiert, damit HR es sieht —
// nur ziel/produktionsziel werden dann nicht aus einem offensichtlich falschen
// Wert berechnet.
const UMSATZ_MIN_PLAUSIBEL = parseFloat(process.env.WELO_UMSATZ_MIN_PLAUSIBEL || '100');
// Dämpfung für den Wachstums-Bonus: eine Filiale mit z.B. +33% realer
// 28-Tage-Wachstumsrate soll NICHT sofort ein um 33% höheres Ziel bekommen —
// per t.duong 03.09.2026: "tăng quá nhiều nhân viên sẽ không đủ thời gian
// thực hiện" (zu starker Sprung, Personal hat keine Zeit sich darauf
// einzustellen/hochzuproduzieren). Nur DAEMPFUNG (Standard 10%) des Anteils
// oberhalb von ZIEL_FAKTOR fließt ins Ziel ein — der Rest des beobachteten
// Wachstums wird zwar weiter in wachstumsrate protokolliert, aber nicht
// sofort ins Ziel übernommen; steigt die Filiale weiter, wandert der
// effektive Faktor beim nächsten Lauf entsprechend langsam nach.
const WACHSTUM_DAEMPFUNG = parseFloat(process.env.WELO_WACHSTUM_DAEMPFUNG || '0.10');
const EMP_COLLECTION = 'emp_welo';
const ZIEL_COLLECTION = 'tagesziel';
const EMPS_COLLECTION = 'emps'; // index.html's echte Mitarbeiter-Stammdaten (region-gefiltert)

// Welo liefert Namen als "Frau/Herr Nachname, Vorname" — die "emps"-Collection
// (und damit die gesamte GLSC-App: Dienstplan, PDFs, Zweitfiliale-Listen …)
// erwartet "Vorname Nachname" ohne Anrede. Bei unerwartetem Format (kein
// Komma) wird der rohe Welo-Name unverändert übernommen statt zu raten.
function reformatWeloName(weloName) {
  const m = (weloName || '').match(/^(?:Frau|Herr)\s+(.+),\s*(.+)$/);
  if (!m) return weloName || '';
  return `${m[2].trim()} ${m[1].trim()}`;
}

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
//
// Dieselbe Seite liefert auch die tatsächlich gearbeiteten Stunden (Ist) pro
// Tag und pro Monat (Auftrag von t.duong am 03.09.2026: "gestern"-Warnung +
// Monats-Übersicht auf der Dienstplan-Seite) — darum in EINEM Seitenaufruf
// pro Person mit erledigt, nicht in einem zweiten Durchlauf.
// DOM-Struktur (per echter Seite verifiziert): jeder Kalendertag ist eine
// <table class="tgl"> (normaler Tag) oder <table class="tgd"> (Tag mit
// Urlaub/Krank-Markierung), beide mit Attribut _r="YYYYMMDD" und einer
// <td class="bo"> mit dem Ist-Stundenwert ("-" wenn nicht gearbeitet).
// An Monatsgrenzen taucht derselbe Tag zweimal auf (Wochen, die zwei Monate
// überspannen) — erster Treffer gewinnt, Wert ist ohnehin identisch.
// Die kumulierte Monatssumme steht einmal pro Monat als
// <td class="az_h">Iststunden</td><td class="az_d">143,12<br>...</td> —
// zwölf Treffer in Dokumentreihenfolge Januar..Dezember, per Monatsindex
// direkt adressierbar.
function extractLabelValue(html, label) {
  const re = new RegExp('>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<\\/td>\\s*<td[^>]*>([^<]*)<\\/td>', 'i');
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

// AZ-Konto (Arbeitszeitkonto — laufender Über-/Unterstunden-Saldo seit Beginn,
// nur für Mitarbeiter mit Monatslohn-Vertrag; per t.duong 03.09.2026: soll dem
// Mitarbeiter selbst gezeigt werden, damit er/sie die Schichten entsprechend
// ausgleicht, und dem Gebietsleiter beim Dienstplan-Erstellen als Klammerwert.
// Auf der Jahresansicht gibt es dafür 12 Monats-Kästchen ("Auswertung"), aber
// NUR bei Personen, die überhaupt ein AZ-Konto haben — bei reinen
// Stundenlohn-Mitarbeitern fehlt die Zeile
// <td class="ay_hb">AZ-Konto</td><td class="ay_db">…</td> komplett (live
// geprüft: Shopleiterin hatte die Zeile mit echtem Wert, ein Sushi-Shop-MA
// gar keine "Konto"-Erwähnung auf der ganzen Seite). Zukünftige/noch nicht
// abgerechnete Monate zeigen "-" statt eines Werts.
//
// WICHTIG (Korrektur per t.duong 03.09.2026, nach Live-Check ungewöhnlich
// großer Minuswerte): das Kästchen des LAUFENDEN Monats zeigt schon jetzt den
// Saldo, als wären alle noch kommenden Tage dieses Monats komplett
// gearbeitet worden mit 0 Ist-Stunden — Soll wird sofort für den ganzen Monat
// abgezogen, Ist gleicht erst nach und nach beim tatsächlichen Arbeiten aus.
// Dadurch ist der laufende Monat künstlich stark negativ, v.a. Anfang des
// Monats. Deshalb wird IMMER das Kästchen des VORMONATS genommen (bereits
// abgeschlossen, echter Endstand) — per Datums-Anker (nächstgelegenes
// vorangehende _r="YYYYMMDD") auf den Zielmonat gefiltert, nicht per
// Positions-Index (Jan=0..Dez=11): dieselbe Positions-Fragilität hatte schon
// bei "Iststunden" für unterjährig Eingestellte falsche Werte geliefert
// (siehe Notiz oben bei dailyIst). Gibt "-" oder gar kein Kästchen für den
// Vormonat zurück (z.B. neu eingestellt) → null.
//
// BEKANNTE LÜCKE (unverifiziert, da aktuell nicht live testbar): im Januar
// läge der Vormonat (Dezember) auf der Jahresansicht-Seite des VORJAHRS, die
// hier nicht geladen wird — extractAzKonto liefert dann null statt des
// echten Dezember-Endstands. Vor Januar 2027 nochmal prüfen und ggf. die
// Vorjahres-Seite zusätzlich laden.
function extractAzKonto(html, heute) {
  const zielMonat = new Date(heute.getFullYear(), heute.getMonth() - 1, 1);
  const zielYm = zielMonat.getFullYear() + String(zielMonat.getMonth() + 1).padStart(2, '0');

  const dateRe = /_r="(\d{8})"/g;
  const dates = [];
  let dm;
  while ((dm = dateRe.exec(html))) dates.push({ idx: dm.index, date: dm[1] });

  const azRe = /<td class="ay_hb">AZ-Konto<\/td><td class="ay_db">([^<]*(?:<span[^>]*>([^<]*)<\/span>)?[^<]*)<\/td>/g;
  let am;
  while ((am = azRe.exec(html))) {
    let nearestDate = null;
    for (const d of dates) {
      if (d.idx >= am.index) break;
      nearestDate = d.date;
    }
    if (!nearestDate || !nearestDate.startsWith(zielYm)) continue;
    const raw = (am[2] != null ? am[2] : am[1]).trim();
    return raw === '-' || raw === '' ? null : parseGermanNumber(raw);
  }
  return null;
}
async function getJahresansichtData(page, sessionBase, ids, year, heute) {
  const merged = {};
  for (const id of ids) {
    await page.goto(`${sessionBase}/pf/jahresansicht/${id}-${year}.html`);
    const html = await page.content();
    const krankRaw = extractLabelValue(html, 'Krank:'); // "0,00 Tage"
    // Nur die Tageswerte per DOM auslesen (eindeutig über _r="YYYYMMDD"). Die
    // von Welo selbst kumulierte "Iststunden"-Monatssumme wird NICHT
    // übernommen — deren Position auf der Seite hängt vom Eintrittsdatum ab
    // (bei unterjährig Eingestellten fehlen die früheren Monate, wodurch sich
    // die Reihenfolge verschiebt). Stattdessen wird die Monatssumme in
    // berechneStunden() selbst aus den Tageswerten aufsummiert.
    //
    // WICHTIG (per echtem Test am 03.09.2026 entdeckt, Nachfrage t.duong):
    // Der .bo-Wert eines Kranktages ist NICHT "-", sondern die dafür
    // gutgeschriebene Soll-Stunden-Zahl (z.B. 6,00) — Welo trennt das erst in
    // der Wochensumme wieder auf ("SN:" = wirklich gearbeitet, "KR:"/"+U:" =
    // gutgeschriebene Abwesenheit). "special" = Tabellenklasse "tgd" statt
    // "tgl" — NICHT über ein inneres <span class="kr"|"ur"> erkennbar: bei
    // einem echten 4-Tage-Krankblock (12.-15.08.2026, live geprüft) erschien
    // der span nur am ERSTEN/LETZTEN Tag als öffnende/schließende Klammer
    // "["/"]", die beiden mittleren Tage hatten gar keinen span. Ein
    // <img class="ma" ...> steht dagegen auf JEDEM Tag (auch normalen) und
    // ist damit ebenfalls kein Signal. Die Tabellenklasse "tgd" traf exakt
    // und ausschließlich auf alle 4 echten Kranktage zu — deshalb dieses
    // Signal statt der (unzuverlässigen) inneren Marker-Suche.
    const daily = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('table.tgl, table.tgd').forEach((el) => {
        const date = el.getAttribute('_r');
        const bo = el.querySelector('.bo');
        if (!date || !bo || date in out) return;
        out[date] = { val: bo.textContent.trim(), special: el.classList.contains('tgd') };
      });
      return out;
    });
    merged[id] = {
      urlaubOffen: parseGermanNumber(extractLabelValue(html, 'Offen:')),
      urlaubGenommen: parseGermanNumber(extractLabelValue(html, 'Genommen:')),
      urlaubAnspruch: parseGermanNumber(extractLabelValue(html, 'Jahr:')),
      krankTage: krankRaw ? parseGermanNumber(krankRaw.replace(/Tage/i, '')) : null,
      dailyIst: daily, // {"20260902": {val:"7,03", special:false}, ...} — special=true bei Krank/Urlaub/Feiertag usw.
      azKonto: extractAzKonto(html, heute), // null = kein AZ-Konto oder Vormonat noch ohne Endstand
    };
  }
  return merged;
}

// "06:00-13:30" -> 7.5 Std. Frei/Urlaub/Krank/leer -> 0 (kein geplanter
// Arbeitstag, zählt nicht als Soll-Stunden für den Monats-/Tagesvergleich).
function parseShiftHours(val) {
  const m = String(val || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const start = (+m[1]) * 60 + (+m[2]);
  let end = (+m[3]) * 60 + (+m[4]);
  if (end <= start) end += 24 * 60; // über Mitternacht
  return (end - start) / 60;
}
function fbSlugLocal(f) {
  return String(f || '').replace(/\s+/g, '_').toLowerCase();
}
async function getPlanDoc(db, marktname, month, cache) {
  const docId = fbSlugLocal(marktname) + '__' + month;
  if (!(docId in cache)) {
    const snap = await db.collection('plan').doc(docId).get();
    cache[docId] = snap.exists ? snap.data() || {} : null;
  }
  return cache[docId];
}
// Schicht-Einträge einer Person im plan-Dokument finden — Schlüssel sind
// "{PersonalNr}-{Name}", aber der Name kann anders formatiert sein als bei
// Welo. Robuster: nur auf den Nummer-Präfix vor dem ersten "-" matchen
// (dasselbe Muster wie beim Besetzungs-Check in index.html/mitarbeiter.html).
function findEmpShifts(planDoc, empId) {
  if (!planDoc || !planDoc.shifts) return null;
  const key = Object.keys(planDoc.shifts).find((k) => k.slice(0, k.indexOf('-')) === empId);
  return key ? planDoc.shifts[key] : null;
}

// Vergleicht "gestern" (Ist aus Welo, Soll aus dem eigenen Dienstplan) und
// summiert Soll/Ist für den laufenden Monat bis einschließlich gestern.
// Nur die eigene Stammfiliale wird für den Soll-Wert herangezogen — bei den
// wenigen Springern/Filialübergreifenden (z.B. Duc Hanh Doan, Trong) fehlen
// dadurch Soll-Stunden aus Zweiteinsätzen; das führt im schlimmsten Fall zu
// einem zu niedrigen Soll (und damit KEINER fälschlichen Minus-Warnung) —
// sicherer Fehlerfall, da laut Vorgabe nur echtes Minus angezeigt werden soll.
async function berechneStunden(db, empId, emp, ja, planCache) {
  const heute = new Date();
  const gestern = new Date(heute);
  gestern.setDate(gestern.getDate() - 1);
  const gesternIso = isoDate(gestern);
  const gesternCompact = compactDate(gestern);

  const daily = ja.dailyIst || {};
  // Krank-/Urlaub-/Feiertag-Tage (day.special) werden NICHT als gearbeitete
  // Zeit gezählt — Welo trägt dort trotzdem eine Stundenzahl ein (die dafür
  // gutgeschriebenen Soll-Stunden), aber das ist keine tatsächlich geleistete
  // Arbeit. Frage t.duong 03.09.2026 bestätigt: das muss ausgeschlossen
  // werden, sonst zählt ein Krank-/Urlaubstag fälschlich als Arbeitszeit.
  const gesternZelle = daily[gesternCompact];
  const gesternIst = gesternZelle && !gesternZelle.special ? parseGermanNumber(gesternZelle.val) : null;

  // NICHT den monthlyIst[monatIndex]-Array per Positionsindex nehmen: bei
  // Mitarbeitern, deren Jahresansicht nicht ab Januar beginnt (z.B. erst
  // dieses Jahr eingestellt), verschiebt sich die Monatsreihenfolge auf der
  // Seite und Index 8 ist dann nicht mehr September (per echtem Test am
  // 03.09.2026 entdeckt — mehrere Personen zeigten "monatIst":0 trotz
  // gestriger Iststunden). Stattdessen die Tageswerte selbst aufsummieren —
  // eindeutig über das _r="YYYYMMDD"-Datum, unabhängig von der Seitenreihenfolge —
  // und dabei Krank-/Urlaubstage (special) ausschließen (siehe oben).
  const monatPrefix = heute.getFullYear() + String(heute.getMonth() + 1).padStart(2, '0');
  let monatIst = null;
  for (const [datum, zelle] of Object.entries(daily)) {
    if (!datum.startsWith(monatPrefix) || zelle.special) continue;
    const n = parseGermanNumber(zelle.val);
    if (n != null) monatIst = (monatIst || 0) + n;
  }
  if (monatIst != null) monatIst = Math.round(monatIst * 100) / 100;

  const month = heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0');
  const planDoc = await getPlanDoc(db, emp.marktname, month, planCache);
  const shifts = findEmpShifts(planDoc, empId);

  let gesternSoll = null;
  let monatSoll = 0;
  if (shifts) {
    if (gesternIso in shifts) gesternSoll = parseShiftHours(shifts[gesternIso]);
    const erster = new Date(heute.getFullYear(), heute.getMonth(), 1);
    for (let d = new Date(erster); d <= gestern; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d);
      if (iso in shifts) monatSoll += parseShiftHours(shifts[iso]);
    }
  }
  monatSoll = Math.round(monatSoll * 100) / 100;

  const gesternDiff = (gesternIst != null && gesternSoll != null) ? Math.round((gesternIst - gesternSoll) * 100) / 100 : null;
  const monatMinusRaw = monatIst != null ? Math.round((monatSoll - monatIst) * 100) / 100 : null;
  // Rundungsrauschen (<3 Min.) nicht als Minus zeigen; positives Delta
  // (Mehrarbeit) bewusst NICHT anzeigen — siehe Vorgabe t.duong 03.09.2026:
  // unvereinbarte Mehrarbeit wird nicht bezahlt, soll also nicht als Zahl
  // suggeriert werden, die "gutgeschrieben" wäre.
  const monatMinus = monatMinusRaw != null && monatMinusRaw > 0.05 ? monatMinusRaw : null;

  return {
    gesternDatum: gesternIso, gesternIst, gesternSoll, gesternDiff,
    monatIst, monatSoll, monatMinus,
  };
}

// Tagesumsätze-Seite listet ALLE Filialen firmenweit (~300) — pro Zeile
// [MarktNr-00, "MarktNr: Name", Ort, Tagesumsatz, Gästezahl]. Kein Filter
// auf eigene Filialen nötig, wir picken uns unsere marktNr-Schlüssel aus der
// vollen Tabelle raus (DOM-Query, nicht Text-Regex — robuster gegen
// Layout-Änderungen an der umgebenden Seite).
// Vorjahres-Basis für das Tagesziel robust gegen mehrtägige Ausfälle machen
// (per t.duong 03.09.2026, live bestätigt: Bad Hersfeld 402146 hatte
// 28.08.-03.09.2025 einen ~einwöchigen Kassenausfall mit Werten von 0-8 €
// statt normal ~400-600 €, danach sofort wieder normal — kein einzelner
// Ausreißertag, den eine einfache ±1-Wochen-Glättung noch auffangen würde).
//
// Formel:
//  A) Geglättete Vorjahres-Basis: Durchschnitt derselben Wochentage
//     (Vorjahresdatum ±14/±7/0 Tage, 5 Kandidaten), aber nur die davon, die
//     über UMSATZ_MIN_PLAUSIBEL liegen — ein mehrtägiger Ausfall filtert sich
//     so selbst heraus, solange nicht alle 5 Kandidaten betroffen sind.
//  B) Wachstumsrate: Summe der letzten 28 Tage ggü. denselben 28 Kalendertagen
//     vor genau einem Jahr (nur mit genug plausiblen Tagen berechnet) — bildet
//     ab, ob eine Filiale gerade schneller/langsamer wächst als die Vorjahres-
//     Basis unterstellt.
//  C) Fallback über 2 Jahre zurück: wenn (A) mangels genug plausibler Tage
//     nicht berechenbar ist (z.B. eine ganze Woche Ausfall wie Bad Hersfeld),
//     wird der sehr wahrscheinlich saubere Wert von vor genau 2 Jahren mit der
//     Wachstumsrate aus (B) ein Jahr nach vorne skaliert.
//  D) Ziel = Basis × effektiver Faktor, effektiver Faktor = max(Wachstumsrate,
//     ZIEL_FAKTOR) — nie unter der bisherigen +25%-Politik, aber höher für
//     Filialen, die real schon schneller wachsen (Auftrag t.duong 03.09.2026).
const N1_GLAETTUNG_OFFSETS = [-14, -7, 0, 7, 14]; // Tage relativ zum Vorjahresdatum, exakt gleicher Wochentag
const TREND_TAGE = 28;

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Lädt Tagesumsätze für mehrere Termine (Duplikate werden übersprungen) und
// liefert eine Map compactDateStr -> {marktNr: umsatz}.
async function fetchUmsatzFuerTermine(page, sessionBase, dates) {
  const cache = {};
  for (const d of dates) {
    const key = compactDate(d);
    if (cache[key]) continue;
    cache[key] = await getTagesumsatzAlle(page, sessionBase, d);
  }
  return cache;
}

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
    // KORREKTUR (per t.duong 03.09.2026, echtem Test entdeckt): Ratio Baunatal
    // taucht hier NICHT unter der kanonischen Nr 401125 auf, sondern nur unter
    // der SushiTime-Alias-Nr 611125 (Zeile: "611125-00" / "401125: RA-Baunatal-
    // Fuldastraße" / "1.035,35 €") — der alte Kommentar hier war falsch. Ohne
    // Alias-Auflösung landete der Umsatz unter dem falschen Key und die
    // spätere Suche nach marktNr="401125" fand nichts (umsatzVorjahr blieb
    // dauerhaft null). Jetzt dieselbe MARKTNR_ALIASES-Auflösung wie überall
    // sonst im Skript.
    const marktNr = MARKTNR_ALIASES[marktNrRaw] || marktNrRaw;
    out[marktNr] = parseGermanNumber(cells[3]);
  }
  return out;
}

// Läuft von mehreren Stellen aus (Startup-Catchup, manueller Doppelklick,
// automatische Umsatz-Auffrischung im Watcher) — withWeloLock verhindert,
// dass zwei dieser Läufe sich eine Welo-Sitzung teilen und sich gegenseitig
// rauswerfen (siehe sync-lock.js).
async function main() {
  return withWeloLock('welo', syncAll);
}

async function syncAll() {
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
    console.log(`Lade Urlaub/Krank/Ist-Stunden für ${heute.getFullYear()} (${ids.length} Personen einzeln)…`);
    const jahresdaten = await getJahresansichtData(page, sessionBase, ids, heute.getFullYear(), heute);
    console.log(`  ${Object.keys(jahresdaten).length} Datensätze.`);

    console.log('Berechne Stunden-Vergleich (gestern + laufender Monat) gegen den Dienstplan…');
    const planCache = {};
    const stunden = {};
    for (const id of ids) {
      stunden[id] = await berechneStunden(db, id, personal[id], jahresdaten[id] || {}, planCache);
    }

    // Personal-Batch
    const empBatch = db.batch();
    let empCount = 0;
    for (const [id, p] of Object.entries(personal)) {
      const uk = jahresdaten[id] || {};
      const st = stunden[id] || {};
      empBatch.set(
        db.collection(EMP_COLLECTION).doc(id),
        {
          name: p.name, taetigkeit: p.taetigkeit, marktNr: p.marktNr, marktname: p.marktname,
          sollStd: p.sollStd,
          urlaubOffen: uk.urlaubOffen ?? null,
          urlaubGenommen: uk.urlaubGenommen ?? null,
          urlaubAnspruch: uk.urlaubAnspruch ?? null,
          krankTage: uk.krankTage ?? null,
          azKonto: uk.azKonto ?? null,
          stunden: {
            gesternDatum: st.gesternDatum ?? null,
            gesternIst: st.gesternIst ?? null,
            gesternSoll: st.gesternSoll ?? null,
            gesternDiff: st.gesternDiff ?? null,
            monatIst: st.monatIst ?? null,
            monatSoll: st.monatSoll ?? null,
            monatMinus: st.monatMinus ?? null,
          },
          updatedAt: now,
        },
        { merge: true }
      );
      empCount++;
    }
    await empBatch.commit();
    console.log(`✓ ${empCount} Mitarbeiter-Datensätze in "${EMP_COLLECTION}" geschrieben.`);

    // emps-Sync (siehe Doc-Kommentar oben, Punkt 4): ersetzt die manuelle
    // CSV-Import+Veröffentlichen-Runde für Neuzugänge/Abgänge.
    console.log('Synchronisiere "emps" (Mitarbeiter-Stammdaten für die HR-App)…');
    const empsSnap = await db.collection(EMPS_COLLECTION).get();
    const bestehendeRegion = {}, bestehendAktiv = new Set();
    empsSnap.forEach((doc) => {
      const d = doc.data() || {};
      if (d.region) bestehendeRegion[doc.id] = d.region;
      if (d.active !== false) bestehendAktiv.add(doc.id);
    });

    const empsBatch = db.batch();
    let empsCount = 0, empsOhneRegion = 0;
    for (const [id, p] of Object.entries(personal)) {
      const region = bestehendeRegion[id] || MARKTNR_REGION[p.marktNr] || null;
      if (!region) empsOhneRegion++;
      const payload = {
        name: reformatWeloName(p.name), filiale: p.marktname, filialeNr: p.marktNr,
        active: true, updatedAt: now,
      };
      if (region) payload.region = region; // nie ein leeres/falsches region-Feld schreiben
      empsBatch.set(db.collection(EMPS_COLLECTION).doc(id), payload, { merge: true });
      empsCount++;
    }
    // Wer vorher aktiv war, aber jetzt nicht mehr in der Welo-Liste auftaucht,
    // ist ausgeschieden — genau wie beim bisherigen manuellen CSV-Import.
    let deaktiviert = 0;
    for (const id of bestehendAktiv) {
      if (!personal[id]) {
        empsBatch.set(db.collection(EMPS_COLLECTION).doc(id), { active: false, updatedAt: now }, { merge: true });
        deaktiviert++;
      }
    }
    await empsBatch.commit();
    console.log(`✓ ${empsCount} Mitarbeiter in "${EMPS_COLLECTION}" aktualisiert, ${deaktiviert} als ausgeschieden markiert.`
      + (empsOhneRegion ? ` ⚠️ ${empsOhneRegion} ohne Region (MARKTNR_REGION in branches.js prüfen).` : ''));

    // Tagesziel: heute + robuste Vorjahres-Basis (geglättet / 2-Jahre-Fallback,
    // siehe Kommentar bei getTagesumsatzAlle/N1_GLAETTUNG_OFFSETS oben)
    const vorjahrAnchor = new Date(heute); vorjahrAnchor.setFullYear(vorjahrAnchor.getFullYear() - 1);
    const vorvorjahrAnchor = new Date(heute); vorvorjahrAnchor.setFullYear(vorvorjahrAnchor.getFullYear() - 2);
    const n1WindowDates = N1_GLAETTUNG_OFFSETS.map((off) => addDays(vorjahrAnchor, off));
    const recentDates = []; for (let i = 0; i < TREND_TAGE; i++) recentDates.push(addDays(heute, -i));
    const recentVorjahrDates = recentDates.map((d) => addDays(d, -365));

    const allTermine = [heute, vorvorjahrAnchor, ...n1WindowDates, ...recentDates, ...recentVorjahrDates];
    console.log(`Lade Tagesumsätze für Ziel-Berechnung (${new Set(allTermine.map(compactDate)).size} unterschiedliche Tage: heute, ${N1_GLAETTUNG_OFFSETS.length} Tage Vorjahres-Fenster, 2×${TREND_TAGE} Tage Trend, 1 Tag vor 2 Jahren)…`);
    const umsatzCache = await fetchUmsatzFuerTermine(page, sessionBase, allTermine);
    const getUmsatzPlausibel = (marktNr, date) => {
      const v = umsatzCache[compactDate(date)]?.[marktNr] ?? null;
      return v != null && v >= UMSATZ_MIN_PLAUSIBEL ? v : null;
    };

    const marktNrSet = new Set([...Object.values(personal).map((p) => p.marktNr)]);
    const zielBatch = db.batch();
    let zielCount = 0;
    for (const marktNr of marktNrSet) {
      // Heute (live, unverändert einfacher Plausibilitäts-Check)
      const uHeuteRoh = umsatzCache[compactDate(heute)]?.[marktNr] ?? null;
      const heuteVerdaechtig = uHeuteRoh != null && uHeuteRoh < UMSATZ_MIN_PLAUSIBEL;
      const uHeute = heuteVerdaechtig ? null : uHeuteRoh;

      // Roh-Einzeltageswert vor genau 1 Jahr, nur zur Transparenz gespeichert
      const uVorjahrRoh = umsatzCache[compactDate(vorjahrAnchor)]?.[marktNr] ?? null;

      // A) Geglättete Vorjahres-Basis
      const n1Werte = n1WindowDates.map((d) => getUmsatzPlausibel(marktNr, d)).filter((v) => v != null);
      let basis = null, methode = null;
      if (n1Werte.length >= 2) {
        basis = n1Werte.reduce((s, v) => s + v, 0) / n1Werte.length;
        methode = 'geglaettet';
      }

      // B) Wachstumsrate (letzte 28 Tage ggü. denselben 28 Tagen vor 1 Jahr)
      let recentSum = 0, recentCount = 0, recentSumVorjahr = 0, recentCountVorjahr = 0;
      for (let i = 0; i < TREND_TAGE; i++) {
        const v1 = getUmsatzPlausibel(marktNr, recentDates[i]);
        if (v1 != null) { recentSum += v1; recentCount++; }
        const v0 = getUmsatzPlausibel(marktNr, recentVorjahrDates[i]);
        if (v0 != null) { recentSumVorjahr += v0; recentCountVorjahr++; }
      }
      const wachstumsrate = (recentCount >= 14 && recentCountVorjahr >= 14 && recentSumVorjahr > 0)
        ? Math.round((recentSum / recentSumVorjahr) * 1000) / 1000
        : null;

      // C) Fallback über 2 Jahre zurück, skaliert mit der Wachstumsrate — nur
      // wenn (A) mangels genug plausibler Tage nicht berechenbar war.
      if (basis == null) {
        const n2 = getUmsatzPlausibel(marktNr, vorvorjahrAnchor);
        if (n2 != null && wachstumsrate != null) {
          basis = n2 * wachstumsrate;
          methode = 'n2-skaliert';
        } else if (uVorjahrRoh != null && uVorjahrRoh >= UMSATZ_MIN_PLAUSIBEL) {
          basis = uVorjahrRoh; // letzter Fallback: der einzelne Vorjahres-Tageswert war doch plausibel
          methode = 'einzeltag';
        }
      }

      // D) Ziel = Basis × effektiver Faktor (nie unter der Policy von 1,25;
      // bei real schneller wachsenden Filialen steigt der Faktor, aber
      // gedämpft — nur WACHSTUM_DAEMPFUNG (Standard 10%) des Anteils über
      // 1,25 hinaus wird übernommen, damit das Ziel nicht schneller springt,
      // als das Personal produktionsseitig mithalten kann.
      const wachstumUeberschuss = wachstumsrate != null ? Math.max(wachstumsrate - ZIEL_FAKTOR, 0) : 0;
      const effektiverFaktor = Math.round((ZIEL_FAKTOR + WACHSTUM_DAEMPFUNG * wachstumUeberschuss) * 10000) / 10000;
      const ziel = basis != null ? Math.round(basis * effektiverFaktor * 100) / 100 : null;
      const produktionsziel = ziel != null ? Math.round((ziel / (1 - WASTE_FAKTOR)) * 100) / 100 : null;

      const marktname = Object.values(personal).find((p) => p.marktNr === marktNr)?.marktname || '';
      zielBatch.set(
        db.collection(ZIEL_COLLECTION).doc(`${marktNr}_${compactDate(heute)}`),
        {
          marktNr, marktname, datum: isoDate(heute),
          umsatzHeute: uHeute,
          umsatzVorjahrRoh: uVorjahrRoh,
          umsatzVorjahr: basis != null ? Math.round(basis * 100) / 100 : null,
          vorjahrMethode: methode,
          wachstumsrate,
          zielFaktor: ZIEL_FAKTOR, effektiverFaktor,
          ziel, wasteFaktor: WASTE_FAKTOR, produktionsziel,
          umsatzHeuteVerdaechtig: heuteVerdaechtig ? uHeuteRoh : admin.firestore.FieldValue.delete(),
          umsatzVorjahrVerdaechtig: (uVorjahrRoh != null && uVorjahrRoh < UMSATZ_MIN_PLAUSIBEL) ? uVorjahrRoh : admin.firestore.FieldValue.delete(),
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
