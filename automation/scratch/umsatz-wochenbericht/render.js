// Rendert report.html zu einem gedruckten A4-PDF (@page-Regel in build-report.js).
// Aufruf: node render.js report.html report.pdf
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const [htmlPath, pdfPath] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(htmlPath));
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  await browser.close();
  console.log('PDF geschrieben:', pdfPath);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
