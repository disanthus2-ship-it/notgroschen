# Anleitung für KI-Werkzeuge: Notgroschen-Dateien lesen und schreiben

Diese Datei richtet sich an KI-Assistenten (Claude, ChatGPT, Copilot und
Vergleichbares), die eine exportierte Notgroschen-Datei auswerten oder
verändern sollen — typischerweise, um Daten aus Kontoauszügen, Tabellen oder
anderen Haushaltsbüchern zu importieren.

**Kurzfassung:** Eine Notgroschen-Datei ist eine einzelne JSON-Datei. Lies sie
vollständig ein, verändere gezielt einzelne Einträge, schreibe **das gesamte
Objekt** wieder heraus und prüfe das Ergebnis mit
`node tools/validate-daten.mjs <datei>`. Erfinde nichts, was nicht in der
Quelle steht.

---

## 1. Arbeitsablauf

Die App hat keine Schnittstelle und keinen Server. Der Austausch läuft
ausschließlich über die Datei:

1. **Die Person exportiert** in der App über **Speichern** (oben rechts) oder
   **Daten → Als Datei speichern**. Es entsteht
   `notgroschen-<haushalt>-<JJJJ-MM-TT>.json`, üblicherweise im
   Download-Ordner.
2. **Du liest diese Datei**, führst die gewünschte Änderung durch und schreibst
   eine neue Datei.
3. **Die Person lädt sie zurück** über **Laden** oder per Drag-and-drop ins
   Fenster.

### Drei Regeln, die alles andere überwiegen

> **Der Import ersetzt den kompletten Stand.** Es gibt kein Zusammenführen in
> der App. Was in deiner Ausgabedatei fehlt, ist danach weg. Gib deshalb immer
> das vollständige Objekt zurück, nicht nur die geänderten Teile.

> **Ändere niemals die `id` eines bestehenden Eintrags.** Szenario-Anpassungen
> verweisen über `targetId` auf Posten und Personen; Buchungen und Posten
> verweisen über `owner` und `categoryId`. Eine geänderte ID zerreißt diese
> Verweise stillschweigend.

> **Überschreibe die Originaldatei nicht.** Schreibe nach
> `<originalname>.imported.json` oder ähnlich, damit die Person vergleichen und
> zurückgehen kann.

### Der lokale Browser-Speicher

Zusätzlich hält die App denselben Stand unter dem `localStorage`-Schlüssel
`notgroschen.state.v1`. Den solltest du **nicht** direkt manipulieren: Er ist
nur über die Entwicklerkonsole des richtigen Browserprofils erreichbar, und die
laufende Seite überschreibt ihn bei der nächsten Änderung ohnehin aus ihrem
Arbeitsspeicher. Der Weg über die Datei ist der einzige verlässliche.

---

## 2. Aufbau der Datei

```jsonc
{
  "schema": 1,                    // unverändert lassen
  "app": "notgroschen",           // unverändert lassen
  "meta":        { … },
  "settings":    { … },
  "household":   { … },
  "people":      [ … ],
  "categories":  [ … ],
  "items":       [ … ],           // wiederkehrende Posten
  "transactions":[ … ],           // Einzelbuchungen mit Datum
  "investments": [ … ],           // Geldanlagen (Vermögensseite)
  "debts":       [ … ],           // Kredite (Schuldenseite)
  "plans":       [ … ],           // Szenarien
  "fire":        { … }
}
```

Damit die App eine Datei überhaupt annimmt, muss sie ein Objekt sein und
mindestens eines der Felder `people`, `items` oder `categories` besitzen. Alles
andere wird beim Import mit Vorgaben aufgefüllt.

### `meta`

| Feld | Typ | Bedeutung |
|---|---|---|
| `name` | string | Name des Haushalts, erscheint in der Kopfzeile |
| `currency` | string | ISO-Code, Vorgabe `"EUR"` |
| `created` | ISO-Zeitstempel | wird nie überschrieben |
| `updated` | ISO-Zeitstempel | setze ihn nach deiner Änderung auf die aktuelle Zeit |

