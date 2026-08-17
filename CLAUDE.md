# Notgroschen

Lokal-first Haushaltsplanung: eine statische Browser-App ohne Build, ohne Server
und ohne Abhängigkeiten. `index.html` läuft per Doppelklick über `file://`.

## Am Code arbeiten

- Klassische `<script>`-Tags, **keine ES-Module** — die werden über `file://`
  per CORS blockiert. Alles hängt am globalen Namespace `HB`; die Reihenfolge
  der Tags in `index.html` ist die Abhängigkeitsreihenfolge.
- Keine externen Bibliotheken einführen. Sankey-Layout und Diagramme sind
  bewusst selbst geschrieben, damit die App offline und ohne Installation läuft.
- Farben ausschließlich über die Tokens aus `css/tokens.css` beziehen, nie als
  Literal. Jede Änderung muss in Hell **und** Dunkel geprüft werden.
- Oberflächentexte sind durchgehend deutsch, Beträge im Format `de-AT`.

## Mit Daten arbeiten

Wenn es darum geht, eine exportierte `notgroschen-*.json` zu lesen, zu
verändern oder Daten aus fremden Quellen zu importieren:

**Lies zuerst [`AGENTS.md`](AGENTS.md).** Dort steht das vollständige
Dateiformat, welche Regeln die App beim Import stillschweigend erzwingt und
welche sie ungeprüft durchlässt.

Für den Import aus einer fremden Quelle gibt es den fertigen Ablauf
`/import <quelldatei>` (siehe `.claude/commands/import.md`).

Prüfe jedes Ergebnis, bevor du es ausgibst:

```
node tools/validate-daten.mjs <datei.json>
```

Exportierte Haushaltsdateien (`notgroschen-*.json`) sind über `.gitignore`
ausgeschlossen und dürfen nie committet werden.

## Prüfen

Es gibt keine Testsuite. Vor dem Commit:

```
for f in js/*.js js/views/*.js; do node --check "$f"; done
```

Danach `index.html` im Browser öffnen, den Beispielhaushalt laden und alle
acht Ansichten in beiden Designs auf Konsolenfehler durchsehen.
