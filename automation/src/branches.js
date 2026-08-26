// Bekannte Kostenstellen von Thang Duc Duongs 11 Filialen (Stand 2026-08-25).
// Nötig geworden, weil das Axonity-Update vom 25.08.2026 /markets/ und
// /pickups/ standardmäßig firmenweit (alle ~346 Standorte / alle Filialen)
// statt nur die eigenen zeigt. Der Gebietsleiter-Filter auf /markets/ holt
// das dort wieder rein, aber /pickups/ hat keinen entsprechenden Filter —
// dort wird stattdessen jede Zeile gegen diese Liste geprüft.
// Bei neuen/weggefallenen Filialen hier manuell nachpflegen.
const BEKANNTE_KOSTENSTELLEN = new Set([
  '401125', // Ratio Baunatal
  '401888', // Rewe Homberg Efze Mohr
  '401891', // Edeka Kassel Aschoff
  '402155', // Marktkauf Nordhausen
  '402207', // Edeka Bovenden
  '402240', // Rewe Heilbad Heiligenstadt - Ihme
  '402257', // Edeka Schnabel
  '402286', // Kaufland (vormals Real)
  '402297', // Marktkauf Einbeck (Regie)
  '402501', // Tegut Göttingen (Weender Str.)
  '402502', // Tegut Göttingen (An der Lutter)
]);

const GEBIETSLEITER_NAME = 'Thang Duc Duong';

module.exports = { BEKANNTE_KOSTENSTELLEN, GEBIETSLEITER_NAME };