### `settings`

| Feld | Erlaubte Werte | Vorgabe |
|---|---|---|
| `theme` | `"auto"` · `"light"` · `"dark"` | `"auto"` |
| `splitMode` | `"income"` · `"equal"` · `"custom"` | `"income"` |
| `startMonth` | `"JJJJ-MM"` | laufender Monat |
| `projectionMonths` | Zahl | `60` |
| `sankeyMode` | `"budget"` · `"direct"` | `"budget"` |
| `sankeyMinShare` | Zahl in Prozent | `1.5` |
| `emergencyMonths` | Zahl | `4` — Zielreichweite des Notgroschens |

Fasse `settings` bei einem Datenimport nicht an — das sind Anzeigevorlieben.

### `household`

| Feld | Typ | Bedeutung |
|---|---|---|
| `budget` | Zahl oder `null` | monatliche Obergrenze für gemeinsame Ausgaben |
| `assets` | Zahl | Vermögen **außerhalb** der Investments — Girokonto, Bargeld, Sparbuch |

> `assets` ist nicht das Gesamtvermögen. Die App rechnet
> **Gesamtvermögen = `household.assets` + Summe aller `investments[].currentValue`**
> und davon abgeleitet
> **Nettovermögen = Gesamtvermögen − Summe aller `debts[].balance`**.
> Ein Bestand, der hier steht und zugleich als Investment erfasst ist, zählt doppelt.

### `people[]`

```jsonc
{
  "id": "per_alex",        // frei wählbar, muss eindeutig sein
  "name": "Alex",
  "colorIndex": 0,         // 0–7, feste Serienfarbe; pro Person verschieden wählen
  "budget": 400,           // persönliches Monatsbudget, oder null
  "sharePct": null,        // nur bei splitMode "custom" wirksam, 0–100 oder null
  "note": ""
}
```

### `categories[]`

```jsonc
{
  "id": "cat_food",
  "name": "Lebensmittel",
  "kind": "expense",       // "income" oder "expense"
  "system": true,          // true = mitgeliefert, in der App nicht löschbar
  "saving": true           // optional: zählt als Vermögensaufbau, nicht als Konsum
}
```

Diese Kategorien sind immer vorhanden. **Verwende sie, statt neue anzulegen**,
solange eine davon passt:

| Einnahmen | Ausgaben | |
|---|---|---|
| `cat_salary` — Gehalt & Lohn | `cat_housing` — Wohnen | `cat_kids` — Kinder & Bildung |
| `cat_bonus` — Sonderzahlungen | `cat_utilities` — Energie & Nebenkosten | `cat_travel` — Urlaub & Reisen |
| `cat_transfer` — Transferleistungen | `cat_food` — Lebensmittel | `cat_debt` — Kredite & Zinsen |
| `cat_sidejob` — Nebeneinkünfte | `cat_mobility` — Mobilität | `cat_saving` — Sparen & Vorsorge *(saving)* |
| `cat_capital` — Kapitalerträge | `cat_insurance` — Versicherungen | `cat_other` — Sonstiges |
| | `cat_health` — Gesundheit | |
| | `cat_leisure` — Freizeit & Hobbys | |
| | `cat_shopping` — Anschaffungen | |
| | `cat_comms` — Kommunikation & Abos | |

Eine eigene Kategorie bekommt eine neue `id` (Konvention: `cat_<begriff>`) und
`"system": false`.

### `items[]` — wiederkehrende Posten

```jsonc
{
  "id": "itm_…",
  "label": "Miete",
  "amount": 1290,          // immer positiv; die Richtung steckt in "kind"
  "interval": "monthly",
  "kind": "expense",       // "income" oder "expense"
  "owner": "household",    // "household" oder eine people[].id
  "categoryId": "cat_housing",
  "start": null,           // "JJJJ-MM" oder null (= seit jeher)
  "end": null,             // "JJJJ-MM" oder null (= unbefristet)
  "dueMonth": null,        // 1–12: Fälligkeitsmonat, oder null
  "growth": null,          // Progression, siehe unten — oder null
  "active": true,
  "note": ""
}
```

