// Baut dieselbe Berichts-Struktur wie build-report.js (PDF), aber als
// bearbeitbares .docx — dieselben Quellen (data.json, week-config.json),
// Charts als PNG eingebettet (render-chart-pngs.js muss vorher gelaufen sein).
// Aufruf: node build-docx.js data.json week-config.json report.docx
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  ImageRun, Header,
} = require('docx');

const INK = '1A1A18', MUTED = '6B6860', AMBER_BG = 'FFF7E6', AMBER_BORDER = 'F0C070', AMBER_TEXT = '8A5A00';
const RED = 'C0392B', GREEN = '1E8449', GRAY_BG = 'F5F3F0', BORDER_GRAY = 'E5E2DC', BLUE = '1A5276';
const GAP_BG = 'FBEAE7', GAP_BORDER = 'E6B3AC';
const CONTENT_W = 9000; // dxa, ~6.25in Textbreite bei A4 + Normalrändern

function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function img(file, targetW) {
  const { w, h } = pngSize(file);
  return new ImageRun({ type: 'png', data: fs.readFileSync(file), transformation: { width: targetW, height: Math.round(targetW * h / w) } });
}
function p(text, opts) {
  opts = opts || {};
  return new Paragraph({
    spacing: { after: opts.after !== undefined ? opts.after : 160 },
    children: [new TextRun({ text, bold: !!opts.bold, size: opts.size || 21, color: opts.color || INK, italics: !!opts.italics })],
  });
}
function richP(runs, opts) {
  opts = opts || {};
  return new Paragraph({ spacing: { after: opts.after !== undefined ? opts.after : 160 }, children: runs });
}
function run(text, opts) { opts = opts || {}; return new TextRun({ text, bold: !!opts.bold, size: opts.size || 21, color: opts.color || INK, font: opts.font }); }

function pctColor(p) { if (p == null) return MUTED; return p >= 0 ? GREEN : RED; }
function monthLabelDE(periode) {
  const MONTH = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const [y, m] = periode.split('-');
  return MONTH[parseInt(m, 10) - 1] + ' ' + y.slice(2);
}
function pctChange(a, b) { if (!a) return null; return Math.round(((b - a) / a) * 1000) / 10; }
function fmtPct(v) { if (v == null) return '–'; return (v > 0 ? '+' : '') + v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }

function calloutBox(label, text, bg, border, labelColor) {
  // text darf "\n\n"-getrennte Absätze enthalten — docx-js kennt kein \n
  // innerhalb eines TextRun, deshalb hier in echte Paragraph-Elemente auflösen.
  const parts = String(text).split('\n\n');
  const paragraphs = parts.map((part, i) =>
    new Paragraph({ spacing: { after: i < parts.length - 1 ? 140 : 0 }, children: [new TextRun({ text: part, size: 21, color: INK })] }));
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: border }, bottom: { style: BorderStyle.SINGLE, size: 4, color: border },
      left: { style: BorderStyle.SINGLE, size: 4, color: border }, right: { style: BorderStyle.SINGLE, size: 4, color: border },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: border }, insideVertical: { style: BorderStyle.NONE, size: 0, color: border },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: bg },
      margins: { top: 140, bottom: 140, left: 160, right: 160 },
      children: [
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: label, bold: true, size: 16, color: labelColor })] }),
        ...paragraphs,
      ],
    })] })],
  });
}

function summaryLabelValue(label, text) {
  return new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: label + ': ', bold: true, size: 20, color: INK }),
    new TextRun({ text, size: 20, color: INK }),
  ] });
}

