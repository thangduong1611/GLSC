// Einmaliges Planungsskript (kein Cron-Job): erstellt einen Urlaubsplan für alle
// aktiven West-Mitarbeiter für den Rest von 2026, sodass jeder sein Resturlaub
// (emp_welo.urlaubOffen, abzüglich bereits gebuchter Urlaub 2026) aufbraucht.
//
// Regeln (Auftrag t.duong 04.09.2026, bestaetigt/praezisiert 05.09.2026):
// - Innerhalb 1 Filiale keine überlappenden Urlaubstage.
// - Auch keine Überlappung mit Kollegen, für die diese Filiale als Zweitfiliale
//   eingetragen ist (gemeinsamer "Coverage-Pool" pro Filiale, Stamm ODER Zweit).
// - Herr Nguyen, Trong (550078) ist unternehmensweiter Springer/Dulieu (Zweit
//   für alle 11 West-Filialen) -> aus der Überlappungs-Regel ausgeschlossen
//   (blockiert niemanden, wird von niemandem blockiert), bekommt aber trotzdem
//   eigenen Urlaub verplant. Zusätzlich: an Tagen, an denen eine Filiale mit nur
//   1 Stammkraft diese Stammkraft im Urlaub hat, wird Herr Nguyen als
//   Vertretung markiert (und diese Tage bei seiner eigenen Urlaubsplanung
//   möglichst freigehalten).
// - Frühester Starttermin: heute + 10 Tage (deckt sich mit der 10-Tage-
//   Vorlaufregel in mitarbeiter.html maValidateUrlaub).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const TRONG_ID = '550078';
// Herr Nguyen, Viet Hoang ist Bereichsleiter einer ANDEREN Region (Auftrag
// t.duong 04.09.2026) und wird komplett aus der West-Planung ausgenommen -
// weder Dienstplan noch Urlaubsplan.
// Frau Purnomo, Paramita Dian (341450) ist im Mutterschutz/Elternzeit und
// mehrere Jahre nicht im Einsatz (Auftrag t.duong 05.09.2026) - bekommt
// deshalb ueberhaupt keinen Urlaub verplant, bis das manuell wieder geaendert wird.
const AUSGESCHLOSSEN = new Set(['550198', '341450']);
const HEUTE = new Date('2026-09-04T00:00:00');
const START = new Date('2026-09-14T00:00:00'); // heute + 10 Tage, fällt auf einen Montag
const ENDE = new Date('2026-12-31T00:00:00');
// Gesetzliche Feiertage NRW (West-Filialen liegen alle in Nordrhein-Westfalen)
// im Planungszeitraum (Auftrag t.duong 04.09.2026: Feiertage duerfen nicht als
// Urlaubstag gezaehlt werden). Diese Tage zaehlen nicht gegen den Resturlaub -
// ein Block, der einen Feiertag ueberdeckt, wird um genau diese Tage verlaengert.
const FEIERTAGE = new Set(['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26']);

const APPLY = process.argv.includes('--apply');
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function dayCount(fromIso, toIso) {
  const a = new Date(fromIso), b = new Date(toIso);
  return Math.round((b - a) / 86400000) + 1;
}
function overlaps(aFrom, aTo, bFrom, bTo) { return aFrom <= bTo && bFrom <= aTo; }