Der Betrag wird über das Intervall auf einen Monatswert umgerechnet. **Trage
immer den tatsächlichen Zahlbetrag ein, nicht den Monatsanteil** — die
Umrechnung macht die App:

| `interval` | Faktor auf den Monat | Beispiel |
|---|---|---|
| `weekly` | × 52 ⁄ 12 | 50 € wöchentlich → 216,67 €/Monat |
| `biweekly` | × 26 ⁄ 12 | 50 € alle zwei Wochen → 108,33 €/Monat |
| `monthly` | × 1 | |
| `bimonthly` | × 1 ⁄ 2 | 80 € alle zwei Monate → 40 €/Monat |
| `quarterly` | × 1 ⁄ 3 | 300 € im Quartal → 100 €/Monat |
| `semiannual` | × 1 ⁄ 6 | 600 € halbjährlich → 100 €/Monat |
| `yearly` | × 1 ⁄ 12 | 1.200 € jährlich → 100 €/Monat |

#### Fälligkeit (`dueMonth`)

Für Intervalle gröber als monatlich: In welchem Kalendermonat der Betrag
tatsächlich abgeht. Ein Jahresposten mit `"dueMonth": 7` trifft im Juli mit dem
vollen Betrag ein, ein Quartalsposten mit `"dueMonth": 3` in März, Juni,
September und Dezember.

Das ändert **nichts** an der Monatsrechnung — dort bleibt der Betrag über das
Intervall verteilt. Es wirkt allein auf die Liquiditätsvorschau, die den echten
Kontoverlauf zeigt. Ohne Angabe (`null`) wird auch dort gleichmäßig verteilt.

Bei `monthly`, `biweekly` und `weekly` ist das Feld wirkungslos und gehört
auf `null`.

#### Progression (`growth`)

Regelmäßige Steigerung eines Postens: Gehaltsprogression, indexierte Miete,
valorisierte Prämie.

```jsonc
"growth": {
  "pct": 3,              // Steigerung je Schritt in Prozent, ungleich 0
  "everyMonths": 12,     // 12 = jährlich, 24 = alle 2 Jahre, frei wählbar (≥ 1)
  "from": "2027-01",     // Monat der ERSTEN Steigerung, Pflichtfeld
  "until": null          // letzte Steigerung, oder null für unbefristet
}
```

Die Steigerungen wirken **zinseszinsartig** — jede setzt auf dem bereits
gestiegenen Betrag auf:

```
Schritte(Monat) = 0                                        falls Monat < from
                = floor((min(Monat, until) − from) / everyMonths) + 1   sonst
Betrag(Monat)   = Monatsbetrag × (1 + pct/100) ^ Schritte
```

Nach `until` bleibt der zuletzt erreichte Stand stehen, er fällt nicht zurück.

Zwei Dinge dazu:

- **`amount` bleibt immer der Ausgangsbetrag.** Trage nie einen schon
  hochgerechneten Wert ein — die App rechnet je Monat selbst.
- **Ein unvollständiger Satz wird beim Import ersatzlos verworfen.** Fehlt
  `from`, ist `pct` gleich 0 oder `everyMonths` kleiner als 1, verschwindet die
  Progression stillschweigend. Entweder vollständig oder `null`.

### `transactions[]` — Einzelbuchungen

```jsonc
{
  "id": "tx_…",
  "date": "2026-08-11",    // JJJJ-MM-TT
  "label": "Winterreifen",
  "amount": 480,           // immer positiv
  "kind": "expense",
  "owner": "household",
  "categoryId": "cat_mobility",
  "note": ""
}
```

