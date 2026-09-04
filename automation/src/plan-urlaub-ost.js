// Einmaliges Planungsskript (kein Cron-Job): erstellt einen Urlaubsplan für alle
// aktiven Ost-Mitarbeiter für den Rest von 2026, sodass jeder sein Resturlaub
// aufbraucht. Gleiche Regeln wie plan-urlaub-west.js (Auftrag t.duong
// 04.09.2026 "làm tương tự ... với các quy tắc đã nêu trước đó", präzisiert
// 04.09.2026: "Claudine, Hazel đều không cần xếp lịch, Khang chính là người
// như Trong bên khu west"):
// - Innerhalb 1 Filiale (inkl. Zweitfiliale-Pool) keine überlappenden
//   Urlaubstage.
// - Frühester Start: heute + 10 Tage.
// - Feiertage zählen nicht als Urlaubstag (Block wird automatisch verlängert).
// - Herr Kieu, Van Khang (550152) ist der Springer-Analog zu Herrn Nguyen,
//   Trong (West): aus der Überschneidungsregel ausgenommen (blockiert
//   niemanden, wird von niemandem blockiert), eigener Resturlaub wird
//   trotzdem verplant, und er dient als Vertretung für Einzel-Stammkraft-
//   Filialen INNERHALB seines eigenen Filiale+Zweitfiliale-Bereichs
//   (Baunatal/Homberg/Kassel — sein Zweitfiliale-Eintrag deckt anders als bei
//   Trong nicht alle Filialen ab, siehe Hinweis im Report).
// - Frau Müller, Claudine (360135) und Frau Kneipp, Hazel (470008) werden
//   komplett aus der Planung ausgenommen (Auftrag t.duong 04.09.2026).
//
// Unterschiede zu West:
// - Die emps.zweit-Einträge sind bei Ost NICHT einheitlich mit "NNNNNN: "-
//   Präfix geschrieben (z.B. "Edeka Kassel Frankfurter Str." statt "401891:
//   E-Kassel-Frankfurter Str. - Aschoff") -> werden hier zuerst auf die
//   kanonische Filiale normalisiert (normalizeBranch()), sonst würde der
//   Pool-Abgleich diese Verknüpfungen stillschweigend übersehen.
// - Ost-Filialen liegen in 3 Bundesländern (Hessen/Niedersachsen/Thüringen)
//   -> Feiertage werden pro Filiale nach Bundesland bestimmt (aus den
//   Städtenamen abgeleitet, siehe BUNDESLAND_JE_MARKTNR), nicht ein
//   einheitliches NRW-Set wie bei West.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const KHANG_ID = '550152';
const AUSGESCHLOSSEN = new Set(['360135', '470008']); // Claudine Müller, Hazel Kneipp
const START = new Date('2026-09-14T00:00:00');
const ENDE = new Date('2026-12-31T00:00:00');

const BUNDESLAND_JE_MARKTNR = {
  '401125': 'HE', // Baunatal
  '401888': 'HE', // Homberg (Efze)
  '401891': 'HE', // Kassel
  '402146': 'HE', // Bad Hersfeld
  '402150': 'HE', // Sontra
  '402254': 'HE', // Kirchheim
  '402155': 'TH', // Nordhausen
  '402240': 'TH', // Heilbad Heiligenstadt
  '402207': 'NI', // Bovenden
  '402257': 'NI', // Northeim
  '402286': 'NI', // Göttingen Am Kauf Park
  '402297': 'NI', // Einbeck
  '402501': 'NI', // Göttingen Weender Str.
  '402502': 'NI', // Göttingen An-der-Lutter
};
function feiertageFuer(marktNr) {
  const bl = BUNDESLAND_JE_MARKTNR[marktNr] || null;
  const set = new Set(['2026-10-03', '2026-12-25', '2026-12-26']);
  if (bl === 'NI' || bl === 'TH') set.add('2026-10-31');
  if (bl === 'TH') set.add('2026-09-20');
  return set;
}

