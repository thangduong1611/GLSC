const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', '..', '..', 'index.html');
const content = fs.readFileSync(indexPath, 'utf8');

const startMarker = '// --- KPI-Auswertung Q3 (Jun-Aug 2026) - Entwürfe je Filiale ---------------';
const start = content.indexOf(startMarker);
if (start === -1) throw new Error('start marker not found');

const arrStart = content.indexOf('var KPI_DRAFTS = [', start);
const arrEnd = content.indexOf('\n];', arrStart);
if (arrEnd === -1) throw new Error('array end not found');
const afterArrEnd = arrEnd + '\n];'.length; // index right after the ']' + ';'... let's check char by char

// confirm the char sequence at arrEnd is '\n];'
console.log('Chars at arrEnd:', JSON.stringify(content.slice(arrEnd, arrEnd + 4)));

const block = fs.readFileSync(path.join(__dirname, 'kpi_drafts_v2_block.txt'), 'utf8');

const newContent = content.slice(0, start) + block.trimEnd() + '\n' + content.slice(afterArrEnd);
fs.writeFileSync(indexPath, newContent, 'utf8');
console.log('Spliced v2 KPI_DRAFTS + legacy map into index.html');