Buchungen wirken **zusätzlich** zu den wiederkehrenden Posten in dem Monat, in
den ihr Datum fällt. Sie ersetzen keinen Posten. Eine Supermarktabbuchung ist
also nur dann eine Buchung, wenn es daneben keinen laufenden Posten
„Lebensmittel" gibt — sonst zählst du sie doppelt. Siehe § 4.

### `investments[]` — Geldanlagen

```jsonc
{
  "id": "inv_…",
  "label": "MSCI World ETF",
  "type": "etf",               // siehe Tabelle unten
  "owner": "household",        // "household" oder eine people[].id
  "currentValue": 21400,       // aktueller Wert, zählt zum Gesamtvermögen
  "costBasis": 18200,          // Einstandswert (Summe der Einzahlungen) oder null
  "expectedReturnPct": 6.5,    // Renditeerwartung p. a. nominal, oder null
  "liquid": null,              // null = Vorgabe der Anlageart, sonst true/false
  "linkedItemId": "itm_…",     // Verweis auf den Sparplan-Posten, oder null
  "provider": "Depotbank",
  "note": ""
}
```

Erlaubte `type`-Werte — alles andere wird beim Import zu `sonstiges`:

| Schlüssel | Anlageart | Schlüssel | Anlageart |
|---|---|---|---|
| `etf` | ETF | `versicherung` | Lebens-/Rentenversicherung |
| `aktien` | Aktien (Einzelwerte) | `vorsorge` | Betriebliche Vorsorge |
| `fonds` | Investmentfonds | `immobilie` | Immobilie |
| `anleihen` | Anleihen | `edelmetall` | Edelmetalle & Rohstoffe |
| `fixzins` | Fixzinssparen | `krypto` | Kryptowährungen |
| `tagesgeld` | Tages- & Festgeld | `sonstiges` | Sonstiges |
| `bausparer` | Bausparvertrag | | |

**Ein Investment erzeugt keinen Geldfluss.** Es ist reine Bestandsführung. Die
monatliche Einzahlung ist ein ganz normaler Posten in `items` (Kategorie
`cat_saving`), und `linkedItemId` verweist darauf. Genau diese Trennung
verhindert, dass eine Sparrate doppelt zählt — einmal als Ausgabe im Budget und
noch einmal als Vermögenszuwachs.

Beim Anlegen eines Investments mit Sparplan also **beides** erzeugen: den Posten
in `items` und das Investment mit `linkedItemId` darauf. Existiert der Posten
schon, nur verknüpfen — keinen zweiten anlegen.

`expectedReturnPct` speist die nach Wert gewichtete Portfoliorendite, die
Projektion und FIRE-Rechnung als Vorgabe verwenden. Positionen ohne
Renditeerwartung (`null`) bleiben aus diesem Durchschnitt heraus, ziehen ihn
also nicht künstlich nach unten.

### `debts[]` — Kredite

```jsonc
{
  "id": "dbt_…",
  "label": "Wohnkredit",
  "type": "mortgage",          // siehe Tabelle unten
  "owner": "household",        // "household" oder eine people[].id
  "balance": 198500,           // aktuelle Restschuld, ≥ 0
  "principal": 240000,         // ursprüngliche Summe, oder null
  "interestPct": 3.4,          // Sollzins p. a.
  "paymentMonthly": null,      // nur ohne verknüpften Posten
  "linkedItemId": "itm_…",     // Verweis auf den Ratenposten, oder null
  "provider": "Hausbank",
  "note": ""
}
```

Erlaubte `type`-Werte — alles andere wird beim Import zu `other`:
`mortgage` (Wohnkredit) · `consumer` (Konsumkredit) · `car` (Auto-/Leasing) ·
`education` (Bildungskredit) · `creditcard` (Kreditkarte/Überziehung) ·
`privateloan` (Privatdarlehen) · `other`.

**Ein Kredit erzeugt keinen Geldfluss** — dasselbe Prinzip wie bei den
Investments. Die Rate ist ein gewöhnlicher Posten in `items` (Kategorie
`cat_debt`), `linkedItemId` verweist darauf. Nur wenn kein Posten verknüpft ist,
zieht die App `paymentMonthly` heran; dieser Betrag wirkt dann allein auf die
Tilgungsrechnung und **nicht** auf Budget und Saldo.

