// Liest ein Foto aus einer Wareneingang-Schnellmeldung (nur Foto + Freitext-
// Notiz, kein Lieferant/Auftrag-Feld) und prüft per Claude-Vision, ob es sich
// um einen Schwan-Asia-Food-Lieferschein handelt — falls ja, werden HK-Nummer
// und Kunden-Nr extrahiert, damit sync-schwan-lookup.js denselben Kunde→
// Auftrag→Artikel-Ablauf wie bei den vollständig ausgefüllten Meldungen
// fahren kann (Auftrag t.duong 11.09.2026: "Sử dụng AI để chọn đúng đơn
// hàng trong báo cáo nhanh").
//
// BEWUSST KONSERVATIV: liefert das Modell istSchwanLieferschein:false oder
// gar keine gültige Antwort, wird die Meldung komplett übersprungen (kein
// Vorschlag, kein Rätselraten) — der Admin behandelt sie wie bisher von Hand.
require('dotenv').config();

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_VISION_MODEL || 'claude-haiku-4-5-20251001';

const PROMPT = `Dies ist ein Foto, das ein Mitarbeiter bei einer Wareneingang-Reklamation hochgeladen hat.

Prüfe: ist das ein LIEFERSCHEIN von "Schwan Asia Food" (erkennbar am Logo/Schriftzug "Schwan Asia Food" oben auf dem Beleg, mit Feldern wie "HK-XXXXXX", "Kunden-Nr: SCXXXX", "Lieferdatum")?

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, keine Erklärung, kein Markdown:
- Falls JA, ein Schwan-Lieferschein: {"istSchwanLieferschein": true, "hkNummer": "HK-XXXXXX" (exakt wie gedruckt, oder null falls nicht lesbar), "kundenNr": "SCXXXX" (oder null), "kostenstelle": "XXXXXX" (6-stellige Zahl vor dem Marktnamen, oder null), "lieferdatum": "YYYY-MM-DD" (oder null)}
- Falls NEIN (z.B. Foto von Ware, Verpackung, irgendetwas anderes): {"istSchwanLieferschein": false}

Bei Unsicherheit: istSchwanLieferschein: false.`;

async function extractLieferschein(dataUrl) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY fehlt in .env');
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { istSchwanLieferschein: false };
  const [, mediaType, base64] = m;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API Fehler ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content && data.content[0] && data.content[0].text;
  if (!text) return { istSchwanLieferschein: false };
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { istSchwanLieferschein: false };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed && typeof parsed === 'object' ? parsed : { istSchwanLieferschein: false };
  } catch (e) {
    return { istSchwanLieferschein: false };
  }
}

module.exports = { extractLieferschein };
