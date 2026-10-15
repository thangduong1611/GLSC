const fs = require('fs');
const path = require('path');

const oldDrafts = JSON.parse(fs.readFileSync(path.join(__dirname, 'old_drafts.json'), 'utf8'));
const newOst = JSON.parse(fs.readFileSync(path.join(__dirname, 'new_ost_drafts.json'), 'utf8'));

const newOstKst = new Set(newOst.map(o => o.filiale.split(':')[0]));

// Keep only old entries whose Kostenstelle is NOT being replaced by the new ost batch (i.e. the West entries)
const kept = oldDrafts.filter(o => !newOstKst.has(o.filiale.split(':')[0]));

console.log('Kept (West, unchanged):', kept.length);
console.log('New/updated (Ost):', newOst.length);

const merged = kept.concat(newOst);
console.log('Total merged:', merged.length);

const forbidden = ['telefonieren', 'rufe an', 'zusammensetzen', 'sprechen wir', 'anruf', '—'];
merged.forEach((o, i) => {
  const text = (o.de + ' ' + o.vi).toLowerCase();
  forbidden.forEach(f => {
    if (text.includes(f)) console.log('FORBIDDEN PHRASE FOUND in entry', i, o.filiale, ':', f);
  });
});

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

let block = 'var KPI_DRAFTS = [\n';
merged.forEach((o, i) => {
  block += `  {nr: ${i + 1}, filiale: '${esc(o.filiale)}', de: '${esc(o.de)}', vi: '${esc(o.vi)}'},\n`;
});
block += ']';

fs.writeFileSync(path.join(__dirname, 'kpi_drafts_block.txt'), block, 'utf8');
console.log('Wrote block, length:', block.length);