Der Tilgungsplan rechnet Monat für Monat:

```
Zins(Monat)    = Restschuld × interestPct / 100 / 12
Tilgung(Monat) = Rate − Zins
Restschuld     = Restschuld − Tilgung
```

Ist ein Kredit getilgt, lässt die App den verknüpften Posten in der Projektion
automatisch auslaufen — ein Enddatum am Posten ist dafür nicht nötig. Deckt die
Rate die Zinsen nicht, meldet die App das, statt endlos zu rechnen.

### `plans[]` — Szenarien

```jsonc
{
  "id": "pln_…",
  "name": "Karenz Robin",
  "active": false,          // Ansichtszustand; die App schaltet ihn selbst
  "note": "",
  "adjustments": [
    {
      "id": "adj_…",
      "label": "Einkommen Robin −65 %",
      "scope": "person",    // person | item | category | household | all | oneoff
      "targetId": "per_robin",
      "kind": "income",     // income | expense | both  (bei oneoff nur income/expense)
      "mode": "percent",    // percent | delta | set    (bei oneoff immer delta)
      "value": -65,
      "from": "2026-12",
      "to": "2027-11"       // null = unbefristet
    }
  ]
}
```

Wirkung der Modi:

- `percent` — betroffene Beträge werden mit `1 + value/100` multipliziert.
  Negative Werte senken.
- `delta` — bei `scope: "item"` wird der Betrag auf den Monatswert addiert; bei
  allen Gruppen-Bereichen entsteht stattdessen ein **zusätzlicher** Posten in
  Höhe von `|value|`.
- `set` — bei `scope: "item"` wird der Monatsbetrag gesetzt; bei Gruppen werden
  alle betroffenen Posten proportional auf die Zielsumme skaliert.
- `scope: "oneoff"` — ein einmaliges Ereignis. `targetId` ist hier der Träger
  (`"household"` oder eine Personen-ID), `value` der Betrag. Für ein einzelnes
  Ereignis `from` und `to` auf denselben Monat setzen.

### `fire`

```jsonc
{
  "startAssets": null,           // null = automatisch: Gesamtvermögen inkl. Investments
  "monthlyContribution": null,   // null = automatisch aus dem Haushaltssaldo
  "contributionGrowthPct": 0,
  "returnPct": null,             // null = automatisch: gewichtete Portfoliorendite
  "inflationPct": 2,
  "withdrawalPct": 3.5,
  "annualSpendOverride": null,   // null = aus dem Budget abgeleitet
  "spendFactor": 100,            // Ausgabenniveau im Ruhestand in % von heute
  "coastYears": 20,
  "maxYears": 60
}
```

Annahmen der Person — bei einem Datenimport nicht verändern. Bei `startAssets`,
`monthlyContribution` und `returnPct` bedeutet `null` jeweils „automatisch
ableiten"; ein gesetzter Wert überschreibt die Ableitung. Ohne Investments
fällt die automatische Rendite auf 6 % zurück.

---

## 3. Regeln, die du einhalten musst

Manches davon repariert die App beim Import stillschweigend, anderes nicht. Wo
sie repariert, tut sie es auf eine Weise, die du selten willst — verlass dich
nicht darauf.

**Wird still repariert (und dabei verfälscht):**

| Verstoß | Was die App daraus macht |
|---|---|
| `owner` zeigt auf eine nicht existierende Person | wird zu `"household"` |
| `categoryId` existiert nicht | wird zu `cat_salary` bzw. `cat_other` |
| `interval` unbekannt | wird zu `"monthly"` — ein Jahresbetrag zählt dann zwölffach |
| `growth` unvollständig oder ohne gültiges `from` | wird zu `null`, die Progression ist weg |
| `investments[].type` unbekannt | wird zu `"sonstiges"` |
| `debts[].type` unbekannt | wird zu `"other"` |
| `dueMonth` außerhalb 1–12 | wird zu `null`, die Fälligkeit ist weg |
| `linkedItemId` zeigt auf einen gelöschten Posten | wird auf `null` gesetzt |
| `kind` ist etwas anderes als `"income"` | wird zu `"expense"` |
| `amount` nicht als Zahl lesbar | wird zu `0` |

