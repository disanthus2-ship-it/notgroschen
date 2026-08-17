/* ---------------------------------------------------------------------------
   views/transactions.js — Einzelbuchungen mit Datum
   Ergänzen die wiederkehrenden Posten um alles, was nur einmal anfällt:
   Zahnarzt, Winterreifen, Steuerausgleich.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  var view = { month: null, owner: '', kind: '', category: '', q: '' };

  function render(root) {
    var state = S.state;
    if (view.month === null) view.month = U.monthKey();

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Einzelbuchungen' }),
        U.el('p', {
          class: 'lede',
          text: 'Einmalige Zahlungen mit konkretem Datum. Sie fließen zusätzlich zu den wiederkehrenden Posten in den jeweiligen Monat ein.'
        })
      ]),
      U.el('button', { class: 'btn btn-primary', text: 'Buchung erfassen', onclick: function () { edit(null); } })
    ]));

    root.appendChild(filterbar(state));

    if (view.month) root.appendChild(planVsActual(state));

    var rows = filtered(state);

    if (!state.transactions.length) {
      root.appendChild(ui.card({
        body: ui.emptyState(
          'Noch keine Buchungen',
          'Alles, was nicht regelmäßig wiederkehrt, gehört hierher.',
          U.el('button', { class: 'btn btn-primary', text: 'Erste Buchung erfassen', onclick: function () { edit(null); } })
        )
      }));
      return;
    }

    root.appendChild(table(state, rows));
  }

  /* --- Filter ------------------------------------------------------------- */

  function filterbar(state) {
    var bar = U.el('div', { class: 'filterbar' });

    bar.appendChild(ui.field('Monat', ui.monthInput(view.month, {
      onchange: function (e) { view.month = e.target.value; HB.app.repaint(); }
    }), 'leer = alle Monate'));

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

    bar.appendChild(U.el('div', { class: 'spacer' }));
    bar.appendChild(U.el('button', {
      class: 'btn btn-sm', text: 'Filter zurücksetzen',
      onclick: function () {
        view = { month: '', owner: '', kind: '', category: '', q: '' };
        HB.app.repaint();
      }
    }));

    return bar;
  }

  function filtered(state) {
    var q = view.q.trim().toLowerCase();
    return state.transactions.filter(function (t) {
      if (view.month && U.monthOfISO(t.date) !== view.month) return false;
      if (view.kind && t.kind !== view.kind) return false;
      if (view.owner && t.owner !== view.owner) return false;
      if (view.category && t.categoryId !== view.category) return false;
      if (q && t.label.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  /* --- Plan gegen Ist ----------------------------------------------------- */

  function planVsActual(state) {
    var plans = S.activePlans();
    var planSum = C.monthSummary(state, view.month, { plans: plans, includeTransactions: false });
    var actualSum = C.monthSummary(state, view.month, { plans: plans, includeTransactions: true });

    var dInc = actualSum.income - planSum.income;
    var dExp = actualSum.expense - planSum.expense;
    var dNet = actualSum.net - planSum.net;

    return U.el('div', { class: 'grid grid-3', style: { marginBottom: '16px' } }, [
      ui.stat({
        label: 'Einnahmen ' + U.monthLabel(view.month),
        value: U.currency(actualSum.income, { digits: 0 }),
        sub: deltaLine(dInc, 'gegenüber Plan', true)
      }),
      ui.stat({
        label: 'Ausgaben ' + U.monthLabel(view.month),
        value: U.currency(actualSum.expense, { digits: 0 }),
        sub: deltaLine(dExp, 'gegenüber Plan', false)
      }),
      ui.stat({
        label: 'Saldo ' + U.monthLabel(view.month),
        value: U.currency(actualSum.net, { digits: 0, sign: true }),
        tone: ui.toneClass(actualSum.net),
        sub: deltaLine(dNet, 'gegenüber Plan', true)
      })
    ]);
  }

  /** Ein Delta wird eingefärbt nach Richtung × ob „mehr“ hier gut ist. */
  function deltaLine(delta, label, upIsGood) {
    if (Math.abs(delta) < 0.5) return U.el('span', { class: 'muted', text: 'wie geplant' });
    var good = upIsGood ? delta > 0 : delta < 0;
    return U.el('span', { class: 'stat-delta ' + (good ? 'pos' : 'neg') }, [
      U.el('span', { text: (delta > 0 ? '▲ ' : '▼ ') + U.currency(Math.abs(delta), { digits: 0 }) + ' ' + label })
    ]);
  }

  /* --- Tabelle ------------------------------------------------------------ */

  function table(state, rows) {
    if (!rows.length) {
      return ui.card({ body: ui.emptyState('Kein Treffer', 'Keine Buchung passt zu den aktuellen Filtern.') });
    }

    var inc = U.sum(rows.filter(function (r) { return r.kind === 'income'; }), function (r) { return r.amount; });
    var exp = U.sum(rows.filter(function (r) { return r.kind === 'expense'; }), function (r) { return r.amount; });

    var byMonth = U.groupBy(rows, function (t) { return U.monthOfISO(t.date); });
    var monthKeys = Object.keys(byMonth).sort().reverse();

    var tbody = U.el('tbody', {});
    monthKeys.forEach(function (mk) {
      if (monthKeys.length > 1) {
        tbody.appendChild(U.el('tr', {}, U.el('td', {
          colspan: 6,
          class: 'small muted',
          style: { background: 'var(--surface-2)', fontWeight: '600' },
          text: U.monthLabel(mk, 'long')
        })));
      }
      byMonth[mk].forEach(function (t) { tbody.appendChild(txRow(t)); });
    });

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Datum' }),
            U.el('th', { text: 'Bezeichnung' }),
            U.el('th', { text: 'Träger' }),
            U.el('th', { text: 'Kategorie' }),
            U.el('th', { class: 'num', text: 'Betrag' }),
            U.el('th', { class: 'num', text: '' })
          ])),
          tbody,
          U.el('tfoot', {}, U.el('tr', {}, [
            U.el('td', { colspan: 4, text: rows.length + ' Buchungen' }),
            U.el('td', { class: 'num ' + ui.toneClass(inc - exp), text: U.currency(inc - exp, { digits: 0, sign: true }) }),
            U.el('td', { text: '' })
          ]))
        ])
      ]),
      foot: 'Einnahmen ' + U.currency(inc, { digits: 0 }) + ' · Ausgaben ' + U.currency(exp, { digits: 0 })
    });
  }

  function txRow(t) {
    return U.el('tr', {}, [
      U.el('td', { class: 'nowrap', text: U.dateLabel(t.date) }),
      U.el('td', {}, [
        U.el('div', { style: { fontWeight: '500' }, text: t.label }),
        t.note ? U.el('div', { class: 'small muted', text: t.note }) : null
      ]),
      U.el('td', {}, ui.personSwatch(t.owner)),
      U.el('td', { text: S.categoryName(t.categoryId) }),
      U.el('td', {
        class: 'num ' + (t.kind === 'income' ? 'num-pos' : ''),
        text: (t.kind === 'income' ? '+' : '−') + U.currency(Math.abs(t.amount), { digits: 2 })
      }),
      U.el('td', {}, U.el('div', { class: 'row-actions' }, [
        ui.iconBtn('edit', 'Bearbeiten', function () { edit(t); }),
        ui.iconBtn('trash', 'Löschen', function () { remove(t); })
      ]))
    ]);
  }

  /* --- Bearbeiten --------------------------------------------------------- */

  function edit(t) {
    var isNew = !t;
    var state = S.state;
    var draft = t ? U.deepClone(t) : {
      id: U.uid('tx'), date: U.todayISO(), label: '', amount: null,
      kind: 'expense', owner: 'household', categoryId: 'cat_other', note: ''
    };

    var dateIn = ui.dateInput(draft.date);
    var labelIn = ui.textInput(draft.label, { placeholder: 'z. B. Winterreifen' });
    var amountIn = ui.numInput(draft.amount, { placeholder: '0,00' });
    var ownerSel = ui.select(ui.ownerOptions(state), draft.owner);
    var noteIn = ui.textInput(draft.note, { placeholder: 'optional' });

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

    ui.openModal({
      title: isNew ? 'Buchung erfassen' : 'Buchung bearbeiten',
      body: U.el('div', { class: 'form-grid' }, [
        ui.field('Datum', dateIn),
        ui.field('Art', kindSel),
        ui.field('Bezeichnung', labelIn, null, 'full'),
        ui.field('Betrag (€)', amountIn),
        ui.field('Träger', ownerSel),
        ui.field('Kategorie', catField, null, 'full'),
        ui.field('Notiz', noteIn, null, 'full')
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Erfassen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var label = labelIn.value.trim();
            if (!label) { labelIn.focus(); ui.toast('Bitte eine Bezeichnung eingeben.', 'err'); return; }
            var amount = U.parseNum(amountIn.value);
            if (amount <= 0) { amountIn.focus(); ui.toast('Der Betrag muss größer als 0 sein.', 'err'); return; }
            if (!dateIn.value) { dateIn.focus(); ui.toast('Bitte ein Datum wählen.', 'err'); return; }

            draft.date = dateIn.value;
            draft.label = label;
            draft.amount = amount;
            draft.owner = ownerSel.value;
            draft.note = noteIn.value.trim();

            S.update(function (st) {
              if (isNew) st.transactions.unshift(draft);
              else {
                var i = st.transactions.findIndex(function (x) { return x.id === draft.id; });
                if (i > -1) st.transactions[i] = draft;
              }
            }, 'transactions');
            ui.toast(isNew ? 'Buchung erfasst.' : 'Buchung gespeichert.');
            close();
          }
        }
      ]
    });
  }

  function remove(t) {
    ui.confirm({
      title: 'Buchung löschen',
      text: '„' + t.label + '“ vom ' + U.dateLabel(t.date) + ' wird entfernt.',
      confirmLabel: 'Löschen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      S.update(function (st) {
        st.transactions = st.transactions.filter(function (x) { return x.id !== t.id; });
      }, 'transactions');
      ui.toast('Buchung gelöscht.');
    });
  }

  HB.views.transactions = { render: render };
})(window.HB);