function storeSection(cfg, store, chartInfo, idx) {
  const children = [];
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
    children: [
      new TextRun({ text: `2.${idx} ${cfg.name}  `, bold: true }),
      new TextRun({ text: `${store.marktNr}${store.ort ? ' · ' + store.ort : ''}`, size: 18, color: MUTED, bold: false }),
    ],
  }));
  children.push(calloutBox('MASSNAHME DIESE WOCHE', cfg.measure, AMBER_BG, AMBER_BORDER, AMBER_TEXT));
  children.push(new Paragraph({ spacing: { after: 140 } }));

  const monthly = store.monthly.slice(-3);
  if (monthly.length >= 2 && chartInfo.monthly) {
    const first = monthly[0], last = monthly[monthly.length - 1];
    const change = pctChange(first.umsatz, last.umsatz);
    children.push(p(`Monatsumsatz, letzte ${monthly.length} Monate (${monthLabelDE(first.periode)} – ${monthLabelDE(last.periode)})`, { bold: true, size: 19, after: 80 }));
    children.push(new Paragraph({ spacing: { after: 40 }, children: [img(chartInfo.monthly.file, CONTENT_W / 15)] }));
    children.push(richP([
      run('Veränderung ' + monthLabelDE(first.periode) + ' → ' + monthLabelDE(last.periode) + ': ', { size: 18, color: MUTED }),
      run(fmtPct(change), { bold: true, size: 18, color: pctColor(change) }),
    ], { after: 200 }));
  } else {
    children.push(calloutBox('MONATSUMSATZ — NICHT VERFÜGBAR',
      `Für diese Filiale liegt noch keine monatliche Umsatzhistorie aus dem Welo-Export vor (Kostenstelle ${store.marktNr} ist dort aktuell nicht als eigene Zeile hinterlegt, andere Filialen derselben Kette schon). Empfehlung: Kostenstelle im Welo-Statistik-Export ergänzen, damit ab nächstem Bericht ein voller Monatsverlauf zur Verfügung steht.`,
      GAP_BG, GAP_BORDER, RED));
    children.push(new Paragraph({ spacing: { after: 140 } }));
  }

  if (chartInfo.daily) {
    children.push(p(`Ist-Umsatz vs. Tagesziel (letzte ${chartInfo.dailyCount} Tage)`, { bold: true, size: 19, after: 80 }));
    children.push(new Paragraph({ spacing: { after: 40 }, children: [img(chartInfo.daily.file, CONTENT_W / 15)] }));
    children.push(richP([
      run('■ ', { size: 18, color: '2A6FB0' }), run('Ist-Umsatz     ', { size: 18, color: MUTED }),
      run('● ', { size: 18, color: RED }), run('Tagesziel (Produktion, inkl. Waste)', { size: 18, color: MUTED }),
    ], { after: 60 }));
    children.push(richP([
      run('Ø Zielerreichung (abgeschlossene Tage): ', { size: 18, color: MUTED }),
      run(chartInfo.achievement != null ? chartInfo.achievement + ' %' : '–', { bold: true, size: 18, color: pctColor((chartInfo.achievement || 0) - 100) }),
    ], { after: 200 }));
  }

  children.push(p('KURZANALYSE', { bold: true, size: 16, color: MUTED, after: 60 }));
  children.push(p(cfg.analysis, { after: 280 }));
  return children;
}

