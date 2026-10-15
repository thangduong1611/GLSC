const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', '..', '..', 'index.html');
const content = fs.readFileSync(indexPath, 'utf8');

const startMarker = 'var KPI_DRAFTS = [';
const start = content.indexOf(startMarker);
if (start === -1) throw new Error('KPI_DRAFTS not found');
const end = content.indexOf('\n];', start);
if (end === -1) throw new Error('end marker not found');

const block = fs.readFileSync(path.join(__dirname, 'kpi_drafts_block.txt'), 'utf8');

const newContent = content.slice(0, start) + block + content.slice(end + '\n];'.length - 1);
// end points to the start of '\n];' ; we want to replace up to and including '];'
// content.slice(end + ...) needs care — recompute precisely below instead.

fs.writeFileSync(indexPath, content.slice(0, start) + block + ';' + content.slice(end + 3), 'utf8');
console.log('Spliced KPI_DRAFTS into index.html');