const APPLY = process.argv.includes('--apply');
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function clampDayCount(fromIso, toIso, lo, hi) {
  const f = fromIso < lo ? lo : fromIso;
  const t = toIso > hi ? hi : toIso;
  if (t < f) return 0;
  return Math.round((new Date(t) - new Date(f)) / 86400000) + 1;
}
function overlaps(aFrom, aTo, bFrom, bTo) { return aFrom <= bTo && bFrom <= aTo; }
function fbSlug(f) { return ('' + f).replace(/\s+/g, '_').toLowerCase(); }

function normalizeBranchText(s) {
  return ('' + s)
    .replace(/^\d+:\s*/, '')
    .replace(/^[A-Za-z]{1,3}-/, '')
    .replace(/^(Edeka|Kaufland|Tegut|Marktkauf|Rewe)\s+/i, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function main() {
  const db = getDb();

  // Alte, selbst erzeugte Eintraege ZUERST loeschen (vor dem Laden der
  // bestehenden Buchungen!) - sonst wuerden sie als "bereits gebucht"
  // mitgezaehlt und den gesamten Resturlaub faelschlich auf 0 rechnen.
  if (APPLY) {
    console.log('⏳ Entferne alte, selbst erzeugte Eintraege (note enthaelt "Urlaubsplan Ost 2026") …');
    const alleUrlaubVorab = await db.collectionGroup('urlaub').get();
    let geloeschtVorab = 0;
    for (const d of alleUrlaubVorab.docs) {
      const v = d.data();
      if (v.note && v.note.includes('Urlaubsplan Ost 2026')) { await d.ref.delete(); geloeschtVorab++; }
    }
    console.log(`  ✓ ${geloeschtVorab} alte Eintraege geloescht.\n`);
  }

  console.log('Lade Ost-Mitarbeiter (emps) …');
  const empsSnap = await db.collection('emps').where('region', '==', 'ost').where('active', '==', true).get();
  const people = [];
  empsSnap.forEach((d) => {
    if (AUSGESCHLOSSEN.has(d.id)) return;
    const v = d.data();
    people.push({ id: d.id, name: v.name, filiale: v.filiale, zweit: Array.isArray(v.zweit) ? v.zweit : [], shopleiter: !!v.shopleiter });
  });

  const kanonisch = [...new Set(people.map((p) => p.filiale).filter(Boolean))];
  const kanonischNorm = kanonisch.map((f) => ({ full: f, marktNr: (f.match(/^(\d+):/) || [])[1] || '', n: normalizeBranchText(f) }));
  function resolveBranch(loose) {
    const nl = normalizeBranchText(loose);
    const exact = kanonischNorm.find((c) => c.n === nl);
    if (exact) return exact;
    const sub = kanonischNorm.find((c) => c.n.includes(nl) || nl.includes(c.n));
    if (sub) return sub;
    console.warn(`  ⚠ Konnte Zweitfiliale-Eintrag nicht zuordnen: "${loose}"`);
    return null;
  }
  people.forEach((p) => {
    p.zweitKanonisch = p.zweit.map(resolveBranch).filter(Boolean).map((c) => c.full);
    p.marktNr = (p.filiale.match(/^(\d+):/) || [])[1] || '';
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
  const ostIds = new Set(people.map((p) => p.id));
  const urlaubSnap = await db.collectionGroup('urlaub').get();
  const existingByPerson = {};
  urlaubSnap.forEach((d) => {
    const v = d.data();
    if (!ostIds.has(v.empId)) return;
    if (v.status === 'rejected') return;
    if (v.to < '2026-01-01') return;
    (existingByPerson[v.empId] = existingByPerson[v.empId] || []).push({ from: v.from, to: v.to, status: v.status });
  });

  // ---- Filialen-Pools bauen (kanonische Filiale -> Mitglieder, OHNE Khang) ----
  const pools = {};
  people.forEach((p) => {
    if (p.id === KHANG_ID) return;
    const branches = [p.filiale, ...p.zweitKanonisch].filter(Boolean);
    branches.forEach((b) => { (pools[b] = pools[b] || new Set()).add(p.id); });
  });
  const neighbors = {};
  people.forEach((p) => { neighbors[p.id] = new Set(); });
  Object.values(pools).forEach((memberSet) => {
    const members = Array.from(memberSet);
    members.forEach((a) => members.forEach((b) => { if (a !== b) neighbors[a].add(b); }));
  });

  // ---- Einzel-Stammkraft-Filialen (Khang zaehlt nicht als Stammkraft-Blocker) ----
  const primaryCount = {};
  people.forEach((p) => { if (p.id !== KHANG_ID) primaryCount[p.filiale] = (primaryCount[p.filiale] || 0) + 1; });
  const singleStaffBranches = Object.keys(primaryCount).filter((b) => primaryCount[b] === 1);
  console.log('Filialen mit nur 1 Stammkraft:', singleStaffBranches);
  const khang = people.find((p) => p.id === KHANG_ID);
  const khangBranches = khang ? [khang.filiale, ...khang.zweitKanonisch] : [];
  const singleStaffImKhangBereich = singleStaffBranches.filter((b) => khangBranches.includes(b));
  console.log('Davon in Khangs Zweitfiliale-Bereich (Baunatal/Homberg/Kassel):', singleStaffImKhangBereich);

  function blockSizes(days) {
    if (days <= 0) return [];
    if (days <= 10) return [days];
    if (days <= 20) return [Math.ceil(days / 2), Math.floor(days / 2)];
    const a = Math.ceil(days / 3);
    const b = Math.ceil((days - a) / 2);
    const c = days - a - b;
    return [a, b, c].filter((n) => n > 0);
  }

  const occupied = {};
  people.forEach((p) => { occupied[p.id] = (existingByPerson[p.id] || []).map((e) => ({ from: e.from, to: e.to })); });

  function isFreeFor(personId, fromIso, toIso) {
    if (occupied[personId].some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    for (const nb of neighbors[personId]) {
      if (occupied[nb].some((iv) => overlaps(fromIso, toIso, iv.from, iv.to))) return false;
    }
    return true;
  }
  // Sonntag existiert im Dienstplan-Raster gar nicht (dpGetWeeks liefert nur
  // Mo-Sa je Woche) - Mitarbeiter arbeiten nur Mo-Sa, daher zaehlt Sonntag
  // genau wie ein Feiertag nicht als Urlaubstag (Auftrag t.duong 04.09.2026).
  function endForChargedDays(start, len, feiertage) {
    let end = new Date(start);
    let counted = 0;
    while (counted < len) {
      if (end.getDay() !== 0 && !feiertage.has(iso(end))) counted++;
      if (counted < len) end = addDays(end, 1);
    }
    return end;
  }
  function placeBlock(personId, len, feiertage) {
    let cursor = new Date(START);
    while (cursor <= ENDE) {
      const end = endForChargedDays(cursor, len, feiertage);
      if (end > ENDE) break;
      const f = iso(cursor), t = iso(end);
      if (isFreeFor(personId, f, t)) {
        occupied[personId].push({ from: f, to: t });
        return { from: f, to: t };
      }
      cursor = addDays(cursor, 1);
    }
    return null;
  }

  const toSchedule = people.filter((p) => p.id !== KHANG_ID).map((p) => {
    const already = (existingByPerson[p.id] || []).reduce((s, e) => s + clampDayCount(e.from, e.to, '2026-01-01', '2026-12-31'), 0);
    const rest = Math.max(0, p.urlaubOffen - already);
    return { ...p, bereitsGebucht: already, rest };
  });
  toSchedule.sort((a, b) => (neighbors[b.id].size - neighbors[a.id].size) || (b.rest - a.rest));

  const plan = [];
  const nichtVerplant = [];
  toSchedule.forEach((p) => {
    if (p.rest <= 0) return;
    const feiertage = feiertageFuer(p.marktNr);
    const sizes = blockSizes(p.rest);
    sizes.forEach((len) => {
      const block = placeBlock(p.id, len, feiertage);
      if (block) {
        plan.push({ id: p.id, name: p.name, filiale: p.filiale, from: block.from, to: block.to, tage: len });
      } else {
        nichtVerplant.push({ id: p.id, name: p.name, filiale: p.filiale, tage: len });
      }
    });
  });

  // ---- Vertretung: Einzel-Stammkraft-Filialen INNERHALB von Khangs eigenem Bereich ----
  const vertretung = [];
  plan.forEach((e) => {
    if (singleStaffImKhangBereich.includes(e.filiale)) {
      vertretung.push({ filiale: e.filiale, from: e.from, to: e.to, fuerName: e.name, fuerId: e.id });
    }
  });

  // ---- Khang bekommt KEINEN eigenen Urlaub verplant (Auftrag t.duong
  // 04.09.2026: "loại bỏ lịch Urlaub của Van Khang Kieu") -- er bleibt
  // ausschließlich in seiner Vertretungsrolle, sein Resturlaub wird hier
  // nicht angetastet.
  const khangPlan = [];

  const result = {
    generiertAm: iso(new Date()),
    zeitraum: { von: iso(START), bis: iso(ENDE) },
    plan: plan.concat(khangPlan).sort((a, b) => a.from < b.from ? -1 : 1),
    vertretung,
    nichtVerplant,
    singleStaffBranches,
    singleStaffOhneVertretung: singleStaffBranches.filter((b) => !khangBranches.includes(b)),
    feiertageJeMarktNr: Object.fromEntries(kanonisch.map((f) => {
      const nr = (f.match(/^(\d+):/) || [])[1] || '';
      return [f, Array.from(feiertageFuer(nr)).sort()];
    })),
    people: people.map((p) => ({ id: p.id, name: p.name, filiale: p.filiale, zweit: p.zweit, zweitKanonisch: p.zweitKanonisch, urlaubOffen: p.urlaubOffen, urlaubAnspruch: p.urlaubAnspruch, shopleiter: p.shopleiter })),
    existingByPerson,
  };

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'urlaub_plan_ost_2026.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n✓ ${plan.length} Urlaubsbloecke geplant fuer ${toSchedule.filter((p) => p.rest > 0).length} Mitarbeiter (Khang ohne eigenen Urlaub, nur Vertretungsrolle).`);
  console.log(`  Khang-Vertretungstage: ${vertretung.length}`);
  if (nichtVerplant.length) {
    console.log(`  WARNUNG: ${nichtVerplant.length} Block(s) konnten NICHT untergebracht werden:`);
    nichtVerplant.forEach((n) => console.log('   -', n.name, n.filiale, n.tage, 'Tage'));
  }
  console.log(`\n✓ Geschrieben nach: ${outPath}`);

  if (!APPLY) {
    console.log('\n(Nur berechnet, NICHT gespeichert. Mit --apply erneut aufrufen, um die Bloecke echt in Firestore einzutragen.)');
    process.exit(0);
  }

  console.log('\n⏳ Trage Bloecke in Firestore ein (Filial Radar / GLSC) …');
  let written = 0;
  for (const b of result.plan) {
    const docId = `${b.id}_${b.from}_${b.to}`;
    const doc = {
      empId: '' + b.id,
      name: b.name,
      filiale: b.filiale,
      region: 'ost',
      from: b.from,
      to: b.to,
      status: 'approved',
      created: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      source: 'hr',
      note: 'Automatischer Urlaubsplan Ost 2026 (Filial Radar, Resturlaub-Ausschöpfung)',
    };
    await db.collection('filialen').doc(fbSlug(b.filiale)).collection('urlaub').doc(docId).set(doc, { merge: true });
    written++;
    console.log(`  [${written}/${result.plan.length}] ${b.name} — ${b.from} bis ${b.to} (${b.tage} Tage) → ${fbSlug(b.filiale)}/${docId}`);
  }
  console.log(`\n✓ ${written} Urlaubseintraege in Firestore gespeichert (status: approved).`);
  process.exit(0);
}

main().catch((err) => { console.error('FEHLER:', err); process.exit(1); });