**Wird gar nicht geprüft — hier bist allein du verantwortlich:**

- **Doppelte IDs.** Eindeutigkeit wird nirgends erzwungen, Duplikate führen zu
  schwer auffindbaren Fehlern.
- **Kategorie passt nicht zur Art.** Ein Posten mit `kind: "expense"` und
  `categoryId: "cat_salary"` wird anstandslos übernommen und taucht dann als
  Ausgabe unter „Gehalt & Lohn" auf.
- **Negative Beträge.** `amount` muss positiv sein; die Richtung steckt
  ausschließlich in `kind`. Ein negativer Ausgabenbetrag senkt die Ausgaben.
  Dasselbe gilt für `currentValue` eines Investments.
- **Doppelt erfasstes Vermögen.** Ein Bestand gehört entweder in
  `household.assets` oder in `investments` — nie in beides.
- **Kreditraten doppelt.** Ist ein Posten als `linkedItemId` verknüpft, darf
  `paymentMonthly` nicht zusätzlich gesetzt sein — die App nimmt dann den Posten,
  der andere Wert ist nur verwirrend.
- **Rate unter dem Zins.** Ein Kredit, dessen Rate die Monatszinsen nicht deckt,
  tilgt sich nie. Die App meldet das, rechnet aber nicht dagegen an.
- **Doppelt belegte Sparpläne.** Hängt derselbe Posten an mehreren Investments,
  erscheint seine Rate bei jedem davon.
- **Szenario-Ziele.** Ein `targetId`, das ins Leere zeigt, wirkt einfach nicht.
- **`end` vor `start`** ergibt einen Posten, der nie zählt.
- **Datumsformate.** `date` ist `JJJJ-MM-TT`, alle Monatsfelder sind `JJJJ-MM`.

Vergib neue IDs nach dem Muster der App: `itm_`, `tx_`, `per_`, `cat_`, `pln_`,
`adj_` plus etwas Eindeutiges. Für maschinell erzeugte Einträge eignet sich ein
nachvollziehbares Schema wie `tx_import_2026-08_017`.

---

## 4. Datenimport aus fremden Quellen

### Der entscheidende Unterschied: Posten oder Buchung?

Notgroschen ist ein **Planungswerkzeug**, kein Kontobuch. Ein Kontoauszug
enthält beides durcheinander, und die Zuordnung ist die eigentliche Denkarbeit:

- **Wiederkehrend und vorhersehbar** → `items`, einmal angelegt, mit Intervall.
  Miete, Gehalt, Versicherungen, Abos, Leasingraten, Sparpläne.
- **Einmalig oder unregelmäßig** → `transactions`, mit Datum.
  Zahnarzt, Winterreifen, Steuerausgleich, Geschenke.

**Übernimm niemals einen Kontoauszug eins zu eins als Buchungen.** Zwölf
Mietabbuchungen als zwölf Transaktionen zu importieren, während schon ein Posten
„Miete" existiert, verdoppelt die Ausgaben in jedem betroffenen Monat.

Ein tragfähiges Vorgehen:

1. **Gruppieren.** Buchungen nach ähnlichem Verwendungszweck und ähnlichem
   Betrag zusammenfassen.
2. **Wiederkehrendes erkennen.** Eine Gruppe, die in mindestens drei
   aufeinanderfolgenden Monaten mit stabilem Betrag auftaucht, ist ein
   Kandidat für `items`. Vorschlagen, nicht einfach anlegen.
