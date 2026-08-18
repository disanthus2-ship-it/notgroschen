/* ---------------------------------------------------------------------------
   views/debts.js — Kredite und Schulden
   Die Gegenseite der Investments. Zusammen ergeben sie das Nettovermögen —
   die einzige Vermögenszahl, die tatsächlich jemandem gehört.

   Wie bei den Investments erzeugt ein Kredit keinen Geldfluss: Die Rate ist
   ein gewöhnlicher Posten, der Kredit verweist nur darauf. Ist er getilgt,
   lässt die Projektion die Rate automatisch auslaufen.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  var view = { owner: '', type: '' };

  function render(root) {
    var state = S.state;
    var d = C.debtSummary(state);

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Kredite & Schulden' }),
        U.el('p', {
          class: 'lede',
          text: 'Wohnkredit, Autofinanzierung, Bildungskredit — mit Restschuld, Zinssatz und ' +
                'Tilgungsverlauf. Erst zusammen mit den Investments ergibt sich das Nettovermögen.'
        })
      ]),
      U.el('button', {
        class: 'btn btn-primary', text: 'Kredit hinzufügen',
        onclick: function () { edit(null); }
      })
    ]));

    root.appendChild(kpis(state, d));

    if (!state.debts.length) {
      root.appendChild(ui.card({
        body: ui.emptyState(
          'Keine Schulden erfasst',
          'Wer schuldenfrei ist, lässt diese Ansicht leer — das Nettovermögen entspricht dann dem Gesamtvermögen. ' +
          'Andernfalls: Restschuld, Zinssatz und die verknüpfte Rate eintragen.',
          U.el('button', {
            class: 'btn btn-primary', text: 'Ersten Kredit anlegen',
            onclick: function () { edit(null); }
          })
        )
      }));
      return;
    }

    root.appendChild(U.el('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, [
      payoffChart(state),
      ownerCard(state, d)
    ]));

    root.appendChild(U.el('div', { class: 'section-title', text: 'Kredite' }));
    root.appendChild(filterbar(state));
    root.appendChild(table(state, d));
  }

  /* --- Kennzahlen --------------------------------------------------------- */

  function kpis(state, d) {
    var net = C.netWorth(state);
    var assets = C.totalAssets(state);
    var grid = U.el('div', { class: 'grid grid-4' });

    grid.appendChild(ui.stat({
      label: 'Nettovermögen',
      value: U.currency(net, { digits: 0 }),
      hero: true,
      tone: ui.toneClass(net),
      sub: U.currency(assets, { digits: 0 }) + ' Vermögen − ' +
           U.currency(d.balance, { digits: 0 }) + ' Schulden'
    }));

    grid.appendChild(ui.stat({
      label: 'Restschuld',
      value: U.currency(d.balance, { digits: 0 }),
      sub: d.count + (d.count === 1 ? ' Kredit' : ' Kredite') +
        (d.weightedRate != null ? ' · ' + U.num(d.weightedRate, 2) + ' % gewichtet' : '')
    }));

    grid.appendChild(ui.stat({
      label: 'Monatliche Rate',
      value: U.currency(d.monthlyPayment, { digits: 0 }),
      sub: 'davon ' + U.currency(d.monthlyInterest, { digits: 0 }) + ' Zinsen, ' +
           U.currency(Math.max(0, d.monthlyPayment - d.monthlyInterest), { digits: 0 }) + ' Tilgung'
    }));

    grid.appendChild(ui.stat({
      label: 'Schuldenfrei',
      value: d.longest ? U.monthLabel(d.longest, 'long') : '—',
      sub: d.longest
        ? 'in ' + U.num(U.monthDiff(U.monthKey(), d.longest) / 12, 1) + ' Jahren'
        : 'Mindestens ein Kredit tilgt sich bei dieser Rate nicht'
    }));

    return grid;
  }

  /* --- Tilgungsverlauf ---------------------------------------------------- */

  function payoffChart(state) {
    var from = state.settings.startMonth || U.monthKey();
    var schedules = state.debts.map(function (dd) {
      return { debt: dd, sch: C.debtSchedule(state, dd) };
    });

    // Bis zum letzten Tilgungsmonat rechnen, höchstens 30 Jahre.
    var span = 12;
    schedules.forEach(function (x) {
      if (x.sch.payoffKey && !x.sch.neverPaysOff) {
        span = Math.max(span, U.monthDiff(from, x.sch.payoffKey) + 2);
      } else {
        span = Math.max(span, 120);
      }
    });
    span = Math.min(span, 360);

    var labels = [], values = [];
    for (var i = 0; i < span; i++) {
      var key = U.addMonths(from, i);
      labels.push(U.monthLabel(key, 'tiny'));
      values.push(schedules.reduce(function (a, x) {
        return a + C.debtBalanceAt(state, x.debt, key, x.sch);
      }, 0));
    }

    var series = [{
      name: 'Restschuld', color: U.token('--series-8'), values: values, area: true
    }];

    return ui.chartCard({
      title: 'Tilgungsverlauf',
      sub: 'Gesamte Restschuld bei unveränderten Raten',
      chart: function () {
        return HB.charts.line({
          labels: labels, series: series, height: 260, width: 640,
          valueFormat: function (v) { return U.currency(v, { digits: 0 }); },
          tooltipTitle: function (i) { return U.monthLabel(U.addMonths(from, i), 'long'); },
          ariaLabel: 'Verlauf der gesamten Restschuld'
        });
      },
      table: function () {
        return HB.charts.seriesTable(
          labels.map(function (_, i) { return U.monthLabel(U.addMonths(from, i)); }),
          series, function (v) { return U.currency(v, { digits: 0 }); }
        );
      },
      foot: 'Zins auf die Restschuld, der Rest der Rate tilgt. Sondertilgungen lassen sich ' +
            'als einmaliges Ereignis in einem Szenario abbilden.'
    });
  }

  /* --- Nach Träger -------------------------------------------------------- */

  function ownerCard(state, d) {
    var owners = Object.keys(d.byOwner).sort(function (a, b) {
      return d.byOwner[b] - d.byOwner[a];
    });

    return ui.card({
      title: 'Nach Träger',
      sub: 'Wer haftet für welchen Teil',
      body: U.el('div', { class: 'stack' }, owners.map(function (o) {
        var v = d.byOwner[o];
        return U.el('div', {}, [
          U.el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' } }, [
            ui.personSwatch(o),
            U.el('span', {
              style: { fontVariantNumeric: 'tabular-nums', fontWeight: '600' },
              text: U.currency(v, { digits: 0 })
            })
          ]),
          U.el('div', { class: 'meter-track', style: { marginTop: '6px' } }, [
            U.el('div', {
              class: 'meter-fill',
              style: {
                width: (d.balance ? (v / d.balance) * 100 : 0) + '%',
                background: S.ownerColor(o)
              }
            })
          ]),
          U.el('div', { class: 'meter-legend' }, [
            U.el('span', { text: d.balance ? U.pct(v / d.balance, 1) + ' der Restschuld' : '' }),
            U.el('span', { text: countFor(state, o) })
          ])
        ]);
      }))
    });
  }

  function countFor(state, owner) {
    var n = state.debts.filter(function (x) { return x.owner === owner; }).length;
    return n + (n === 1 ? ' Kredit' : ' Kredite');
  }

  /* --- Filter & Tabelle --------------------------------------------------- */

  function filterbar(state) {
    var bar = U.el('div', { class: 'filterbar' });

    bar.appendChild(ui.field('Träger', ui.select(
      ui.ownerOptions(state, { all: true }), view.owner,
      function (v) { view.owner = v; HB.app.repaint(); }
    )));

    var typeOpts = [{ value: '', label: 'Alle Kreditarten' }].concat(
      Object.keys(C.DEBT_TYPES)
        .filter(function (t) { return state.debts.some(function (x) { return x.type === t; }); })
        .map(function (t) { return { value: t, label: C.debtTypeLabel(t) }; })
    );
    bar.appendChild(ui.field('Kreditart', ui.select(typeOpts, view.type,
      function (v) { view.type = v; HB.app.repaint(); })));

    return bar;
  }

  function table(state, summary) {
    var rows = state.debts.filter(function (x) {
      if (view.owner && x.owner !== view.owner) return false;
      if (view.type && x.type !== view.type) return false;
      return true;
    }).sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); });

    if (!rows.length) {
      return ui.card({ body: ui.emptyState('Kein Treffer', 'Kein Kredit passt zu den aktuellen Filtern.') });
    }

    var sumBalance = U.sum(rows, function (r) { return Number(r.balance) || 0; });
    var sumPayment = U.sum(rows, function (r) { return C.debtPayment(state, r); });

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Bezeichnung' }),
            U.el('th', { text: 'Art' }),
            U.el('th', { text: 'Träger' }),
            U.el('th', { class: 'num', text: 'Restschuld' }),
            U.el('th', { class: 'num', text: 'Zins p. a.' }),
            U.el('th', { class: 'num', text: 'Rate' }),
            U.el('th', { class: 'num', text: 'Zinsanteil' }),
            U.el('th', { text: 'Schuldenfrei' }),
            U.el('th', { class: 'num', text: '' })
          ])),
          U.el('tbody', {}, rows.map(function (x) { return row(state, x); })),
          U.el('tfoot', {}, U.el('tr', {}, [
            U.el('td', { colspan: 3, text: rows.length + ' von ' + state.debts.length + ' Krediten' }),
            U.el('td', { class: 'num', text: U.currency(sumBalance, { digits: 0 }) }),
            U.el('td', { class: 'num', text: summary.weightedRate != null ? U.num(summary.weightedRate, 2) + ' %' : '—' }),
            U.el('td', { class: 'num', text: U.currency(sumPayment, { digits: 0 }) }),
            U.el('td', { class: 'num', text: U.currency(summary.monthlyInterest, { digits: 0 }) }),
            U.el('td', { colspan: 2, text: '' })
          ]))
        ])
      ]),
      foot: 'Die Spalte „Rate" verweist auf den Posten, der die Zahlung im Budget abbildet. ' +
            'Der Kredit selbst erzeugt keinen Geldfluss — so kann nichts doppelt zählen.'
    });
  }

  function row(state, d) {
    var sch = C.debtSchedule(state, d);
    var payment = C.debtPayment(state, d);
    var interest = (Number(d.balance) || 0) * (Number(d.interestPct) || 0) / 100 / 12;
    var link = d.linkedItemId ? U.byId(state.items, d.linkedItemId) : null;
    var progress = d.principal > 0 ? (d.principal - d.balance) / d.principal : null;

    return U.el('tr', {}, [
      U.el('td', {}, [
        U.el('div', { style: { fontWeight: '500' }, text: d.label }),
        d.provider ? U.el('div', { class: 'small muted', text: d.provider }) : null,
        progress != null
          ? U.el('div', { class: 'small muted', text: U.pct(progress, 0) + ' von ' + U.currency(d.principal, { digits: 0 }) + ' getilgt' })
          : null
      ]),
      U.el('td', { text: C.debtTypeLabel(d.type) }),
      U.el('td', {}, ui.personSwatch(d.owner)),
      U.el('td', { class: 'num', style: { fontWeight: '600' }, text: U.currency(d.balance, { digits: 0 }) }),
      U.el('td', { class: 'num', text: U.num(d.interestPct, 2) + ' %' }),
      U.el('td', {}, U.el('div', { style: { textAlign: 'right' } }, [
        U.el('div', { style: { fontVariantNumeric: 'tabular-nums' }, text: U.currency(payment, { digits: 0 }) }),
        link
          ? U.el('div', { class: 'small muted', text: link.label })
          : U.el('div', { class: 'small muted', text: 'ohne Posten' })
      ])),
      U.el('td', { class: 'num num-neg', text: U.currency(interest, { digits: 0 }) }),
      U.el('td', {}, sch.neverPaysOff
        ? U.el('span', { class: 'badge neg', text: 'Rate deckt die Zinsen nicht' })
        : U.el('div', {}, [
            U.el('div', { class: 'small', text: sch.payoffKey ? U.monthLabel(sch.payoffKey) : '—' }),
            U.el('div', { class: 'small muted', text: sch.totalInterest ? U.currency(sch.totalInterest, { digits: 0 }) + ' Zinsen gesamt' : '' })
          ])),
      U.el('td', {}, U.el('div', { class: 'row-actions' }, [
        ui.iconBtn('edit', 'Bearbeiten', function () { edit(d); }),
        ui.iconBtn('trash', 'Löschen', function () { remove(d); })
      ]))
    ]);
  }

  /* --- Bearbeiten --------------------------------------------------------- */

  function edit(d) {
    var isNew = !d;
    var state = S.state;
    var draft = d ? U.deepClone(d) : {
      id: U.uid('dbt'), label: '', type: 'consumer', owner: 'household',
      balance: null, principal: null, interestPct: 4,
      paymentMonthly: null, linkedItemId: null, provider: '', note: ''
    };

    var labelIn = ui.textInput(draft.label, { placeholder: 'z. B. Wohnkredit' });
    var balanceIn = ui.numInput(draft.balance, { placeholder: '0,00' });
    var principalIn = ui.numInput(draft.principal, { placeholder: 'optional' });
    var rateIn = ui.numInput(draft.interestPct, { step: '0.01' });
    var providerIn = ui.textInput(draft.provider, { placeholder: 'Bank, Leasinggeber' });
    var noteIn = ui.textInput(draft.note, { placeholder: 'optional' });

    var typeSel = ui.select(
      Object.keys(C.DEBT_TYPES).map(function (t) { return { value: t, label: C.debtTypeLabel(t) }; }),
      draft.type, function (v) { draft.type = v; }
    );
    var ownerSel = ui.select(ui.ownerOptions(state), draft.owner, function (v) {
      draft.owner = v;
      paintRate();
    });

    /* --- Rate: verknüpfen oder eigenständig --- */

    var rateWrap = U.el('div', {});
    var payIn = ui.numInput(draft.paymentMonthly, { placeholder: '0,00' });
    var newAmountIn = ui.numInput(null, { placeholder: '0,00' });
    var mode = draft.linkedItemId ? 'link' : (draft.paymentMonthly != null ? 'own' : 'link');

    function linkedElsewhere(itemId) {
      return state.debts.some(function (x) {
        return x.id !== draft.id && x.linkedItemId === itemId;
      });
    }

    function itemOptions() {
      var opts = [{ value: '', label: '— Posten wählen —' }, { value: '__new__', label: '→ Neuen Ratenposten anlegen' }];
      state.items
        .filter(function (it) { return it.kind === 'expense'; })
        .sort(function (a, b) { return a.label.localeCompare(b.label, 'de'); })
        .forEach(function (it) {
          opts.push({
            value: it.id,
            label: it.label + ' — ' + S.ownerName(it.owner) + ' · ' +
              U.currency(C.perMonthAt(it, U.monthKey()), { digits: 0 }) + '/Mon.' +
              (linkedElsewhere(it.id) ? ' (bereits verknüpft)' : '')
          });
        });
      return opts;
    }

    function paintRate() {
      U.clear(rateWrap);

      rateWrap.appendChild(ui.field('Woher kommt die Rate?', ui.select([
        { value: 'link', label: 'Aus einem Posten im Budget' },
        { value: 'own', label: 'Nur hier eintragen (nicht im Budget)' }
      ], mode, function (v) { mode = v; paintRate(); }),
        'Ein verknüpfter Posten ist der Regelfall — die Zahlung steht dann genau einmal im Budget.'));

      if (mode === 'link') {
        rateWrap.appendChild(ui.field('Posten',
          ui.select(itemOptions(), draft.linkedItemId || '', function (v) {
            draft.linkedItemId = v === '' ? null : v;
            paintRate();
          })));

        if (draft.linkedItemId === '__new__') {
          rateWrap.appendChild(U.el('div', { class: 'form-grid' }, [
            ui.field('Monatsrate (€)', newAmountIn)
          ]));
          rateWrap.appendChild(U.el('div', { class: 'callout' }, [
            'Es wird ein Posten „' + (labelIn.value.trim() || 'Kredit') + ' (Rate)" in der Kategorie ' +
            '„Kredite & Zinsen" für ' + S.ownerName(draft.owner) + ' angelegt und verknüpft.'
          ]));
        }
      } else {
        rateWrap.appendChild(ui.field('Monatsrate (€)', payIn,
          'Wirkt sich nicht auf Budget und Saldo aus — nur auf die Tilgungsrechnung.'));
      }
      paintPreview();
    }

    /* --- Vorschau der Tilgung --- */

    var preview = U.el('div', { class: 'callout' });

    function draftPayment() {
      if (mode === 'own') return U.parseNum(payIn.value);
      if (draft.linkedItemId === '__new__') return U.parseNum(newAmountIn.value);
      var it = draft.linkedItemId ? U.byId(state.items, draft.linkedItemId) : null;
      return it ? C.perMonthAt(it, U.monthKey()) : 0;
    }

    function paintPreview() {
      var balance = U.parseNum(balanceIn.value);
      var pay = draftPayment();
      var pct = U.parseNum(rateIn.value);
      var monthlyInterest = balance * pct / 100 / 12;

      if (!balance || !pay) {
        preview.classList.remove('warn');
        preview.textContent = 'Restschuld und Rate eintragen, dann erscheint hier die Laufzeit.';
        return;
      }
      if (pay <= monthlyInterest) {
        preview.classList.add('warn');
        preview.textContent = 'Die Rate von ' + U.currency(pay, { digits: 0 }) +
          ' liegt unter den monatlichen Zinsen von ' + U.currency(monthlyInterest, { digits: 2 }) +
          ' — bei diesen Werten wächst die Schuld, statt zu sinken.';
        return;
      }
      preview.classList.remove('warn');
      var sch = C.debtSchedule(state, {
        balance: balance, interestPct: pct, paymentMonthly: pay, linkedItemId: null
      });
      preview.textContent = 'Bei ' + U.currency(pay, { digits: 0 }) + ' im Monat schuldenfrei in ' +
        U.num(sch.years, 1) + ' Jahren (' + U.monthLabel(sch.payoffKey, 'long') + '), ' +
        U.currency(sch.totalInterest, { digits: 0 }) + ' Zinsen insgesamt. ' +
        'Aktuell entfallen ' + U.currency(monthlyInterest, { digits: 0 }) + ' der Rate auf Zinsen.';
    }

    [balanceIn, rateIn, payIn, newAmountIn].forEach(function (el) {
      el.addEventListener('input', paintPreview);
    });
    paintRate();

    ui.openModal({
      title: isNew ? 'Kredit hinzufügen' : 'Kredit bearbeiten',
      wide: true,
      body: U.el('div', {}, [
        U.el('div', { class: 'form-grid' }, [
          ui.field('Bezeichnung', labelIn, null, 'full'),
          ui.field('Kreditart', typeSel),
          ui.field('Träger', ownerSel, 'Wer haftet für diesen Kredit?'),
          ui.field('Restschuld (€)', balanceIn, 'Was heute noch offen ist'),
          ui.field('Ursprüngliche Summe (€)', principalIn, 'Optional, zeigt den Tilgungsfortschritt'),
          ui.field('Sollzins (% p. a.)', rateIn),
          ui.field('Kreditgeber', providerIn),
          ui.field('Notiz', noteIn, null, 'full')
        ]),
        U.el('div', { class: 'section-title', text: 'Rate' }),
        rateWrap,
        preview
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Hinzufügen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var label = labelIn.value.trim();
            if (!label) { labelIn.focus(); ui.toast('Bitte eine Bezeichnung eingeben.', 'err'); return; }
            var balance = U.parseNum(balanceIn.value);
            if (balance < 0) { balanceIn.focus(); ui.toast('Die Restschuld darf nicht negativ sein.', 'err'); return; }

            var makeNew = mode === 'link' && draft.linkedItemId === '__new__';
            var newAmount = U.parseNum(newAmountIn.value);
            if (makeNew && newAmount <= 0) {
              newAmountIn.focus();
              ui.toast('Bitte eine Rate größer als 0 eingeben.', 'err');
              return;
            }

            draft.label = label;
            draft.type = typeSel.value;
            draft.owner = ownerSel.value;
            draft.balance = balance;
            draft.principal = principalIn.value === '' ? null : U.parseNum(principalIn.value);
            draft.interestPct = U.parseNum(rateIn.value);
            draft.provider = providerIn.value.trim();
            draft.note = noteIn.value.trim();

            if (mode === 'own') {
              draft.linkedItemId = null;
              draft.paymentMonthly = U.parseNum(payIn.value);
            } else {
              draft.paymentMonthly = null;
            }

            S.update(function (st) {
              if (makeNew) {
                var item = {
                  id: U.uid('itm'),
                  label: label + ' (Rate)',
                  amount: newAmount,
                  interval: 'monthly',
                  kind: 'expense',
                  owner: draft.owner,
                  categoryId: C.fallbackCategory(st, 'expense', 'cat_debt'),
                  start: null, end: null, dueMonth: null, growth: null,
                  active: true,
                  note: 'Rate für ' + label
                };
                st.items.push(item);
                draft.linkedItemId = item.id;
              }

              if (isNew) st.debts.push(draft);
              else {
                var i = st.debts.findIndex(function (x) { return x.id === draft.id; });
                if (i > -1) st.debts[i] = draft;
              }
            }, 'debts');

            ui.toast(makeNew ? 'Kredit und Ratenposten angelegt.' : (isNew ? 'Kredit hinzugefügt.' : 'Kredit gespeichert.'));
            close();
          }
        }
      ]
    });
  }

  function remove(d) {
    var link = d.linkedItemId ? U.byId(S.state.items, d.linkedItemId) : null;
    ui.confirm({
      title: 'Kredit löschen',
      text: '„' + d.label + '" wird entfernt.',
      detail: link
        ? 'Der verknüpfte Posten „' + link.label + '" bleibt erhalten — er ist eine echte Zahlung. ' +
          'Ohne den Kredit läuft er allerdings unbegrenzt weiter; setze bei Bedarf ein Enddatum.'
        : 'Das Nettovermögen steigt dadurch um ' + U.currency(d.balance || 0, { digits: 0 }) + '.',
      confirmLabel: 'Löschen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      S.update(function (st) {
        st.debts = st.debts.filter(function (x) { return x.id !== d.id; });
      }, 'debts');
      ui.toast('Kredit gelöscht.');
    });
  }

  HB.views.debts = { render: render };
})(window.HB);
