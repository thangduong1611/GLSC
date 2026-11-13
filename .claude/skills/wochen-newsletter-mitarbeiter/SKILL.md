---
name: wochen-newsletter-mitarbeiter
description: Verarbeitet den wöchentlichen "Newsletter | KW XX"-PDF von Sushi Circle Gastronomie GmbH (Zentrale) zu einer kurzen, zweisprachigen (Deutsch + Vietnamesisch) Mitteilung fürs eigene Team, fertig zum Einfügen in die "📢 Mitteilungen"-Karte in index.html. Benutze dieses Skill IMMER, wenn der Nutzer ein PDF mit "Newsletter" und einer Kalenderwoche (KW) im Namen hochlädt oder erwähnt, auch wenn er nicht wörtlich "Skill" sagt — z.B. "hier der Newsletter dieser Woche", "fass das für die Mitarbeiter zusammen", "kannst du daraus wieder eine Nachricht bauen".
---

# Wöchentlicher Sushi-Circle-Newsletter → Mitteilung fürs Team

## Warum dieses Skill existiert

Die Zentrale (Sushi Circle Gastronomie GmbH, Neu-Isenburg) schickt jede Woche ein
mehrseitiges PDF "NEWSLETTER | KW XX" per E-Mail — Wochenüberblick (Umsatz-KPIs),
Neueröffnungen, Feiertage, dann Updates aus Operations/Produktmanagement/Einkauf/
Marketing/IT-Operational-Support. Der Nutzer (Gebietsleiter, siehe
[[user_role_gebietsleiter]]) will daraus **nicht** das ganze PDF an sein Team
weiterleiten, sondern jede Woche eine **kurze, nur die wirklich relevanten
Punkte enthaltende, zweisprachige (Deutsch + Vietnamesisch) Mitteilung** bauen —
fertig zum Einfügen in die bereits bestehende **"📢 Mitteilungen"-Karte** in
`index.html` (Textfeld `nw-text`, `nwSend()`, Ziel standardmäßig "📢 Alle
Mitarbeiter der Region").

## Ablauf

### 1. PDF lesen (Text + Bilder — poppler/pdftoppm ist auf dieser Maschine NICHT installiert)

```bash
python3 -m pip install --quiet pypdf pymupdf   # einmalig, falls noch nicht vorhanden
```

Zwei Durchgänge, beide nötig:
- **Text** mit `pypdf` (`PdfReader(path).pages[i].extract_text()`) — schnell,
  reicht für die meisten Absätze.
- **Seiten als PNG rendern** mit `pymupdf` (`import pymupdf` bzw. `fitz`,
  `page.get_pixmap(dpi=200).save(...)`) und die PNGs mit `Read` ansehen —
  **Tabellen und Grafiken** (z.B. die Verpackungsgrößen-Umbenennung als
  gestyltes Bild, nicht als Text) stehen oft NUR im Bild, nicht im
  extrahierten Text. Nicht auf `extract_text()` allein verlassen, immer auch
  kurz jede Seite als Bild durchsehen.

### 2. Relevanz filtern — bewusst NICHT alles 1:1 übernehmen

Das PDF ist für Gebietsleiter/Verwaltung geschrieben, nicht für Kiosk-
Mitarbeiter. Pro Ausgabe neu entscheiden, aber als Faustregel:

**Meistens relevant fürs Team** (konkrete Handlungsanweisung oder betrifft
ihren Arbeitsalltag direkt):
- Neue Produkte/Menü-Umstellungen mit Checkliste (Preise prüfen, Planogramm,
  Mindestbestand, Verpackung, Etiketten, …)
- Umbenennungen/Änderungen bei Verpackungsgrößen, Rezepten, Abläufen
- Neue/geänderte Verpackung, wann sie ankommt/im Webshop aktiv wird
- Marketing-Material, das am Standort ankommt (Plakate etc.) und wie damit
  umzugehen ist
- Änderungen bei Inventur, Wareneingang, Kassensystem, Waagen-Eichung o.ä. —
  alles, wo ein externer Prüfer/Techniker unangekündigt auftauchen kann oder
  sich ein täglicher Ablauf ändert
- Neue Apps/Tools, die das Team selbst benutzen muss
- Feiertage/Ferien, wenn sie tatsächlich die Produktion/Öffnungszeiten der
  EIGENEN Bundesländer betreffen (Ost-Filialen: Hessen/Niedersachsen/
  Thüringen; West-Filialen: NRW — siehe `automation/src/branches.js` für die
  genaue Zuordnung Kostenstelle→Bundesland/Region)

**Meistens NICHT relevant fürs Team** (internes Reporting/Strategie, kein
Handlungsbedarf für Kiosk-Personal):
- Detaillierte Umsatz-KPI-Tabellen (€/Tag je Kiosk, LFL vs. neue Standorte) —
  höchstens EIN kurzer, einfacher Satz daraus (z.B. "Umsatz ist diese Woche
  wieder rückläufig, bitte eng am Produktionsplan arbeiten"), nie die rohen
  Zahlen/Fachbegriffe wie "LFL"
- Neueröffnungen anderer Standorte (außer es ist im eigenen Gebiet)
- Rein interne Prozess-/Strategie-Updates ohne Bezug zum Kiosk-Alltag

Eine motivierende Erwähnung (z.B. Glückwunsch an ein Team mit besonders gutem
Ergebnis) ist auch dann wert, kurz mit reinzunehmen, auch wenn es kein
"Hausaufgabe"-Punkt ist — hält die Mitteilung menschlich statt nur eine
Checkliste.

### 3. Zweisprachig schreiben (Deutsch + Vietnamesisch)

- **EIN zusammenhängender Text**, nicht zwei separate Nachrichten — das
  Mitteilungs-Feld (`nw-text`) ist ein einzelnes Textfeld, und der Nutzer
  will "1 phiên bản song ngữ" (eine zweisprachige Version). Pro Thema: erst
  der deutsche Absatz, direkt danach die vietnamesische Übersetzung desselben
  Absatzes (nicht erst alles Deutsch, dann alles Vietnamesisch — bei einer
  längeren Mitteilung müsste sonst jeder bis zur Hälfte scrollen, um seine
  Sprache zu finden).
- 🇩🇪/🇻🇳-Flaggen oder ein klares "Auf Deutsch:"/"Tiếng Việt:" als Trenner
  pro Abschnitt, plus ein Themen-Emoji pro Punkt (🍱📦🛒📢⚖️📱📊📅 — wie im
  Original-Newsletter, hilft beim schnellen Überfliegen).
- Vietnamesisch: natürlich übersetzen, nicht wortwörtlich — einfache,
  direkte Alltagssprache fürs Kiosk-Team, kein Behörden-/Konzerndeutsch
  1:1 übertragen (z.B. "Planogramm"/"Menübuch" als feststehende Begriffe
  stehen lassen, nicht künstlich übersetzen, da im Alltag ohnehin so
  genannt).
- [[feedback_no_em_dash]] — "-" statt "—", auch im vietnamesischen Teil.

### 4. Liefern

- Fertigen Text direkt im Chat als Code-Block ausgeben (zum 1-Klick-Kopieren),
  NICHT als Artifact — der Zieltext landet in einem reinen Textfeld
  (`nw-text`), ein HTML-Artifact wäre hier nur ein Umweg.
- Kurz empfehlen: über "📢 Mitteilungen" → "Alle Mitarbeiter der Region"
  einfügen und senden — bei Inhalten, die für beide Gebiete gelten (meistens
  der Fall, da der Newsletter firmenweit ist), **in Ost UND West einzeln
  senden** (kein Admin-weiter "alle Regionen"-Knopf vorhanden, siehe
  `nw-filiale`-Select in `index.html`).
- Falls eine Tabelle/Grafik aus dem PDF (z.B. Verpackungsgrößen) für sich
  allein schon gut verständlich ist, zusätzlich erwähnen, dass das Original-
  PDF oder ein Foto der Tabelle über denselben Dialog als Anhang mitgeschickt
  werden kann (`nw-pdf`/`nw-img` sind bereits vorhandene Upload-Felder dort).
- Der Nutzer liest den Entwurf durch und sendet selbst — Claude sendet nie
  selbst Mitteilungen an echte Mitarbeiter (siehe projektweite Regel: erst
  testen/zeigen, nie live gegen echte Mitarbeiter ausprobieren).

## Kurzfassung für einen kompletten Durchlauf

```bash
python3 -m pip install --quiet pypdf pymupdf   # falls nötig
python3 -c "
from pypdf import PdfReader
r = PdfReader('<pfad-zum-pdf>')
for i, p in enumerate(r.pages):
    print(f'--- PAGE {i+1} ---'); print(p.extract_text() or '')
"
python3 -c "
import pymupdf
doc = pymupdf.open('<pfad-zum-pdf>')
for i, page in enumerate(doc):
    page.get_pixmap(dpi=200).save(f'<scratchpad>/newsletter_page{i+1}.png')
"
# jede PNG-Seite kurz mit Read ansehen (Tabellen/Grafiken prüfen)
# relevante Punkte auswählen (siehe Schritt 2), zweisprachigen Text schreiben (Schritt 3)
# als Code-Block im Chat ausgeben, Versand-Hinweis dazu (Schritt 4)
```
