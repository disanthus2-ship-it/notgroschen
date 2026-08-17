---
description: Kontoauszug oder andere Quelle in eine Notgroschen-Datei importieren
argument-hint: <quelldatei> [ziel.json]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node tools/validate-daten.mjs:*), Bash(ls:*), Bash(wc:*), Bash(head:*), Bash(file:*)
---

Importiere Daten aus `$1` in eine Notgroschen-Haushaltsdatei.

Quelle: `$1`
Ziel (optional, sonst automatisch ermitteln): `$2`

Arbeite die folgenden Phasen der Reihe nach ab. **Phase 2 endet mit einer
Rückfrage — schreibe nichts, bevor die Person bestätigt hat.**

---

## Phase 0 — Grundlage

1. Lies **`AGENTS.md`** vollständig. Sie ist der verbindliche Vertrag für das
   Dateiformat; alles Weitere richtet sich danach.
2. Bestimme die Zieldatei:
   - Ist `$2` angegeben, nimm die.
   - Sonst suche mit Glob nach `notgroschen-*.json` im Arbeitsverzeichnis.
     Genau eine → nimm sie. Mehrere → liste sie mit Änderungsdatum und frage,
     welche gemeint ist. Keine → **brich ab** und erkläre: In der App auf
     „Speichern" klicken und die Datei hier ablegen; ohne Ausgangsstand ist
     nicht bekannt, welche Personen und Kategorien es gibt.
   - Dateien, die auf `.imported.json` enden, sind Ergebnisse früherer Läufe.
     Nimm sie nur, wenn ausdrücklich verlangt.
3. Lauf den Validator auf der Zieldatei als **Ausgangsmessung**:
   `node tools/validate-daten.mjs <ziel>`
   Merke dir die Monatsbilanz — sie ist später die Vergleichsgröße.
   Meldet er schon jetzt Fehler, weise darauf hin und frage, ob trotzdem
   fortgefahren werden soll.
4. Verschaffe dir einen Überblick über den Bestand: Personen mit ihren IDs,
   vorhandene Kategorien, bereits erfasste wiederkehrende Posten, Zeitraum der
   vorhandenen Buchungen.

## Phase 1 — Quelle sichten

1. Prüfe zuerst die Größe (`wc -l`) und sieh dir nur die ersten Zeilen an
   (`head`). Ziehe **keine** große Datei vollständig in den Kontext; arbeite bei
   vielen Zeilen mit einem kurzen Auswertungsskript statt mit bloßem Lesen.
2. Bestimme das Format, ohne zu raten: Trennzeichen, Zeichensatz, Spaltenköpfe,
   Datumsformat (`TT.MM.JJJJ` vs. `JJJJ-MM-TT`) und Zahlenformat
   (`1.234,56` deutsch vs. `1,234.56` englisch). Nenne deine Erkennung explizit.
3. Berichte knapp: Anzahl Zeilen, abgedeckter Zeitraum, Summe Eingänge, Summe
   Ausgänge.

## Phase 2 — Analysieren und vorschlagen (noch nichts schreiben)

Die eigentliche Denkarbeit. Halte dich an § 4 von `AGENTS.md`.

1. **Gruppieren.** Fasse Zeilen mit ähnlichem Verwendungszweck und ähnlichem
   Betrag zusammen.
2. **Wiederkehrendes erkennen.** Eine Gruppe, die in mindestens drei
   aufeinanderfolgenden Monaten mit stabilem Betrag auftaucht, ist ein Kandidat
   für `items` — mit passendem `interval`, nicht als Reihe von Einzelbuchungen.
3. **Gegen den Bestand abgleichen.** Existiert bereits ein Posten mit ähnlicher
   Bezeichnung und Höhe, ist die Zahlung schon abgedeckt. Diese Zeilen dürfen
   **nicht** zusätzlich als Buchung übernommen werden — genau daraus entsteht
   die Doppelzählung. Weiche der Betrag deutlich ab, melde das als Abweichung,
   statt etwas anzulegen.
4. **Duplikate.** Eine Buchung gilt als vorhanden, wenn `date`, `amount` und
   `kind` übereinstimmen und die Bezeichnung sehr ähnlich ist.
5. **Zuordnen.** Kategorie und Träger vorschlagen. Wo es unklar ist, **nicht
   raten**: `cat_other` bzw. `"household"` setzen und in der Liste der offenen
   Punkte ausweisen. Gemeinsame Kosten wie Miete oder Lebensmittel gehören auch
   dann auf `"household"`, wenn sie vom Konto einer Person abgehen — sonst
   verschiebt sich der Verteilungsschlüssel.

Lege das Ergebnis als kompakte Tabelle vor:

- **Neue wiederkehrende Posten** — Bezeichnung, Betrag, Intervall, Träger,
  Kategorie, worauf sich die Erkennung stützt
- **Neue Einzelbuchungen** — nach Monat gezählt, mit den größten Positionen
- **Übersprungen** — Duplikate und bereits durch Posten abgedeckte Zahlungen
- **Offene Punkte** — alles, was du auf eine Vorgabe gesetzt hast

**Frage dann, ob so übernommen werden soll**, und warte die Antwort ab.
Korrekturen einarbeiten und erneut vorlegen, bis es passt.

## Phase 3 — Schreiben

1. Schreibe nach `<ziel-ohne-endung>.imported.json`. **Überschreibe das Original
   niemals.**
2. Gib das **vollständige** Objekt aus. Der Import in der App ersetzt den
   gesamten Stand; was fehlt, ist danach weg.
3. **Ändere keine bestehende `id`.** Szenarien und Zuordnungen hängen daran.
4. Neue IDs nachvollziehbar vergeben: `tx_import_<JJJJ-MM>_<lfd>` bzw.
   `itm_import_<lfd>`.
5. Setze `meta.updated` auf die aktuelle Zeit. Lass `settings`, `fire`,
   `plans` und `investments` unangetastet. Aus einem Kontoauszug lässt sich kein
   Depotbestand ableiten; erkennst du eine regelmäßige Einzahlung in ein Depot,
   wird daraus ein Posten in `items` (Kategorie `cat_saving`) — die Verknüpfung
   zum Investment stellt die Person danach in der App her.
6. Beträge unverändert übernehmen — nicht runden, nicht glätten. `amount` ist
   immer positiv, die Richtung steckt in `kind`.

## Phase 4 — Prüfen und berichten

1. `node tools/validate-daten.mjs <neue-datei>`
2. **Meldet er Fehler, liefere nicht aus.** Behebe sie und prüfe erneut.
   Warnungen darfst du bewusst stehen lassen, dann aber begründet.
3. Stelle die Monatsbilanz aus Phase 0 der neuen gegenüber: Einnahmen,
   Ausgaben, Saldo, Sparquote — jeweils vorher, nachher, Differenz.
4. Schließe mit einem knappen Bericht:
   - wie viele Posten und Buchungen hinzugekommen sind
   - wie viele übersprungen wurden und warum
   - welche Zuordnungen unsicher blieben und nachgesehen werden sollten
   - der Hinweis, die Datei in der App über **Laden** zurückzuspielen

Fällt dir dabei etwas auf, das rechnerisch stimmt, aber sachlich unplausibel
wirkt — eine verdoppelte Fixausgabe, ein Gehalt, das zweimal auftaucht, ein
Saldo, der sich unerwartet stark verschiebt —, sag es deutlich, statt es in der
Bilanz untergehen zu lassen.
