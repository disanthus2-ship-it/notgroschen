/* ---------------------------------------------------------------------------
   report.js — Monats- und Jahresbericht zum Ausdrucken

   Ein PDF entsteht hier nicht durch eine Bibliothek, sondern durch den
   Druckdialog des Browsers („Als PDF sichern“). Das hält die App abhängigkeits-
   frei und liefert trotzdem eine Datei, die man ablegen oder herschicken kann.

   Der Bericht wird in einen eigenen Container gebaut. Beim Drucken blendet
   `@media print` alles andere aus und schaltet auf die Druckfarben aus
   tokens.css um — Papier ist ein anderes Medium als ein Bildschirm.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store;

  var root = null;

  function ensureRoot() {
    if (root) return root;
    root = document.getElementById('printRoot');
    if (!root) {
      root = U.el('div', { id: 'printRoot', class: 'print-root' });
      document.body.appendChild(root);
    }
    return root;
  }

  /* --- Bausteine ---------------------------------------------------------- */

  function head(title, sub) {
    return U.el('header', { class: 'print-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: title }),
        U.el('p', { class: 'print-sub', text: sub })
      ]),
      U.el('div', { class: 'print-brand' }, [
        U.el('strong', { text: 'Notgroschen' }),
        U.el('div', { text: S.state.meta.name || 'Haushalt' })
      ])
    ]);
  }

  function section(title, node) {
    return U.el('section', { class: 'print-section' }, [
      U.el('h2', { text: title }),
      node
    ]);
  }

  /** Kennzahlenzeile — im Druck genügen Zahl und Beschriftung. */
  function figures(list) {
    return U.el('div', { class: 'print-figures' }, list.filter(Boolean).map(function (f) {
      return U.el('div', { class: 'print-figure' }, [
        U.el('div', { class: 'print-figure-label', text: f.label }),
        U.el('div', { class: 'print-figure-value', text: f.value }),
        f.sub ? U.el('div', { class: 'print-figure-sub', text: f.sub }) : null
      ]);
    }));
  }

  function table(cols, rows, foot) {
    return U.el('table', { class: 'print-table' }, [
      U.el('thead', {}, U.el('tr', {}, cols.map(function (c) {
        return U.el('th', { class: c.num ? 'num' : '', text: c.label });
      }))),
      U.el('tbody', {}, rows.map(function (r) {
        return U.el('tr', {}, r.map(function (cell, i) {
          var c = cols[i];
          return U.el('td', {
            class: (c && c.num ? 'num ' : '') + (cell && cell.cls ? cell.cls : ''),
            text: cell && cell.text != null ? cell.text : String(cell == null ? '' : cell)
          });
        }));
      })),
      foot ? U.el('tfoot', {}, U.el('tr', {}, foot.map(function (cell, i) {
        var c = cols[i];
        return U.el('td', { class: c && c.num ? 'num' : '', text: String(cell == null ? '' : cell) });
      }))) : null
    ]);
  }

  function money(v) { return U.currency(v, { digits: 0 }); }
  function signed(v) { return U.currency(v, { digits: 0, sign: true }); }

  /* --- Monatsbericht ------------------------------------------------------- */

  function monthReport(state, key, opts) {
    opts = opts || {};
    var plans = opts.plans || [];
    var sum = C.monthSummary(state, key, { plans: plans, includeTransactions: true });
    var budgets = C.budgetSummary(state, sum);
    var page = U.el('div', { class: 'print-page' });

    page.appendChild(head('Monatsbericht ' + U.monthLabel(key, 'long'),
      'Erstellt am ' + new Date().toLocaleDateString('de-AT') +
      (plans.length ? ' · mit ' + plans.length + ' aktiven Szenarien' : '')));

    page.appendChild(figures([
      { label: 'Einnahmen', value: money(sum.income) },
      { label: 'Ausgaben', value: money(sum.expense) },
      { label: 'Saldo', value: signed(sum.net) },
      { label: 'Sparquote', value: U.pct(sum.savingsRate, 1),
        sub: money(sum.savingsTotal) + ' zurückgelegt' }
    ]));

    /* Personen */
    var people = state.people.map(function (p) {
      var b = sum.byPerson[p.id];
      return [
        p.name, money(b.income), money(b.expense), money(b.householdShare),
        { text: signed(b.personalNet), cls: b.personalNet < 0 ? 'neg' : '' }
      ];
    });
    if (people.length) {
      page.appendChild(section('Nach Person', table([
        { label: 'Person' }, { label: 'Einnahmen', num: true }, { label: 'eigene Ausgaben', num: true },
        { label: 'Anteil Haushalt', num: true }, { label: 'Bleibt übrig', num: true }
      ], people, [
        'Haushalt gemeinsam', money(sum.household.income), money(sum.household.expense),
        money(sum.householdNetCost), ''
      ])));
    }

    /* Kategorien mit Budget */
    var catRows = Object.keys(sum.expenseByCategory).map(function (id) {
      return { id: id, name: S.categoryName(id), value: sum.expenseByCategory[id] };
    }).sort(function (a, b) { return b.value - a.value; });

    var byId = {};
    budgets.list.forEach(function (b) { byId[b.id] = b; });

    page.appendChild(section('Ausgaben nach Kategorie', table([
      { label: 'Kategorie' }, { label: 'Betrag', num: true }, { label: 'Anteil', num: true },
      { label: 'Budget', num: true }, { label: 'Abweichung', num: true }
    ], catRows.map(function (r) {
      var b = byId[r.id];
      return [
        r.name, money(r.value),
        sum.expense ? U.pct(r.value / sum.expense, 1) : '—',
        b ? money(b.budget) : '—',
        b ? { text: signed(b.left), cls: b.over ? 'neg' : '' } : '—'
      ];
    }), ['Summe', money(sum.expense), '100 %',
      budgets.count ? money(budgets.total) : '—',
      budgets.count ? signed(budgets.total - budgets.used) : '—'])));

    /* Buchungen des Monats */
    var tx = state.transactions.filter(function (t) { return U.monthOfISO(t.date) === key; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (tx.length) {
      page.appendChild(section('Einzelbuchungen', table([
        { label: 'Datum' }, { label: 'Bezeichnung' }, { label: 'Träger' },
        { label: 'Kategorie' }, { label: 'Betrag', num: true }
      ], tx.map(function (t) {
        return [
          new Date(t.date).toLocaleDateString('de-AT'), t.label, S.ownerName(t.owner),
          S.categoryName(t.categoryId),
          { text: (t.kind === 'income' ? '+' : '−') + money(t.amount), cls: t.kind === 'income' ? '' : 'neg' }
        ];
      }))));
    }

    page.appendChild(balanceSection(state));
    page.appendChild(footNote());
    return page;
  }

  /* --- Jahresbericht ------------------------------------------------------- */

  function yearReport(state, year, opts) {
    opts = opts || {};
    var plans = opts.plans || [];
    var page = U.el('div', { class: 'print-page' });

    var months = [];
    for (var m = 1; m <= 12; m++) months.push(year + '-' + U.pad2(m));

    var sums = months.map(function (key) {
      return { key: key, s: C.monthSummary(state, key, { plans: plans, includeTransactions: true }) };
    });

    var income = U.sum(sums, function (x) { return x.s.income; });
    var expense = U.sum(sums, function (x) { return x.s.expense; });
    var saving = U.sum(sums, function (x) { return x.s.savingContrib; });

    page.appendChild(head('Jahresbericht ' + year,
      'Erstellt am ' + new Date().toLocaleDateString('de-AT') +
      (plans.length ? ' · mit ' + plans.length + ' aktiven Szenarien' : '')));

    page.appendChild(figures([
      { label: 'Einnahmen', value: money(income), sub: money(income / 12) + ' im Schnitt' },
      { label: 'Ausgaben', value: money(expense), sub: money(expense / 12) + ' im Schnitt' },
      { label: 'Saldo', value: signed(income - expense) },
      { label: 'Sparquote', value: income > 0 ? U.pct((income - expense + saving) / income, 1) : '—',
        sub: money(income - expense + saving) + ' zurückgelegt' }
    ]));

    page.appendChild(section('Monatsverlauf', table([
      { label: 'Monat' }, { label: 'Einnahmen', num: true }, { label: 'Ausgaben', num: true },
      { label: 'Saldo', num: true }, { label: 'Sparquote', num: true }
    ], sums.map(function (x) {
      return [
        U.monthLabel(x.key), money(x.s.income), money(x.s.expense),
        { text: signed(x.s.net), cls: x.s.net < 0 ? 'neg' : '' },
        x.s.income > 0 ? U.pct(x.s.savingsRate, 0) : '—'
      ];
    }), ['Summe', money(income), money(expense), signed(income - expense),
      income > 0 ? U.pct((income - expense + saving) / income, 1) : '—'])));

    /* Personen über das Jahr */
    if (state.people.length) {
      var perPerson = state.people.map(function (p) {
        var inc = 0, exp = 0, share = 0, left = 0;
        sums.forEach(function (x) {
          var b = x.s.byPerson[p.id];
          inc += b.income; exp += b.expense; share += b.householdShare; left += b.personalNet;
        });
        return [p.name, money(inc), money(exp), money(share),
          { text: signed(left), cls: left < 0 ? 'neg' : '' }];
      });
      page.appendChild(section('Nach Person', table([
        { label: 'Person' }, { label: 'Einnahmen', num: true }, { label: 'eigene Ausgaben', num: true },
        { label: 'Anteil Haushalt', num: true }, { label: 'Bleibt übrig', num: true }
      ], perPerson)));
    }

    /* Kategorien über das Jahr */
    var byCat = {};
    sums.forEach(function (x) {
      Object.keys(x.s.expenseByCategory).forEach(function (id) {
        byCat[id] = (byCat[id] || 0) + x.s.expenseByCategory[id];
      });
    });
    var catRows = Object.keys(byCat).map(function (id) {
      var cat = U.byId(state.categories, id);
      return {
        name: S.categoryName(id), value: byCat[id],
        budget: cat && cat.budget != null ? Number(cat.budget) * 12 : null
      };
    }).sort(function (a, b) { return b.value - a.value; });

    page.appendChild(section('Ausgaben nach Kategorie', table([
      { label: 'Kategorie' }, { label: 'Jahressumme', num: true }, { label: 'pro Monat', num: true },
      { label: 'Anteil', num: true }, { label: 'Jahresbudget', num: true }, { label: 'Abweichung', num: true }
    ], catRows.map(function (r) {
      return [
        r.name, money(r.value), money(r.value / 12),
        expense ? U.pct(r.value / expense, 1) : '—',
        r.budget == null ? '—' : money(r.budget),
        r.budget == null ? '—' : { text: signed(r.budget - r.value), cls: r.value > r.budget ? 'neg' : '' }
      ];
    }), ['Summe', money(expense), money(expense / 12), '100 %', '', ''])));

    page.appendChild(balanceSection(state));
    page.appendChild(footNote());
    return page;
  }

  /* --- Gemeinsame Abschnitte ---------------------------------------------- */

  function balanceSection(state) {
    var inv = C.investmentSummary(state);
    var other = Number(state.household.assets) || 0;
    var debt = C.totalDebt(state);
    var emergency = C.emergencyFund(state, {});

    var rows = [
      ['Sonstiges Vermögen (Konto, Bargeld)', money(other)],
      ['Investments (' + inv.count + ')', money(inv.total)],
      ['Schulden', { text: debt ? money(-debt) : '—', cls: debt ? 'neg' : '' }],
      ['Nettovermögen', money(other + inv.total - debt)]
    ];
    if (emergency.months != null) {
      rows.push(['Notgroschen', U.num(emergency.months, 1) + ' Monatsausgaben (Ziel ' +
        emergency.targetMonths + ')']);
    }

    return section('Vermögensstand', table(
      [{ label: 'Position' }, { label: 'Betrag', num: true }], rows
    ));
  }

  function footNote() {
    return U.el('p', { class: 'print-foot' }, [
      'Erstellt mit Notgroschen — lokale Haushaltsplanung. Alle Beträge in Euro. ' +
      'Wiederkehrende Posten sind auf den Monat umgerechnet; Jahres- und Quartalsbeträge ' +
      'erscheinen daher anteilig, nicht im Fälligkeitsmonat.'
    ]);
  }

  /* --- Drucken ------------------------------------------------------------ */

  /**
   * Baut den Bericht und öffnet den Druckdialog. Aufgeräumt wird erst nach dem
   * Druck: Solange der Dialog offen ist, muss der Inhalt im Dokument stehen.
   */
  function print(o) {
    var state = S.state;
    var container = ensureRoot();
    U.clear(container);

    var page = o.kind === 'year'
      ? yearReport(state, o.key, o)
      : monthReport(state, o.key, o);
    container.appendChild(page);

    var title = document.title;
    document.title = (o.kind === 'year' ? 'Jahresbericht-' : 'Monatsbericht-') +
      (state.meta.name || 'Haushalt').replace(/[^\wäöüÄÖÜß]+/g, '-') + '-' + o.key;

    document.body.classList.add('is-printing');

    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      document.body.classList.remove('is-printing');
      document.title = title;
      U.clear(container);
      window.removeEventListener('afterprint', cleanup);
    }
    // Zweifach abgesichert: `window.print()` blockiert zwar bis zum Schließen
    // des Dialogs, aber wenn ein Browser das anders hält, räumt `afterprint`
    // auf. Bliebe die Klasse stehen, wäre die ganze App unsichtbar.
    window.addEventListener('afterprint', cleanup);

    // Ein Tick, damit der Browser das eingefügte DOM vor dem Dialog layoutet.
    setTimeout(function () {
      try { window.print(); } finally { setTimeout(cleanup, 400); }
    }, 60);
  }

  HB.report = { print: print, monthReport: monthReport, yearReport: yearReport };
})(window.HB);
