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
  '402144', // F-Neustadt am Rübenberge-Rudolf-Diesel-Ring
  '402418', // R-Barsinghausen-Reihekamp - Krause
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
// Ein zweites Automation-Konto (eigener Axonity/Welo-Login, eigene Filialen,
// z.B. eine dritte Region) hat seine eigenen Kostenstellen nie in dieser
// Liste — daher per .env/Secret Manager override-bar (KOSTENSTELLEN=
// 123456,234567), ohne dass das bestehende ost/west-Konto (kein
// KOSTENSTELLEN in seiner .env) sich ändert.
// ALS FUNKTION (nicht als Konstante beim require() ausgewertet!): ein
// Cloud-Run-Konto lädt seine eigenen Zugangsdaten erst innerhalb von main()
// per loadRegionSecretsIntoEnv() nach — das passiert NACH diesem require(),
// eine zur require-Zeit ausgewertete Konstante hätte also für immer den
// (leeren) Ausgangswert eingefroren.
function getBekannteKostenstellen() {
  const envKostenstellen = (process.env.KOSTENSTELLEN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return envKostenstellen.length
    ? new Set(envKostenstellen)
    : new Set([...OST_KOSTENSTELLEN, ...WEST_KOSTENSTELLEN]);
}

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

// Per .env/Secret Manager override-bar (GEBIETSLEITER_NAME=...) für ein
// zweites Automation-Konto mit eigenem Axonity-Login, dessen "Gebietsleiter"-
// Filter naturgemäß einen anderen Namen braucht. Als Funktion aus demselben
// Grund wie getBekannteKostenstellen() oben.
function getGebietsleiterName() {
  return process.env.GEBIETSLEITER_NAME || 'Thang Duc Duong';
}

// marktNr -> region für Firestore-Writes. Nutzt zuerst die geteilte
// MARKTNR_REGION-Tabelle oben (ost/west); eine komplett neue Region (eigener
// Axonity/Welo-Login, eigene Filialen) taucht dort nie auf und fällt daher
// automatisch auf REGION aus der eigenen .env dieses Automation-Kontos zurück
// — kein Pflegen der geteilten Tabelle nötig, wenn eine weitere Region dazukommt.
function resolveRegion(marktNr) {
  return MARKTNR_REGION[marktNr] || process.env.REGION || null;
}

module.exports = { getBekannteKostenstellen, MARKTNR_ALIASES, MARKTNR_REGION, getGebietsleiterName, resolveRegion };
