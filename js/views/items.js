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

  // sort.key === null heißt: Vorsortierung der Ansicht (Einnahmen zuerst,
  // dann nach Monatsbetrag absteigend).
  var view = {
    owner: '', kind: '', category: '', q: '', showInactive: false,
    sort: { key: null, dir: -1 }
  };

  function setSort(key, numeric) {
    ui.toggleSort(view.sort, key, numeric);
    HB.app.repaint();
  }

  function render(root, params) {
    var state = S.state;

    // Aufruf aus der Übersicht: Kategorie vorfiltern und nach Größe sortieren.
    if (params && params.category) {
      view.category = params.category;
      view.owner = '';
      view.q = '';
      view.kind = params.kind || '';
      view.sort = { key: 'perMonth', dir: -1 };
    }

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

    var rows = ui.applySort(filtered(state), view.sort, SORT_KEYS);

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

    var active = view.owner || view.kind || view.category || view.q || view.sort.key;
    if (active) {
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: 'Filter & Sortierung zurücksetzen',
        onclick: function () {
          view.owner = ''; view.kind = ''; view.category = ''; view.q = '';
          view.showInactive = false;
          view.sort = { key: null, dir: -1 };
          HB.app.repaint();
        }
      }));
    }

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

  /* --- Sortierung --------------------------------------------------------- */

  var SORT_KEYS = {
    label:    function (it) { return it.label; },
    owner:    function (it) { return S.ownerName(it.owner); },
    category: function (it) { return S.categoryName(it.categoryId); },
    interval: function (it) { return C.INTERVALS[it.interval].perMonth; },
    amount:   function (it) { return Number(it.amount) || 0; },
    perMonth: function (it) { return C.perMonthAt(it, U.monthKey()); },
    perYear:  function (it) { return C.perMonthAt(it, U.monthKey()) * 12; },
    range:    function (it) { return it.start ? U.monthIndex(it.start) : -Infinity; }
  };

  /* --- Kopfzahlen --------------------------------------------------------- */

  function summaryStrip(state, rows) {
    var now = U.monthKey();
    var at = function (r) { return C.perMonthAt(r, now); };
    var inc = U.sum(rows.filter(function (r) { return r.kind === 'income' && r.active !== false; }), at);
    var exp = U.sum(rows.filter(function (r) { return r.kind === 'expense' && r.active !== false; }), at);

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

    var now = U.monthKey();
    var totalMonth = U.sum(rows, function (r) {
      var v = C.perMonthAt(r, now);
      return (r.active === false ? 0 : 1) * (r.kind === 'income' ? v : -v);
    });

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            th('Bezeichnung', 'label'),
            th('Träger', 'owner'),
            th('Kategorie', 'category'),
            th('Intervall', 'interval', true),
            th('Betrag', 'amount', true),
            th('pro Monat', 'perMonth', true),
            th('pro Jahr', 'perYear', true),
            th('Zeitraum', 'range', true),
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

  function th(label, key, numeric) {
    return ui.thSort({
      label: label, key: key, num: numeric && key !== 'interval' && key !== 'range',
      sort: view.sort,
      onSort: function (k) { setSort(k, !!numeric); }
    });
  }

  function itemRow(state, it) {
    var m = C.perMonthAt(it, U.monthKey());
    var paused = it.active === false;

    return U.el('tr', { class: paused ? 'row-muted' : '' }, [
      U.el('td', {}, [
        U.el('div', {}, [
          U.el('span', { style: { fontWeight: '500' }, text: it.label }),
          paused ? U.el('span', { class: 'badge', text: 'pausiert', style: { marginLeft: '6px' } }) : null,
          it.dueMonth
            ? U.el('span', {
                class: 'badge', style: { marginLeft: '6px' },
                title: 'Kassenwirksam im ' + U.monthLabel('2000-' + U.pad2(it.dueMonth), 'long').replace(' 2000', ''),
                text: 'fällig ' + U.monthLabel('2000-' + U.pad2(it.dueMonth)).replace(' 2000', '')
              })
            : null,
          it.growth
            ? U.el('span', {
                class: 'badge info', style: { marginLeft: '6px' },
                title: 'Erste Steigerung ' + U.monthLabel(it.growth.from) +
                  (it.growth.until ? ', letzte ' + U.monthLabel(it.growth.until) : ''),
                text: C.growthLabel(it.growth)
              })
            : null,
          !it.growth && it.inflationLinked === false
            ? U.el('span', {
                class: 'badge', style: { marginLeft: '6px' },
                title: 'Steigt nicht mit der Inflation — nominell fest',
                text: 'nominell fest'
              })
            : null
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
      start: null, end: null, dueMonth: null, growth: null,
      inflationLinked: null, active: true, note: ''
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
      paintGrowth();
    });
    paintCat();

    /* --- Fälligkeit: nur sinnvoll bei Intervallen gröber als monatlich --- */

    var MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    var dueWrap = U.el('div', {});
    var dueValue = draft.dueMonth;

    function paintDue() {
      U.clear(dueWrap);
      var span = Math.round(C.intervalMonths(intervalSel.value));
      if (span <= 1) { dueValue = null; return; }

      var opts = [{ value: '', label: 'Gleichmäßig verteilt' }].concat(
        MONTHS.map(function (name, i) { return { value: String(i + 1), label: name }; })
      );
      dueWrap.appendChild(ui.field('Fällig im Monat',
        ui.select(opts, dueValue == null ? '' : String(dueValue), function (v) {
          dueValue = v === '' ? null : parseInt(v, 10);
          paintPreview();
        }),
        span === 12
          ? 'Bestimmt, wann der Betrag in der Liquiditätsvorschau tatsächlich abgeht.'
          : 'Ab diesem Monat alle ' + span + ' Monate. Ohne Angabe wird gleichmäßig verteilt.',
        'full'));
    }

    var preview = U.el('div', { class: 'callout' });
    function paintPreview() {
      var amt = U.parseNum(amountIn.value);
      var per = (C.INTERVALS[intervalSel.value] || C.INTERVALS.monthly).perMonth;
      var span = Math.round(C.intervalMonths(intervalSel.value));
      var txt = 'Entspricht ' + U.currency(amt * per, { digits: 2 }) + ' pro Monat und ' +
        U.currency(amt * per * 12, { digits: 0 }) + ' pro Jahr.';
      if (span > 1) {
        txt += dueValue == null
          ? ' In der Liquiditätsvorschau gleichmäßig verteilt — für den echten Kontoverlauf einen Fälligkeitsmonat wählen.'
          : ' Kassenwirksam ' + U.currency(amt, { digits: 0 }) + ' im ' + MONTHS[dueValue - 1] +
            (span < 12 ? ' und dann alle ' + span + ' Monate' : '') + '.';
      }
      preview.textContent = txt;
    }
    amountIn.addEventListener('input', paintPreview);
    intervalSel.addEventListener('change', function () { paintDue(); paintPreview(); });
    paintDue();
    paintPreview();

    /* --- Progression --- */

    // Ohne eigene Progression steigt ein Posten mit der Inflation — außer er
    // liegt nominell fest, wie die Rate eines Kredits.
    var infOpts = C.inflationOpts(S.state, {});
    var inflationDefault = C.followsInflation(infOpts, { id: draft.id, growth: null });
    var inflationIn = U.el('input', {
      type: 'checkbox',
      checked: draft.inflationLinked == null ? inflationDefault : !!draft.inflationLinked
    });

    var g = draft.growth;
    var growthTitle = U.el('div', { class: 'section-title' });
    var growthWrap = U.el('div', {});
    var growthPreview = U.el('div', { class: 'callout' });

    var pctIn = ui.numInput(g ? g.pct : 3, { step: '0.1' });
    var everyIn = ui.numInput(g ? g.everyMonths : 12, { step: '1', min: '1' });
    var fromIn = ui.monthInput(g ? g.from : defaultGrowthStart());
    var untilIn = ui.monthInput(g ? g.until : null);

    // „Individuell“ nur dann vorwählen, wenn der Rhythmus keinem Preset entspricht.
    var presetValues = C.GROWTH_PRESETS.map(function (x) { return String(x.value); });
    var rhythm = !g ? '' :
      (presetValues.indexOf(String(g.everyMonths)) > -1 ? String(g.everyMonths) : 'custom');

    var rhythmSel = ui.select(
      [{ value: '', label: 'Keine Progression' }]
        .concat(C.GROWTH_PRESETS.map(function (x) {
          return { value: String(x.value), label: x.label };
        }))
        .concat([{ value: 'custom', label: 'Individueller Zeitraum …' }]),
      rhythm,
      function (v) { rhythm = v; paintGrowth(); }
    );

    function paintGrowth() {
      growthTitle.textContent = draft.kind === 'income' ? 'Gehaltsprogression' : 'Wertanpassung';
      U.clear(growthWrap);

      growthWrap.appendChild(ui.field('Rhythmus', rhythmSel,
        draft.kind === 'income'
          ? 'Regelmäßige Erhöhung, etwa aus dem Kollektivvertrag'
          : 'Regelmäßige Anpassung, etwa eine indexierte Miete'));

      if (!rhythm) {
        growthWrap.appendChild(ui.field('',
          U.el('label', { class: 'checkline' }, [
            inflationIn,
            U.el('span', { text: 'steigt mit der Inflation (' + U.num(C.inflationPct(S.state), 1) + ' % p. a.)' })
          ]),
          inflationDefault
            ? 'Vorgabe für Posten ohne eigene Progression'
            : 'Vorgabe für diesen Posten ist nein — er ist die Rate eines Kredits'));
        growthPreview.textContent = inflationIn.checked
          ? 'Der Betrag bleibt in heutiger Kaufkraft gleich und steigt in der Projektion mit der Inflation.'
          : 'Der Betrag bleibt nominell unverändert — in heutiger Kaufkraft wird er also von Jahr zu Jahr kleiner.';
        inflationIn.onchange = paintGrowth;
        return;
      }

      var grid = U.el('div', { class: 'form-grid' }, [
        ui.field('Steigerung je Schritt (%)', pctIn, 'Negative Werte senken den Betrag'),
        rhythm === 'custom'
          ? ui.field('Abstand (Monate)', everyIn, 'z. B. 18 für alle eineinhalb Jahre')
          : U.el('div', {}),
        ui.field('Erste Steigerung', fromIn, 'Monat, in dem sie zum ersten Mal greift'),
        ui.field('Letzte Steigerung', untilIn, 'leer = unbefristet')
      ]);
      growthWrap.appendChild(grid);
      paintGrowthPreview();
    }

    function currentGrowth() {
      if (!rhythm) return null;
      var pct = U.parseNum(pctIn.value);
      var every = rhythm === 'custom' ? Math.round(U.parseNum(everyIn.value)) : parseInt(rhythm, 10);
      if (!pct || !(every >= 1) || !fromIn.value) return null;
      return { pct: pct, everyMonths: every, from: fromIn.value, until: untilIn.value || null };
    }

    /** Zeigt, wo der Betrag am Ende des eingestellten Planungszeitraums steht. */
    function paintGrowthPreview() {
      var gr = currentGrowth();
      if (!gr) {
        growthPreview.textContent = 'Bitte Steigerung, Abstand und ersten Monat angeben — sonst bleibt die Progression wirkungslos.';
        return;
      }
      var base = U.parseNum(amountIn.value);
      var months = state.settings.projectionMonths || 60;
      var end = U.addMonths(state.settings.startMonth || U.monthKey(), months - 1);
      var steps = C.growthSteps(gr, end);
      var factor = C.growthFactor(gr, end);
      growthPreview.textContent = C.growthLabel(gr) + ' ab ' + U.monthLabel(gr.from) + ': aus ' +
        U.currency(base, { digits: 0 }) + ' werden bis ' + U.monthLabel(end, 'long') + ' rund ' +
        U.currency(base * factor, { digits: 0 }) + ' (' + steps +
        (steps === 1 ? ' Steigerung' : ' Steigerungen') + ').';
    }

    [pctIn, everyIn, fromIn, untilIn].forEach(function (el) {
      el.addEventListener('input', paintGrowthPreview);
      el.addEventListener('change', paintGrowthPreview);
    });
    amountIn.addEventListener('input', paintGrowthPreview);
    paintGrowth();

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
          ui.field('', U.el('label', { class: 'checkline' }, [activeIn, U.el('span', { text: 'Posten ist aktiv' })]), null, 'full'),
          dueWrap
        ]),
        preview,
        growthTitle,
        growthWrap,
        growthPreview
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
            draft.dueMonth = Math.round(C.intervalMonths(intervalSel.value)) > 1 ? dueValue : null;
            draft.growth = currentGrowth();
            // Mit eigener Progression ist die Frage beantwortet; sonst nur
            // speichern, was von der Vorgabe abweicht.
            draft.inflationLinked = rhythm ? null
              : (inflationIn.checked === inflationDefault ? null : inflationIn.checked);
            if (rhythm && !draft.growth) {
              ui.toast('Für die Progression fehlen Steigerung, Abstand oder erster Monat.', 'err');
              return;
            }
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

  /** Vorschlag für die erste Steigerung: der kommende Jänner. */
  function defaultGrowthStart() {
    var now = U.monthKey();
    return (parseInt(now.slice(0, 4), 10) + 1) + '-01';
  }

  function duplicate(it) {
    var copy = U.deepClone(it);
    copy.id = U.uid('itm');
    copy.label = it.label + ' (Kopie)';
    S.update(function (st) { st.items.push(copy); }, 'items');
    ui.toast('Posten dupliziert.');
  }

  function remove(it) {
    var linked = S.state.investments.filter(function (inv) { return inv.linkedItemId === it.id; });

    ui.confirm({
      title: 'Posten löschen',
      text: '„' + it.label + '“ wird dauerhaft entfernt.',
      detail: 'Szenario-Anpassungen, die sich auf diesen Posten beziehen, werden mitgelöscht.' +
        (linked.length
          ? ' Der Posten ist als Sparplan von „' + linked.map(function (i) { return i.label; }).join('“, „') +
            '“ hinterlegt; diese Verknüpfung entfällt, die Investments selbst bleiben erhalten.'
          : ''),
      confirmLabel: 'Löschen', danger: true
    }).then(function (ok) {
      if (!ok) return;
      S.update(function (st) {
        st.items = st.items.filter(function (x) { return x.id !== it.id; });
        st.investments.forEach(function (inv) {
          if (inv.linkedItemId === it.id) inv.linkedItemId = null;
        });
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

  /**
   * Vollwertige Kategorienverwaltung. Auch die mitgelieferten Kategorien sind
   * änder- und löschbar — sie sind Vorschläge, kein Gesetz. Zwei Leitplanken
   * bleiben: Die letzte Kategorie einer Art lässt sich nicht löschen, und
   * Einträge einer gelöschten Kategorie müssen umgebucht werden, statt still
   * irgendwo zu landen.
   */
  function manageCategories() {
    var body = U.el('div', {});
    var editing = null;   // null = Liste, sonst die bearbeitete Kategorie

    function usage(state) {
      var used = {};
      state.items.forEach(function (i) { used[i.categoryId] = (used[i.categoryId] || 0) + 1; });
      state.transactions.forEach(function (t) { used[t.categoryId] = (used[t.categoryId] || 0) + 1; });
      state.plans.forEach(function (p) {
        (p.adjustments || []).forEach(function (a) {
          if (a.scope === 'category') used[a.targetId] = (used[a.targetId] || 0) + 1;
        });
      });
      return used;
    }

    function countOfKind(state, kind) {
      return state.categories.filter(function (c) { return c.kind === kind; }).length;
    }

    function paint() {
      var state = S.state;
      U.clear(body);
      if (editing) paintForm(state);
      else paintList(state);
    }

    /* --- Liste --- */

    function paintList(state) {
      var used = usage(state);

      body.appendChild(U.el('div', { class: 'inline-actions', style: { marginBottom: '14px' } }, [
        U.el('button', {
          class: 'btn btn-primary', text: 'Kategorie hinzufügen',
          onclick: function () {
            editing = { id: null, name: '', kind: 'expense', saving: false, budget: null };
            paint();
          }
        }),
        U.el('span', { class: 'small muted', text: state.categories.length + ' Kategorien' })
      ]));

      body.appendChild(U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Kategorie' }),
            U.el('th', { text: 'Art' }),
            U.el('th', { class: 'num', text: 'Monatsbudget' }),
            U.el('th', { class: 'num', text: 'Einträge' }),
            U.el('th', { class: 'num', text: '' })
          ])),
          U.el('tbody', {}, state.categories.map(function (c) {
            var last = countOfKind(state, c.kind) <= 1;
            return U.el('tr', {}, [
              U.el('td', {}, [
                U.el('span', { text: c.name }),
                c.saving ? U.el('span', { class: 'badge pos', style: { marginLeft: '6px' }, text: 'Sparen' }) : null,
                c.system ? U.el('span', { class: 'badge', style: { marginLeft: '6px' }, text: 'mitgeliefert' }) : null
              ]),
              U.el('td', { text: c.kind === 'income' ? 'Einnahme' : 'Ausgabe' }),
              U.el('td', {
                class: 'num' + (c.budget == null ? ' muted' : ''),
                text: c.budget == null ? '—' : U.currency(c.budget, { digits: 0 })
              }),
              U.el('td', { class: 'num', text: String(used[c.id] || 0) }),
              U.el('td', {}, U.el('div', { class: 'row-actions' }, [
                ui.iconBtn('edit', 'Bearbeiten', function () {
                  editing = U.deepClone(c);
                  paint();
                }),
                last
                  ? U.el('span', {
                      class: 'small muted', title: 'Die letzte Kategorie dieser Art bleibt erhalten',
                      text: 'letzte'
                    })
                  : ui.iconBtn('trash', 'Löschen', function () { askDelete(c, used[c.id] || 0); })
              ]))
            ]);
          }))
        ])
      ]));

      body.appendChild(U.el('div', { class: 'callout', style: { marginTop: '14px' } }, [
        'Auch die mitgelieferten Kategorien lassen sich umbenennen und löschen. ' +
        'Beim Löschen werden alle Einträge auf eine andere Kategorie umgebucht — es geht nichts verloren.'
      ]));
    }

    /* --- Formular --- */

    function paintForm(state) {
      var isNew = !editing.id;
      var used = usage(state);
      var inUse = editing.id ? (used[editing.id] || 0) : 0;

      var nameIn = ui.textInput(editing.name, { placeholder: 'z. B. Haustiere' });
      var kindSel = ui.select([
        { value: 'expense', label: 'Ausgabe' },
        { value: 'income', label: 'Einnahme' }
      ], editing.kind, null, inUse ? { disabled: true } : null);
      var savingIn = U.el('input', { type: 'checkbox', checked: !!editing.saving });
      var budgetIn = ui.numInput(editing.budget, { placeholder: 'kein Budget' });

      body.appendChild(U.el('h3', { text: isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten' }));
      body.appendChild(U.el('div', { class: 'form-grid', style: { marginTop: '12px' } }, [
        ui.field('Bezeichnung', nameIn, null, 'full'),
        ui.field('Art', kindSel, inUse
          ? 'Nicht änderbar, solange ' + inUse + ' Einträge darauf zeigen — sie stünden sonst in der falschen Auswertung.'
          : 'Bestimmt, ob die Kategorie bei Einnahmen oder Ausgaben erscheint.'),
        ui.field('Monatsbudget (€)', budgetIn,
          'Leer lassen für kein Budget. Die Übersicht zeigt dann die Auslastung mit Ampel.'),
        ui.field('Verwendung',
          U.el('label', { class: 'checkline' }, [savingIn, U.el('span', { text: 'zählt als Vermögensaufbau' })]),
          'Solche Ausgaben gehen in die Sparquote ein statt in den Konsum.')
      ]));

      body.appendChild(U.el('div', { class: 'inline-actions', style: { marginTop: '8px' } }, [
        U.el('button', {
          class: 'btn btn-primary', text: isNew ? 'Anlegen' : 'Speichern',
          onclick: function () {
            var name = nameIn.value.trim();
            if (!name) { nameIn.focus(); ui.toast('Bitte eine Bezeichnung eingeben.', 'err'); return; }
            var id = editing.id;
            var kind = kindSel.value;
            var saving = savingIn.checked;
            var budgetValue = budgetIn.value === '' ? null : U.parseNum(budgetIn.value);
            var budget = budgetValue != null && budgetValue > 0 ? budgetValue : null;

            S.update(function (st) {
              if (id) {
                var c = U.byId(st.categories, id);
                if (c) { c.name = name; c.kind = kind; c.saving = saving; c.budget = budget; }
              } else {
                st.categories.push({
                  id: U.uid('cat'), name: name, kind: kind, system: false,
                  saving: saving, budget: budget
                });
              }
            }, 'categories');

            editing = null;
            paint();
            ui.toast(isNew ? 'Kategorie angelegt.' : 'Kategorie gespeichert.');
          }
        }),
        U.el('button', {
          class: 'btn', text: 'Zurück zur Liste',
          onclick: function () { editing = null; paint(); }
        })
      ]));
    }

    /* --- Löschen mit Umbuchung --- */

    function askDelete(cat, count) {
      var state = S.state;
      var targets = state.categories.filter(function (c) {
        return c.id !== cat.id && c.kind === cat.kind;
      });

      var targetSel = ui.select(
        targets.map(function (c) { return { value: c.id, label: c.name }; }),
        targets[0] ? targets[0].id : ''
      );

      // Erst die Liste frisch aufbauen, damit sich Panels nicht stapeln.
      paint();
      var panel = U.el('div', { class: 'callout warn', style: { marginTop: '14px' } }, [
        U.el('div', { style: { fontWeight: '600', marginBottom: '6px' }, text: '„' + cat.name + '" löschen' }),
        count
          ? U.el('div', {}, [
              U.el('p', { text: count + ' Einträge zeigen auf diese Kategorie. Sie werden umgebucht auf:' }),
              targetSel
            ])
          : U.el('p', { text: 'Auf diese Kategorie zeigt kein Eintrag.' }),
        U.el('div', { class: 'inline-actions', style: { marginTop: '10px' } }, [
          U.el('button', {
            class: 'btn btn-danger', text: 'Endgültig löschen',
            onclick: function () {
              var to = count ? targetSel.value : null;
              S.update(function (st) {
                if (to) {
                  st.items.forEach(function (i) { if (i.categoryId === cat.id) i.categoryId = to; });
                  st.transactions.forEach(function (t) { if (t.categoryId === cat.id) t.categoryId = to; });
                  st.plans.forEach(function (p) {
                    (p.adjustments || []).forEach(function (a) {
                      if (a.scope === 'category' && a.targetId === cat.id) a.targetId = to;
                    });
                  });
                }
                st.categories = st.categories.filter(function (c) { return c.id !== cat.id; });
              }, 'categories');
              paint();
              ui.toast(count
                ? 'Kategorie gelöscht, ' + count + ' Einträge umgebucht.'
                : 'Kategorie gelöscht.');
            }
          }),
          U.el('button', { class: 'btn', text: 'Abbrechen', onclick: function () { paint(); } })
        ])
      ]);
      body.appendChild(panel);
      panel.scrollIntoView({ block: 'nearest' });
    }

    paint();

    ui.openModal({
      title: 'Kategorien verwalten', wide: true, body: body,
      actions: [{ label: 'Fertig', variant: 'btn-primary' }]
    });
  }

  HB.views.items = { render: render, manageCategories: manageCategories };
})(window.HB);
