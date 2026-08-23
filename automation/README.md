# Filial Radar — Automation

Node-Skripte, die Filialdaten aus zwei externen Systemen in das Firestore-Projekt
der GLSC-App (`glsc-eabb6`) synchronisieren, als Datenquelle für das geplante
Dashboard. Siehe auch das Architektur-Memo "Filial Radar".

## Setup

```bash
cd automation
npm install
npx playwright install chromium   # nur für sync:produktion nötig
cp .env.example .env
```

`.env` ausfüllen (siehe Kommentare in `.env.example`):
- `WELO_STATISTIK_URL` — persönlicher CSV-Link aus Welo/SuCi-Net (Statistiken > Statistik Exporter)
- `AXONITY_USER` / `AXONITY_PASSWORD` — Zugang zu erp.axonity.de
- `GOOGLE_APPLICATION_CREDENTIALS` — Pfad zu einem Firebase-Service-Account-Key (JSON)

**Keiner dieser Werte darf committed werden.** `.env` und `service-account.json`
sind in `.gitignore` bereits ausgeschlossen.

## Skripte

| Befehl | Was es macht | Quelle | Braucht Browser? |
|---|---|---|---|
| `npm run sync:umsatz` | Umsatz/Personalkosten/Ertrag pro Filiale & Monat → `filiale_umsatz` | Welo CSV-Export | Nein — reiner HTTP-GET |
| `npm run sync:produktion` | Produktionsbeginn/-ende & Topseller pro Filiale & Tag → `filiale_produktion` | Axonity (Playwright) | Ja — Playwright/Chromium |

## Firestore-Collections

- **`filiale_umsatz/{marktNr}_{periode}`** — `periode` im Format `YYYY-MM`.
  Felder: `marktNr`, `periode`, `kundengruppe`, `teammanager`, `umsatz`,
  `personalkosten`, `ertrag`, `produktivitaet`, `qualitaetMonat`, `updatedAt`.
- **`filiale_produktion/{marktNr}_{datum}`** — `datum` im Format `YYYY-MM-DD`.
  Felder: `marktNr`, `datum`, `standort`, `sxStart`, `sxEnde`, `topProdukt`, `updatedAt`.

Beide Collections werden ausschließlich serverseitig über das Firebase-Admin-SDK
beschrieben (Service-Account-Key, umgeht die Firestore-Regeln). Aus dem Client
(GLSC-App, `dashboard.html`) sind sie nur lesbar für angemeldete Manager — siehe
`firestore.rules`.

## Geplanter Zeitplan

Noch nicht final entschieden (siehe Memo, Abschnitt "Was noch offen ist"):
lokaler Task Scheduler zum Testen, danach Cloud Scheduler + Cloud Functions für
den Dauerbetrieb ohne laufenden PC.
