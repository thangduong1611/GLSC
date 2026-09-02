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
const BEKANNTE_KOSTENSTELLEN = new Set([
  // Region Ost
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
  // Region West
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
  '402523', // Kaufland Essen
]);

// Welo führt Ratio Baunatal unter seiner SushiTime-Nummer statt der
// Axonity-Kostenstelle — siehe sync-welo-umsatz.js. Zentral hier, damit
// jedes Skript, das Welo-Daten mit Axonity/GLSC-Kostenstellen abgleicht,
// dieselbe Übersetzung nutzt.
const MARKTNR_ALIASES = {
  '611125': '401125', // Ratio Baunatal
};

const GEBIETSLEITER_NAME = 'Thang Duc Duong';

module.exports = { BEKANNTE_KOSTENSTELLEN, MARKTNR_ALIASES, GEBIETSLEITER_NAME };
