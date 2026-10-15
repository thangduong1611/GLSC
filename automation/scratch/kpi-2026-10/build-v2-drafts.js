const fs = require('fs');
const path = require('path');

const newOst = JSON.parse(fs.readFileSync(path.join(__dirname, 'new_ost_drafts.json'), 'utf8'));
const oldDrafts = JSON.parse(fs.readFileSync(path.join(__dirname, 'old_drafts.json'), 'utf8')); // 28 entries, original order, pre-this-session

const newOstKst = new Set(newOst.map(o => o.filiale.split(':')[0]));
const keptWest = oldDrafts.filter(o => !newOstKst.has(o.filiale.split(':')[0])); // 17 West entries, unchanged

const PERIOD_NEW = 'Juli - September 2026';
const PERIOD_OLD = 'Juni - August 2026';

// Final array: newest period first (Jul-Sep Ost), then older period (Jun-Aug West)
const finalArr = []
  .concat(newOst.map(o => ({ ...o, period: PERIOD_NEW })))
  .concat(keptWest.map(o => ({ ...o, period: PERIOD_OLD })));
finalArr.forEach((o, i) => { o.nr = i + 1; });

// Legacy map: ALL 28 original entries (nr 1-28 as they existed before this session's edit)
// were from the single original PDF batch, period = PERIOD_OLD. Used only to migrate
// old nr-keyed "sent" flags to the new, collision-proof period+filiale key.
const legacyMap = {};
oldDrafts.forEach((o, i) => {
  legacyMap[i + 1] = { period: PERIOD_OLD, filiale: o.filiale };
});

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

let out = '';
out += "// Legacy nr->{period,filiale} snapshot of the KPI_DRAFTS array as it existed BEFORE\n";
out += "// 15.10.2026 (single batch, Juni-August 2026, nr 1-28). Inserting new branches\n";
out += "// mid-list on a later PDF shifts every nr after the insertion point, so nr alone\n";
out += "// can silently point an old 'sent' flag at the wrong branch after a merge - this\n";
out += "// is exactly what happened to nr 21-28 when 3 new Ost branches were inserted on\n";
out += "// 15.10.2026. Kept only so kpiDraftsMigrateLegacy() can re-key old sent-flags onto\n";
out += "// the new, collision-proof period+filiale key - never used for anything else.\n";
out += "var KPI_LEGACY_NR_MAP = {\n";
Object.keys(legacyMap).forEach(nr => {
  const m = legacyMap[nr];
  out += `  ${nr}: {period: '${esc(m.period)}', filiale: '${esc(m.filiale)}'},\n`;
});
out += "};\n";

out += "// filiale MUSS exakt dem echten emps.filiale-Wert entsprechen (inkl.\n";
out += "// \"NNNNNN: \"-Präfix), sonst filtert mitarbeiter.html die Nachricht für\n";
out += "// niemanden sichtbar heraus. \"period\" gruppiert die Karten im UI (neueste\n";
out += "// Auswertung zuerst) und ist Teil des Schlüssels für den Versand-Status -\n";
out += "// bei einer neuen PDF-Runde NICHT die alten Einträge für dieselbe Filiale\n";
out += "// überschreiben, sondern als neuen Eintrag mit neuem \"period\"-Wert anhängen,\n";
out += "// sonst geht die 'bereits gesendet'-Historie für das alte Quartal verloren.\n";
out += "var KPI_DRAFTS = [\n";
finalArr.forEach(o => {
  out += `  {nr: ${o.nr}, period: '${esc(o.period)}', filiale: '${esc(o.filiale)}', de: '${esc(o.de)}', vi: '${esc(o.vi)}'},\n`;
});
out += "];\n";

fs.writeFileSync(path.join(__dirname, 'kpi_drafts_v2_block.txt'), out, 'utf8');
console.log('West kept:', keptWest.length, '| New Ost:', newOst.length, '| Total:', finalArr.length, '| Legacy map entries:', Object.keys(legacyMap).length);
