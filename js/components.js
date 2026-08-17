/* ---------------------------------------------------------------------------
   components.js — wiederverwendete UI-Bausteine (Karten, Kennzahlen, Meter,
   Diagrammkarte mit Tabellenumschalter, Modal, Toasts, Formularfelder)
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util;

  /* --- Karten & Kennzahlen ------------------------------------------------ */

  function card(o) {
    var head = null;
    if (o.title || o.actions) {
      head = U.el('div', { class: 'card-head' }, [
        U.el('div', {}, [
          U.el('h2', { text: o.title || '' }),
          o.sub ? U.el('p', { class: 'sub', text: o.sub }) : null
        ]),
        o.actions ? U.el('div', { class: 'inline-actions' }, o.actions) : null
      ]);
    }
    return U.el('section', { class: 'card' + (o.class ? ' ' + o.class : '') }, [
      head,
      o.body ? U.el('div', { class: 'card-body' + (o.tight ? ' tight' : '') }, o.body) : null,
      o.raw || null,
      o.foot ? U.el('div', { class: 'card-foot' }, o.foot) : null
    ]);
  }

  function toneClass(v) { return v > 0 ? 'num-pos' : v < 0 ? 'num-neg' : ''; }

  function stat(o) {
    return U.el('div', { class: 'stat' + (o.class ? ' ' + o.class : '') }, [
      U.el('div', { class: 'stat-label', text: o.label }),
      U.el('div', {
        class: 'stat-value' + (o.hero ? ' hero' : '') + (o.tone ? ' ' + o.tone : ''),
        text: o.value
      }),
      o.sub ? U.el('div', { class: 'stat-sub' }, o.sub) : null,
      o.after || null
    ]);
  }

  /**
   * Budget-Meter. Die Füllung trägt den Schweregrad, die Spur ist die
   * ungefüllte Rest-Strecke — Zustand liest über die ganze Breite.
   */
  function meter(o) {
    var used = o.used || 0;
    var budget = o.budget || 0;
    var ratio = budget > 0 ? used / budget : 0;
    var cls = ratio > 1 ? 'is-over' : ratio > 0.85 ? 'is-warn' : '';
    var left = budget - used;

    return U.el('div', { class: 'meter' }, [
      U.el('div', {
        class: 'meter-track', role: 'meter',
        'aria-valuenow': Math.round(ratio * 100), 'aria-valuemin': 0, 'aria-valuemax': 100,
        'aria-label': o.label || 'Budgetauslastung'
      }, [
        U.el('div', {
          class: 'meter-fill ' + cls,
          style: { width: U.clamp(ratio, 0, 1) * 100 + '%' }
        })
      ]),
      U.el('div', { class: 'meter-legend' }, [
        U.el('span', { text: U.pct(ratio, 0) + ' von ' + U.currency(budget, { digits: 0 }) }),
        U.el('span', {
          class: left < 0 && o.mode !== 'progress' ? 'num-neg' : '',
          text: o.mode === 'progress'
            ? (left > 0 ? 'noch ' + U.currency(left, { digits: 0 }) : 'erreicht')
            : (left < 0
                ? U.currency(-left, { digits: 0 }) + ' über Budget'
                : U.currency(left, { digits: 0 }) + ' frei')
        })
      ])
    ]);
  }

  /* --- Diagrammkarte mit Tabellenumschalter -------------------------------- */

  /**
   * Jedes Diagramm bekommt ein barrierefreies Gegenstück: über „Tabelle“
   * wird dieselbe Information als Zahlenwerk sichtbar.
   */
  function chartCard(o) {
    var showTable = false;
    var slot = U.el('div', {});
    var legendSlot = U.el('div', {});

    var toggle = U.el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: function () {
        showTable = !showTable;
        toggle.textContent = showTable ? 'Diagramm' : 'Tabelle';
        paint();
      },
      text: 'Tabelle'
    });

    function paint() {
      U.clear(slot);
      U.clear(legendSlot);
      if (showTable) {
        slot.appendChild(typeof o.table === 'function' ? o.table() : o.table);
      } else {
        slot.appendChild(typeof o.chart === 'function' ? o.chart() : o.chart);
        var lg = typeof o.legend === 'function' ? o.legend() : o.legend;
        if (lg) legendSlot.appendChild(lg);
      }
    }
    paint();

    var actions = (o.actions || []).slice();
    if (o.table) actions.push(toggle);

    return card({
      title: o.title,
      sub: o.sub,
      actions: actions,
      raw: U.el('div', {}, [legendSlot, U.el('div', { class: 'card-body tight' }, slot)]),
      foot: o.foot
    });
  }

  /* --- Modal -------------------------------------------------------------- */

  var modalRoot, modalBody, modalFoot, modalTitle, modalCard;
  var modalCleanup = null;

  function ensureModal() {
    if (modalRoot) return;
    modalRoot = document.getElementById('modalRoot');
    modalCard = modalRoot.querySelector('.modal-card');
    modalBody = document.getElementById('modalBody');
    modalFoot = document.getElementById('modalFoot');
    modalTitle = document.getElementById('modalTitle');
    modalRoot.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modalRoot.hidden) closeModal();
    });
  }

  function openModal(o) {
    ensureModal();
    modalTitle.textContent = o.title || '';
    modalCard.classList.toggle('wide', !!o.wide);
    U.clear(modalBody);
    U.clear(modalFoot);
    modalBody.appendChild(typeof o.body === 'function' ? o.body() : o.body);

    (o.actions || []).forEach(function (a) {
      modalFoot.appendChild(U.el('button', {
        class: 'btn ' + (a.variant || 'btn-ghost'),
        type: 'button',
        onclick: function () { a.onClick ? a.onClick(closeModal) : closeModal(); },
        text: a.label
      }));
    });

    modalCleanup = o.onClose || null;
    modalRoot.hidden = false;
    var first = modalBody.querySelector('input, select, textarea, button');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }

  function closeModal() {
    if (!modalRoot || modalRoot.hidden) return;
    modalRoot.hidden = true;
    U.clear(modalBody);
    U.clear(modalFoot);
    if (modalCleanup) { var f = modalCleanup; modalCleanup = null; f(); }
  }

  function confirm(o) {
    return new Promise(function (resolve) {
      var done = false;
      openModal({
        title: o.title || 'Bestätigen',
        body: U.el('div', {}, [
          U.el('p', { text: o.text || '' }),
          o.detail ? U.el('p', { class: 'muted small', text: o.detail }) : null
        ]),
        actions: [
          { label: o.cancelLabel || 'Abbrechen', variant: 'btn-ghost', onClick: function (close) { done = true; resolve(false); close(); } },
          { label: o.confirmLabel || 'Bestätigen', variant: o.danger ? 'btn btn-danger' : 'btn-primary', onClick: function (close) { done = true; resolve(true); close(); } }
        ],
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  /* --- Toasts ------------------------------------------------------------- */

  function toast(msg, type) {
    var host = document.getElementById('toasts');
    var t = U.el('div', { class: 'toast' + (type ? ' ' + type : ''), text: msg });
    host.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .25s ease';
      setTimeout(function () { t.remove(); }, 260);
    }, type === 'err' ? 5200 : 2800);
  }

  /* --- Formularfelder ----------------------------------------------------- */

  function field(label, control, hint, cls) {
    return U.el('div', { class: 'field' + (cls ? ' ' + cls : '') }, [
      label ? U.el('label', { text: label }) : null,
      control,
      hint ? U.el('span', { class: 'hint', text: hint }) : null
    ]);
  }

  function select(options, value, onChange, attrs) {
    var s = U.el('select', Object.assign({
      onchange: function () { if (onChange) onChange(s.value); }
    }, attrs || {}));
    options.forEach(function (o) {
      s.appendChild(U.el('option', { value: o.value, text: o.label, selected: o.value === value }));
    });
    s.value = value;
    return s;
  }

  function textInput(value, attrs) {
    return U.el('input', Object.assign({ type: 'text', value: value == null ? '' : value }, attrs || {}));
  }

  function numInput(value, attrs) {
    return U.el('input', Object.assign({
      type: 'number', step: '0.01', value: value == null ? '' : value
    }, attrs || {}));
  }

  function monthInput(value, attrs) {
    return U.el('input', Object.assign({ type: 'month', value: value || '' }, attrs || {}));
  }

  function dateInput(value, attrs) {
    return U.el('input', Object.assign({ type: 'date', value: value || '' }, attrs || {}));
  }

  function iconBtn(kind, title, onClick) {
    var paths = {
      edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z',
      trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
      copy: 'M9 9h10v10H9zM5 15V5h10',
      plus: 'M12 5v14M5 12h14'
    };
    return U.el('button', {
      class: 'btn btn-ghost btn-icon btn-sm', type: 'button', title: title,
      'aria-label': title, onclick: onClick
    }, [
      U.svgEl('svg', {
        viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none',
        stroke: 'currentColor', 'stroke-width': 1.8,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }, [U.svgEl('path', { d: paths[kind] })])
    ]);
  }

  function emptyState(title, text, action) {
    return U.el('div', { class: 'empty' }, [
      U.el('strong', { text: title }),
      U.el('div', { text: text || '' }),
      action ? U.el('div', { style: { marginTop: '14px' } }, action) : null
    ]);
  }

  /* --- Auswahllisten ------------------------------------------------------ */

  function ownerOptions(state, opts) {
    opts = opts || {};
    var out = [];
    if (opts.all) out.push({ value: '', label: 'Alle Träger' });
    out.push({ value: 'household', label: 'Haushalt (gemeinsam)' });
    state.people.forEach(function (p) { out.push({ value: p.id, label: p.name }); });
    return out;
  }

  function categoryOptions(state, kind, opts) {
    opts = opts || {};
    var out = opts.all ? [{ value: '', label: 'Alle Kategorien' }] : [];
    state.categories
      .filter(function (c) { return !kind || c.kind === kind; })
      .forEach(function (c) { out.push({ value: c.id, label: c.name }); });
    return out;
  }

  function intervalOptions() {
    return Object.keys(HB.calc.INTERVALS).map(function (k) {
      return { value: k, label: HB.calc.INTERVALS[k].label };
    });
  }

  function personSwatch(ownerId) {
    return U.el('span', { class: 'person-swatch' }, [
      U.el('span', { class: 'dot', style: { background: HB.store.ownerColor(ownerId) } }),
      HB.store.ownerName(ownerId)
    ]);
  }

  HB.ui = {
    card: card, stat: stat, meter: meter, chartCard: chartCard,
    openModal: openModal, closeModal: closeModal, confirm: confirm, toast: toast,
    field: field, select: select, textInput: textInput, numInput: numInput,
    monthInput: monthInput, dateInput: dateInput, iconBtn: iconBtn,
    emptyState: emptyState, toneClass: toneClass,
    ownerOptions: ownerOptions, categoryOptions: categoryOptions,
    intervalOptions: intervalOptions, personSwatch: personSwatch
  };
})(window.HB);
