/* ---------------------------------------------------------------------------
   views/dashboard.js — Übersicht: Kennzahlen, Budgets, Sankey, Kategorien,
                        Zwölfmonatsverlauf
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  // Ansichtszustand — überlebt Neuzeichnen, wandert nicht in die Datei.
  var view = {
    month: null,
    withTransactions: true,
    activePlans: {}
  };

  function selectedPlans() {
    return S.state.plans.filter(function (p) { return view.activePlans[p.id]; });
  }

  function render(root) {
    var state = S.state;
    if (!view.month) view.month = U.monthKey();

    var plans = selectedPlans();
    var opts = { plans: plans, includeTransactions: view.withTransactions };
    var sum = C.monthSummary(state, view.month, opts);

    root.appendChild(head(state));
    root.appendChild(filterbar(state));

    if (!state.items.length && !state.transactions.length) {
      root.appendChild(ui.card({
        body: ui.emptyState(
          'Noch keine Daten erfasst',
          'Lege zuerst die Personen des Haushalts an und trage danach die wiederkehrenden Posten ein. Oder starte mit dem Beispielhaushalt unter „Daten“.',
          U.el('div', { class: 'inline-actions', style: { justifyContent: 'center' } }, [
            U.el('button', {
              class: 'btn btn-primary', text: 'Beispielhaushalt laden',
              onclick: function () { S.loadDemo(); ui.toast('Beispielhaushalt geladen.'); }
            }),
            U.el('button', {
              class: 'btn', text: 'Zu den Personen',
              onclick: function () { HB.app.go('people'); }
            })
          ])
        )
      }));
      return;
    }

    root.appendChild(kpis(sum));
    root.appendChild(budgets(state, sum));
    root.appendChild(sankeySection(state, sum));

    root.appendChild(U.el('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, [
      categorySection(state, sum),
      trendSection(state, plans)
    ]));
  }

  /* --- Kopf & Filter ------------------------------------------------------ */

  function head(state) {
    return U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: state.meta.name || 'Haushalt' }),
        U.el('p', {
          class: 'lede',
          text: 'Alle Beträge auf Monatsbasis normalisiert. Jährliche und quartalsweise Posten sind anteilig eingerechnet.'
        })
      ]),
      U.el('div', { class: 'inline-actions' }, [
        U.el('button', {
          class: 'btn btn-sm', text: 'Posten erfassen',
          onclick: function () { HB.app.go('items', { create: true }); }
        })
      ])
    ]);
  }

  function filterbar(state) {
    var bar = U.el('div', { class: 'filterbar' });

    bar.appendChild(ui.field('Monat',
      ui.monthInput(view.month, {
        onchange: function (e) { view.month = e.target.value || U.monthKey(); HB.app.repaint(); }
      })
    ));

    bar.appendChild(ui.field('Einzelbuchungen',
      U.el('label', { class: 'checkline' }, [
        U.el('input', {
          type: 'checkbox', checked: view.withTransactions,
          onchange: function (e) { view.withTransactions = e.target.checked; HB.app.repaint(); }
        }),
        U.el('span', { text: 'des Monats mitzählen' })
      ])
    ));

    if (state.plans.length) {
      var chips = U.el('div', { class: 'chips' }, state.plans.map(function (p) {
        return U.el('button', {
          class: 'chip', type: 'button',
          'aria-pressed': view.activePlans[p.id] ? 'true' : 'false',
          text: p.name,
          onclick: function () {
            view.activePlans[p.id] = !view.activePlans[p.id];
            HB.app.repaint();
          }
        });
      }));
      bar.appendChild(ui.field('Szenarien', chips, 'Wirken auf alle Auswertungen dieser Seite'));
    }

    bar.appendChild(U.el('div', { class: 'spacer' }));
    bar.appendChild(U.el('div', { class: 'small muted', text: U.monthLabel(view.month, 'long') }));
    return bar;
  }

  /* --- Kennzahlen --------------------------------------------------------- */

  function kpis(s) {
    var grid = U.el('div', { class: 'grid grid-4' });

    grid.appendChild(ui.stat({
      label: 'Einnahmen gesamt',
      value: U.currency(s.income, { digits: 0 }),
      sub: U.el('span', {}, [
        'davon Haushalt ' + U.currency(s.household.income, { digits: 0 })
      ])
    }));

    grid.appendChild(ui.stat({
      label: 'Ausgaben gesamt',
      value: U.currency(s.expense, { digits: 0 }),
      sub: U.el('span', {}, [
        'davon Sparbeiträge ' + U.currency(s.savingContrib, { digits: 0 })
      ])
    }));

    grid.appendChild(ui.stat({
      label: 'Monatssaldo',
      value: U.currency(s.net, { digits: 0, sign: true }),
      hero: true,
      tone: ui.toneClass(s.net),
      sub: s.net >= 0 ? 'bleibt frei verfügbar' : 'Deckungslücke im Monat'
    }));

    grid.appendChild(ui.stat({
      label: 'Sparquote',
      value: U.pct(s.savingsRate, 1),
      tone: s.savingsRate >= 0.15 ? 'num-pos' : s.savingsRate < 0 ? 'num-neg' : '',
      sub: 'Saldo + Sparbeiträge, gemessen an den Einnahmen'
    }));

    return grid;
  }

  /* --- Budgets ------------------------------------------------------------ */

  function budgets(state, s) {
    var wrap = U.el('div', {});
    wrap.appendChild(U.el('div', { class: 'section-title', text: 'Budgets' }));

    var cards = U.el('div', { class: 'grid grid-auto' });

    cards.appendChild(emergencyCard(state));

    // Haushalt
    cards.appendChild(ui.card({
      title: 'Haushalt (gemeinsam)',
      sub: 'Verteilungsschlüssel: ' + splitLabel(state),
      body: U.el('div', {}, [
        U.el('div', { class: 'stack' }, [
          miniRow('Einnahmen', s.household.income),
          miniRow('Ausgaben', s.household.expense),
          miniRow('Von den Personen zu tragen', s.householdNetCost),
          miniRow('Gesamtvermögen', C.totalAssets(state)),
          C.totalDebt(state) ? miniRow('Schulden', -C.totalDebt(state), true) : null,
          C.totalDebt(state) ? miniRow('Nettovermögen', C.netWorth(state), true) : null
        ]),
        state.household.budget
          ? ui.meter({ used: s.household.expense, budget: state.household.budget, label: 'Haushaltsbudget' })
          : U.el('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Kein Haushaltsbudget hinterlegt.' })
      ])
    }));

    state.people.forEach(function (p) {
      var b = s.byPerson[p.id];
      if (!b) return;
      cards.appendChild(ui.card({
        title: p.name,
        sub: 'trägt ' + U.pct(b.share, 0) + ' der Haushaltskosten',
        actions: [U.el('span', { class: 'dot', style: { background: S.ownerColor(p.id) } })],
        body: U.el('div', {}, [
          U.el('div', { class: 'stack' }, [
            miniRow('Einnahmen', b.income),
            miniRow('Eigene Ausgaben', b.expense),
            miniRow('Anteil Haushaltskosten', b.householdShare),
            miniRow('Bleibt übrig', b.personalNet, true)
          ]),
          p.budget
            ? ui.meter({ used: b.expense, budget: p.budget, label: 'Persönliches Budget' })
            : U.el('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Kein persönliches Budget hinterlegt.' })
        ])
      }));
    });

    wrap.appendChild(cards);
    return wrap;
  }

  /**
   * Der Notgroschen — die Kennzahl, nach der die App benannt ist: Wie lange
   * tragen die sofort verfügbaren Mittel die Ausgaben ohne Einkommen?
   */
  function emergencyCard(state) {
    // Bewusst ohne die Einmalbuchungen des Monats: Eine einzelne Anschaffung
    // verkürzt die Reichweite nicht dauerhaft. Maßstab sind die laufenden Kosten.
    var e = C.emergencyFund(state, { plans: selectedPlans(), month: view.month });
    var reached = e.months != null && e.months >= e.targetMonths;

    return ui.card({
      title: 'Notgroschen',
      sub: 'Reichweite ohne Einkommen',
      actions: [
        U.el('span', {
          class: 'badge ' + (reached ? 'pos' : e.months != null && e.months >= e.targetMonths / 2 ? 'warn' : 'neg'),
          text: e.months == null ? 'keine Ausgaben' : U.num(e.months, 1) + ' Monate'
        })
      ],
      body: U.el('div', {}, [
        U.el('div', { class: 'stack' }, [
          miniRow('Sofort verfügbar', e.available),
          miniRow('Monatlicher Bedarf', e.burn),
          miniRow('Ziel: ' + U.num(e.targetMonths, 0) + ' Monate', e.targetAmount)
        ]),
        ui.meter({
          used: Math.min(e.available, e.targetAmount),
          budget: e.targetAmount || 1,
          mode: 'progress',
          label: 'Fortschritt zum Notgroschen'
        }),
        U.el('p', { class: 'small muted', style: { marginTop: '10px' } }, [
          reached
            ? 'Ziel erreicht. Sparbeiträge sind nicht eingerechnet — die würde man in einer solchen Lage aussetzen.'
            : 'Es fehlen ' + U.currency(Math.max(0, e.gap), { digits: 0 }) +
              '. Kreditraten laufen weiter und sind im Bedarf enthalten.'
        ])
      ])
    });
  }

  function miniRow(label, value, tone) {
    return U.el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
      U.el('span', { class: 'small muted', text: label }),
      U.el('span', {
        class: 'small' + (tone ? ' ' + ui.toneClass(value) : ''),
        style: { fontVariantNumeric: 'tabular-nums', fontWeight: '600' },
        text: U.currency(value, { digits: 0, sign: tone })
      })
    ]);
  }

  function splitLabel(state) {
    return { income: 'nach Einkommen', equal: 'zu gleichen Teilen', custom: 'individuell' }
      [state.settings.splitMode] || 'nach Einkommen';
  }

  /* --- Sankey ------------------------------------------------------------- */

  function sankeySection(state, s) {
    var wrap = U.el('div', {});
    wrap.appendChild(U.el('div', { class: 'section-title', text: 'Geldflüsse' }));

    var modeSel = ui.select([
      { value: 'budget', label: 'über das Gesamtbudget' },
      { value: 'direct', label: 'direkt je Person' }
    ], state.settings.sankeyMode, function (v) {
      S.update(function (st) { st.settings.sankeyMode = v; }, 'settings');
    });

    var minSel = ui.select([
      { value: '0', label: 'alle Kategorien' },
      { value: '1.5', label: 'ab 1,5 % bündeln' },
      { value: '3', label: 'ab 3 % bündeln' },
      { value: '5', label: 'ab 5 % bündeln' }
    ], String(state.settings.sankeyMinShare), function (v) {
      S.update(function (st) { st.settings.sankeyMinShare = parseFloat(v); }, 'settings');
    });

    function graph() {
      return C.sankeyGraph(state, s, {
        mode: state.settings.sankeyMode,
        minShare: state.settings.sankeyMinShare
      });
    }

    var g = graph();

    wrap.appendChild(ui.chartCard({
      title: 'Wohin fließt das Geld?',
      sub: U.monthLabel(view.month, 'long') + ' · Einnahmen ' + U.currency(s.income, { digits: 0 }) +
        (s.net < 0 ? ' · Deckungslücke ' + U.currency(-s.net, { digits: 0 }) : ''),
      actions: [modeSel, minSel],
      chart: function () { return HB.sankey.render(g, { total: s.income }); },
      table: function () { return HB.sankey.table(g); },
      foot: s.net < 0
        ? 'Die Ausgaben übersteigen die Einnahmen um ' + U.currency(-s.net, { digits: 0 }) +
          '. Die Differenz wird aus dem Vermögen gedeckt und erscheint nicht als Fluss.'
        : 'Jede Bahnbreite entspricht dem Monatsbetrag. Zeigt die Maus auf eine Bahn, wird der Fluss hervorgehoben.'
    }));

    return wrap;
  }

  /* --- Kategorien --------------------------------------------------------- */

  function categorySection(state, s) {
    var rows = Object.keys(s.expenseByCategory).map(function (id) {
      return { id: id, name: S.categoryName(id), value: s.expenseByCategory[id] };
    }).sort(function (a, b) { return b.value - a.value; });

    var total = U.sum(rows, function (r) { return r.value; });

    var body = rows.length
      ? U.el('div', { class: 'table-wrap' }, [
          U.el('table', { class: 'tbl' }, [
            U.el('thead', {}, U.el('tr', {}, [
              U.el('th', { text: 'Kategorie' }),
              U.el('th', { class: 'num', text: 'pro Monat' }),
              U.el('th', { class: 'num', text: 'pro Jahr' }),
              U.el('th', { class: 'num', text: 'Anteil' })
            ])),
            U.el('tbody', {}, rows.map(function (r) {
              return U.el('tr', {
                class: 'is-clickable',
                tabindex: '0',
                title: 'Einzelposten von „' + r.name + '“ anzeigen',
                onclick: function () { categoryDetail(state, s, r.id); },
                onkeydown: function (e) {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    categoryDetail(state, s, r.id);
                  }
                }
              }, [
                U.el('td', {}, [
                  C.isSavingCategory(state, r.id)
                    ? U.el('span', { class: 'badge pos', text: 'Sparen' })
                    : null,
                  U.el('span', { text: (C.isSavingCategory(state, r.id) ? ' ' : '') + r.name }),
                  U.el('span', { class: 'row-chevron', text: ' ›' })
                ]),
                U.el('td', { class: 'num', text: U.currency(r.value, { digits: 0 }) }),
                U.el('td', { class: 'num', text: U.currency(r.value * 12, { digits: 0 }) }),
                U.el('td', { class: 'num', text: U.pct(r.value / total, 1) })
              ]);
            })),
            U.el('tfoot', {}, U.el('tr', {}, [
              U.el('td', { text: 'Summe' }),
              U.el('td', { class: 'num', text: U.currency(total, { digits: 0 }) }),
              U.el('td', { class: 'num', text: U.currency(total * 12, { digits: 0 }) }),
              U.el('td', { class: 'num', text: '100 %' })
            ]))
          ])
        ])
      : ui.emptyState('Keine Ausgaben', 'Für diesen Monat sind keine Ausgaben erfasst.');

    return ui.card({
      title: 'Ausgaben nach Kategorie',
      sub: 'inkl. anteiliger Jahres- und Quartalsposten',
      raw: body,
      foot: rows.length ? 'Eine Zeile anklicken zeigt die Einzelposten dahinter.' : null
    });
  }

  /* --- Aufschlüsselung einer Kategorie ------------------------------------- */

  /**
   * Zeigt alle Einzelposten hinter einem Kategoriebetrag der Übersicht —
   * wiederkehrende Posten, Einzelbuchungen und Szenario-Effekte gemeinsam,
   * absteigend nach Anteil. Nur so entspricht die Summe exakt der angeklickten
   * Zahl; eine reine Postenliste würde Buchungen unterschlagen.
   */
  function categoryDetail(state, sum, catId) {
    var flows = sum.flows
      .filter(function (f) { return f.kind === 'expense' && f.categoryId === catId; })
      .slice()
      .sort(function (a, b) { return b.amount - a.amount; });

    var catTotal = U.sum(flows, function (f) { return f.amount; });
    var isSaving = C.isSavingCategory(state, catId);

    var SOURCE = {
      recurring: { label: 'Posten', cls: '' },
      transaction: { label: 'Buchung', cls: 'info' },
      plan: { label: 'Szenario', cls: 'warn' }
    };

    var body = U.el('div', {}, [
      U.el('div', { class: 'grid grid-3', style: { marginBottom: '14px' } }, [
        ui.stat({
          label: 'Pro Monat', value: U.currency(catTotal, { digits: 0 }),
          sub: U.currency(catTotal * 12, { digits: 0 }) + ' pro Jahr'
        }),
        ui.stat({
          label: 'Anteil an allen Ausgaben',
          value: sum.expense ? U.pct(catTotal / sum.expense, 1) : '—',
          sub: 'von ' + U.currency(sum.expense, { digits: 0 })
        }),
        ui.stat({
          label: 'Einzelposten', value: String(flows.length),
          sub: isSaving ? 'zählt als Vermögensaufbau' : U.monthLabel(view.month, 'long')
        })
      ]),
      U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Bezeichnung' }),
            U.el('th', { text: 'Träger' }),
            U.el('th', { text: 'Herkunft' }),
            U.el('th', { class: 'num', text: 'pro Monat' }),
            U.el('th', { class: 'num', text: 'Anteil' })
          ])),
          U.el('tbody', {}, flows.map(function (f) {
            var src = SOURCE[f.source] || SOURCE.recurring;
            return U.el('tr', {}, [
              U.el('td', { text: f.label }),
              U.el('td', {}, ui.personSwatch(f.owner)),
              U.el('td', {}, U.el('span', {
                class: 'badge' + (src.cls ? ' ' + src.cls : ''), text: src.label
              })),
              U.el('td', { class: 'num', text: U.currency(f.amount, { digits: 2 }) }),
              U.el('td', { class: 'num', text: catTotal ? U.pct(f.amount / catTotal, 1) : '—' })
            ]);
          })),
          U.el('tfoot', {}, U.el('tr', {}, [
            U.el('td', { colspan: 3, text: 'Summe' }),
            U.el('td', { class: 'num', text: U.currency(catTotal, { digits: 2 }) }),
            U.el('td', { class: 'num', text: '100 %' })
          ]))
        ])
      ])
    ]);

    ui.openModal({
      title: S.categoryName(catId),
      wide: true,
      body: body,
      actions: [
        {
          label: 'Wiederkehrende Posten öffnen', variant: 'btn-ghost',
          onClick: function (close) {
            close();
            HB.app.go('items', { category: catId, kind: 'expense' });
          }
        },
        { label: 'Schließen', variant: 'btn-primary' }
      ]
    });
  }

  /* --- Zwölfmonatsverlauf ------------------------------------------------- */

  function trendSection(state, plans) {
    var from = U.addMonths(view.month, -2);
    var rows = C.project(state, {
      from: from, months: 12, plans: plans,
      includeTransactions: view.withTransactions,
      startAssets: state.household.assets || 0
    });

    var labels = rows.map(function (r) { return U.monthLabel(r.key, 'tiny'); });
    var series = [
      { name: 'Einnahmen', color: U.token('--series-3'), values: rows.map(function (r) { return r.income; }) },
      { name: 'Ausgaben', color: U.token('--series-2'), values: rows.map(function (r) { return r.expense; }) }
    ];

    return ui.chartCard({
      title: 'Verlauf über zwölf Monate',
      sub: 'ab ' + U.monthLabel(from, 'long') + ', mit den ausgewählten Szenarien',
      chart: function () {
        return HB.charts.line({
          labels: labels, series: series, height: 260, width: 640,
          valueFormat: function (v) { return U.currency(v, { digits: 0 }); },
          tooltipTitle: function (i) { return U.monthLabel(rows[i].key, 'long'); },
          ariaLabel: 'Einnahmen und Ausgaben über zwölf Monate'
        });
      },
      legend: function () { return HB.charts.legend(series); },
      table: function () {
        return HB.charts.seriesTable(
          rows.map(function (r) { return U.monthLabel(r.key); }),
          series.concat([{ name: 'Saldo', values: rows.map(function (r) { return r.net; }) }]),
          function (v) { return U.currency(v, { digits: 0 }); }
        );
      }
    });
  }

  HB.views.dashboard = { render: render, view: view };
})(window.HB);
