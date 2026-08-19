# Notgroschen

Haushalts- und Finanzplanung für Haushalte ab zwei Personen — **lokal-first**,
browserbasiert, ohne Build, ohne Server, ohne externe Abhängigkeiten.

Alle Daten bleiben auf dem Gerät: automatisch im lokalen Browser-Speicher,
zusätzlich als JSON-Datei, die du selbst exportierst und wieder lädst. Es gibt
keinen einzigen Netzwerkaufruf in dieser Anwendung.

## Starten

```
git clone <repo>
cd notgroschen
```

Dann `index.html` doppelklicken — fertig. Die App läuft direkt über `file://`.

> Die Skripte werden bewusst als klassische `<script>`-Tags eingebunden statt als
> ES-Module. ES-Module werden von allen Browsern über `file://` per CORS blockiert;
> so bleibt die Aufteilung auf mehrere Dateien erhalten, ohne einen lokalen Server
> zu erzwingen.

Wer trotzdem einen Server möchte (z. B. um im Netzwerk darauf zuzugreifen):

```
python3 -m http.server 8000
# → http://localhost:8000
```

Beim ersten Start bietet die App einen vollständig ausgefüllten Beispielhaushalt an.
Er lässt sich jederzeit unter **Daten → Beispielhaushalt laden** wiederholen.

## Was die App kann

### Personen und gemeinsamer Haushalt

Der Haushalt besteht aus beliebig vielen Personen, die dynamisch hinzugefügt
werden. Jede Person hat eigene Einnahmen, eigene Ausgaben und optional ein
persönliches Monatsbudget. Der Haushalt als Ganzes hat ebenfalls Einnahmen,
Ausgaben und ein Gesamtbudget.

Die **gemeinsamen Kosten** werden nach einem wählbaren Schlüssel auf die Personen
verteilt:

| Schlüssel | Bedeutung |
|---|---|
| Nach Einkommen | proportional zum jeweiligen Monatseinkommen |
| Zu gleichen Teilen | jede Person trägt denselben Anteil |
| Individuell | frei gesetzte Prozentsätze, auf 100 % normalisiert |

Für den individuellen Schlüssel hat jede Personenkarte einen Regler. Er startet
beim derzeit wirksamen Anteil, zeigt beim Ziehen sofort die neuen Prozentsätze
und Beträge aller Beteiligten und stellt den Schlüssel beim Loslassen auf
„individuell“.

Daraus ergibt sich für jede Person der Betrag, der nach eigenen Ausgaben und
Haushaltsanteil übrig bleibt. Die Summe dieser Restbeträge entspricht exakt dem
Monatssaldo des Haushalts.

### Erfassung

* **Wiederkehrende Posten** mit Intervall — wöchentlich, alle zwei Wochen,
  monatlich, zweimonatlich, quartalsweise, halbjährlich, jährlich. Alles wird auf
  einen Monatsbetrag normalisiert, ein Jahresposten über 1.200 € zählt also mit
  100 € pro Monat. Optional mit Start- und Endmonat, sodass auslaufende
  Kreditraten oder befristete Verträge korrekt abgebildet sind.
* **Einzelbuchungen** mit konkretem Datum für alles Einmalige. Die Ansicht
  „Buchungen“ stellt Plan (nur Wiederkehrendes) und Ist (inklusive Buchungen)
  eines Monats gegenüber.
* **Kategorien** sind vollständig verwaltbar — auch die mitgelieferten lassen
  sich umbenennen, umwidmen und löschen. Beim Löschen werden alle Einträge auf
  eine andere Kategorie umgebucht, es geht nichts verloren; die letzte Kategorie
  einer Art bleibt erhalten. Kategorien mit dem Merkmal *Sparen* zählen in der
  Sparquote als Vermögensaufbau und nicht als Konsum.
* **Progression** je Posten — jährlich, alle zwei Jahre oder in einem frei
  gewählten Abstand, ab einem bestimmten Monat und optional befristet. Bei
  Einnahmen ist das die Gehaltsprogression (etwa aus dem Kollektivvertrag), bei
  Ausgaben die Wertanpassung (etwa eine indexierte Miete). Die Steigerungen
  wirken zinseszinsartig und schlagen bis in Projektion und FIRE-Rechnung durch.

In beiden Tabellen sortiert ein Klick auf die Spaltenüberschrift, ein zweiter
dreht die Richtung. Auf der Übersicht führt ein Klick auf eine Kategoriezeile zu
den Einzelposten dahinter — wiederkehrende Posten, Einzelbuchungen und
Szenario-Effekte gemeinsam, absteigend nach Anteil.

### Investments

