/* ---------------------------------------------------------------------------
   views/people.js — Personen des Haushalts, deren Budgets und der
                     Verteilungsschlüssel für die gemeinsamen Kosten
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  // Register der Anteilsregler des aktuellen Aufbaus. Sie hängen voneinander ab
  // — wird einer bewegt, ändern sich die Prozentsätze aller anderen mit.
  var sliders = [];
  var netCost = 0;

  function render(root) {
    var state = S.state;
    var sum = C.monthSummary(state, U.monthKey(), { plans: S.activePlans() });
    sliders = [];
    netCost = sum.householdNetCost;

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Personen & Verteilung' }),
        U.el('p', {
          class: 'lede',
          text: 'Jede Person hat eigene Einnahmen, eigene Ausgaben und optional ein persönliches Budget. ' +
                'Die gemeinsamen Haushaltskosten werden nach dem gewählten Schlüssel aufgeteilt.'
        })
      ]),
      U.el('button', {
        class: 'btn btn-primary', text: 'Person hinzufügen',
        onclick: function () { editPerson(null); }
      })
    ]));

    root.appendChild(settingsCard(state));

    if (!state.people.length) {
      root.appendChild(ui.card({
        body: ui.emptyState(
          'Noch keine Personen',
          'Ein Haushalt braucht mindestens zwei Personen, damit sich die Aufteilung lohnt.',
          U.el('button', {
            class: 'btn btn-primary', text: 'Erste Person anlegen',
            onclick: function () { editPerson(null); }
          })
        )
      }));
      return;
    }

    root.appendChild(U.el('div', { class: 'section-title', text: 'Haushaltsmitglieder' }));
    root.appendChild(U.el('div', { class: 'grid grid-auto' }, state.people.map(function (p) {
      return personCard(state, p, sum);
    })));
    refreshShares();

    root.appendChild(U.el('div', { class: 'section-title', text: 'Aufteilung im laufenden Monat' }));
    root.appendChild(shareTable(state, sum));
  }

  /* --- Einstellungen ------------------------------------------------------ */

  function settingsCard(state) {
    var splitSel = ui.select([
      { value: 'income', label: 'Nach Einkommen (proportional)' },
      { value: 'equal', label: 'Zu gleichen Teilen' },
      { value: 'custom', label: 'Individuelle Prozentsätze' }
    ], state.settings.splitMode, function (v) {
      S.update(function (st) { st.settings.splitMode = v; }, 'settings');
    });

    var nameIn = ui.textInput(state.meta.name, {
      onchange: function (e) { S.update(function (st) { st.meta.name = e.target.value; }, 'meta'); }
    });

    var budgetIn = ui.numInput(state.household.budget, {
      placeholder: 'kein Limit',
      onchange: function (e) {
        var v = e.target.value === '' ? null : U.parseNum(e.target.value);
        S.update(function (st) { st.household.budget = v; }, 'household');
      }
    });

    var assetsIn = ui.numInput(state.household.assets, {
      onchange: function (e) {
        var v = U.parseNum(e.target.value);
        S.update(function (st) { st.household.assets = v; }, 'household');
      }
    });

    var portfolio = C.investmentSummary(state);
    var total = C.totalAssets(state);

    return ui.card({
      title: 'Haushalt',
      sub: 'Gilt für alle Auswertungen',
      body: U.el('div', {}, [
        U.el('div', { class: 'form-grid' }, [
          ui.field('Name des Haushalts', nameIn),
          ui.field('Verteilungsschlüssel gemeinsamer Kosten', splitSel,
            state.settings.splitMode === 'custom'
              ? 'Prozentsätze je Person unten eintragen; sie werden auf 100 % normalisiert.'
              : state.settings.splitMode === 'income'
                ? 'Wer mehr verdient, trägt anteilig mehr.'
                : 'Alle tragen denselben Anteil.'),
          ui.field('Monatliches Haushaltsbudget (€)', budgetIn, 'Obergrenze für gemeinsame Ausgaben, optional'),
          ui.field('Sonstiges Vermögen (€)', assetsIn, 'Girokonto, Bargeld, Sparbuch — alles außerhalb der Investments')
        ]),
        U.el('div', { class: 'callout' }, [
          U.el('div', {}, [
            'Gesamtvermögen: ',
            U.el('strong', { text: U.currency(total, { digits: 0 }) }),
            ' — ' + U.currency(state.household.assets || 0, { digits: 0 }) + ' sonstiges Vermögen plus ' +
            U.currency(portfolio.total, { digits: 0 }) + ' aus ' + portfolio.count +
            (portfolio.count === 1 ? ' Investment' : ' Investments') + '.'
          ]),
          U.el('div', { style: { marginTop: '6px' } }, [
            U.el('button', {
              class: 'btn btn-sm', text: 'Investments verwalten',
              onclick: function () { HB.app.go('investments'); }
            })
          ])
        ])
      ])
    });
  }

  /* --- Personenkarte ------------------------------------------------------ */

  function personCard(state, p, sum) {
    var b = sum.byPerson[p.id] || { income: 0, expense: 0, share: 0, householdShare: 0, personalNet: 0 };

    var rows = U.el('div', { class: 'stack' }, [
      row('Einnahmen', U.currency(b.income, { digits: 0 })),
      row('Eigene Ausgaben', U.currency(b.expense, { digits: 0 })),
      row('Anteil Haushaltskosten', U.currency(b.householdShare, { digits: 0 }) +
        ' (' + U.pct(b.share, 0) + ')'),
      row('Bleibt übrig', U.currency(b.personalNet, { digits: 0, sign: true }), ui.toneClass(b.personalNet))
    ]);

    return ui.card({
      title: p.name,
      sub: p.note || null,
      actions: [
        U.el('span', { class: 'dot', style: { background: S.ownerColor(p.id) } }),
        ui.iconBtn('edit', 'Bearbeiten', function () { editPerson(p); }),
        ui.iconBtn('trash', 'Entfernen', function () { removePerson(p); })
      ],
      body: U.el('div', {}, [
        rows,
        p.budget
          ? ui.meter({ used: b.expense, budget: p.budget, label: 'Persönliches Budget' })
          : U.el('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Kein persönliches Budget hinterlegt.' }),
        shareSlider(state, p, b)
      ])
    });
  }

  /* --- Anteilsregler ------------------------------------------------------ */

  /**
   * Regler für den Anteil dieser Person an den gemeinsamen Kosten.
   *
   * Startwert ist der derzeit tatsächlich wirksame Anteil, egal welcher
   * Schlüssel gerade gilt — dadurch springt beim ersten Anfassen nichts.
   * Die Rohwerte aller Personen werden auf 100 % normalisiert; angezeigt wird
   * deshalb immer der normalisierte Anteil, nicht die Reglerstellung.
   */
  function shareSlider(state, p, b) {
    var raw = p.sharePct != null ? p.sharePct : Math.round((b.share || 0) * 100);

    var input = U.el('input', {
      type: 'range', min: '0', max: '100', step: '1', value: String(U.clamp(raw, 0, 100)),
      'aria-label': 'Anteil von ' + p.name + ' an den Haushaltskosten',
      oninput: refreshShares,
      onchange: commitShares
    });

    var valEl = U.el('span', { class: 'val' });
    var costEl = U.el('span', {});

    sliders.push({ id: p.id, input: input, valEl: valEl, costEl: costEl });

    return U.el('div', { class: 'share-slider' }, [
      U.el('div', { class: 'share-slider-head' }, [
        U.el('span', { class: 'lbl', text: 'Anteil an den Haushaltskosten' }),
        valEl
      ]),
      input,
      U.el('div', { class: 'foot' }, [
        costEl,
        U.el('span', {
          text: state.settings.splitMode === 'custom'
            ? 'individueller Schlüssel'
            : 'aktiviert „individuell“'
        })
      ])
    ]);
  }

  /** Live beim Ziehen: normalisierte Anteile aller Regler neu beschriften. */
  function refreshShares() {
    if (!sliders.length) return;
    var total = sliders.reduce(function (a, s) { return a + Number(s.input.value); }, 0);
    sliders.forEach(function (s) {
      var share = total > 0 ? Number(s.input.value) / total : 1 / sliders.length;
      s.valEl.textContent = U.pct(share, 1);
      s.costEl.textContent = U.currency(netCost * share, { digits: 0 }) +
        ' von ' + U.currency(netCost, { digits: 0 });
    });
  }

  /** Beim Loslassen speichern — und den Schlüssel auf „individuell“ setzen. */
  function commitShares() {
    var values = sliders.map(function (s) { return { id: s.id, value: Number(s.input.value) }; });
    var wasCustom = S.state.settings.splitMode === 'custom';

    S.update(function (st) {
      values.forEach(function (v) {
        var person = U.byId(st.people, v.id);
        if (person) person.sharePct = v.value;
      });
      st.settings.splitMode = 'custom';
    }, 'people');

    if (!wasCustom) ui.toast('Verteilungsschlüssel auf „individuell“ umgestellt.');
  }

  function row(label, value, cls) {
    return U.el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px' } }, [
      U.el('span', { class: 'small muted', text: label }),
      U.el('span', {
        class: 'small ' + (cls || ''),
        style: { fontVariantNumeric: 'tabular-nums', fontWeight: '600' },
        text: value
      })
    ]);
  }

  /* --- Verteilungstabelle -------------------------------------------------- */

  function shareTable(state, sum) {
    var totalHouseholdCost = sum.householdNetCost;

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('thead', {}, U.el('tr', {}, [
            U.el('th', { text: 'Person' }),
            U.el('th', { class: 'num', text: 'Einnahmen' }),
            U.el('th', { class: 'num', text: 'Eigene Ausgaben' }),
            U.el('th', { class: 'num', text: 'Schlüssel' }),
            U.el('th', { class: 'num', text: 'Haushaltsanteil' }),
            U.el('th', { class: 'num', text: 'Bleibt übrig' })
          ])),
          U.el('tbody', {}, state.people.map(function (p) {
            var b = sum.byPerson[p.id];
            return U.el('tr', {}, [
              U.el('td', {}, ui.personSwatch(p.id)),
              U.el('td', { class: 'num', text: U.currency(b.income, { digits: 0 }) }),
              U.el('td', { class: 'num', text: U.currency(b.expense, { digits: 0 }) }),
              U.el('td', { class: 'num', text: U.pct(b.share, 1) }),
              U.el('td', { class: 'num', text: U.currency(b.householdShare, { digits: 0 }) }),
              U.el('td', { class: 'num ' + ui.toneClass(b.personalNet), text: U.currency(b.personalNet, { digits: 0, sign: true }) })
            ]);
          })),
          U.el('tfoot', {}, U.el('tr', {}, [
            U.el('td', { text: 'Gemeinsame Netto-Kosten' }),
            U.el('td', { class: 'num', text: U.currency(sum.household.income, { digits: 0 }) }),
            U.el('td', { class: 'num', text: U.currency(sum.household.expense, { digits: 0 }) }),
            U.el('td', { class: 'num', text: '100 %' }),
            U.el('td', { class: 'num', text: U.currency(totalHouseholdCost, { digits: 0 }) }),
            U.el('td', { class: 'num ' + ui.toneClass(sum.net), text: U.currency(sum.net, { digits: 0, sign: true }) })
          ]))
        ])
      ]),
      foot: 'Der Haushaltsanteil ist der Betrag, den die Person rechnerisch zu den gemeinsamen Kosten beisteuert. ' +
            'Die Summe der Spalte „Bleibt übrig“ entspricht exakt dem Monatssaldo des Haushalts.'
    });
  }

  /* --- Bearbeiten --------------------------------------------------------- */

  function editPerson(p) {
    var isNew = !p;
    var state = S.state;
    var draft = p ? U.deepClone(p) : {
      id: U.uid('per'),
      name: '',
      colorIndex: state.people.length % 8,
      budget: null,
      sharePct: null,
      note: ''
    };

    var nameIn = ui.textInput(draft.name, { placeholder: 'z. B. Alex', required: true });
    var budgetIn = ui.numInput(draft.budget, { placeholder: 'kein Limit' });
    var shareIn = ui.numInput(draft.sharePct, { placeholder: 'z. B. 60', min: '0', max: '100' });
    var noteIn = ui.textInput(draft.note, { placeholder: 'optionale Notiz' });

    var swatches = U.el('div', { class: 'chips' }, U.SERIES_SLOTS.map(function (tok, i) {
      var btn = U.el('button', {
        type: 'button', class: 'chip',
        'aria-pressed': draft.colorIndex === i ? 'true' : 'false',
        title: 'Farbe ' + (i + 1),
        style: { paddingLeft: '9px', paddingRight: '9px' },
        onclick: function () {
          draft.colorIndex = i;
          Array.prototype.forEach.call(swatches.children, function (c, j) {
            c.setAttribute('aria-pressed', j === i ? 'true' : 'false');
          });
        }
      }, [U.el('span', { class: 'dot', style: { background: U.token(tok) } })]);
      return btn;
    }));

    ui.openModal({
      title: isNew ? 'Person hinzufügen' : 'Person bearbeiten',
      body: U.el('div', {}, [
        U.el('div', { class: 'form-grid' }, [
          ui.field('Name', nameIn, null, 'full'),
          ui.field('Persönliches Budget (€ / Monat)', budgetIn, 'Gilt für die eigenen Ausgaben'),
          ui.field('Anteil an Haushaltskosten (%)', shareIn,
            state.settings.splitMode === 'custom'
              ? 'Wird auf 100 % normalisiert.'
              : 'Nur wirksam, wenn der Schlüssel „individuell“ gewählt ist.'),
          ui.field('Notiz', noteIn, null, 'full'),
          ui.field('Farbe', swatches, 'Erscheint in Diagrammen und Tabellen', 'full')
        ])
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: isNew ? 'Hinzufügen' : 'Speichern', variant: 'btn-primary',
          onClick: function (close) {
            var name = nameIn.value.trim();
            if (!name) { nameIn.focus(); ui.toast('Bitte einen Namen eingeben.', 'err'); return; }
            draft.name = name;
            draft.budget = budgetIn.value === '' ? null : U.parseNum(budgetIn.value);
            draft.sharePct = shareIn.value === '' ? null : U.parseNum(shareIn.value);
            draft.note = noteIn.value.trim();

            S.update(function (st) {
              if (isNew) st.people.push(draft);
              else {
                var i = st.people.findIndex(function (x) { return x.id === draft.id; });
                if (i > -1) st.people[i] = draft;
              }
            }, 'people');
            ui.toast(isNew ? 'Person hinzugefügt.' : 'Änderungen gespeichert.');
            close();
          }
        }
      ]
    });
  }

  function removePerson(p) {
    var state = S.state;
    var items = state.items.filter(function (i) { return i.owner === p.id; });
    var txs = state.transactions.filter(function (t) { return t.owner === p.id; });
    var invs = state.investments.filter(function (i) { return i.owner === p.id; });
    var count = items.length + txs.length + invs.length;

    var modeSel = ui.select([
      { value: 'household', label: 'Auf den Haushalt umschreiben' },
      { value: 'delete', label: 'Mitsamt den Einträgen löschen' }
    ], 'household');

    ui.openModal({
      title: p.name + ' entfernen',
      body: U.el('div', {}, [
        U.el('p', {
          text: count
            ? 'Dieser Person sind ' + items.length + ' Posten, ' + txs.length + ' Buchungen und ' +
              invs.length + ' Investments zugeordnet.'
            : 'Dieser Person sind keine Posten, Buchungen oder Investments zugeordnet.'
        }),
        count ? ui.field('Was soll damit geschehen?', modeSel) : null,
        U.el('p', { class: 'small muted', text: 'Auch Szenario-Anpassungen, die sich auf diese Person beziehen, werden entfernt.' })
      ]),
      actions: [
        { label: 'Abbrechen', variant: 'btn-ghost' },
        {
          label: 'Entfernen', variant: 'btn btn-danger',
          onClick: function (close) {
            var mode = count ? modeSel.value : 'household';
            S.update(function (st) {
              if (mode === 'delete') {
                st.items = st.items.filter(function (i) { return i.owner !== p.id; });
                st.transactions = st.transactions.filter(function (t) { return t.owner !== p.id; });
                st.investments = st.investments.filter(function (i) { return i.owner !== p.id; });
                // Verweise auf soeben gelöschte Sparplan-Posten kappen.
                var alive = {};
                st.items.forEach(function (i) { alive[i.id] = true; });
                st.investments.forEach(function (i) {
                  if (i.linkedItemId && !alive[i.linkedItemId]) i.linkedItemId = null;
                });
              } else {
                st.items.forEach(function (i) { if (i.owner === p.id) i.owner = 'household'; });
                st.transactions.forEach(function (t) { if (t.owner === p.id) t.owner = 'household'; });
                st.investments.forEach(function (i) { if (i.owner === p.id) i.owner = 'household'; });
              }
              st.plans.forEach(function (pl) {
                pl.adjustments = pl.adjustments.filter(function (a) { return a.targetId !== p.id; });
              });
              st.people = st.people.filter(function (x) { return x.id !== p.id; });
            }, 'people');
            ui.toast(p.name + ' entfernt.');
            close();
          }
        }
      ]
    });
  }

  HB.views.people = { render: render };
})(window.HB);
