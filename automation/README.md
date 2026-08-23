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
| `npm run sync:umsatz` | Umsatz/Personalkosten/Ertrag pro Filiale & Monat → `filiale_umsatz` (Fallback-Quelle) | Welo CSV-Export | Nein — reiner HTTP-GET |
| `npm run sync:produktion` | Umsatz heute, produzierte Ware, Sortenzahl, SX-Start/-Ende & Topseller pro Filiale & Tag → `filiale_produktion` | Axonity (Playwright) | Ja — Playwright/Chromium |
| `npm run sync:bestellungen` | Neueste Webshop-Bestellungen (inkl. Artikel + Kundennotiz bei neuen) → `filiale_bestellungen` | Axonity (Playwright) | Ja — Playwright/Chromium |

## Firestore-Collections

- **`filiale_umsatz/{marktNr}_{periode}`** — `periode` im Format `YYYY-MM`.
  Felder: `marktNr`, `periode`, `kundengruppe`, `teammanager`, `umsatz`,
  `personalkosten`, `ertrag`, `produktivitaet`, `qualitaetMonat`, `updatedAt`.
- **`filiale_produktion/{marktNr}_{datum}`** — `datum` im Format `YYYY-MM-DD`.
  Felder: `marktNr`, `datum`, `standort`, `umsatz30Tage`, `umsatzHeute`,
  `produzierteWare`, `anzahlSorten`, `sxStart`, `sxEnde`, `topProdukt`, `updatedAt`.
- **`filiale_bestellungen/{bestellnummer}`** — Felder: `bestellnummer`, `marktNr`,
  `standort`, `bestellzeit`, `abholzeit`, `storniert`, `artikel` (Array aus
  `{name, menge}`, nur bei Erstsichtung gefüllt), `notiz` (Kundenanmerkung, nur
  bei Erstsichtung gefüllt), `createdAt` (Zeitpunkt der Erstsichtung — bleibt
  bei erneutem Sehen unverändert, steuert die "neu"-Markierung im Dashboard),
  `updatedAt`. Absichtlich NICHT gespeichert: Kundenname/Telefon/E-Mail aus
  demselben Axonity-Dialog — nicht gebraucht, unnötige personenbezogene Daten.

Alle drei Collections werden ausschließlich serverseitig über das
Firebase-Admin-SDK beschrieben (Service-Account-Key, umgeht die Firestore-
Regeln). Aus dem Client (GLSC-App, `dashboard.html`) sind sie nur lesbar für
angemeldete Manager — siehe `firestore.rules`.

## Zeitplan

Windows Task Scheduler auf dem lokalen Rechner (Testphase, noch keine Cloud
Functions):
- **"GLSC Filial Radar - Produktion Sync"** — täglich 14:00 (`run-sync-produktion.bat`)
- **"GLSC Filial Radar - Umsatz Sync"** — täglich 06:00 (`run-sync-umsatz.bat`)
- **Bestellungen-Sync** — noch kein Scheduled Task angelegt; manuell mit
  `npm run sync:bestellungen` starten, bis Zeitplan/Intervall entschieden ist.

Beide Tasks laufen im Logon-Modus "Nur interaktiv" (kein gespeichertes Passwort
nötig, läuft aber nur während der Nutzer angemeldet ist). Logs landen in
`automation/logs/`.