Aktien, ETFs, Fonds, Fixzinssparen, Bausparer, Vorsorgeprodukte, Immobilien —
je Person oder gemeinsam. Erfasst werden aktueller Wert, Einstandswert und eine
Renditeerwartung; daraus ergeben sich Gewinn/Verlust je Position, die Aufteilung
nach Anlageart und Träger sowie die nach Wert gewichtete Portfoliorendite.

Zwei Kopplungen machen daraus mehr als eine Liste:

* **Das Gesamtvermögen** ist die Summe der Investments plus dem Feld „sonstiges
  Vermögen“ (Girokonto, Bargeld). Es ist der Startwert für Projektion und
  FIRE-Rechnung.
* **Die Portfoliorendite** wird in Projektion und FIRE als Vorgabe gesetzt und
  bleibt überschreibbar — für ein schnelles „was, wenn es nur 4 % werden“.
* **Der KESt-Satz** ergibt sich aus der Anlageart (27,5 % auf Wertpapiere und
  Krypto, 25 % auf Geldeinlagen, 0 % auf Vorsorge, Versicherung, Immobilien und
  Edelmetalle) und lässt sich je Position überschreiben.

Läuft zu einem Investment ein Sparplan, wird er mit dem passenden Posten
**verknüpft** statt doppelt erfasst: Der Geldfluss bleibt im Budget, das
Investment ist die Vermögensseite. Im Formular lässt sich der Posten in einem
Zug miterzeugen. So kann eine Sparrate nicht zugleich als Ausgabe und als
Vermögenszuwachs gezählt werden.

### Kredite und Nettovermögen

Die Gegenseite der Investments: Restschuld, Zinssatz und Tilgungsverlauf je
Kredit. Daraus ergibt sich das **Nettovermögen** — Vermögen minus Schulden, die
einzige Vermögenszahl, die tatsächlich jemandem gehört. Sie steht auf der
Übersicht, in beiden Vermögensansichten und am Ende der Projektion.

Wie bei den Investments erzeugt ein Kredit keinen Geldfluss: Die Rate ist ein
gewöhnlicher Posten, der Kredit verweist nur darauf. Ist er getilgt, **lässt die
Projektion die Rate automatisch auslaufen** — man muss kein Enddatum pflegen.
Deckt eine Rate die Zinsen nicht, sagt die App das, statt eine Laufzeit zu
erfinden.

### Notgroschen

Die Kennzahl, nach der die App benannt ist: Wie viele Monate tragen die sofort
verfügbaren Mittel die Ausgaben, wenn das Einkommen ausbleibt?

```
Liquide Mittel = Girokonto und Bargeld + als Reserve markierte Anlagen
Reichweite     = Liquide Mittel ÷ (Monatsausgaben − Sparbeiträge)
```

Sparbeiträge zählen nicht mit — die würde man in einer solchen Lage aussetzen.
Kreditraten dagegen laufen weiter und bleiben drin. Als Reserve gilt
standardmäßig nur Tages- und Festgeld; wer seinen ETF dazuzählen will, stellt
das je Position um. Das Ziel (Vorgabe vier Monate) ist unter „Daten" einstellbar.

### Liquiditätsvorschau

Die Monatsrechnung glättet: Ein Jahresposten über 3.000 € zählt mit 250 € in
jedem Monat. Das beantwortet nicht, ob das Konto den Juli übersteht, wenn
Urlaub, Versicherung und Jahreskarte zusammenfallen.

Trägt man am Posten einen **Fälligkeitsmonat** ein, zeigt die Planung zusätzlich
den ungeglätteten Kontoverlauf: Der volle Betrag trifft in seinem Monat ein,
darunter eine Liste der Monate mit größeren Einzelzahlungen. Ohne Angabe bleibt
alles wie bisher gleichmäßig verteilt.

### Sankey-Diagramm

Das Flussdiagramm zeigt, wohin das Geld geht, in zwei Lesarten:

* **über das Gesamtbudget** — Einkommensquellen → Träger → Gesamtbudget →
  Ausgabenkategorien und Überschuss
* **direkt je Person** — die Farbe der Person bleibt bis zur Ausgabe erhalten,
  man sieht also, wessen Geld welche Kategorie deckt

Kleine Kategorien lassen sich unterhalb einer einstellbaren Schwelle zu
„Sonstige“ bündeln. Jede Bahnbreite entspricht dem Monatsbetrag; ein
Tabellenumschalter zeigt dieselben Zahlen als Zahlenwerk.

### Planung und Zukunftsaussicht

Ein Szenario bündelt zeitlich begrenzte Anpassungen. Jede Anpassung besteht aus:

* **Wirkungsbereich** — eine Person, ein einzelner Posten, eine Kategorie, alle
  gemeinsamen Posten, der gesamte Haushalt oder ein einmaliges Ereignis
