/* ---------------------------------------------------------------------------
   views/investments.js — Geldanlagen je Person und gemeinsam
   Die Vermögensseite: Bestand, Einstand, Renditeerwartung. Der zugehörige
   Geldfluss bleibt in „Posten"; ein Investment verweist nur darauf.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  var view = { owner: '', type: '' };

  function render(root) {
    var state = S.state;
    var p = C.investmentSummary(state);

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Investments' }),
        U.el('p', {
          class: 'lede',
          text: 'Aktien, Fonds, Fixzinssparen und alles andere, was Vermögen bildet — je Person oder gemeinsam. ' +
                'Der Bestand fließt in Projektion und FIRE-Rechnung ein.'
        })
      ]),
      U.el('button', {
        class: 'btn btn-primary', text: 'Investment hinzufügen',
        onclick: function () { edit(null); }
      })
    ]));

    if (!state.investments.length) {
      root.appendChild(ui.card({
        body: ui.emptyState(
          'Noch keine Investments',
          'Erfasse Depot, Sparbuch, Bausparer oder Vorsorgeprodukte. Läuft dazu ein Sparplan, lässt er sich mit dem passenden Posten verknüpfen, damit die Rate nur einmal im Budget zählt.',
          U.el('button', {
            class: 'btn btn-primary', text: 'Erstes Investment anlegen',
            onclick: function () { edit(null); }
          })
        )
      }));
      return;
    }

    root.appendChild(kpis(state, p));

    root.appendChild(U.el('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, [
      allocationCard(state, p),
      ownerCard(state, p)
    ]));

    root.appendChild(U.el('div', { class: 'section-title', text: 'Bestand' }));
    root.appendChild(filterbar(state));
    root.appendChild(table(state, p));
  }

  /* --- Kennzahlen --------------------------------------------------------- */

  function kpis(state, p) {
    var other = Number(state.household.assets) || 0;
    var grid = U.el('div', { class: 'grid grid-4' });

    var debt = C.totalDebt(state);
    grid.appendChild(ui.stat({
      label: debt ? 'Nettovermögen' : 'Gesamtvermögen',
      value: U.currency(p.total + other - debt, { digits: 0 }),
      hero: true,
      tone: ui.toneClass(p.total + other - debt),
      sub: debt
        ? U.currency(p.total + other, { digits: 0 }) + ' Vermögen − ' +
          U.currency(debt, { digits: 0 }) + ' Schulden'
        : U.currency(p.total, { digits: 0 }) + ' investiert · ' +
          U.currency(other, { digits: 0 }) + ' sonstiges Vermögen'
    }));

    grid.appendChild(ui.stat({
      label: 'Investiertes Kapital',
      value: U.currency(p.total, { digits: 0 }),
      sub: p.count + (p.count === 1 ? ' Position' : ' Positionen') +
        (p.liquid ? ' · ' + U.currency(p.liquid, { digits: 0 }) + ' davon liquide' : '')
    }));

    grid.appendChild(ui.stat({
      label: 'Gewinn / Verlust',
      value: p.cost > 0 ? U.currency(p.gain, { digits: 0, sign: true }) : '—',
      tone: p.cost > 0 ? ui.toneClass(p.gain) : '',
      sub: p.cost > 0
        ? U.pct(p.gainPct, 1) + ' auf ' + U.currency(p.cost, { digits: 0 }) + ' Einstand'
        : 'Kein Einstandswert hinterlegt'
    }));

    grid.appendChild(ui.stat({
      label: 'Erwartete Rendite',
      value: p.weightedReturn == null ? '—' : U.num(p.weightedReturn, 2) + ' %',
      sub: p.weightedReturn == null
        ? 'Keine Renditeerwartung hinterlegt'
        : 'nach Wert gewichtet, p. a. nominal'
    }));

    return grid;
  }

  /* --- Aufteilung nach Anlageart ------------------------------------------ */

  /**
   * Farbe folgt der Anlageart, nicht ihrer Größe: die Zuordnung richtet sich
   * nach der festen Reihenfolge in INVESTMENT_TYPES, damit ein Typ seine Farbe
   * behält, wenn sich die Beträge verschieben. Ab dem achten Typ wird gefaltet.
   */
  function typeEntries(p) {
    var canonical = Object.keys(C.INVESTMENT_TYPES);
    var present = canonical.filter(function (t) { return p.byType[t] > 0; });

    var entries = present.slice(0, 7).map(function (t, i) {
      return { key: t, label: C.typeLabel(t), value: p.byType[t], color: U.seriesColor(i) };
    });

    var rest = present.slice(7);
    if (rest.length) {
      entries.push({
        key: '__rest__',
        label: 'Weitere (' + rest.length + ')',
        value: U.sum(rest, function (t) { return p.byType[t]; }),
        color: U.token('--text-muted')
      });
    }
    return entries.sort(function (a, b) { return b.value - a.value; });
  }

  function allocationCard(state, p) {
    var entries = typeEntries(p);

    var bar = U.el('div', {
      class: 'alloc-bar', role: 'img',
      'aria-label': 'Aufteilung des Portfolios nach Anlageart'
    }, entries.map(function (e) {
      return U.el('span', {
        style: { background: e.color, flex: String(e.value) },
        title: e.label + ': ' + U.currency(e.value, { digits: 0 })
      });
    }));

    var rows = U.el('div', { class: 'alloc-rows' }, entries.map(function (e) {
      return U.el('div', { class: 'alloc-row' }, [
        U.el('span', { class: 'dot', style: { background: e.color } }),
        U.el('span', { class: 'name', text: e.label }),
        U.el('span', { class: 'val', text: U.currency(e.value, { digits: 0 }) }),
        U.el('span', { class: 'share', text: p.total ? U.pct(e.value / p.total, 1) : '—' })
      ]);
    }));

    return ui.card({
      title: 'Aufteilung nach Anlageart',
      sub: entries.length + (entries.length === 1 ? ' Anlageart' : ' Anlagearten'),
      body: U.el('div', {}, [bar, rows])
    });
  }

  /* --- Aufteilung nach Träger --------------------------------------------- */

  function ownerCard(state, p) {
    var owners = Object.keys(p.byOwner).sort(function (a, b) {
      return p.byOwner[b] - p.byOwner[a];
    });

    return ui.card({
      title: 'Nach Träger',
      sub: 'Wem gehört welcher Teil des Portfolios',
      body: U.el('div', { class: 'stack' }, owners.map(function (o) {
        var v = p.byOwner[o];
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
                width: (p.total ? (v / p.total) * 100 : 0) + '%',
                background: S.ownerColor(o)
              }
            })
          ]),
          U.el('div', { class: 'meter-legend' }, [
            U.el('span', { text: p.total ? U.pct(v / p.total, 1) + ' des Portfolios' : '' }),
            U.el('span', { text: countFor(state, o) })
          ])
        ]);
      }))
    });
  }

  function countFor(state, owner) {
    var n = state.investments.filter(function (i) { return i.owner === owner; }).length;
    return n + (n === 1 ? ' Position' : ' Positionen');
  }

  /* --- Filter & Tabelle --------------------------------------------------- */

  function filterbar(state) {
    var bar = U.el('div', { class: 'filterbar' });

    bar.appendChild(ui.field('Träger', ui.select(
      ui.ownerOptions(state, { all: true }), view.owner,
      function (v) { view.owner = v; HB.app.repaint(); }
    )));

    var typeOpts = [{ value: '', label: 'Alle Anlagearten' }].concat(
      Object.keys(C.INVESTMENT_TYPES)
        .filter(function (t) {
          return state.investments.some(function (i) { return i.type === t; });
        })
        .map(function (t) { return { value: t, label: C.typeLabel(t) }; })
    );
    bar.appendChild(ui.field('Anlageart', ui.select(typeOpts, view.type,
      function (v) { view.type = v; HB.app.repaint(); })));

    return bar;
  }

  function filtered(state) {
    return state.investments.filter(function (inv) {
      if (view.owner && inv.owner !== view.owner) return false;
      if (view.type && inv.type !== view.type) return false;
      return true;
    }).sort(function (a, b) { return (b.currentValue || 0) - (a.currentValue || 0); });
  }

  function table(state, p) {
    var rows = filtered(state);
    if (!rows.length) {
      return ui.card({ body: ui.emptyState('Kein Treffer', 'Kein Investment passt zu den aktuellen Filtern.') });
    }

    var sumValue = U.sum(rows, function (r) { return Number(r.currentValue) || 0; });
    var sumCost = U.sum(rows, function (r) { return r.costBasis == null ? 0 : Number(r.costBasis); });
    var sumContrib = U.sum(rows, function (r) {
      var it = r.linkedItemId ? U.byId(state.items, r.linkedItemId) : null;
      return it && it.active !== false ? C.perMonth(it) : 0;
    });

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Bezeichnung' }),
            U.el('th', { text: 'Anlageart' }),
            U.el('th', { text: 'Träger' }),
            U.el('th', { class: 'num', text: 'Einstand' }),
            U.el('th', { class: 'num', text: 'Aktueller Wert' }),
            U.el('th', { class: 'num', text: 'Gewinn' }),
            U.el('th', { class: 'num', text: 'Rendite p. a.' }),
            U.el('th', { text: 'Reserve' }),
            U.el('th', { text: 'Sparplan' }),
            U.el('th', { class: 'num', text: '' })
          ])),
          U.el('tbody', {}, rows.map(function (inv) { return row(state, inv); })),
          U.el('tfoot', {}, U.el('tr', {}, [
            U.el('td', { colspan: 3, text: rows.length + ' von ' + state.investments.length + ' Positionen' }),
            U.el('td', { class: 'num', text: sumCost ? U.currency(sumCost, { digits: 0 }) : '—' }),
            U.el('td', { class: 'num', text: U.currency(sumValue, { digits: 0 }) }),
            U.el('td', { class: 'num ' + ui.toneClass(sumValue - sumCost), text: sumCost ? U.currency(sumValue - sumCost, { digits: 0, sign: true }) : '—' }),
            U.el('td', { class: 'num', text: p.weightedReturn == null ? '—' : U.num(p.weightedReturn, 2) + ' %' }),
            U.el('td', { text: '' }),
            U.el('td', { text: sumContrib ? U.currency(sumContrib, { digits: 0 }) + ' / Monat' : '' }),
            U.el('td', { text: '' })
          ]))
        ])
      ]),
      foot: 'Die Spalte „Sparplan" verweist auf den Posten, der die Einzahlung im Budget abbildet. ' +
            'Das Investment selbst erzeugt keinen Geldfluss — so kann nichts doppelt zählen.'
    });
  }

  function row(state, inv) {
    var value = Number(inv.currentValue) || 0;
    var cost = inv.costBasis == null ? null : Number(inv.costBasis);
    var gain = cost == null ? null : value - cost;
    var link = inv.linkedItemId ? U.byId(state.items, inv.linkedItemId) : null;

    return U.el('tr', {}, [
      U.el('td', {}, [
        U.el('div', { style: { fontWeight: '500' }, text: inv.label }),
        inv.provider ? U.el('div', { class: 'small muted', text: inv.provider }) : null,
        inv.note ? U.el('div', { class: 'small muted', text: inv.note }) : null
      ]),
      U.el('td', { text: C.typeLabel(inv.type) }),
      U.el('td', {}, ui.personSwatch(inv.owner)),
      U.el('td', { class: 'num', text: cost == null ? '—' : U.currency(cost, { digits: 0 }) }),
      U.el('td', { class: 'num', style: { fontWeight: '600' }, text: U.currency(value, { digits: 0 }) }),
      U.el('td', {
        class: 'num ' + (gain == null ? '' : ui.toneClass(gain)),
        text: gain == null ? '—' : U.currency(gain, { digits: 0, sign: true }) +
              (cost > 0 ? ' (' + U.pct(gain / cost, 1) + ')' : '')
      }),
      U.el('td', { class: 'num', text: inv.expectedReturnPct == null ? '—' : U.num(inv.expectedReturnPct, 2) + ' %' }),
      U.el('td', {}, C.isLiquid(inv)
        ? U.el('span', { class: 'badge pos', text: 'liquide' })
        : U.el('span', { class: 'small muted', text: '—' })),
      U.el('td', {}, link
        ? U.el('div', {}, [
            U.el('div', { class: 'small', text: link.label }),
            U.el('div', { class: 'small muted', text: U.currency(C.perMonth(link), { digits: 0 }) + ' / Monat' })
          ])
        : U.el('span', { class: 'small muted', text: '—' })),
      U.el('td', {}, U.el('div', { class: 'row-actions' }, [
        ui.iconBtn('edit', 'Bearbeiten', function () { edit(inv); }),
        ui.iconBtn('trash', 'Löschen', function () { remove(inv); })
      ]))
    ]);
  }

  /* --- Bearbeiten --------------------------------------------------------- */

  function edit(inv) {
    var isNew = !inv;
    var state = S.state;
    var draft = inv ? U.deepClone(inv) : {
      id: U.uid('inv'), label: '', type: 'etf', owner: 'household',
      currentValue: null, costBasis: null,
      expectedReturnPct: C.INVESTMENT_TYPES.etf.defaultReturn,
      liquid: null, linkedItemId: null, provider: '', note: ''
    };

    var labelIn = ui.textInput(draft.label, { placeholder: 'z. B. MSCI World ETF' });
    var valueIn = ui.numInput(draft.currentValue, { placeholder: '0,00' });
    var costIn = ui.numInput(draft.costBasis, { placeholder: 'unbekannt' });
    var returnIn = ui.numInput(draft.expectedReturnPct, { step: '0.1', placeholder: 'ohne Erwartung' });
    var providerIn = ui.textInput(draft.provider, { placeholder: 'Depot, Bank, Broker' });
    var liquidIn = U.el('input', { type: 'checkbox', checked: C.isLiquid(draft) });
    var noteIn = ui.textInput(draft.note, { placeholder: 'optional' });
    var ownerSel = ui.select(ui.ownerOptions(state), draft.owner, function (v) {
      draft.owner = v;
      paintPlan();
    });

    var typeSel = ui.select(
      Object.keys(C.INVESTMENT_TYPES).map(function (t) {
        return { value: t, label: C.typeLabel(t) };
      }),
      draft.type,
      function (v) {
        var prevDefault = C.INVESTMENT_TYPES[draft.type].defaultReturn;
        draft.type = v;
        // Die Vorgabe nur nachziehen, solange sie nicht von Hand geändert wurde.
        if (returnIn.value === '' || U.parseNum(returnIn.value) === prevDefault) {
          returnIn.value = C.INVESTMENT_TYPES[v].defaultReturn;
        }
      }
    );

    /* --- Sparplan: verknüpfen oder gleich mit anlegen --- */

    var planWrap = U.el('div', {});
    var newAmountIn = ui.numInput(null, { placeholder: '0,00' });
    var newIntervalSel = ui.select(ui.intervalOptions(), 'monthly');
    var planSel;

    function linkedElsewhere(itemId) {
      return state.investments.some(function (x) {
        return x.id !== draft.id && x.linkedItemId === itemId;
      });
    }

    function planOptions() {
      var opts = [
        { value: '', label: 'Kein Sparplan' },
        { value: '__new__', label: '→ Neuen Sparplan-Posten anlegen' }
      ];
      state.items
        .filter(function (it) { return it.kind === 'expense'; })
        .sort(function (a, b) {
          var sa = C.isSavingCategory(state, a.categoryId) ? 0 : 1;
          var sb = C.isSavingCategory(state, b.categoryId) ? 0 : 1;
          return sa - sb || a.label.localeCompare(b.label, 'de');
        })
        .forEach(function (it) {
          var busy = linkedElsewhere(it.id);
          opts.push({
            value: it.id,
            label: it.label + ' — ' + S.ownerName(it.owner) + ' · ' +
                   U.currency(C.perMonth(it), { digits: 0 }) + '/Mon.' +
                   (busy ? ' (bereits verknüpft)' : '')
          });
        });
      return opts;
    }

    function paintPlan() {
      U.clear(planWrap);
      planSel = ui.select(planOptions(), draft.linkedItemId || '', function (v) {
        // '__new__' bleibt als Marker stehen und wird erst beim Speichern aufgelöst.
        draft.linkedItemId = v === '' ? null : v;
        paintPlan();
      });

      planWrap.appendChild(ui.field('Sparplan', planSel,
        'Der Geldfluss bleibt ein Posten im Budget; das Investment verweist nur darauf.'));

      if (draft.linkedItemId === '__new__') {
        planWrap.appendChild(U.el('div', { class: 'form-grid' }, [
          ui.field('Rate (€)', newAmountIn),
          ui.field('Intervall', newIntervalSel)
        ]));
        planWrap.appendChild(U.el('div', { class: 'callout' }, [
          'Es wird ein Posten „' + (labelIn.value.trim() || 'Investment') + ' (Sparplan)" in der Kategorie ' +
          '„Sparen & Vorsorge" für ' + S.ownerName(draft.owner) + ' angelegt und mit diesem Investment verknüpft.'
        ]));
      } else if (draft.linkedItemId && linkedElsewhere(draft.linkedItemId)) {
        planWrap.appendChild(U.el('div', { class: 'callout warn' }, [
          'Dieser Posten ist bereits einem anderen Investment zugeordnet. Das ist erlaubt, ' +
          'die Rate erscheint dann aber bei beiden — prüfe, ob das gewollt ist.'
        ]));
      }
    }
    paintPlan();

    var gainPreview = U.el('div', { class: 'callout' });
    function paintGain() {
      var v = U.parseNum(valueIn.value);
      if (costIn.value === '' || !v) {
        gainPreview.textContent = 'Ohne Einstandswert wird kein Gewinn ausgewiesen — der Bestand zählt trotzdem zum Vermögen.';
        return;
      }
      var c = U.parseNum(costIn.value);
      var g = v - c;
      gainPreview.textContent = 'Gewinn/Verlust: ' + U.currency(g, { digits: 2, sign: true }) +
        (c > 0 ? ' (' + U.pct(g / c, 1) + ' auf den Einstand)' : '');
    }
    valueIn.addEventListener('input', paintGain);
    costIn.addEventListener('input', paintGain);
    paintGain();

    ui.openModal({
      title: isNew ? 'Investment hinzufügen' : 'Investment bearbeiten',
      wide: true,
      body: U.el('div', {}, [
        U.el('div', { class: 'form-grid' }, [
          ui.field('Bezeichnung', labelIn, null, 'full'),
          ui.field('Anlageart', typeSel),
          ui.field('Träger', ownerSel, 'Wem gehört diese Position?'),
          ui.field('Aktueller Wert (€)', valueIn, 'Zählt zum Gesamtvermögen'),
          ui.field('Einstandswert (€)', costIn, 'Summe der Einzahlungen, optional'),
          ui.field('Erwartete Rendite (% p. a.)', returnIn, 'Vorgabe je Anlageart, frei änderbar'),
          ui.field('Anbieter', providerIn),
          ui.field('Zählt zum Notgroschen',
            U.el('label', { class: 'checkline' }, [liquidIn, U.el('span', { text: 'kurzfristig verfügbar' })]),
            'Nur was ohne Kursrisiko und ohne Bindung greifbar ist'),
          ui.field('Notiz', noteIn, null, 'full')
        ]),
        gainPreview,
        U.el('div', { class: 'section-title', text: 'Einzahlungen' }),
        planWrap
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Hinzufügen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var label = labelIn.value.trim();
            if (!label) { labelIn.focus(); ui.toast('Bitte eine Bezeichnung eingeben.', 'err'); return; }
            var value = U.parseNum(valueIn.value);
            if (value < 0) { valueIn.focus(); ui.toast('Der Wert darf nicht negativ sein.', 'err'); return; }

            var makeNew = draft.linkedItemId === '__new__';
            var newAmount = U.parseNum(newAmountIn.value);
            if (makeNew && newAmount <= 0) {
              newAmountIn.focus();
              ui.toast('Bitte eine Rate größer als 0 eingeben.', 'err');
              return;
            }

            draft.label = label;
            draft.type = typeSel.value;
            draft.owner = ownerSel.value;
            draft.currentValue = value;
            draft.costBasis = costIn.value === '' ? null : U.parseNum(costIn.value);
            draft.expectedReturnPct = returnIn.value === '' ? null : U.parseNum(returnIn.value);
            draft.provider = providerIn.value.trim();
            draft.note = noteIn.value.trim();
            // Nur speichern, wenn von der Vorgabe der Anlageart abgewichen wird.
            var typeDefault = !!(C.INVESTMENT_TYPES[draft.type] || {}).liquid;
            draft.liquid = liquidIn.checked === typeDefault ? null : liquidIn.checked;

            S.update(function (st) {
              if (makeNew) {
                var item = {
                  id: U.uid('itm'),
                  label: label + ' (Sparplan)',
                  amount: newAmount,
                  interval: newIntervalSel.value,
                  kind: 'expense',
                  owner: draft.owner,
                  categoryId: C.fallbackCategory(st, 'expense', 'cat_saving'),
                  start: null, end: null, active: true,
                  note: 'Einzahlung in ' + label
                };
                st.items.push(item);
                draft.linkedItemId = item.id;
              }

              if (isNew) st.investments.push(draft);
              else {
                var i = st.investments.findIndex(function (x) { return x.id === draft.id; });
                if (i > -1) st.investments[i] = draft;
              }
            }, 'investments');

            ui.toast(makeNew
              ? 'Investment und Sparplan-Posten angelegt.'
              : (isNew ? 'Investment hinzugefügt.' : 'Investment gespeichert.'));
            close();
          }
        }
      ]
    });
  }

  function remove(inv) {
    var link = inv.linkedItemId ? U.byId(S.state.items, inv.linkedItemId) : null;
    ui.confirm({
      title: 'Investment löschen',
      text: '„' + inv.label + '" wird aus dem Bestand entfernt.',
      detail: link
        ? 'Der verknüpfte Posten „' + link.label + '" bleibt erhalten — er ist eine echte Zahlung und gehört weiterhin ins Budget. Entferne ihn bei Bedarf unter „Posten".'
        : 'Das Gesamtvermögen sinkt dadurch um ' + U.currency(inv.currentValue || 0, { digits: 0 }) + '.',
      confirmLabel: 'Löschen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      S.update(function (st) {
        st.investments = st.investments.filter(function (x) { return x.id !== inv.id; });
      }, 'investments');
      ui.toast('Investment gelöscht.');
    });
  }

  HB.views.investments = { render: render };
})(window.HB);