async function main() {
  const [dataPath, cfgPath, outPath] = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'chart-png', 'manifest.json'), 'utf8'));

  function buildDaily(store) {
    const zielByDate = {};
    store.tagesziel.forEach((t) => { zielByDate[t.datum] = t.produktionsziel != null ? t.produktionsziel : t.ziel; });
    return store.produktion.filter((pr) => zielByDate[pr.datum] !== undefined).map((pr) => ({ datum: pr.datum, ist: pr.umsatzHeute, ziel: zielByDate[pr.datum] }));
  }
  function avgAchievement(daily) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const rows = daily.filter((d) => d.datum !== todayIso && d.ziel && d.ist != null && d.ist > 0);
    if (!rows.length) return null;
    const sum = rows.reduce((s, d) => s + Math.min(d.ist / d.ziel, 1.4), 0);
    return Math.round((sum / rows.length) * 1000) / 10;
  }

  const storeChildren = [];
  cfg.stores.forEach((s, i) => {
    const store = data[s.marktNr];
    const daily = buildDaily(store);
    const chartInfo = { monthly: manifest[s.marktNr].monthly, daily: manifest[s.marktNr].daily, dailyCount: daily.length, achievement: avgAchievement(daily) };
    storeChildren.push(...storeSection(s, store, chartInfo, i + 1));
  });

  const summaryRows = [new TableRow({ tableHeader: true, children: [
    new TableCell({ width: { size: 2800, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: GRAY_BG }, children: [p('Filiale', { bold: true, size: 20, after: 0 })] }),
    new TableCell({ width: { size: 6200, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: GRAY_BG }, children: [p('Maßnahme', { bold: true, size: 20, after: 0 })] }),
  ] })];
  cfg.stores.forEach((s) => {
    summaryRows.push(new TableRow({ children: [
      new TableCell({ width: { size: 2800, type: WidthType.DXA }, children: [p(s.name, { size: 20, after: 0 })] }),
      new TableCell({ width: { size: 6200, type: WidthType.DXA }, children: [p(s.measureShort, { size: 20, after: 0 })] }),
    ] }));
  });

  const doc = new Document({
    sections: [{
      properties: { page: { margins: { top: 1100, bottom: 1000, left: 1000, right: 1000 } } },
      children: [
        new Paragraph({ children: [new TextRun({ text: cfg.title, bold: true, size: 40, color: INK })], spacing: { after: 40 } }),
        new Paragraph({ children: [new TextRun({ text: cfg.subtitle, size: 20, color: MUTED })], spacing: { after: 40 } }),
        new Paragraph({
          spacing: { after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: RED, space: 6 } },
          children: [new TextRun({ text: `${cfg.region} · Gebietsleiter: ${cfg.author} · Erstellt am ${cfg.created}`, size: 18, color: MUTED })],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 140 }, children: [new TextRun({ text: '1. Übergreifende Maßnahme: digitales Tagesziel für alle Mitarbeitenden', bold: true })] }),
        p(cfg.systemChange.intro, { after: 160 }),
        calloutBox('FORMEL', 'Tagesziel = geglätteter Vorjahresumsatz desselben Wochentags × mindestens 1,25 (+25 %). Wächst eine Filiale real stärker, steigt der Faktor mit — aber gedämpft: nur 10 % des Anteils über +25 % hinaus fließen sofort ein, damit das Ziel nicht schneller springt als die Produktion mithalten kann.\n\nProduktionsziel = Tagesziel ÷ 0,75 — rechnet ein, dass bei frisch zubereitetem Sushi ca. 25 % der Produktion (Waste) nicht verkauft wird.', GRAY_BG, BLUE, BLUE),
        new Paragraph({ spacing: { before: 200, after: 60 }, children: [img(path.join(__dirname, 'screenshot_umsatzziel_mitarbeiter.png'), 190)] }),
        p('Screenshot aus der Mitarbeiter-App (reale Live-Daten, Filiale Heilbad Heiligenstadt, ' + cfg.created + '): jede/r Mitarbeitende sieht auf der Dienstplan-Seite direkt das heutige Produktionsziel, den bisher erreichten Umsatz und den Fortschritt als Balken — ohne Nachfrage beim Gebietsleiter.', { size: 18, color: MUTED, italics: true, after: 200 }),
        p(cfg.systemChange.outro, { after: 240 }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 140 }, children: [new TextRun({ text: '2. Filialen im Fokus dieser Woche', bold: true })] }),
        p(cfg.storesIntro, { after: 160 }),
        ...storeChildren,

        new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 140 }, children: [new TextRun({ text: '3. Zusammenfassung & nächste Schritte', bold: true })] }),
        new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [2800, 6200], rows: summaryRows }),
        new Paragraph({ spacing: { before: 200 } }),
        ...cfg.nextSteps.map((n) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 100 }, children: [new TextRun({ text: n, size: 20, color: INK })] })),

        new Paragraph({ spacing: { before: 300 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY, space: 8 } }, children: [
          new TextRun({ text: 'Datenquellen: Firestore filiale_umsatz (Welo-Statistik-Export, Monatswerte), filiale_produktion (Axonity, Tageswerte), tagesziel (Live-Berechnung). Bericht automatisiert aus echten Produktionsdaten erzeugt — keine geschätzten oder fiktiven Zahlen.', size: 16, color: MUTED }),
        ] }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  console.log('geschrieben:', outPath);
}

main().catch((e) => { console.error('✗', e.message, e.stack); process.exit(1); });