* **Modus** — um Prozent verändern, um einen festen Betrag verändern, oder auf
  einen festen Betrag setzen
* **Zeitraum** — von Monat bis Monat, offenes Ende möglich

Typische Fälle: „Einkommen Robin −65 % für zwölf Monate (Karenz)“, danach
„−20 % für zwei Jahre (Teilzeit)“, dazu „Neue Küche 9.500 € im April 2027“.
Mehrere Szenarien lassen sich gleichzeitig aktivieren und wirken gemeinsam.

Die Projektion vergleicht das Ergebnis über bis zu 20 Jahre mit der
unveränderten Basis: Vermögensentwicklung, Monatssaldo, Jahresübersicht,
tiefster Vermögensstand und die Anzahl der Monate mit Deckungslücke.

### FIRE-Kalkulator

Gerechnet wird durchgehend **in heutiger Kaufkraft**: die Nominalrendite wird um
die Inflation bereinigt, sodass die FIRE-Zahl direkt mit den heutigen Ausgaben
vergleichbar ist.

```
Realrendite  = (1 + Rendite) ÷ (1 + Inflation) − 1
FIRE-Zahl    = Jahresausgaben ÷ (Entnahmerate × (1 − KESt × Gewinnanteil))
Coast-Zahl   = FIRE-Zahl ÷ (1 + Realrendite nach KESt)^Horizont
```

Startvermögen und Rendite kommen wahlweise automatisch aus den Investments oder
von Hand — dasselbe Muster wie bei der Sparrate: Feld leer heißt „ableiten“.

Die Jahresausgaben werden aus dem Budget abgeleitet — **ohne die Sparbeiträge**,
denn im Ruhestand wird nicht mehr gespart — und lassen sich mit einem
Ausgabenniveau in Prozent skalieren oder ganz überschreiben. Die Sparrate kommt
wahlweise automatisch aus dem Haushaltssaldo plus den planmäßigen Sparbeiträgen
oder manuell. Ergebnis: FIRE-Zahl, Jahre bis zur Unabhängigkeit, voraussichtliches
Datum, monatliche Entnahme und der Coast-FIRE-Fortschritt.

### Kapitalertragsteuer

Beträge in Posten und Buchungen sind Nettobeträge — dort rechnet die App nichts
nach. Besteuert werden allein die Erträge der Investments, in Projektion wie
FIRE-Rechnung:

* **Laufend** fällt ein einstellbarer Anteil des Ertrags an (Vorgabe 30 %) und
  wird sofort versteuert. 100 % passt zum Sparbuch, 0 % zu einer Aktie, die bis
  zum Verkauf nichts ausschüttet. Was laufend versteuert wurde, erhöht die
  Anschaffungskosten und wird kein zweites Mal besteuert.
* **Bei der Entnahme** wird der Gewinnanteil des verkauften Bestands fällig —
  das entspricht dem österreichischen gleitenden Durchschnittspreis. Deshalb
  wandert die FIRE-Zahl mit: je mehr stille Reserven im Depot stecken, desto
  mehr Depot braucht dieselbe Entnahme nach Steuer.

Versteuert wird der **nominelle** Ertrag, auch wenn die Reihe real gerechnet
ist; die KESt kennt keinen Inflationsabschlag. Unter „Daten“ lässt sich die
Steuer ganz abschalten — dann rechnet die App wie zuvor mit Bruttorenditen.

### Darstellung

Zwei Designs: ein helles, das dem Finanzthema entspricht — warmes Papier, tiefe
Tinte, gedämpftes Waldgrün, wie ein gedruckter Vermögensbericht — und ein dunkles
Pendant auf kühlem Schiefer. Die Umschaltung folgt wahlweise dem Betriebssystem.

Die kategoriale Serienpalette ist gegen beide Flächenfarben geprüft (OKLab-ΔE,
Farbfehlsichtigkeit, Kontrast). Jedes Diagramm hat eine Tabellenansicht als
barrierefreies Gegenstück, Farbe trägt nie allein die Information.

## Datenhaltung

* **Auto-Speicherung** im `localStorage` unter `notgroschen.state.v1` nach jeder
  Änderung.
* **Datei-Export/Import** als lesbares JSON. Das ist der Weg für Backups, den
  Gerätewechsel und das Teilen mit der zweiten Person im Haushalt.
* Tastenkürzel <kbd>Strg</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> speichert als Datei.
* Eine Datei lässt sich auch einfach ins Fenster ziehen.

Beim Laden ersetzt die Datei den aktuellen Stand vollständig. Ältere Dateien
werden beim Import migriert: fehlende Felder bekommen Vorgaben, unbekannte Träger
und Kategorien werden auf gültige Werte zurückgeführt.