3. **Gegen Bestehendes abgleichen.** Existiert bereits ein Posten mit
   ähnlichem `label` und Betrag, ist die Buchung schon abgedeckt — verwerfen
   oder als Abweichung ausweisen.
4. **Der Rest** wird zu `transactions`.

### Vorzeichen

Kontoauszüge führen Ausgaben negativ. Beim Import:
`kind = betrag < 0 ? "expense" : "income"`, `amount = Math.abs(betrag)`.
Achte auf das Zahlenformat — `1.234,56` ist deutsch, `1,234.56` englisch.

### Träger zuordnen

`owner` lässt sich selten aus einem Kontoauszug ableiten. Sinnvolle Vorgaben:

- Gemeinschaftskonto → `"household"`
- Konto einer Person → deren `id`, aber gemeinsame Kosten wie Miete oder
  Lebensmittel trotzdem auf `"household"`, sonst stimmt der Verteilungsschlüssel
  nicht mehr.

Im Zweifel `"household"` setzen und in der Zusammenfassung darauf hinweisen,
statt zu raten.

### Doppelte vermeiden

Beim Nachimportieren gilt eine Buchung als bereits vorhanden, wenn `date`,
`amount` und `kind` übereinstimmen und die Bezeichnung sehr ähnlich ist. Solche
Einträge überspringen und im Bericht zählen.

### Was du berichten solltest

Nach jedem Import eine knappe Bilanz, damit die Person prüfen kann:

- wie viele Buchungen und Posten hinzugekommen sind
- wie viele als Duplikat übersprungen wurden
- welche Einträge du auf `cat_other` oder `"household"` setzen musstest, weil
  die Zuordnung unklar war
- wie sich monatliche Einnahmen, Ausgaben und Saldo dadurch verändern

---

## 5. Ergebnis prüfen

Im Repository liegt ein Prüfwerkzeug ohne Abhängigkeiten. Die App selbst
braucht kein Node — das Skript ist reines Werkzeug für diesen Zweck:

```
node tools/validate-daten.mjs pfad/zur/datei.json
```

Es meldet Struktur- und Verweisfehler, warnt bei fragwürdigen Kombinationen und
gibt eine Monatsbilanz aus. Exit-Code `0` heißt: die Datei ist importierbar.

Zwei Läufe nebeneinander zeigen, was deine Änderung bewirkt hat:

```
node tools/validate-daten.mjs original.json
node tools/validate-daten.mjs original.imported.json
```

**Liefere keine Datei aus, bei der das Skript Fehler meldet.** Warnungen darfst
du bewusst in Kauf nehmen, dann aber begründet im Bericht.

---

## 6. Was du nicht tun sollst

- Keine Personen, Posten oder Buchungen erfinden, die nicht in der Quelle
  stehen — auch nicht, um eine Lücke plausibel zu füllen.
- Bestehende Einträge nicht umkategorisieren, ohne es zu erwähnen. Die
  Zuordnung ist oft eine bewusste Entscheidung der Person.
- `settings`, `fire` und `plans` bei einem reinen Datenimport unangetastet
  lassen. Auch `investments` gehört nicht dazu: Aus einem Kontoauszug lässt sich
  kein Depotbestand ableiten — höchstens ein Sparplan-Posten, und der gehört
  nach `items`.
- Beträge nicht runden oder glätten. Übernimm sie so, wie sie in der Quelle
  stehen.
- Bei unklarer Zuordnung nicht raten, sondern eine nachvollziehbare Vorgabe
  setzen (`cat_other`, `"household"`) und im Bericht darauf hinweisen.

---

## 7. Minimalbeispiel

Eine gültige Datei mit zwei Personen, einem Posten und einer Buchung:

