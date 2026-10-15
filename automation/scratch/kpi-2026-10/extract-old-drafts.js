const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, '..', '..', '..', 'index.html');
const content = fs.readFileSync(indexPath, 'utf8');
const start = content.indexOf('var KPI_DRAFTS = [');
const end = content.indexOf('\n];', start);
const block = content.slice(start, end);

const objRegex = /\{nr:\s*\d+,\s*filiale:\s*'((?:[^'\\]|\\.)*)',\s*de:\s*'((?:[^'\\]|\\.)*)',\s*vi:\s*'((?:[^'\\]|\\.)*)'\}/g;
let m;
const objs = [];
while ((m = objRegex.exec(block))) {
  objs.push({ filiale: m[1], de: m[2], vi: m[3] });
}
console.log('Parsed objs:', objs.length);
fs.writeFileSync(path.join(__dirname, 'old_drafts.json'), JSON.stringify(objs, null, 2));