## Datenimport mit KI-Werkzeugen

Für Assistenten wie Claude, die eine exportierte Datei auswerten oder verändern
sollen — etwa um Kontoauszüge, Tabellen oder ein altes Haushaltsbuch zu
übernehmen — liegt eine vollständige Anleitung bereit:

**[`AGENTS.md`](AGENTS.md)** beschreibt das Dateiformat Feld für Feld, die
Regeln, die die App beim Import stillschweigend erzwingt (und die, die sie
*nicht* prüft), sowie das Vorgehen beim Import aus fremden Quellen — inklusive
der wichtigsten Fallgrube: Ein Kontoauszug darf nicht eins zu eins zu
Einzelbuchungen werden, sonst zählen wiederkehrende Posten doppelt.

In **Claude Code** ist der Ablauf als Slash-Command hinterlegt. Repo klonen,
den Export aus der App und die Quelldatei in den Ordner legen, dann:

```
/import kontoauszug.csv
```

Der Command sichtet die Quelle, schlägt vor, was wiederkehrender Posten und was
Einzelbuchung wird, fragt vor dem Schreiben nach, legt das Ergebnis als
`*.imported.json` neben dem Original ab und stellt die Monatsbilanz vorher und
nachher gegenüber. Das Original wird nie überschrieben.

Zum Nachweis, dass eine veränderte Datei wieder importierbar ist:

```
node tools/validate-daten.mjs meine-datei.json
```

Das Skript prüft Struktur, Verweise und Wertebereiche, warnt vor Duplikaten und
falsch einsortierten Kategorien und gibt eine Monatsbilanz aus. Exit-Code `0`
heißt importierbar. Es ist reines Werkzeug und liest nur — die App selbst hat
weiterhin keinerlei Node-Abhängigkeit.

## Aufbau

```
index.html            Grundgerüst, Skript-Reihenfolge
css/
  tokens.css          Design-Tokens für Hell und Dunkel
  app.css             Layout und Komponenten
js/
  util.js             Formatierung, Monatsarithmetik, DOM-Helfer
  store.js            Zustand, localStorage, Datei-Import/Export, Migration
  calc.js             Normalisierung, Aggregation, Kostenschlüssel,
                      Szenarien, Projektion, FIRE, Sankey-Graph
  sankey.js           Layout-Algorithmus und SVG-Rendering
  charts.js           Linien- und Säulendiagramme
  components.js       Karten, Kennzahlen, Meter, Modal, Formularfelder
  views/              Die neun Ansichten
  app.js              Router, Theme, Datei-Ein-/Ausgabe
```

Alles hängt am globalen Namespace `HB`. Die Reihenfolge der `<script>`-Tags in
`index.html` ist die Abhängigkeitsreihenfolge.

## Rechenmodell in Kurzform

```
Monatsbetrag(Posten)   = Betrag × Faktor(Intervall) × Progressionsfaktor
Flüsse(Monat)          = aktive Posten im Zeitraum
                       + Einzelbuchungen des Monats (optional)
                       + Szenario-Anpassungen

Netto-Haushaltskosten  = Haushaltsausgaben − Haushaltseinnahmen
Anteil(Person)         = Netto-Haushaltskosten × Schlüssel(Person)
Bleibt übrig(Person)   = Einnahmen − eigene Ausgaben − Anteil

Monatssaldo            = Einnahmen − Ausgaben  (= Σ „Bleibt übrig“)
Sparquote              = (Monatssaldo + Sparbeiträge) ÷ Einnahmen

Gesamtvermögen         = sonstiges Vermögen + Σ Investments
Portfoliorendite       = Σ (Wert × Renditeerwartung) ÷ Σ Wert
KESt-Satz              = Σ (Wert × Steuersatz) ÷ Σ Wert
Rendite nach KESt      = Rendite × (1 − KESt-Satz × laufend versteuerter Anteil)
```

## Grenzen

Die Projektion unterstellt eine konstante Realrendite und gleichbleibende Posten
außerhalb der Szenarien. Reale Märkte schwanken; gerade die ersten Jahre einer
Entnahmephase entscheiden über deren Erfolg.

Die Steuerrechnung ist ein Modell, keine Steuerberatung: Der laufend versteuerte
Ertragsanteil ist eine Annahme, und Freibetrag, Verlustausgleich, Auslandsdepots
ohne KESt-Abzug sowie Altbestände sind nicht abgebildet. Lohn- und
Einkommensteuer bleiben außen vor — Posten und Buchungen gelten als bereits
versteuert.

Die Zahlen sind eine Größenordnung für die eigene Planung, keine Anlageberatung
und keine Zusage.
