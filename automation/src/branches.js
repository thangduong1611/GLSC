// Bekannte Kostenstellen von Thang Duc Duongs Filialen (Stand 2026-09-02:
// 26 — Region Ost, ursprüngliche 11 + 3 dazugekommene, plus Region West,
// 12 neue seit der Zweitfiliale-Zuordnung). Ursprünglich nur 11 (Stand
// 2026-08-25) — nötig geworden, weil das Axonity-Update vom 25.08.2026
// /markets/ und /pickups/ standardmäßig firmenweit (alle ~346 Standorte)
// statt nur die eigenen zeigt. Der Gebietsleiter-Filter auf /markets/ holt
// das dort wieder rein, aber /pickups/ hat keinen entsprechenden Filter —
// dort wird stattdessen jede Zeile gegen diese Liste geprüft. Wird auch von
// sync-welo-personal.js für die Region-West-Filialen verwendet.
// Bei neuen/weggefallenen Filialen hier manuell nachpflegen.
// Ost/West getrennt gepflegt (statt eines Sets), damit dieselbe Zuordnung
// auch für MARKTNR_REGION unten wiederverwendet werden kann — vorher gab es
// diese Liste nur als Set + Kommentar, die Region stand nirgends maschinell
// lesbar zur Verfügung.
const OST_KOSTENSTELLEN = [
  '401125', // Ratio Baunatal
  '401888', // Rewe Homberg Efze Mohr
  '401891', // Edeka Kassel Aschoff
  '402146', // Bad Hersfeld
  '402150', // Edeka Sontra Salzmann
  '402155', // Marktkauf Nordhausen
  '402207', // Edeka Bovenden
  '402240', // Rewe Heilbad Heiligenstadt - Ihme
  '402254', // Kirchheim Messerschmidt
  '402257', // Edeka Schnabel
  '402286', // Kaufland (vormals Real)
  '402297', // Marktkauf Einbeck (Regie)
  '402501', // Tegut Göttingen (Weender Str.)
  '402502', // Tegut Göttingen (An der Lutter)
];
const WEST_KOSTENSTELLEN = [
  '402167', // Rewe Düsseldorf Hauptstr.
  '402185', // Kaufland Hagen
  '402205', // Rewe Hattingen
  '402251', // Rewe Düsseldorf Zeppelinstraße
  '402261', // Rewe Hilden
  '402272', // Rewe Düsseldorf Münsterstraße
  '402310', // Rewe Wuppertal
  '402315', // Rewe Bochum
  '402422', // Edeka Leverkusen
  '402507', // Kaufland Wesel
  '402512', // Rewe Remscheid
  '402133', // Köln-Thebäerstraße
  '402302', // Neuss-Allerheiligen-Am alten Bach - Friedrich
  '402363', // Bergneustadt-Stadionstr.
  '402414', // Bergheim-Dansweilerstraße - Fischenich
  '402416', // Bergisch Gladbach-Odenthaler Str. - Gärtner
  '402523', // Kaufland Essen
];
const BEKANNTE_KOSTENSTELLEN = new Set([...OST_KOSTENSTELLEN, ...WEST_KOSTENSTELLEN]);

// marktNr -> 'ost'|'west', für den automatischen emps-Sync aus Welo
// (sync-welo-personal.js) — dieselben Region-Werte wie index.html's
// REGION_LABELS/managers.regions ('ost'/'west', klein geschrieben).
const MARKTNR_REGION = {};
OST_KOSTENSTELLEN.forEach((nr) => { MARKTNR_REGION[nr] = 'ost'; });
WEST_KOSTENSTELLEN.forEach((nr) => { MARKTNR_REGION[nr] = 'west'; });

// Welo führt Ratio Baunatal unter seiner SushiTime-Nummer statt der
// Axonity-Kostenstelle — siehe sync-welo-umsatz.js. Zentral hier, damit
// jedes Skript, das Welo-Daten mit Axonity/GLSC-Kostenstellen abgleicht,
// dieselbe Übersetzung nutzt.
const MARKTNR_ALIASES = {
  '611125': '401125', // Ratio Baunatal
};

const GEBIETSLEITER_NAME = 'Thang Duc Duong';

module.exports = { BEKANNTE_KOSTENSTELLEN, MARKTNR_ALIASES, MARKTNR_REGION, GEBIETSLEITER_NAME };
