/* ---------------------------------------------------------------------------
   views/fire.js — FIRE-Kalkulator (Financial Independence, Retire Early)
   Gerechnet wird in heutiger Kaufkraft: die Rendite wird um die Inflation
   bereinigt, damit die FIRE-Zahl direkt mit den heutigen Ausgaben vergleichbar ist.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  var view = { usePlans: false, autoContribution: true };

  function render(root) {
    var state = S.state;
    view.autoContribution = state.fire.monthlyContribution == null || state.fire.monthlyContribution === '';

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'FIRE-Kalkulator' }),
        U.el('p', {
          class: 'lede',
          text: 'Wann trägt das Vermögen die Ausgaben ohne Erwerbseinkommen? Alle Werte sind inflationsbereinigt, ' +
                'also in der Kaufkraft von heute.'
        })
      ])
    ]));

    if (!state.items.length) {
      root.appendChild(ui.card({
        body: ui.emptyState('Noch keine Datengrundlage',
          'Der Rechner leitet Sparrate und Zielausgaben aus dem Haushaltsbudget ab. Erfasse zuerst Posten.')
      }));
      return;
    }

    var results = U.el('div', {});

    function paint() {
      U.clear(results);
      var r = C.fireCalc(state, { plans: view.usePlans ? S.activePlans() : [] });
      results.appendChild(kpis(state, r));
      results.appendChild(chart(r));
      results.appendChild(U.el('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, [
        coastCard(r),
        explainCard(state, r)
      ]));
    }

    root.appendChild(U.el('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)' } }, [
      inputCard(state, paint),
      results
    ]));

    paint();
  }

  /* --- Eingaben ----------------------------------------------------------- */

  function inputCard(state, onChange) {
    var f = state.fire;

    // Direkt in den State schreiben und nur die Ergebnisse neu zeichnen —
    // so bleibt der Fokus im Feld erhalten.
    function bind(key, parse) {
      return function (e) {
        var v = e.target.value;
        f[key] = v === '' ? null : (parse ? parse(v) : U.parseNum(v));
        S.touch();
        onChange();
      };
    }

    var contribIn = ui.numInput(
      view.autoContribution ? null : f.monthlyContribution,
      { placeholder: 'automatisch', disabled: view.autoContribution, oninput: bind('monthlyContribution') }
    );

    var autoBox = U.el('input', {
      type: 'checkbox', checked: view.autoContribution,
      onchange: function (e) {
        view.autoContribution = e.target.checked;
        contribIn.disabled = e.target.checked;
        if (e.target.checked) { f.monthlyContribution = null; contribIn.value = ''; }
        else f.monthlyContribution = U.parseNum(contribIn.value);
        S.touch();
        onChange();
      }
    });

    var spendIn = ui.numInput(f.annualSpendOverride, {
      placeholder: 'aus dem Budget', oninput: bind('annualSpendOverride')
    });

    /**
     * Startvermögen und Rendite folgen demselben Muster wie die Sparrate:
     * leer heißt automatisch, hier aus dem erfassten Vermögen und dem Portfolio.
     */
    function autoField(key, label, attrs, autoLabel, hint) {
      var isAuto = f[key] == null || f[key] === '';
      var input = ui.numInput(isAuto ? null : f[key], Object.assign({
        placeholder: 'automatisch', disabled: isAuto, oninput: bind(key)
      }, attrs || {}));

      var box = U.el('input', {
        type: 'checkbox', checked: isAuto,
        onchange: function (e) {
          input.disabled = e.target.checked;
          if (e.target.checked) { f[key] = null; input.value = ''; }
          else f[key] = U.parseNum(input.value);
          S.touch();
          onChange();
        }
      });

      return U.el('div', {}, [
        ui.field(label, input, hint),
        U.el('label', { class: 'checkline', style: { margin: '-6px 0 12px' } }, [
          box, U.el('span', { class: 'small', text: autoLabel })
        ])
      ]);
    }

    var portfolio = C.investmentSummary(state);
    var total = C.totalAssets(state);

    var body = U.el('div', {}, [
      autoField('startAssets', 'Startvermögen (€)', null,
        'automatisch: ' + U.currency(total, { digits: 0 }) + ' Gesamtvermögen',
        portfolio.count
          ? portfolio.count + (portfolio.count === 1 ? ' Investment' : ' Investments') + ' plus sonstiges Vermögen'
          : 'Sonstiges Vermögen; Investments sind noch keine erfasst'),

      ui.field('Monatliche Sparrate (€)', contribIn),
      U.el('label', { class: 'checkline', style: { margin: '-6px 0 12px' } }, [
        autoBox, U.el('span', { class: 'small', text: 'automatisch aus dem Haushaltssaldo' })
      ]),

      ui.field('Steigerung der Sparrate (% p. a.)',
        ui.numInput(f.contributionGrowthPct, { step: '0.5', oninput: bind('contributionGrowthPct') }),
        'real, zusätzlich zur Inflation'),

      U.el('div', { class: 'section-title', text: 'Kapitalmarkt' }),

      autoField('returnPct', 'Erwartete Rendite (% p. a.)', { step: '0.1' },
        portfolio.weightedReturn == null
          ? 'automatisch: 6 % (keine Investments erfasst)'
          : 'automatisch: ' + U.num(portfolio.weightedReturn, 2) + ' % aus dem Portfolio',
        'nominal, vor Inflation'),
      ui.field('Inflation (% p. a.)',
        ui.numInput(f.inflationPct, { step: '0.1', oninput: bind('inflationPct') })),
      ui.field('Sichere Entnahmerate (% p. a.)',
        ui.numInput(f.withdrawalPct, { step: '0.1', oninput: bind('withdrawalPct') }),
        '3,5 % gilt für lange Entnahmephasen als vorsichtig'),

      U.el('div', { class: 'section-title', text: 'Ausgaben im Ruhestand' }),

      ui.field('Ausgabenniveau (% von heute)',
        ui.numInput(f.spendFactor, { step: '5', oninput: bind('spendFactor') }),
        'Ohne Sparbeiträge, die im Ruhestand entfallen'),
      ui.field('Oder fixe Jahresausgaben (€)', spendIn, 'Überschreibt die Ableitung aus dem Budget'),

      U.el('div', { class: 'section-title', text: 'Rechenrahmen' }),

      ui.field('Coast-Horizont (Jahre)',
        ui.numInput(f.coastYears == null ? 20 : f.coastYears, { step: '1', oninput: bind('coastYears') }),
        'In wie vielen Jahren soll das Ziel ohne weitere Einzahlungen erreicht sein?'),
      ui.field('Maximaler Rechenzeitraum (Jahre)',
        ui.numInput(f.maxYears, { step: '5', oninput: bind('maxYears') })),

      S.state.plans.length
        ? U.el('label', { class: 'checkline' }, [
            U.el('input', {
              type: 'checkbox', checked: view.usePlans,
              onchange: function (e) { view.usePlans = e.target.checked; onChange(); }
            }),
            U.el('span', { class: 'small', text: 'Aktive Szenarien einrechnen' })
          ])
        : null
    ]);

    return ui.card({ title: 'Annahmen', body: body });
  }

  /* --- Ergebnisse --------------------------------------------------------- */

  function kpis(state, r) {
    var grid = U.el('div', { class: 'grid grid-2' });

    grid.appendChild(ui.stat({
      label: 'FIRE-Zahl',
      value: U.currency(r.fireNumber, { digits: 0 }),
      hero: true,
      sub: U.currency(r.annualSpend, { digits: 0 }) + ' Jahresausgaben bei ' +
        U.num(r.swr * 100, 1) + ' % Entnahme'
    }));

    grid.appendChild(ui.stat({
      label: 'Finanzielle Unabhängigkeit erreicht',
      value: r.reached
        ? U.num(r.years, 1) + ' Jahre'
        : 'nicht in ' + r.maxYears + ' Jahren',
      tone: r.reached ? 'num-pos' : 'num-neg',
      sub: r.reached
        ? 'voraussichtlich ' + U.monthLabel(r.targetMonthKey, 'long')
        : (r.contribution <= 0
            ? 'Ohne positiven Sparbetrag wird das Ziel nie erreicht.'
            : 'Sparrate erhöhen oder Zielausgaben senken.')
    }));

    grid.appendChild(ui.stat({
      label: 'Angesetzte Sparrate',
      value: U.currency(r.contribution, { digits: 0 }) + ' / Monat',
      tone: ui.toneClass(r.contribution),
      sub: r.contributionIsAuto
        ? 'automatisch: Monatssaldo + Sparbeiträge'
        : 'manuell gesetzt (automatisch wären ' + U.currency(r.autoContribution, { digits: 0 }) + ')'
    }));

    grid.appendChild(ui.stat({
      label: 'Entnahme im Ruhestand',
      value: U.currency(r.monthlyWithdrawal, { digits: 0 }) + ' / Monat',
      sub: 'heutige Kaufkraft, bei einer Realrendite von ' + U.num(r.realAnnual * 100, 1) + ' %'
    }));

    return grid;
  }

  function chart(r) {
    var labels = r.series.map(function (p) { return U.num(p.month / 12, 0) + ' J.'; });
    var series = [
      {
        name: 'Vermögen (real)', color: U.token('--series-1'),
        values: r.series.map(function (p) { return p.assets; }), area: true
      },
      {
        name: 'FIRE-Zahl', color: U.token('--series-4'), dashed: true,
        values: r.series.map(function () { return r.fireNumber; })
      }
    ];

    return ui.chartCard({
      title: 'Weg zur finanziellen Unabhängigkeit',
      sub: 'Vermögensaufbau in heutiger Kaufkraft gegen die FIRE-Zahl',
      chart: function () {
        return HB.charts.line({
          labels: labels, series: series, height: 300, width: 820, labelLast: false,
          valueFormat: function (v) { return U.currency(v, { digits: 0 }); },
          tooltipTitle: function (i) {
            var m = r.series[i].month;
            return 'Nach ' + U.num(m / 12, 1) + ' Jahren (' + U.monthLabel(U.addMonths(U.monthKey(), m), 'long') + ')';
          },
          ariaLabel: 'Vermögensaufbau gegenüber der FIRE-Zahl'
        });
      },
      legend: function () { return HB.charts.legend(series); },
      table: function () {
        return HB.charts.seriesTable(
          r.series.map(function (p) { return U.num(p.month / 12, 2) + ' Jahre'; }),
          [
            { name: 'Vermögen (real)', values: r.series.map(function (p) { return p.assets; }) },
            { name: 'Eingezahlt', values: r.series.map(function (p) { return p.contributed; }) },
            { name: 'FIRE-Zahl', values: r.series.map(function () { return r.fireNumber; }) }
          ],
          function (v) { return U.currency(v, { digits: 0 }); }
        );
      },
      foot: r.reached
        ? 'Die Kurve endet ein Jahr nach dem Erreichen der FIRE-Zahl.'
        : 'Im gewählten Rechenzeitraum wird die FIRE-Zahl nicht erreicht.'
    });
  }

  function coastCard(r) {
    return ui.card({
      title: 'Coast-FIRE',
      sub: 'Ab welchem Vermögen trägt sich das Ziel von allein?',
      body: U.el('div', {}, [
        U.el('p', {
          text: 'Wer heute ' + U.currency(r.coastNumber, { digits: 0 }) + ' angelegt hat, erreicht die FIRE-Zahl in ' +
                U.num(r.coastYears, 0) + ' Jahren allein durch die Rendite — ganz ohne weitere Einzahlungen.'
        }),
        ui.meter({
          used: Math.min(r.series[0].assets, r.coastNumber),
          budget: r.coastNumber,
          mode: 'progress',
          label: 'Fortschritt Richtung Coast-FIRE'
        }),
        U.el('p', { class: 'small muted', style: { marginTop: '12px' } }, [
          'Der Fortschritt vergleicht das Startvermögen von ' +
          U.currency(r.series[0].assets, { digits: 0 }) + ' mit der Coast-Schwelle.'
        ])
      ])
    });
  }

  function explainCard(state, r) {
    return ui.card({
      title: 'Wie sich die Zahlen ergeben',
      body: U.el('div', { class: 'stack' }, [
        line('Monatliche Ausgaben heute (ohne Sparbeiträge)', U.currency(r.monthlySpend, { digits: 0 })),
        line('Jahresausgaben heute', U.currency(r.annualSpendToday, { digits: 0 })),
        line('Angesetzte Jahresausgaben im Ruhestand', U.currency(r.annualSpend, { digits: 0 })),
        line('Entnahmerate', U.num(r.swr * 100, 2) + ' %'),
        line('FIRE-Zahl = Jahresausgaben ÷ Entnahmerate', U.currency(r.fireNumber, { digits: 0 })),
        line('Angesetzte Rendite' + (r.returnIsAuto ? ' (aus dem Portfolio)' : ''), U.num(r.returnPct, 2) + ' %'),
        line('Realrendite = (1 + Rendite) ÷ (1 + Inflation) − 1', U.num(r.realAnnual * 100, 2) + ' %'),
        line('Startvermögen' + (r.startAssetsIsAuto ? ' (Investments + sonstiges)' : ''),
          U.currency(r.startAssets, { digits: 0 })),
        line('Bis zum Ziel eingezahlt', r.reached ? U.currency(r.contributedTotal, { digits: 0 }) : '—'),
        U.el('div', { class: 'callout', style: { marginTop: '12px' } }, [
          'Die Rechnung unterstellt eine konstante Realrendite. Reale Märkte schwanken; ' +
          'gerade die ersten Ruhestandsjahre entscheiden über den Erfolg der Entnahme. ' +
          'Behandle das Ergebnis als Größenordnung, nicht als Zusage.'
        ])
      ])
    });
  }

  function line(label, value) {
    return U.el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, [
      U.el('span', { class: 'small muted', text: label }),
      U.el('span', {
        class: 'small nowrap',
        style: { fontVariantNumeric: 'tabular-nums', fontWeight: '600' },
        text: value
      })
    ]);
  }

  HB.views.fire = { render: render };
})(window.HB);