async function main() {
  const db = getDb();

  // Alte, selbst erzeugte Eintraege ZUERST loeschen (vor dem Laden der
  // bestehenden Buchungen!) - sonst wuerden sie als "bereits gebucht"
  // mitgezaehlt und den gesamten Resturlaub faelschlich auf 0 rechnen.
  if (APPLY) {
    console.log('⏳ Entferne alte, selbst erzeugte Eintraege (note enthaelt "Urlaubsplan West 2026") …');
    const alleUrlaubVorab = await db.collectionGroup('urlaub').get();
    let geloeschtVorab = 0;
    for (const d of alleUrlaubVorab.docs) {
      const v = d.data();
      if (v.note && v.note.includes('Urlaubsplan West 2026')) { await d.ref.delete(); geloeschtVorab++; }
    }
    console.log(`  ✓ ${geloeschtVorab} alte Eintraege geloescht.\n`);
  }

  console.log('Lade West-Mitarbeiter (emps) …');
  const empsSnap = await db.collection('emps').where('region', '==', 'west').where('active', '==', true).get();
  const people = [];
  empsSnap.forEach((d) => {
    if (AUSGESCHLOSSEN.has(d.id)) return;
    const v = d.data();
    people.push({ id: d.id, name: v.name, filiale: v.filiale, zweit: Array.isArray(v.zweit) ? v.zweit : [] });
  });

  console.log('Lade Resturlaub (emp_welo) …');
  const weloSnap = await db.collection('emp_welo').get();
  const weloById = {};
  weloSnap.forEach((d) => { weloById[d.id] = d.data(); });
  people.forEach((p) => {
    const w = weloById[p.id] || {};
    p.urlaubOffen = typeof w.urlaubOffen === 'number' ? w.urlaubOffen : 0;
    p.urlaubAnspruch = typeof w.urlaubAnspruch === 'number' ? w.urlaubAnspruch : null;
  });

  console.log('Lade bestehende Urlaubsbuchungen (collectionGroup urlaub) …');
  const westIds = new Set(people.map((p) => p.id));
  const urlaubSnap = await db.collectionGroup('urlaub').get();
  const existingByPerson = {}; // id -> [{from,to}]
  urlaubSnap.forEach((d) => {
    const v = d.data();
    if (!westIds.has(v.empId)) return;
    if (v.status === 'rejected') return;
    if (v.to < iso(new Date('2026-01-01'))) return; // nur 2026 relevant
    (existingByPerson[v.empId] = existingByPerson[v.empId] || []).push({ from: v.from, to: v.to, status: v.status });
  });

  // Krankheitstage duerfen nicht mit neu geplantem Urlaub ueberschnitten werden
  // (Auftrag t.duong 05.09.2026: "ngay le hoac om cung nhu vay").
  console.log('Lade bestehende Krankmeldungen (krank) …');
  const krankSnap = await db.collection('krank').get();
  krankSnap.forEach((d) => {
    const v = d.data();
    if (!westIds.has(v.empId)) return;
    if (!v.from || v.to < iso(new Date('2026-01-01'))) return;
    (existingByPerson[v.empId] = existingByPerson[v.empId] || []).push({ from: v.from, to: v.to || v.from });
  });

  // ---- Filialen-Pools bauen (branch -> Mitglieder, OHNE Trong) ----
  const pools = {}; // branchName -> [personId]
  people.forEach((p) => {
    if (p.id === TRONG_ID) return;
    const branches = [p.filiale, ...p.zweit].filter(Boolean);
    branches.forEach((b) => { (pools[b] = pools[b] || new Set()).add(p.id); });
  });

  // ---- Konflikt-Nachbarn pro Person (Vereinigung aller Pools, denen sie angehört) ----
  const neighbors = {}; // personId -> Set(personId)
  people.forEach((p) => { neighbors[p.id] = new Set(); });
  Object.values(pools).forEach((memberSet) => {
    const members = Array.from(memberSet);
    members.forEach((a) => members.forEach((b) => { if (a !== b) neighbors[a].add(b); }));
  });

  // ---- Einzel-Stammkraft-Filialen (fuer Trong-Vertretung) ----
  const primaryCount = {};
  people.forEach((p) => { if (p.id !== TRONG_ID) primaryCount[p.filiale] = (primaryCount[p.filiale] || 0) + 1; });
  const singleStaffBranches = Object.keys(primaryCount).filter((b) => primaryCount[b] === 1);
  console.log('Filialen mit nur 1 Stammkraft (Trong-Vertretung noetig, falls diese Person Urlaub hat):', singleStaffBranches);

  // ---- Blockstruktur je nach Resttagen ----
  function blockSizes(days) {
    if (days <= 0) return [];
    if (days <= 10) return [days];
    if (days <= 20) return [Math.ceil(days / 2), Math.floor(days / 2)];
    const a = Math.ceil(days / 3);
    const b = Math.ceil((days - a) / 2);
    const c = days - a - b;
    return [a, b, c].filter((n) => n > 0);
  }

  // ---- Belegte Intervalle je Person (bestehende Buchungen + neu geplante) ----
  const occupied = {}; // personId -> [{from,to}]
  people.forEach((p) => { occupied[p.id] = (existingByPerson[p.id] || []).map((e) => ({ from: e.from, to: e.to })); });

  function isFreeFor(personId, fromIso, toIso) {
    // eigene bereits belegte Tage
    if (occupied[personId].some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    // Nachbarn (gemeinsamer Filial-Pool)
    for (const nb of neighbors[personId]) {
      if (occupied[nb].some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    }
    return true;
  }

  // Ermittelt das Enddatum, sodass zwischen start und Ende genau `len`
  // NICHT-Feiertage liegen (Feiertage verlaengern den Block, zaehlen aber
  // nicht gegen den Resturlaub).
  // Sonntag existiert im Dienstplan-Raster gar nicht (dpGetWeeks liefert nur
  // Mo-Sa je Woche) - Mitarbeiter arbeiten nur Mo-Sa, daher zaehlt Sonntag
  // genau wie ein Feiertag nicht als Urlaubstag (Auftrag t.duong 04.09.2026).
  function endForChargedDays(start, len) {
    let end = new Date(start);
    let counted = 0;
    while (counted < len) {
      if (end.getDay() !== 0 && !FEIERTAGE.has(iso(end))) counted++;
      if (counted < len) end = addDays(end, 1);
    }
    return end;
  }
  function placeBlock(personId, len) {
    let cursor = new Date(START);
    while (cursor <= ENDE) {
      // Start-Kandidat muss selbst ein echter Arbeitstag sein - sonst zeigt die
      // gespeicherte Buchung faelschlich Sonntag/Feiertag als erstes Datum an,
      // obwohl dieser Tag ohnehin nie angerechnet wird (Auftrag t.duong
      // 05.09.2026, Mitarbeiter-Beschwerde "Urlaub auf Sonntag gelegt").
      if (cursor.getDay() === 0 || FEIERTAGE.has(iso(cursor))) { cursor = addDays(cursor, 1); continue; }
      const end = endForChargedDays(cursor, len);
      if (end > ENDE) break;
      const f = iso(cursor), t = iso(end);
      if (isFreeFor(personId, f, t)) {
        occupied[personId].push({ from: f, to: t });
        return { from: f, to: t };
      }
      cursor = addDays(cursor, 1);
    }
    return null; // nicht unterbringbar
  }

  // Verarbeitungsreihenfolge: am staerksten vernetzte (meiste Nachbarn) zuerst,
  // dann groesster Resturlaub zuerst -> reduziert Blockaden fuer eng gekoppelte Faelle.
  const toSchedule = people.filter((p) => p.id !== TRONG_ID).map((p) => {
    const already = (existingByPerson[p.id] || []).reduce((s, e) => s + dayCount(e.from, e.to), 0);
    const rest = Math.max(0, p.urlaubOffen - already);
    return { ...p, bereitsGebucht: already, rest };
  });
  toSchedule.sort((a, b) => (neighbors[b.id].size - neighbors[a.id].size) || (b.rest - a.rest));

  const plan = []; // {id,name,filiale,from,to}
  const nichtVerplant = [];

  toSchedule.forEach((p) => {
    if (p.rest <= 0) return;
    const sizes = blockSizes(p.rest);
    sizes.forEach((len) => {
      const block = placeBlock(p.id, len);
      if (block) {
        plan.push({ id: p.id, name: p.name, filiale: p.filiale, from: block.from, to: block.to, tage: len });
      } else {
        nichtVerplant.push({ id: p.id, name: p.name, filiale: p.filiale, tage: len });
      }
    });
  });

  // ---- Trong-Vertretungstage ermitteln (Einzel-Stammkraft-Filiale + Person im Plan) ----
  const vertretung = []; // {branch, from, to, fuerName}
  plan.forEach((e) => {
    if (singleStaffBranches.includes(e.filiale)) {
      vertretung.push({ filiale: e.filiale, from: e.from, to: e.to, fuerName: e.name, fuerId: e.id });
    }
  });

  // ---- Trong's eigenen Urlaub verplanen: Vertretungstage moeglichst freihalten ----
  const trong = people.find((p) => p.id === TRONG_ID);
  const trongAlready = (existingByPerson[TRONG_ID] || []).reduce((s, e) => s + dayCount(e.from, e.to), 0);
  const trongRest = Math.max(0, (trong ? trong.urlaubOffen : 0) - trongAlready);
  occupied[TRONG_ID] = (existingByPerson[TRONG_ID] || []).map((e) => ({ from: e.from, to: e.to }));
  vertretung.forEach((v) => occupied[TRONG_ID].push({ from: v.from, to: v.to })); // an diesen Tagen wird er gebraucht -> fuer ihn blockiert

  function isFreeForTrong(fromIso, toIso) {
    return !occupied[TRONG_ID].some((iv) => overlaps(fromIso, toIso, iv.from, iv.to));
  }
  function placeTrongBlock(len) {
    let cursor = new Date(START);
    while (cursor <= ENDE) {
      if (cursor.getDay() === 0 || FEIERTAGE.has(iso(cursor))) { cursor = addDays(cursor, 1); continue; }
      const end = endForChargedDays(cursor, len);
      if (end > ENDE) break;
      const f = iso(cursor), t = iso(end);
      if (isFreeForTrong(f, t)) { occupied[TRONG_ID].push({ from: f, to: t }); return { from: f, to: t }; }
      cursor = addDays(cursor, 1);
    }
    return null;
  }
  const trongPlan = [];
  if (trongRest > 0) {
    blockSizes(trongRest).forEach((len) => {
      const block = placeTrongBlock(len);
      if (block) trongPlan.push({ id: TRONG_ID, name: trong.name, filiale: trong.filiale, from: block.from, to: block.to, tage: len });
      else nichtVerplant.push({ id: TRONG_ID, name: trong.name, filiale: trong.filiale, tage: len });
    });
  }

  const result = {
    generiertAm: iso(new Date()),
    zeitraum: { von: iso(START), bis: iso(ENDE) },
    plan: plan.concat(trongPlan).sort((a, b) => a.from < b.from ? -1 : 1),
    vertretung,
    nichtVerplant,
    singleStaffBranches,
    feiertage: Array.from(FEIERTAGE).sort(),
    people: people.map((p) => ({ id: p.id, name: p.name, filiale: p.filiale, zweit: p.zweit, urlaubOffen: p.urlaubOffen, urlaubAnspruch: p.urlaubAnspruch })),
    existingByPerson,
  };

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'urlaub_plan_west_2026.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n✓ ${plan.length + trongPlan.length} Urlaubsbloecke geplant fuer ${toSchedule.filter(p=>p.rest>0).length + (trongRest>0?1:0)} Mitarbeiter.`);
  console.log(`  Trong-Vertretungstage: ${vertretung.length}`);
  if (nichtVerplant.length) {
    console.log(`  WARNUNG: ${nichtVerplant.length} Block(s) konnten NICHT untergebracht werden:`);
    nichtVerplant.forEach((n) => console.log('   -', n.name, n.filiale, n.tage, 'Tage'));
  }
  console.log(`\n✓ Geschrieben nach: ${outPath}`);

  if (!APPLY) {
    console.log('\n(Nur berechnet, NICHT gespeichert. Mit --apply erneut aufrufen, um die Bloecke echt in Firestore einzutragen.)');
    process.exit(0);
  }

  // ════════ --apply: alle geplanten Bloecke als 'approved' Urlaub eintragen ════════
  // Gleiches Schema wie die manuelle HR-Eintragung in index.html (uManualAdd,
  // "URLAUB MANUELL EINTRAGEN"): {empId,name,filiale,from,to,status:'approved',
  // created,decidedAt,source:'hr'}. Deterministische Doc-ID (statt .add() mit
  // Zufalls-ID) macht den Schreibvorgang idempotent - ein versehentlicher
  // zweiter Lauf erzeugt keine Duplikate, sondern ueberschreibt denselben Doc.
  console.log('\n⏳ Trage Bloecke in Firestore ein (Filial Radar / GLSC) …');
  const allBlocks = plan.concat(trongPlan);
  let written = 0;
  for (const b of allBlocks) {
    const docId = `${b.id}_${b.from}_${b.to}`;
    const doc = {
      empId: '' + b.id,
      name: b.name,
      filiale: b.filiale,
      region: 'west',
      from: b.from,
      to: b.to,
      status: 'approved',
      created: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      source: 'hr',
      note: 'Automatischer Urlaubsplan West 2026 (Filial Radar, Resturlaub-Ausschöpfung)',
    };
    await db.collection('filialen').doc(fbSlug(b.filiale)).collection('urlaub').doc(docId).set(doc, { merge: true });
    written++;
    console.log(`  [${written}/${allBlocks.length}] ${b.name} — ${b.from} bis ${b.to} (${b.tage} Tage) → ${fbSlug(b.filiale)}/${docId}`);
  }
  console.log(`\n✓ ${written} Urlaubseintraege in Firestore gespeichert (status: approved).`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