```json
{
  "schema": 1,
  "app": "notgroschen",
  "meta": {
    "name": "Unser Haushalt",
    "currency": "EUR",
    "created": "2026-08-17T10:00:00.000Z",
    "updated": "2026-08-17T10:00:00.000Z"
  },
  "settings": {
    "theme": "auto",
    "splitMode": "income",
    "startMonth": "2026-08",
    "projectionMonths": 60,
    "sankeyMode": "budget",
    "sankeyMinShare": 1.5
  },
  "household": { "budget": null, "assets": 0 },
  "people": [
    { "id": "per_a", "name": "Alex",  "colorIndex": 0, "budget": null, "sharePct": null, "note": "" },
    { "id": "per_b", "name": "Robin", "colorIndex": 1, "budget": null, "sharePct": null, "note": "" }
  ],
  "categories": [
    { "id": "cat_salary",  "name": "Gehalt & Lohn", "kind": "income",  "system": true },
    { "id": "cat_housing", "name": "Wohnen",        "kind": "expense", "system": true },
    { "id": "cat_other",   "name": "Sonstiges",     "kind": "expense", "system": true }
  ],
  "items": [
    {
      "id": "itm_1", "label": "Gehalt (netto)", "amount": 2900, "interval": "monthly",
      "kind": "income", "owner": "per_a", "categoryId": "cat_salary",
      "start": null, "end": null, "active": true, "note": ""
    }
  ],
  "transactions": [
    {
      "id": "tx_1", "date": "2026-08-11", "label": "Winterreifen", "amount": 480,
      "kind": "expense", "owner": "household", "categoryId": "cat_other", "note": ""
    }
  ],
  "investments": [
    {
      "id": "inv_1", "label": "MSCI World ETF", "type": "etf", "owner": "household",
      "currentValue": 21400, "costBasis": 18200, "expectedReturnPct": 6.5,
      "linkedItemId": null, "provider": "Depotbank", "note": ""
    }
  ],
  "plans": [],
  "fire": {
    "startAssets": null, "monthlyContribution": null, "contributionGrowthPct": 0,
    "returnPct": null, "inflationPct": 2, "withdrawalPct": 3.5,
    "annualSpendOverride": null, "spendFactor": 100, "coastYears": 20, "maxYears": 60
  }
}
```

Werden nur die drei Standardkategorien mitgegeben, ersetzt die App beim Import
**nichts** — sie übernimmt genau diese Liste. Möchtest du den vollen
Kategoriensatz, gib ihn vollständig mit oder lass `categories` weg; ein leeres
oder fehlendes `categories` füllt die App mit ihren Vorgaben.

---

## 8. Rechenmodell in Kurzform

Damit du eine Änderung im Kopf nachvollziehen kannst:

```
Monatsbetrag(Posten)  = amount × Faktor(interval) × Progressionsfaktor(Monat)
                                                           nur wenn active
                                                           und Monat in [start, end]
Netto-Haushaltskosten = Haushaltsausgaben − Haushaltseinnahmen
Anteil(Person)        = Netto-Haushaltskosten × Schlüssel(Person)
Bleibt übrig(Person)  = Einnahmen − eigene Ausgaben − Anteil

Monatssaldo           = Einnahmen − Ausgaben   (= Summe aller „Bleibt übrig")
Sparquote             = (Monatssaldo + Sparbeiträge) ÷ Einnahmen
```

„Sparbeiträge" sind alle Ausgabenposten in Kategorien mit `"saving": true`.

Für die Vermögensseite:

```
Gesamtvermögen    = household.assets + Σ investments[].currentValue
Nettovermögen     = Gesamtvermögen − Σ debts[].balance
Liquide Mittel    = household.assets + Σ investments mit liquid = true
Notgroschen       = Liquide Mittel ÷ (Monatsausgaben − Sparbeiträge)
Gewinn            = Σ currentValue − Σ costBasis   (nur Positionen mit costBasis)
Portfoliorendite  = Σ (currentValue × expectedReturnPct) ÷ Σ currentValue
                    (nur Positionen mit gesetzter Renditeerwartung)
```

Der Schlüssel folgt `settings.splitMode`: proportional zum Einkommen, zu
gleichen Teilen, oder nach `people[].sharePct` (auf 100 % normalisiert).
