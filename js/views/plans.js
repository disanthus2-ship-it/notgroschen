/* ---------------------------------------------------------------------------
   views/plans.js — Zukunftsaussicht und Szenarien
   Ein Szenario bündelt zeitlich begrenzte Anpassungen (z. B. Karenz, Teilzeit,
   größere Anschaffungen) und lässt sich gegen die Basis vergleichen.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  // real = in heutiger Kaufkraft. Vorgabe, weil nur so über 20 Jahre hinweg
  // vergleichbar bleibt, was 5.000 € Ausgaben bedeuten.
  var view = { from: null, months: null, returnPct: null, real: true, active: {} };

  function selected(state) {
    return state.plans.filter(function (p) { return view.active[p.id]; });
  }

  function render(root) {
    var state = S.state;
    if (!view.from) view.from = state.settings.startMonth || U.monthKey();
    if (!view.months) view.months = state.settings.projectionMonths || 60;
    // Vorgabe aus dem Portfolio; bleibt in der Filterleiste überschreibbar.
    if (view.returnPct == null) {
      var pr = C.portfolioReturn(state);
      view.returnPct = pr == null ? 4 : Math.round(pr * 10) / 10;
    }

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Planung & Zukunftsaussicht' }),
        U.el('p', {
          class: 'lede',
          text: 'Szenarien verändern Einnahmen oder Ausgaben für einen frei wählbaren Zeitraum. ' +
                'Die Projektion vergleicht sie mit der unveränderten Basis.'
        })
      ]),
      U.el('button', { class: 'btn btn-primary', text: 'Szenario anlegen', onclick: function () { editPlan(null); } })
    ]));

    root.appendChild(filterbar(state));

    var plans = selected(state);
    var base = C.project(state, {
      from: view.from, months: view.months, plans: [], real: view.real,
      startAssets: C.totalAssets(state), returnPct: view.returnPct
    });
    var scen = plans.length ? C.project(state, {
      from: view.from, months: view.months, plans: plans, real: view.real,
      startAssets: C.totalAssets(state), returnPct: view.returnPct
    }) : null;

    root.appendChild(outlookStats(base, scen));
    root.appendChild(assetsChart(base, scen));

    root.appendChild(U.el('div', { class: 'section-title', text: 'Liquidität' }));
    root.appendChild(liquiditySection(state, plans));

    root.appendChild(U.el('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, [
      netChart(scen || base, !!scen),
      yearTable(scen || base)
    ]));

    root.appendChild(U.el('div', { class: 'section-title', text: 'Szenarien' }));
    root.appendChild(planList(state));
  }

  /* --- Filter ------------------------------------------------------------- */

  function filterbar(state) {
    var bar = U.el('div', { class: 'filterbar' });

    bar.appendChild(ui.field('Ab Monat', ui.monthInput(view.from, {
      onchange: function (e) { view.from = e.target.value || U.monthKey(); HB.app.repaint(); }
    })));

    bar.appendChild(ui.field('Zeitraum', ui.select([
      { value: '12', label: '1 Jahr' },
      { value: '24', label: '2 Jahre' },
      { value: '60', label: '5 Jahre' },
      { value: '120', label: '10 Jahre' },
      { value: '240', label: '20 Jahre' }
    ], String(view.months), function (v) {
      view.months = parseInt(v, 10);
      S.update(function (st) { st.settings.projectionMonths = view.months; }, 'settings');
    })));

    var pr = C.portfolioReturn(state);
    bar.appendChild(ui.field('Rendite auf Vermögen (% p. a.)', ui.numInput(view.returnPct, {
      step: '0.5', style: 'width:110px',
      onchange: function (e) { view.returnPct = U.parseNum(e.target.value); HB.app.repaint(); }
    }), returnHint(state, pr)));

    bar.appendChild(ui.field('Darstellung', ui.select([
      { value: 'real', label: 'Heutige Kaufkraft' },
      { value: 'nominal', label: 'Nominal' }
    ], view.real ? 'real' : 'nominal', function (v) {
      view.real = v === 'real';
      HB.app.repaint();
    }), moneyHint(state)));

    if (state.plans.length) {
      bar.appendChild(ui.field('Aktive Szenarien',
        U.el('div', { class: 'chips' }, state.plans.map(function (p) {
          return U.el('button', {
            class: 'chip', type: 'button',
            'aria-pressed': view.active[p.id] ? 'true' : 'false',
            text: p.name,
            onclick: function () { view.active[p.id] = !view.active[p.id]; HB.app.repaint(); }
          });
        })),
        'Mehrere Szenarien wirken gemeinsam'
      ));
    }

    return bar;
  }

  /* --- Kennzahlen --------------------------------------------------------- */

  function outlookStats(base, scen) {
    var series = scen || base;
    var end = series[series.length - 1];
    var low = series.reduce(function (a, r) { return r.assets < a.assets ? r : a; }, series[0]);
    var negMonths = series.filter(function (r) { return r.net < 0; }).length;
    var avgNet = U.sum(series, function (r) { return r.net; }) / series.length;

    var grid = U.el('div', { class: 'grid grid-4' });

    var hasDebt = C.totalDebt(S.state) > 0;
    grid.appendChild(ui.stat({
      label: hasDebt ? 'Nettovermögen am Ende des Zeitraums' : 'Vermögen am Ende des Zeitraums',
      value: U.currency(hasDebt ? end.netWorth : end.assets, { digits: 0 }),
      hero: true,
      tone: ui.toneClass(hasDebt ? end.netWorth : end.assets),
      sub: scen
        ? deltaSub((hasDebt ? end.netWorth : end.assets) -
            (hasDebt ? base[base.length - 1].netWorth : base[base.length - 1].assets))
        : (hasDebt
            ? U.currency(end.assets, { digits: 0 }) + ' Vermögen − ' +
              U.currency(end.debt, { digits: 0 }) + ' Restschuld'
            : U.monthLabel(end.key, 'long'))
    }));

    grid.appendChild(ui.stat({
      label: 'Durchschnittlicher Monatssaldo',
      value: U.currency(avgNet, { digits: 0, sign: true }),
      tone: ui.toneClass(avgNet),
      sub: 'über ' + series.length + ' Monate'
    }));

    grid.appendChild(ui.stat({
      label: 'Tiefster Vermögensstand',
      value: U.currency(low.assets, { digits: 0 }),
      tone: low.assets < 0 ? 'num-neg' : '',
      sub: U.monthLabel(low.key, 'long')
    }));

    grid.appendChild(ui.stat({
      label: 'Monate mit negativem Saldo',
      value: String(negMonths),
      tone: negMonths ? 'num-neg' : 'num-pos',
      sub: negMonths ? 'werden aus dem Vermögen gedeckt' : 'durchgehend im Plus'
    }));

    return grid;
  }

  function deltaSub(delta) {
    if (Math.abs(delta) < 1) return U.el('span', { class: 'muted', text: 'wie die Basis' });
    return U.el('span', { class: 'stat-delta ' + (delta >= 0 ? 'pos' : 'neg') }, [
      U.el('span', { text: (delta >= 0 ? '▲ ' : '▼ ') + U.currency(Math.abs(delta), { digits: 0 }) + ' gegenüber der Basis' })
    ]);
  }

  /* --- Diagramme ---------------------------------------------------------- */

  function assetsChart(base, scen) {
    var labels = base.map(function (r) { return U.monthLabel(r.key, 'tiny'); });
    var series = [{
      name: 'Basis', color: U.token('--series-1'),
      values: base.map(function (r) { return r.assets; }),
      area: !scen
    }];
    if (scen) {
      series.push({
        name: 'mit Szenarien', color: U.token('--series-2'),
        values: scen.map(function (r) { return r.assets; })
      });
    }

    return ui.chartCard({
      title: 'Vermögensentwicklung',
      sub: U.monthLabel(view.from, 'long') + ' bis ' + U.monthLabel(base[base.length - 1].key, 'long') +
        ' · Startvermögen ' + U.currency(C.totalAssets(S.state), { digits: 0 }),
      chart: function () {
        return HB.charts.line({
          labels: labels, series: series, height: 320, width: 1120,
          valueFormat: function (v) { return U.currency(v, { digits: 0 }); },
          tooltipTitle: function (i) { return U.monthLabel(base[i].key, 'long'); },
          ariaLabel: 'Vermögensentwicklung über den Planungszeitraum'
        });
      },
      legend: function () { return HB.charts.legend(series); },
      table: function () {
        return HB.charts.seriesTable(
          base.map(function (r) { return U.monthLabel(r.key); }), series,
          function (v) { return U.currency(v, { digits: 0 }); }
        );
      },
      foot: 'Der Bestand wird monatlich mit ' + U.num(view.returnPct, 1) +
            ' % p. a. verzinst; Saldo und Sparbeiträge fließen zusätzlich zu.' +
            inflationNote(S.state) + taxNote(S.state) + growthNote(S.state)
    });
  }

  /** Erklärt, was die gewählte Darstellung mit den Beträgen macht. */
  function moneyHint(state) {
    var pct = C.inflationPct(state);
    if (!pct) return 'ohne Inflation — unter „Daten" einstellbar';
    return view.real
      ? 'alle Beträge in Preisen von heute, bei ' + U.num(pct, 1) + ' % Inflation'
      : 'in dem Geld, das es dann gibt, bei ' + U.num(pct, 1) + ' % Inflation';
  }

  /**
   * Die eingetippte Rendite ist brutto — der Hinweis nennt, was nach der
   * laufenden KESt davon übrig bleibt.
   */
  function returnHint(state, pr) {
    var tax = C.taxSettings(state);
    var base = pr == null
      ? 'nominal, auf den Bestand'
      : 'Vorgabe aus dem Portfolio: ' + U.num(pr, 2) + ' %';
    if (!tax.enabled) return base;
    return base + ' · ' + U.num(C.netReturnPct(state, view.returnPct || 0, tax), 2) +
      ' % nach laufender KESt';
  }

  /** Sagt, wie die Inflation in der Kurve steckt. */
  function inflationNote(state) {
    var pct = C.inflationPct(state);
    if (!pct) return ' Ohne Inflationsannahme bleiben die Posten nominell stehen.';
    var n = state.items.filter(function (it) {
      return it.active !== false && C.followsInflation(C.inflationOpts(state, { from: view.from }), it);
    }).length;
    return ' ' + n + ' Posten steigen mit ' + U.num(pct, 1) + ' % Inflation p. a.; die Reihe ist ' +
      (view.real ? 'anschließend in heutige Kaufkraft umgerechnet.' : 'nominal dargestellt.');
  }

  /** Nennt die Steuer, die in der Kurve schon abgezogen ist. */
  function taxNote(state) {
    var tax = C.taxSettings(state);
    if (!tax.enabled) return ' Kapitalertragsteuer ist abgeschaltet.';
    return ' Von den Erträgen gehen ' + U.num(tax.ongoingSharePct, 0) + ' % laufend mit ' +
      U.num(tax.ratePct, 2) + ' % KESt ab; der Rest bleibt als aufgeschobene Steuer im Bestand.';
  }

  /** Weist darauf hin, dass die Projektion Progressionen bereits enthält. */
  function growthNote(state) {
    var n = state.items.filter(function (it) { return it.growth && it.active !== false; }).length;
    if (!n) return '';
    return n === 1
      ? ' Die Progression eines Postens ist eingerechnet.'
      : ' Die Progression von ' + n + ' Posten ist eingerechnet.';
  }

  /* --- Liquiditätsvorschau ------------------------------------------------ */

  /**
   * Der ungeglättete Kontoverlauf. Die Projektion oben verteilt Jahresposten
   * über zwölf Monate; hier treffen sie in ihrem Fälligkeitsmonat mit vollem
   * Betrag ein. Erst dadurch wird sichtbar, ob ein teurer Monat das Konto trägt.
   */
  function liquiditySection(state, plans) {
    var months = Math.min(view.months, 36);
    var rows = C.liquidityProjection(state, {
      from: view.from, months: months, plans: plans
    });

    var start = C.liquidAssets(state);

    // Der Kurve einen Startpunkt voranstellen: Der Wert eines Monats ist der
    // Stand an dessen Ende, der heutige Stand gehört also davor.
    var points = [{ key: U.addMonths(view.from, -1), balance: start, isStart: true }]
      .concat(rows);

    var low = points.reduce(function (a, r) { return r.balance < a.balance ? r : a; }, points[0]);
    var negative = rows.filter(function (r) { return r.balance < 0; });

    var labels = points.map(function (r) { return r.isStart ? 'heute' : U.monthLabel(r.key, 'tiny'); });
    var series = [{
      name: 'Kontostand', color: U.token('--series-1'),
      values: points.map(function (r) { return r.balance; }), area: true
    }];

    var withoutDue = state.items.filter(function (it) {
      return it.active !== false && it.dueMonth == null &&
        Math.round(C.intervalMonths(it.interval)) > 1;
    });

    var stats = U.el('div', { class: 'grid grid-3', style: { marginBottom: '16px' } }, [
      ui.stat({
        label: 'Liquide Mittel heute',
        value: U.currency(start, { digits: 0 }),
        sub: 'Girokonto, Bargeld und als Reserve markierte Anlagen'
      }),
      ui.stat({
        label: 'Tiefster Kontostand',
        value: U.currency(low.balance, { digits: 0 }),
        tone: low.balance < 0 ? 'num-neg' : low.balance < start * 0.25 ? '' : 'num-pos',
        sub: low.isStart ? 'heute — der Verlauf steigt durchgehend' : U.monthLabel(low.key, 'long')
      }),
      ui.stat({
        label: 'Monate im Minus',
        value: String(negative.length),
        tone: negative.length ? 'num-neg' : 'num-pos',
        sub: negative.length
          ? 'erstmals ' + U.monthLabel(negative[0].key, 'long')
          : 'Das Konto trägt den gesamten Zeitraum'
      })
    ]);

    var card = ui.chartCard({
      title: 'Kontoverlauf',
      sub: 'Ungeglättet — Jahres- und Quartalszahlungen treffen in ihrem Fälligkeitsmonat ein',
      chart: function () {
        return HB.charts.line({
          labels: labels, series: series, height: 300, width: 1120,
          valueFormat: function (v) { return U.currency(v, { digits: 0 }); },
          tooltipTitle: function (i) {
            return points[i].isStart ? 'Heutiger Stand' : U.monthLabel(points[i].key, 'long');
          },
          ariaLabel: 'Verlauf der liquiden Mittel'
        });
      },
      table: function () {
        return HB.charts.seriesTable(
          rows.map(function (r) { return U.monthLabel(r.key); }),
          [
            { name: 'Eingänge', values: rows.map(function (r) { return r.inflow; }) },
            { name: 'Ausgänge', values: rows.map(function (r) { return r.outflow; }) },
            { name: 'Kontostand', values: rows.map(function (r) { return r.balance; }) }
          ],
          function (v) { return U.currency(v, { digits: 0 }); }
        );
      },
      foot: (withoutDue.length
        ? withoutDue.length + ' Posten ohne Fälligkeitsmonat werden weiterhin gleichmäßig verteilt — ' +
          'trage die Fälligkeit ein, um den echten Verlauf zu sehen (' +
          withoutDue.slice(0, 3).map(function (i) { return i.label; }).join(', ') +
          (withoutDue.length > 3 ? ' …' : '') + ').'
        : 'Alle nicht-monatlichen Posten haben einen Fälligkeitsmonat — der Verlauf ist vollständig.')
        + (C.inflationPct(S.state)
            ? ' Der Kontostand bleibt immer nominal — er soll sich mit dem echten Konto vergleichen lassen.'
            : '')
    });

    return U.el('div', {}, [stats, card, spikeTable(rows)]);
  }

  /** Die Monate mit den größten Einzelzahlungen. */
  function spikeTable(rows) {
    var withSpikes = rows.filter(function (r) { return r.spikes.length; }).slice(0, 12);
    if (!withSpikes.length) return null;

    return ui.card({
      class: 'span-2',
      title: 'Größere Einzelzahlungen',
      sub: 'Was in welchem Monat zusätzlich zum Alltag anfällt',
      raw: U.el('div', { class: 'table-wrap', style: { marginTop: '0' } }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Monat' }),
            U.el('th', { text: 'Zahlungen' }),
            U.el('th', { class: 'num', text: 'Saldo des Monats' }),
            U.el('th', { class: 'num', text: 'Kontostand danach' })
          ])),
          U.el('tbody', {}, withSpikes.map(function (r) {
            return U.el('tr', {}, [
              U.el('td', { class: 'nowrap', text: U.monthLabel(r.key, 'long') }),
              U.el('td', {}, U.el('div', { class: 'chips' }, r.spikes.slice(0, 4).map(function (sp) {
                return U.el('span', {
                  class: 'badge ' + (sp.kind === 'income' ? 'pos' : ''),
                  text: sp.label + ' ' + U.currency(sp.amount, { digits: 0 })
                });
              }))),
              U.el('td', { class: 'num ' + ui.toneClass(r.net), text: U.currency(r.net, { digits: 0, sign: true }) }),
              U.el('td', { class: 'num ' + (r.balance < 0 ? 'num-neg' : ''), text: U.currency(r.balance, { digits: 0 }) })
            ]);
          }))
        ])
      ])
    });
  }

  function netChart(rows, hasScenario) {
    var labels = rows.map(function (r) { return U.monthLabel(r.key, 'tiny'); });
    var values = rows.map(function (r) { return r.net; });
    var pos = U.token('--series-3'), neg = U.token('--series-8');

    return ui.chartCard({
      title: 'Monatssaldo',
      sub: hasScenario ? 'mit den ausgewählten Szenarien' : 'Basis ohne Szenarien',
      chart: function () {
        return HB.charts.bars({
          labels: labels, values: values, height: 260, width: 640,
          colorOf: function (v) { return v >= 0 ? pos : neg; },
          valueName: 'Saldo',
          valueFormat: function (v) { return U.currency(v, { digits: 0, sign: true }); },
          tooltipTitle: function (i) { return U.monthLabel(rows[i].key, 'long'); },
          extraRows: function (i) {
            return '<div class="tt-row"><span class="k">Einnahmen</span><span class="v">' +
              U.escapeHtml(U.currency(rows[i].income, { digits: 0 })) + '</span></div>' +
              '<div class="tt-row"><span class="k">Ausgaben</span><span class="v">' +
              U.escapeHtml(U.currency(rows[i].expense, { digits: 0 })) + '</span></div>';
          },
          ariaLabel: 'Monatssaldo im Planungszeitraum'
        });
      },
      table: function () {
        return HB.charts.seriesTable(
          rows.map(function (r) { return U.monthLabel(r.key); }),
          [
            { name: 'Einnahmen', values: rows.map(function (r) { return r.income; }) },
            { name: 'Ausgaben', values: rows.map(function (r) { return r.expense; }) },
            { name: 'Saldo', values: values }
          ],
          function (v) { return U.currency(v, { digits: 0 }); }
        );
      },
      foot: 'Grün = Überschuss, rot = Deckungslücke. Die Farbe wiederholt die Richtung, die Achse trägt den Wert.'
    });
  }

  function yearTable(rows) {
    var years = {};
    rows.forEach(function (r) {
      var y = r.key.slice(0, 4);
      if (!years[y]) years[y] = { income: 0, expense: 0, net: 0, assets: 0, tax: 0, n: 0 };
      years[y].income += r.income;
      years[y].expense += r.expense;
      years[y].net += r.net;
      years[y].assets = r.assets;
      years[y].tax += r.tax || 0;
      years[y].n++;
    });

    return ui.card({
      title: 'Jahresübersicht',
      sub: 'aggregiert aus der Projektion',
      foot: 'Die Spalte „KESt" zeigt die laufend gezahlte Kapitalertragsteuer. ' +
            'Sie ist im ausgewiesenen Vermögen bereits abgezogen.',
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Jahr' }),
            U.el('th', { class: 'num', text: 'Einnahmen' }),
            U.el('th', { class: 'num', text: 'Ausgaben' }),
            U.el('th', { class: 'num', text: 'Saldo' }),
            U.el('th', { class: 'num', text: 'KESt' }),
            U.el('th', { class: 'num', text: 'Vermögen (Ende)' })
          ])),
          U.el('tbody', {}, Object.keys(years).sort().map(function (y) {
            var v = years[y];
            return U.el('tr', {}, [
              U.el('td', {}, [
                U.el('span', { text: y }),
                v.n < 12 ? U.el('span', { class: 'small muted', text: ' (' + v.n + ' Mon.)' }) : null
              ]),
              U.el('td', { class: 'num', text: U.currency(v.income, { digits: 0 }) }),
              U.el('td', { class: 'num', text: U.currency(v.expense, { digits: 0 }) }),
              U.el('td', { class: 'num ' + ui.toneClass(v.net), text: U.currency(v.net, { digits: 0, sign: true }) }),
              U.el('td', { class: 'num muted', text: v.tax > 0.5 ? U.currency(v.tax, { digits: 0 }) : '—' }),
              U.el('td', { class: 'num', text: U.currency(v.assets, { digits: 0 }) })
            ]);
          }))
        ])
      ])
    });
  }

  /* --- Szenarienliste ----------------------------------------------------- */

  function planList(state) {
    if (!state.plans.length) {
      return ui.card({
        body: ui.emptyState(
          'Noch keine Szenarien',
          'Typische Fälle: Karenz, Teilzeit, Jobwechsel, eine größere Anschaffung oder eine auslaufende Kreditrate.',
          U.el('button', { class: 'btn btn-primary', text: 'Erstes Szenario anlegen', onclick: function () { editPlan(null); } })
        )
      });
    }

    return U.el('div', { class: 'grid grid-2' }, state.plans.map(function (p) {
      return ui.card({
        title: p.name,
        sub: p.note || null,
        actions: [
          U.el('label', { class: 'checkline small' }, [
            U.el('input', {
              type: 'checkbox', checked: !!view.active[p.id],
              onchange: function (e) { view.active[p.id] = e.target.checked; HB.app.repaint(); }
            }),
            U.el('span', { text: 'aktiv' })
          ]),
          ui.iconBtn('edit', 'Szenario bearbeiten', function () { editPlan(p); }),
          ui.iconBtn('trash', 'Szenario löschen', function () { removePlan(p); })
        ],
        raw: U.el('div', { class: 'table-wrap' }, [
          U.el('table', { class: 'tbl' }, [
            U.el('thead', {}, U.el('tr', {}, [
              U.el('th', { text: 'Anpassung' }),
              U.el('th', { text: 'Wirkung' }),
              U.el('th', { text: 'Zeitraum' }),
              U.el('th', { class: 'num', text: '' })
            ])),
            U.el('tbody', {}, p.adjustments.length
              ? p.adjustments.map(function (a) {
                  return U.el('tr', {}, [
                    U.el('td', { text: a.label }),
                    U.el('td', {}, [
                      U.el('div', { class: 'small', text: effectLabel(state, a) }),
                      U.el('div', { class: 'small muted', text: scopeLabel(state, a) })
                    ]),
                    U.el('td', { class: 'small nowrap', text: periodLabel(a) }),
                    U.el('td', {}, U.el('div', { class: 'row-actions' }, [
                      ui.iconBtn('edit', 'Bearbeiten', function () { editAdjustment(p, a); }),
                      ui.iconBtn('trash', 'Entfernen', function () { removeAdjustment(p, a); })
                    ]))
                  ]);
                })
              : [U.el('tr', {}, U.el('td', { colspan: 4, class: 'muted small', text: 'Noch keine Anpassungen in diesem Szenario.' }))]
            )
          ])
        ]),
        foot: U.el('button', {
          class: 'btn btn-sm', text: 'Anpassung hinzufügen',
          onclick: function () { editAdjustment(p, null); }
        })
      });
    }));
  }

  function scopeLabel(state, a) {
    switch (a.scope) {
      case 'person': return 'Person: ' + S.ownerName(a.targetId);
      case 'item': {
        var it = U.byId(state.items, a.targetId);
        return 'Posten: ' + (it ? it.label : 'entfernt');
      }
      case 'category': return 'Kategorie: ' + S.categoryName(a.targetId);
      case 'household': return 'Gemeinsame Posten';
      case 'oneoff': return 'Einmaliges Ereignis';
      case 'all': return 'Alle Posten';
      default: return '';
    }
  }

  function effectLabel(state, a) {
    var what = a.kind === 'income' ? 'Einnahmen' : a.kind === 'expense' ? 'Ausgaben' : 'Ein- und Ausgaben';
    if (a.scope === 'oneoff') {
      return (a.kind === 'income' ? 'Einmalige Einnahme ' : 'Einmalige Ausgabe ') +
        U.currency(Math.abs(a.value), { digits: 0 });
    }
    if (a.mode === 'percent') {
      return what + ' ' + (a.value >= 0 ? '+' : '−') + U.num(Math.abs(a.value), 1) + ' %';
    }
    if (a.mode === 'set') return what + ' auf ' + U.currency(Math.abs(a.value), { digits: 0 }) + ' setzen';
    return what + ' ' + (a.value >= 0 ? '+' : '−') + U.currency(Math.abs(a.value), { digits: 0 }) + ' / Monat';
  }

  function periodLabel(a) {
    if (a.from && a.to) {
      if (a.from === a.to) return U.monthLabel(a.from);
      return U.monthLabel(a.from) + ' – ' + U.monthLabel(a.to);
    }
    if (a.from) return 'ab ' + U.monthLabel(a.from);
    if (a.to) return 'bis ' + U.monthLabel(a.to);
    return 'dauerhaft';
  }

  /* --- Szenario bearbeiten ------------------------------------------------ */

  function editPlan(p) {
    var isNew = !p;
    var nameIn = ui.textInput(p ? p.name : '', { placeholder: 'z. B. Karenz Robin' });
    var noteIn = U.el('textarea', { placeholder: 'Was ist die Annahme?' });
    noteIn.value = p ? p.note : '';

    ui.openModal({
      title: isNew ? 'Szenario anlegen' : 'Szenario bearbeiten',
      body: U.el('div', {}, [
        ui.field('Name', nameIn),
        ui.field('Beschreibung', noteIn)
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Anlegen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var name = nameIn.value.trim();
            if (!name) { nameIn.focus(); ui.toast('Bitte einen Namen eingeben.', 'err'); return; }
            var id = p ? p.id : U.uid('pln');
            S.update(function (st) {
              if (isNew) {
                st.plans.push({ id: id, name: name, active: false, note: noteIn.value.trim(), adjustments: [] });
              } else {
                var t = U.byId(st.plans, id);
                if (t) { t.name = name; t.note = noteIn.value.trim(); }
              }
            }, 'plans');
            if (isNew) view.active[id] = true;
            close();
            if (isNew) editAdjustment(U.byId(S.state.plans, id), null);
          }
        }
      ]
    });
  }

  function removePlan(p) {
    ui.confirm({
      title: 'Szenario löschen',
      text: '„' + p.name + '“ und alle darin enthaltenen Anpassungen werden entfernt.',
      confirmLabel: 'Löschen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      delete view.active[p.id];
      S.update(function (st) {
        st.plans = st.plans.filter(function (x) { return x.id !== p.id; });
      }, 'plans');
      ui.toast('Szenario gelöscht.');
    });
  }

  /* --- Anpassung bearbeiten ----------------------------------------------- */

  function editAdjustment(plan, adj) {
    var isNew = !adj;
    var state = S.state;
    var draft = adj ? U.deepClone(adj) : {
      id: U.uid('adj'), label: '', scope: 'person', targetId: state.people.length ? state.people[0].id : null,
      kind: 'income', mode: 'percent', value: -50,
      from: U.monthKey(), to: U.addMonths(U.monthKey(), 11)
    };

    var labelIn = ui.textInput(draft.label, { placeholder: 'z. B. Karenz, 65 % weniger Einkommen' });
    var valueIn = ui.numInput(draft.value, { step: '0.1' });
    var fromIn = ui.monthInput(draft.from);
    var toIn = ui.monthInput(draft.to);

    var targetWrap = U.el('div', {});
    var modeWrap = U.el('div', {});
    var kindWrap = U.el('div', {});
    var hint = U.el('div', { class: 'callout' });

    var scopeSel = ui.select([
      { value: 'person', label: 'Alles einer Person' },
      { value: 'item', label: 'Ein einzelner Posten' },
      { value: 'category', label: 'Eine Kategorie' },
      { value: 'household', label: 'Alle gemeinsamen Posten' },
      { value: 'all', label: 'Der gesamte Haushalt' },
      { value: 'oneoff', label: 'Einmaliges Ereignis' }
    ], draft.scope, function (v) {
      draft.scope = v;
      if (v === 'oneoff') { draft.mode = 'delta'; draft.kind = 'expense'; }
      else if (draft.mode === 'set' && v !== 'item') draft.mode = 'percent';
      paintAll();
    });

    function paintTarget() {
      U.clear(targetWrap);
      if (draft.scope === 'person') {
        var opts = state.people.map(function (p) { return { value: p.id, label: p.name }; });
        if (!opts.length) {
          targetWrap.appendChild(U.el('p', { class: 'small muted', text: 'Es sind noch keine Personen angelegt.' }));
          return;
        }
        if (!U.byId(state.people, draft.targetId)) draft.targetId = opts[0].value;
        targetWrap.appendChild(ui.field('Person',
          ui.select(opts, draft.targetId, function (v) { draft.targetId = v; })));
      } else if (draft.scope === 'item') {
        var iopts = state.items.map(function (i) {
          return { value: i.id, label: i.label + ' — ' + S.ownerName(i.owner) + ' · ' + U.currency(C.perMonth(i), { digits: 0 }) + '/Mon.' };
        });
        if (!iopts.length) {
          targetWrap.appendChild(U.el('p', { class: 'small muted', text: 'Es sind noch keine Posten angelegt.' }));
          return;
        }
        if (!U.byId(state.items, draft.targetId)) draft.targetId = iopts[0].value;
        targetWrap.appendChild(ui.field('Posten',
          ui.select(iopts, draft.targetId, function (v) { draft.targetId = v; })));
      } else if (draft.scope === 'category') {
        var copts = state.categories.map(function (c) {
          return { value: c.id, label: c.name + ' (' + (c.kind === 'income' ? 'Einnahme' : 'Ausgabe') + ')' };
        });
        if (!U.byId(state.categories, draft.targetId)) draft.targetId = copts[0].value;
        targetWrap.appendChild(ui.field('Kategorie',
          ui.select(copts, draft.targetId, function (v) { draft.targetId = v; })));
      } else if (draft.scope === 'oneoff') {
        targetWrap.appendChild(ui.field('Träger',
          ui.select(ui.ownerOptions(state), draft.targetId || 'household', function (v) { draft.targetId = v; })));
      }
    }

    function paintKind() {
      U.clear(kindWrap);
      var opts = draft.scope === 'oneoff'
        ? [{ value: 'expense', label: 'Ausgabe' }, { value: 'income', label: 'Einnahme' }]
        : [
            { value: 'income', label: 'nur Einnahmen' },
            { value: 'expense', label: 'nur Ausgaben' },
            { value: 'both', label: 'Ein- und Ausgaben' }
          ];
      if (!opts.some(function (o) { return o.value === draft.kind; })) draft.kind = opts[0].value;
      kindWrap.appendChild(ui.field('Betrifft',
        ui.select(opts, draft.kind, function (v) { draft.kind = v; paintHint(); })));
    }

    function paintMode() {
      U.clear(modeWrap);
      if (draft.scope === 'oneoff') {
        modeWrap.appendChild(ui.field('Modus',
          U.el('input', { type: 'text', value: 'Einmalbetrag', disabled: true })));
        return;
      }
      var opts = [
        { value: 'percent', label: 'um Prozent verändern' },
        { value: 'delta', label: 'um festen Betrag verändern' }
      ];
      if (draft.scope === 'item') opts.push({ value: 'set', label: 'auf festen Betrag setzen' });
      else opts.push({ value: 'set', label: 'Gruppensumme auf Betrag setzen' });

      modeWrap.appendChild(ui.field('Modus',
        ui.select(opts, draft.mode, function (v) { draft.mode = v; paintHint(); })));
    }

    function paintHint() {
      var unit = (draft.scope !== 'oneoff' && draft.mode === 'percent') ? '%' : '€';
      var lbl = valueIn.parentNode && valueIn.parentNode.querySelector('label');
      if (lbl) lbl.textContent = 'Wert (' + unit + ')';

      var texts = {
        percent: 'Negative Werte senken, positive erhöhen. −65 % bedeutet, es bleiben 35 % übrig.',
        delta: draft.scope === 'item'
          ? 'Der Betrag wird auf den Monatswert des Postens addiert (negativ = weniger).'
          : 'Es entsteht ein zusätzlicher Posten in dieser Höhe für den gewählten Zeitraum.',
        set: draft.scope === 'item'
          ? 'Der Posten wird für den Zeitraum auf diesen Monatsbetrag gesetzt.'
          : 'Alle betroffenen Posten werden proportional so skaliert, dass ihre Summe diesem Betrag entspricht.'
      };
      hint.textContent = draft.scope === 'oneoff'
        ? 'Wirkt genau in den gewählten Monaten — für ein einzelnes Ereignis „ab“ und „bis“ auf denselben Monat setzen.'
        : texts[draft.mode];
    }

    function paintAll() { paintTarget(); paintKind(); paintMode(); paintHint(); }

    var form = U.el('div', {}, [
      U.el('div', { class: 'form-grid' }, [
        ui.field('Bezeichnung', labelIn, null, 'full'),
        ui.field('Wirkt auf', scopeSel),
        targetWrap,
        kindWrap,
        modeWrap,
        ui.field('Wert', valueIn),
        U.el('div', {}),
        ui.field('Ab Monat', fromIn),
        ui.field('Bis Monat', toIn, 'leer = unbefristet')
      ]),
      hint
    ]);
    paintAll();

    ui.openModal({
      title: isNew ? 'Anpassung hinzufügen' : 'Anpassung bearbeiten',
      wide: true,
      body: form,
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Hinzufügen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var value = U.parseNum(valueIn.value);
            if (draft.scope === 'oneoff' && value <= 0) {
              valueIn.focus(); ui.toast('Ein Einmalbetrag muss größer als 0 sein.', 'err'); return;
            }
            if (!fromIn.value) { fromIn.focus(); ui.toast('Bitte einen Startmonat wählen.', 'err'); return; }
            if (toIn.value && U.monthIndex(toIn.value) < U.monthIndex(fromIn.value)) {
              ui.toast('Der Endmonat liegt vor dem Startmonat.', 'err'); return;
            }
            if ((draft.scope === 'person' || draft.scope === 'item' || draft.scope === 'category') && !draft.targetId) {
              ui.toast('Bitte ein Ziel auswählen.', 'err'); return;
            }

            draft.value = value;
            draft.from = fromIn.value;
            draft.to = toIn.value || null;
            draft.label = labelIn.value.trim() || autoLabel(state, draft);

            S.update(function (st) {
              var pl = U.byId(st.plans, plan.id);
              if (!pl) return;
              if (isNew) pl.adjustments.push(draft);
              else {
                var i = pl.adjustments.findIndex(function (x) { return x.id === draft.id; });
                if (i > -1) pl.adjustments[i] = draft;
              }
            }, 'plans');
            ui.toast(isNew ? 'Anpassung hinzugefügt.' : 'Anpassung gespeichert.');
            close();
          }
        }
      ]
    });
  }

  function autoLabel(state, a) {
    return effectLabel(state, a) + ' · ' + scopeLabel(state, a);
  }

  function removeAdjustment(plan, adj) {
    ui.confirm({
      title: 'Anpassung entfernen',
      text: '„' + adj.label + '“ wird aus dem Szenario „' + plan.name + '“ entfernt.',
      confirmLabel: 'Entfernen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      S.update(function (st) {
        var pl = U.byId(st.plans, plan.id);
        if (pl) pl.adjustments = pl.adjustments.filter(function (x) { return x.id !== adj.id; });
      }, 'plans');
    });
  }

  HB.views.plans = { render: render };
})(window.HB);
