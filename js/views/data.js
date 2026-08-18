/* ---------------------------------------------------------------------------
   views/data.js — Datei laden/speichern, Darstellung, Beispieldaten, Reset
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};
HB.views = HB.views || {};

(function (HB) {
  'use strict';

  var U = HB.util, C = HB.calc, S = HB.store, ui = HB.ui;

  function render(root) {
    var state = S.state;

    root.appendChild(U.el('div', { class: 'view-head' }, [
      U.el('div', {}, [
        U.el('h1', { text: 'Daten & Einstellungen' }),
        U.el('p', {
          class: 'lede',
          text: 'Diese App arbeitet ausschließlich lokal. Es werden keine Daten an einen Server gesendet — ' +
                'gespeichert wird im Browser dieses Geräts und in der Datei, die du selbst exportierst.'
        })
      ])
    ]));

    root.appendChild(U.el('div', { class: 'grid grid-2' }, [
      fileCard(state),
      appearanceCard(state)
    ]));

    root.appendChild(U.el('div', { class: 'section-title', text: 'Bestand' }));
    root.appendChild(statsCard(state));

    root.appendChild(U.el('div', { class: 'section-title', text: 'Zurücksetzen' }));
    root.appendChild(dangerCard(state));
  }

  /* --- Datei -------------------------------------------------------------- */

  function fileCard(state) {
    var drop = U.el('div', {
      class: 'callout',
      style: {
        border: '1px dashed var(--border)', background: 'var(--surface-2)',
        borderLeft: '1px dashed var(--border)', textAlign: 'center', padding: '22px 14px',
        cursor: 'pointer'
      },
      text: 'Datei hierher ziehen oder klicken, um sie auszuwählen',
      onclick: function () { HB.app.pickFile(); }
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.style.borderColor = 'var(--accent)';
        drop.style.background = 'var(--accent-soft)';
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.style.borderColor = 'var(--border)';
        drop.style.background = 'var(--surface-2)';
      });
    });
    drop.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) HB.app.readFile(file);
    });

    return ui.card({
      title: 'Datei',
      sub: 'JSON — vollständig, menschenlesbar, versionierbar',
      body: U.el('div', {}, [
        U.el('div', { class: 'inline-actions', style: { marginBottom: '14px' } }, [
          U.el('button', {
            class: 'btn btn-primary', text: 'Als Datei speichern',
            onclick: function () {
              var name = S.exportFile();
              ui.toast('Gespeichert als ' + name + '.');
            }
          }),
          U.el('button', { class: 'btn', text: 'Datei laden', onclick: function () { HB.app.pickFile(); } }),
          U.el('button', {
            class: 'btn', text: 'JSON ansehen',
            onclick: function () {
              var pre = U.el('pre', {
                class: 'mono',
                style: {
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                  maxHeight: '55vh', overflow: 'auto'
                },
                text: S.toJSON()
              });
              ui.openModal({
                title: 'Aktueller Datenstand', wide: true, body: pre,
                actions: [
                  {
                    label: 'In die Zwischenablage', variant: 'btn-ghost',
                    onClick: function () {
                      navigator.clipboard.writeText(S.toJSON()).then(
                        function () { ui.toast('Kopiert.'); },
                        function () { ui.toast('Kopieren nicht möglich.', 'err'); }
                      );
                    }
                  },
                  { label: 'Schließen', variant: 'btn-primary' }
                ]
              });
            }
          })
        ]),
        drop,
        U.el('p', { class: 'small muted', style: { marginTop: '12px' } }, [
          'Vorgeschlagener Dateiname: ',
          U.el('span', { class: 'mono', text: S.suggestedFilename() })
        ]),
        U.el('p', { class: 'small muted' }, [
          'Zuletzt geändert: ' + formatStamp(state.meta.updated) +
          ' · Angelegt: ' + formatStamp(state.meta.created)
        ])
      ]),
      foot: 'Beim Laden wird der aktuelle Stand vollständig ersetzt. Vorher speichern, wenn er noch gebraucht wird.'
    });
  }

  function formatStamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString(U.LOCALE, {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  /* --- Darstellung -------------------------------------------------------- */

  function appearanceCard(state) {
    var themeSel = ui.select([
      { value: 'auto', label: 'Wie das System' },
      { value: 'light', label: 'Hell' },
      { value: 'dark', label: 'Dunkel' }
    ], state.settings.theme || 'auto', function (v) {
      S.update(function (st) { st.settings.theme = v; }, 'settings');
      HB.app.applyTheme();
    });

    var startIn = ui.monthInput(state.settings.startMonth, {
      onchange: function (e) {
        S.update(function (st) { st.settings.startMonth = e.target.value || U.monthKey(); }, 'settings');
      }
    });

    var emergencyIn = ui.numInput(state.settings.emergencyMonths, {
      step: '1', min: '1',
      onchange: function (e) {
        var v = Math.max(1, Math.round(U.parseNum(e.target.value)) || 4);
        S.update(function (st) { st.settings.emergencyMonths = v; }, 'settings');
      }
    });

    return ui.card({
      title: 'Darstellung & Vorgaben',
      body: U.el('div', {}, [
        ui.field('Design', themeSel, 'Das helle Design ist die Vorgabe; „Wie das System“ folgt der Einstellung des Betriebssystems.'),
        ui.field('Startmonat der Planung', startIn, 'Ausgangspunkt für Projektion und FIRE-Rechnung'),
        ui.field('Ziel für den Notgroschen (Monate)', emergencyIn,
          'Wie viele Monatsausgaben die sofort verfügbaren Mittel abdecken sollen'),
        ui.field('Kategorien', U.el('button', {
          class: 'btn', text: 'Kategorien verwalten',
          onclick: function () { HB.views.items.manageCategories(); }
        }), 'Anlegen, umbenennen, löschen — auch die mitgelieferten'),
        U.el('div', { class: 'callout', style: { marginTop: '4px' } }, [
          'Auto-Speicherung ist aktiv: Jede Änderung landet sofort im lokalen Speicher dieses Browsers. ' +
          'Für Backups, Gerätewechsel oder das Teilen mit der zweiten Person ist trotzdem die Datei der richtige Weg.'
        ])
      ])
    });
  }

  /* --- Bestand ------------------------------------------------------------ */

  function statsCard(state) {
    var sum = C.monthSummary(state, U.monthKey(), {});
    var rows = [
      ['Personen', state.people.length],
      ['Wiederkehrende Posten', state.items.length],
      ['davon pausiert', state.items.filter(function (i) { return i.active === false; }).length],
      ['Einzelbuchungen', state.transactions.length],
      ['Kategorien', state.categories.length],
      ['Szenarien', state.plans.length],
      ['Anpassungen in Szenarien', U.sum(state.plans, function (p) { return p.adjustments.length; })],
      ['Monatliche Einnahmen', U.currency(sum.income, { digits: 0 })],
      ['Monatliche Ausgaben', U.currency(sum.expense, { digits: 0 })]
    ];

    return ui.card({
      raw: U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'tbl' }, [
          U.el('tbody', {}, rows.map(function (r) {
            return U.el('tr', {}, [
              U.el('td', { text: r[0] }),
              U.el('td', { class: 'num', text: String(r[1]) })
            ]);
          }))
        ])
      ])
    });
  }

  /* --- Gefahrenzone ------------------------------------------------------- */

  function dangerCard(state) {
    return ui.card({
      body: U.el('div', { class: 'inline-actions' }, [
        U.el('button', {
          class: 'btn', text: 'Beispielhaushalt laden',
          onclick: function () {
            ui.confirm({
              title: 'Beispielhaushalt laden',
              text: 'Der aktuelle Stand wird durch einen vollständig ausgefüllten Beispielhaushalt ersetzt.',
              detail: 'Vorher speichern, falls die eigenen Daten erhalten bleiben sollen.',
              confirmLabel: 'Laden'
            }).then(function (ok) {
              if (!ok) return;
              S.loadDemo();
              ui.toast('Beispielhaushalt geladen.');
            });
          }
        }),
        U.el('button', {
          class: 'btn btn-danger', text: 'Alle Daten löschen',
          onclick: function () {
            ui.confirm({
              title: 'Alle Daten löschen',
              text: 'Personen, Posten, Buchungen und Szenarien werden entfernt. Das lässt sich nicht rückgängig machen.',
              detail: 'Eine zuvor gespeicherte Datei bleibt selbstverständlich erhalten.',
              confirmLabel: 'Endgültig löschen', danger: true
            }).then(function (ok) {
              if (!ok) return;
              S.reset();
              ui.toast('Alle Daten gelöscht.');
            });
          }
        })
      ]),
      foot: 'Der lokale Speicherschlüssel lautet „' + S.STORAGE_KEY + '“. ' +
            'Wird der Browser-Speicher geleert, ist der Stand nur noch in der exportierten Datei vorhanden.'
    });
  }

  HB.views.data = { render: render };
})(window.HB);
