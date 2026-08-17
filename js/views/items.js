/* ---------------------------------------------------------------------------
   views/items.js — wiederkehrende Einnahmen und Ausgaben
   Jeder Posten hat ein Intervall und wird für alle Auswertungen auf einen
   Monatsbetrag normalisiert.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  var view = { owner: '', kind: '', category: '', q: '', showInactive: false };

  function render(root, params) {
    var state = S.state;

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Wiederkehrende Posten' }),
        U.el('p', {
          class: 'lede',
          text: 'Fixe Einnahmen und Ausgaben mit Intervall. Ein Jahresposten von 1.200 € zählt in der Monatsrechnung mit 100 €.'
        })
      ]),
      U.el('div', { class: 'inline-actions' }, [
        U.el('button', { class: 'btn btn-sm', text: 'Kategorien', onclick: manageCategories }),
        U.el('button', { class: 'btn btn-primary', text: 'Posten hinzufügen', onclick: function () { edit(null); } })
      ])
    ]));

    root.appendChild(filterbar(state));

    var rows = filtered(state);

    if (!state.items.length) {
      root.appendChild(ui.card({
        body: ui.emptyState(
          'Noch keine Posten',
          'Erfasse Gehalt, Miete, Versicherungen und alles andere, was regelmäßig fließt.',
          U.el('button', { class: 'btn btn-primary', text: 'Ersten Posten anlegen', onclick: function () { edit(null); } })
        )
      }));
    } else {
      root.appendChild(summaryStrip(state, rows));
      root.appendChild(table(state, rows));
    }

    if (params && params.create) edit(null);
  }

  /* --- Filter ------------------------------------------------------------- */

  function filterbar(state) {
    var bar = U.el('div', { class: 'filterbar' });

    bar.appendChild(ui.field('Suche', ui.textInput(view.q, {
      placeholder: 'Bezeichnung …',
      oninput: U.debounce(function (e) { view.q = e.target.value; HB.app.repaint(); }, 220)
    })));

    bar.appendChild(ui.field('Art', ui.select([
      { value: '', label: 'Einnahmen & Ausgaben' },
      { value: 'income', label: 'nur Einnahmen' },
      { value: 'expense', label: 'nur Ausgaben' }
    ], view.kind, function (v) { view.kind = v; HB.app.repaint(); })));

    bar.appendChild(ui.field('Träger', ui.select(
      ui.ownerOptions(state, { all: true }), view.owner,
      function (v) { view.owner = v; HB.app.repaint(); }
    )));

    bar.appendChild(ui.field('Kategorie', ui.select(
      ui.categoryOptions(state, view.kind || null, { all: true }), view.category,
      function (v) { view.category = v; HB.app.repaint(); }
    )));

    bar.appendChild(ui.field('', U.el('label', { class: 'checkline' }, [
      U.el('input', {
        type: 'checkbox', checked: view.showInactive,
        onchange: function (e) { view.showInactive = e.target.checked; HB.app.repaint(); }
      }),
      U.el('span', { text: 'Pausierte anzeigen' })
    ])));

    return bar;
  }

  function filtered(state) {
    var q = view.q.trim().toLowerCase();
    return state.items.filter(function (it) {
      if (!view.showInactive && it.active === false) return false;
      if (view.kind && it.kind !== view.kind) return false;
      if (view.owner && it.owner !== view.owner) return false;
      if (view.category && it.categoryId !== view.category) return false;
      if (q && it.label.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'income' ? -1 : 1;
      return C.perMonth(b) - C.perMonth(a);
    });
  }

  /* --- Kopfzahlen --------------------------------------------------------- */

  function summaryStrip(state, rows) {
    var inc = U.sum(rows.filter(function (r) { return r.kind === 'income' && r.active !== false; }), C.perMonth);
    var exp = U.sum(rows.filter(function (r) { return r.kind === 'expense' && r.active !== false; }), C.perMonth);

    return U.el('div', { class: 'grid grid-3', style: { marginBottom: '16px' } }, [
      ui.stat({ label: 'Einnahmen in der Auswahl', value: U.currency(inc, { digits: 0 }), sub: U.currency(inc * 12, { digits: 0 }) + ' pro Jahr' }),
      ui.stat({ label: 'Ausgaben in der Auswahl', value: U.currency(exp, { digits: 0 }), sub: U.currency(exp * 12, { digits: 0 }) + ' pro Jahr' }),
      ui.stat({
        label: 'Saldo der Auswahl', value: U.currency(inc - exp, { digits: 0, sign: true }),
        tone: ui.toneClass(inc - exp), sub: rows.length + ' von ' + state.items.length + ' Posten'
      })
    ]);
  }

  /* --- Tabelle ------------------------------------------------------------ */

  function table(state, rows) {
    if (!rows.length) {
      return ui.card({ body: ui.emptyState('Kein Treffer', 'Kein Posten passt zu den aktuellen Filtern.') });
    }

    var totalMonth = U.sum(rows, function (r) {
      return (r.active === false ? 0 : 1) * (r.kind === 'income' ? C.perMonth(r) : -C.perMonth(r));
    });

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Bezeichnung' }),
            U.el('th', { text: 'Träger' }),
            U.el('th', { text: 'Kategorie' }),
            U.el('th', { text: 'Intervall' }),
            U.el('th', { class: 'num', text: 'Betrag' }),
            U.el('th', { class: 'num', text: 'pro Monat' }),
            U.el('th', { class: 'num', text: 'pro Jahr' }),
            U.el('th', { text: 'Zeitraum' }),
            U.el('th', { class: 'num', text: '' })
          ])),
          U.el('tbody', {}, rows.map(function (it) { return itemRow(state, it); })),
          U.el('tfoot', {}, U.el('tr', {}, [
            U.el('td', { colspan: 5, text: 'Saldo der Auswahl' }),
            U.el('td', { class: 'num ' + ui.toneClass(totalMonth), text: U.currency(totalMonth, { digits: 0, sign: true }) }),
            U.el('td', { class: 'num ' + ui.toneClass(totalMonth), text: U.currency(totalMonth * 12, { digits: 0, sign: true }) }),
            U.el('td', { colspan: 2, text: '' })
          ]))
        ])
      ])
    });
  }

  function itemRow(state, it) {
    var m = C.perMonth(it);
    var paused = it.active === false;

    return U.el('tr', { class: paused ? 'row-muted' : '' }, [
      U.el('td', {}, [
        U.el('div', {}, [
          U.el('span', { style: { fontWeight: '500' }, text: it.label }),
          paused ? U.el('span', { class: 'badge', text: 'pausiert', style: { marginLeft: '6px' } }) : null
        ]),
        it.note ? U.el('div', { class: 'small muted', text: it.note }) : null
      ]),
      U.el('td', {}, ui.personSwatch(it.owner)),
      U.el('td', {}, [
        U.el('span', { text: S.categoryName(it.categoryId) }),
        C.isSavingCategory(state, it.categoryId)
          ? U.el('span', { class: 'badge pos', style: { marginLeft: '6px' }, text: 'Sparen' }) : null
      ]),
      U.el('td', { text: C.INTERVALS[it.interval].label }),
      U.el('td', { class: 'num', text: U.currency(it.amount, { digits: 2 }) }),
      U.el('td', { class: 'num ' + (it.kind === 'income' ? 'num-pos' : ''), text: U.currency(m, { digits: 0 }) }),
      U.el('td', { class: 'num', text: U.currency(m * 12, { digits: 0 }) }),
      U.el('td', { class: 'small muted', text: rangeLabel(it) }),
      U.el('td', {}, U.el('div', { class: 'row-actions' }, [
        ui.iconBtn('copy', 'Duplizieren', function () { duplicate(it); }),
        ui.iconBtn('edit', 'Bearbeiten', function () { edit(it); }),
        ui.iconBtn('trash', 'Löschen', function () { remove(it); })
      ]))
    ]);
  }

  function rangeLabel(it) {
    if (!it.start && !it.end) return 'laufend';
    if (it.start && !it.end) return 'ab ' + U.monthLabel(it.start);
    if (!it.start && it.end) return 'bis ' + U.monthLabel(it.end);
    return U.monthLabel(it.start) + ' – ' + U.monthLabel(it.end);
  }

  /* --- Bearbeiten --------------------------------------------------------- */

  function edit(it) {
    var isNew = !it;
    var state = S.state;
    var draft = it ? U.deepClone(it) : {
      id: U.uid('itm'), label: '', amount: null, interval: 'monthly',
      kind: 'expense', owner: 'household', categoryId: 'cat_other',
      start: null, end: null, active: true, note: ''
    };

    var labelIn = ui.textInput(draft.label, { placeholder: 'z. B. Miete' });
    var amountIn = ui.numInput(draft.amount, { placeholder: '0,00' });
    var intervalSel = ui.select(ui.intervalOptions(), draft.interval);
    var ownerSel = ui.select(ui.ownerOptions(state), draft.owner);
    var startIn = ui.monthInput(draft.start);
    var endIn = ui.monthInput(draft.end);
    var noteIn = ui.textInput(draft.note, { placeholder: 'optional' });
    var activeIn = U.el('input', { type: 'checkbox', checked: draft.active !== false });

    var catField = U.el('div', {});
    function paintCat() {
      U.clear(catField);
      catField.appendChild(ui.select(
        ui.categoryOptions(state, draft.kind), draft.categoryId,
        function (v) { draft.categoryId = v; }
      ));
    }

    var kindSel = ui.select([
      { value: 'expense', label: 'Ausgabe' },
      { value: 'income', label: 'Einnahme' }
    ], draft.kind, function (v) {
      draft.kind = v;
      var first = ui.categoryOptions(state, v)[0];
      draft.categoryId = first ? first.value : draft.categoryId;
      paintCat();
    });
    paintCat();

    var preview = U.el('div', { class: 'callout' });
    function paintPreview() {
      var amt = U.parseNum(amountIn.value);
      var per = (C.INTERVALS[intervalSel.value] || C.INTERVALS.monthly).perMonth;
      preview.textContent = 'Entspricht ' + U.currency(amt * per, { digits: 2 }) + ' pro Monat und ' +
        U.currency(amt * per * 12, { digits: 0 }) + ' pro Jahr.';
    }
    amountIn.addEventListener('input', paintPreview);
    intervalSel.addEventListener('change', paintPreview);
    paintPreview();

    ui.openModal({
      title: isNew ? 'Posten hinzufügen' : 'Posten bearbeiten',
      wide: true,
      body: U.el('div', {}, [
        U.el('div', { class: 'form-grid' }, [
          ui.field('Bezeichnung', labelIn, null, 'full'),
          ui.field('Art', kindSel),
          ui.field('Träger', ownerSel, 'Wer trägt diesen Posten?'),
          ui.field('Betrag (€)', amountIn),
          ui.field('Intervall', intervalSel),
          ui.field('Kategorie', catField, null, 'full'),
          ui.field('Läuft ab (optional)', startIn, 'Leer = seit jeher'),
          ui.field('Läuft bis (optional)', endIn, 'Leer = unbefristet'),
          ui.field('Notiz', noteIn, null, 'full'),
          ui.field('', U.el('label', { class: 'checkline' }, [activeIn, U.el('span', { text: 'Posten ist aktiv' })]), null, 'full')
        ]),
        preview
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Hinzufügen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var label = labelIn.value.trim();
            if (!label) { labelIn.focus(); ui.toast('Bitte eine Bezeichnung eingeben.', 'err'); return; }
            var amount = U.parseNum(amountIn.value);
            if (amount <= 0) { amountIn.focus(); ui.toast('Der Betrag muss größer als 0 sein.', 'err'); return; }
            if (startIn.value && endIn.value && U.monthIndex(endIn.value) < U.monthIndex(startIn.value)) {
              ui.toast('Das Enddatum liegt vor dem Startdatum.', 'err'); return;
            }

            draft.label = label;
            draft.amount = amount;
            draft.interval = intervalSel.value;
            draft.owner = ownerSel.value;
            draft.start = startIn.value || null;
            draft.end = endIn.value || null;
            draft.note = noteIn.value.trim();
            draft.active = activeIn.checked;

            S.update(function (st) {
              if (isNew) st.items.push(draft);
              else {
                var i = st.items.findIndex(function (x) { return x.id === draft.id; });
                if (i > -1) st.items[i] = draft;
              }
            }, 'items');
            ui.toast(isNew ? 'Posten hinzugefügt.' : 'Posten gespeichert.');
            close();
          }
        }
      ]
    });
  }

  function duplicate(it) {
    var copy = U.deepClone(it);
    copy.id = U.uid('itm');
    copy.label = it.label + ' (Kopie)';
    S.update(function (st) { st.items.push(copy); }, 'items');
    ui.toast('Posten dupliziert.');
  }

  function remove(it) {
    ui.confirm({
      title: 'Posten löschen',
      text: '„' + it.label + '“ wird dauerhaft entfernt.',
      detail: 'Szenario-Anpassungen, die sich auf diesen Posten beziehen, werden mitgelöscht.',
      confirmLabel: 'Löschen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      S.update(function (st) {
        st.items = st.items.filter(function (x) { return x.id !== it.id; });
        st.plans.forEach(function (pl) {
          pl.adjustments = pl.adjustments.filter(function (a) {
            return !(a.scope === 'item' && a.targetId === it.id);
          });
        });
      }, 'items');
      ui.toast('Posten gelöscht.');
    });
  }

  /* --- Kategorien --------------------------------------------------------- */

  function manageCategories() {
    var state = S.state;
    var body = U.el('div', {});

    function paint() {
      U.clear(body);

      var nameIn = ui.textInput('', { placeholder: 'Neue Kategorie' });
      var kindSel = ui.select([
        { value: 'expense', label: 'Ausgabe' },
        { value: 'income', label: 'Einnahme' }
      ], 'expense');
      var savingIn = U.el('input', { type: 'checkbox' });

      body.appendChild(U.el('div', { class: 'form-grid' }, [
        ui.field('Bezeichnung', nameIn),
        ui.field('Art', kindSel),
        ui.field('', U.el('label', { class: 'checkline' }, [savingIn, U.el('span', { text: 'zählt als Sparen' })])),
        ui.field('', U.el('button', {
          class: 'btn btn-primary', text: 'Hinzufügen',
          onclick: function () {
            var n = nameIn.value.trim();
            if (!n) { nameIn.focus(); return; }
            S.update(function (st) {
              st.categories.push({
                id: U.uid('cat'), name: n, kind: kindSel.value,
                system: false, saving: savingIn.checked
              });
            }, 'categories');
            paint();
          }
        }))
      ]));

      var used = {};
      state.items.forEach(function (i) { used[i.categoryId] = (used[i.categoryId] || 0) + 1; });
      state.transactions.forEach(function (t) { used[t.categoryId] = (used[t.categoryId] || 0) + 1; });

      body.appendChild(U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Kategorie' }),
            U.el('th', { text: 'Art' }),
            U.el('th', { class: 'num', text: 'Einträge' }),
            U.el('th', { class: 'num', text: '' })
          ])),
          U.el('tbody', {}, state.categories.map(function (c) {
            return U.el('tr', {}, [
              U.el('td', {}, [
                U.el('span', { text: c.name }),
                c.saving ? U.el('span', { class: 'badge pos', style: { marginLeft: '6px' }, text: 'Sparen' }) : null
              ]),
              U.el('td', { text: c.kind === 'income' ? 'Einnahme' : 'Ausgabe' }),
              U.el('td', { class: 'num', text: String(used[c.id] || 0) }),
              U.el('td', {}, U.el('div', { class: 'row-actions' }, [
                c.system || used[c.id]
                  ? U.el('span', { class: 'small muted', text: c.system ? 'Standard' : 'in Verwendung' })
                  : ui.iconBtn('trash', 'Löschen', function () {
                      S.update(function (st) {
                        st.categories = st.categories.filter(function (x) { return x.id !== c.id; });
                      }, 'categories');
                      paint();
                    })
              ]))
            ]);
          }))
        ])
      ]));
    }
    paint();

    ui.openModal({
      title: 'Kategorien verwalten', wide: true, body: body,
      actions: [{ label: 'Fertig', variant: 'btn-primary' }]
    });
  }

  HB.views.items = { render: render };
})(window.HB);
