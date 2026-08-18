/* ---------------------------------------------------------------------------
   store.js — Zustand, Auto-Save (localStorage), Datei-Export/-Import, Migration
   Alle Daten bleiben auf dem Gerät. Es gibt keinen Server-Aufruf in dieser App.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util;
  var STORAGE_KEY = 'notgroschen.state.v1';
  var SCHEMA_VERSION = 1;

  /* --- Vorgaben ----------------------------------------------------------- */

  var DEFAULT_CATEGORIES = [
    { id: 'cat_salary',    name: 'Gehalt & Lohn',        kind: 'income',  system: true },
    { id: 'cat_bonus',     name: 'Sonderzahlungen',      kind: 'income',  system: true },
    { id: 'cat_transfer',  name: 'Transferleistungen',   kind: 'income',  system: true },
    { id: 'cat_sidejob',   name: 'Nebeneinkünfte',       kind: 'income',  system: true },
    { id: 'cat_capital',   name: 'Kapitalerträge',       kind: 'income',  system: true },

    { id: 'cat_housing',   name: 'Wohnen',               kind: 'expense', system: true },
    { id: 'cat_utilities', name: 'Energie & Nebenkosten',kind: 'expense', system: true },
    { id: 'cat_food',      name: 'Lebensmittel',         kind: 'expense', system: true },
    { id: 'cat_mobility',  name: 'Mobilität',            kind: 'expense', system: true },
    { id: 'cat_insurance', name: 'Versicherungen',       kind: 'expense', system: true },
    { id: 'cat_health',    name: 'Gesundheit',           kind: 'expense', system: true },
    { id: 'cat_leisure',   name: 'Freizeit & Hobbys',    kind: 'expense', system: true },
    { id: 'cat_shopping',  name: 'Anschaffungen',        kind: 'expense', system: true },
    { id: 'cat_comms',     name: 'Kommunikation & Abos', kind: 'expense', system: true },
    { id: 'cat_kids',      name: 'Kinder & Bildung',     kind: 'expense', system: true },
    { id: 'cat_travel',    name: 'Urlaub & Reisen',      kind: 'expense', system: true },
    { id: 'cat_debt',      name: 'Kredite & Zinsen',     kind: 'expense', system: true },
    { id: 'cat_saving',    name: 'Sparen & Vorsorge',    kind: 'expense', system: true, saving: true },
    { id: 'cat_other',     name: 'Sonstiges',            kind: 'expense', system: true }
  ];

  function defaultFire() {
    return {
      startAssets: null,           // null = automatisch: Gesamtvermögen inkl. Investments
      monthlyContribution: null,   // null = automatisch aus dem Haushaltssaldo
      contributionGrowthPct: 0,    // jährliche Steigerung der Sparrate, real
      returnPct: null,             // null = automatisch: gewichtete Portfoliorendite
      inflationPct: 2,             // erwartete Inflation p. a.
      withdrawalPct: 3.5,          // sichere Entnahmerate p. a.
      annualSpendOverride: null,   // null = Jahresausgaben aus dem Budget
      spendFactor: 100,            // Ausgabenniveau im Ruhestand in % von heute
      coastYears: 20,              // Horizont für die Coast-FIRE-Schwelle
      maxYears: 60
    };
  }

  function emptyState() {
    var now = new Date().toISOString();
    return {
      schema: SCHEMA_VERSION,
      app: 'notgroschen',
      meta: { name: 'Unser Haushalt', currency: 'EUR', created: now, updated: now },
      settings: {
        theme: 'auto',
        splitMode: 'income',       // Verteilungsschlüssel der Haushaltskosten
        startMonth: U.monthKey(),
        projectionMonths: 60,
        sankeyMode: 'budget',      // 'budget' | 'direct'
        sankeyMinShare: 1.5        // Anteil in %, darunter wird zu "Sonstige" gefaltet
      },
      // assets = Vermögen außerhalb der Investments (Girokonto, Bargeld, Sparbuch).
      // Das Gesamtvermögen ist assets + Summe der Investments, siehe calc.totalAssets.
      household: { budget: null, assets: 0 },
      people: [],
      categories: U.deepClone(DEFAULT_CATEGORIES),
      items: [],
      transactions: [],
      investments: [],
      plans: [],
      fire: defaultFire()
    };
  }

  /* --- Demodaten ---------------------------------------------------------- */

  function demoState() {
    var s = emptyState();
    var m = U.monthKey();
    s.meta.name = 'Haushalt Berg';
    s.household.budget = 4600;
    s.household.assets = 8500;   // Girokonto und Rücklage; der Rest steckt in Investments

    var a = { id: 'per_alex',  name: 'Alex',  colorIndex: 0, budget: 400, sharePct: null, note: '' };
    var r = { id: 'per_robin', name: 'Robin', colorIndex: 1, budget: 400, sharePct: null, note: '' };
    s.people = [a, r];

    // Erste Steigerung im kommenden Jänner — so laufen KV-Erhöhungen üblicherweise.
    var nextJan = (parseInt(m.slice(0, 4), 10) + 1) + '-01';

    function item(o) {
      return {
        id: U.uid('itm'), label: o.l, amount: o.a, interval: o.i || 'monthly',
        kind: o.k, owner: o.o, categoryId: o.c,
        start: null, end: null,
        growth: o.g ? { pct: o.g, everyMonths: o.ge || 12, from: nextJan, until: null } : null,
        active: true, note: ''
      };
    }

    s.items = [
      // Einnahmen
      item({ l: 'Gehalt (netto)',        a: 2900, k: 'income', o: a.id, c: 'cat_salary', g: 3 }),
      item({ l: '13./14. Gehalt',        a: 5800, i: 'yearly', k: 'income', o: a.id, c: 'cat_bonus', g: 3 }),
      item({ l: 'Gehalt (netto)',        a: 2250, k: 'income', o: r.id, c: 'cat_salary', g: 2.5 }),
      item({ l: '13./14. Gehalt',        a: 4500, i: 'yearly', k: 'income', o: r.id, c: 'cat_bonus', g: 2.5 }),
      item({ l: 'Nebentätigkeit',        a: 280,  k: 'income', o: r.id, c: 'cat_sidejob' }),
      item({ l: 'Familienbeihilfe',      a: 141.5, k: 'income', o: 'household', c: 'cat_transfer' }),

      // Haushaltsausgaben
      item({ l: 'Miete',                 a: 1290, k: 'expense', o: 'household', c: 'cat_housing', g: 2.8 }),
      item({ l: 'Betriebskosten',        a: 185,  k: 'expense', o: 'household', c: 'cat_housing' }),
      item({ l: 'Strom & Gas',           a: 138,  k: 'expense', o: 'household', c: 'cat_utilities' }),
      item({ l: 'Internet & Mobilfunk',  a: 68,   k: 'expense', o: 'household', c: 'cat_comms' }),
      item({ l: 'Streaming-Abos',        a: 34,   k: 'expense', o: 'household', c: 'cat_comms' }),
      item({ l: 'Lebensmittel',          a: 820,  k: 'expense', o: 'household', c: 'cat_food' }),
      item({ l: 'Drogerie & Haushalt',   a: 125,  k: 'expense', o: 'household', c: 'cat_food' }),
      item({ l: 'Haushaltsversicherung', a: 340,  i: 'yearly', k: 'expense', o: 'household', c: 'cat_insurance' }),
      item({ l: 'Lebensversicherung',    a: 96,   k: 'expense', o: 'household', c: 'cat_insurance' }),
      item({ l: 'Auto-Leasing',          a: 319,  k: 'expense', o: 'household', c: 'cat_mobility' }),
      item({ l: 'Kfz-Versicherung & Steuer', a: 980, i: 'yearly', k: 'expense', o: 'household', c: 'cat_mobility' }),
      item({ l: 'Treibstoff',            a: 165,  k: 'expense', o: 'household', c: 'cat_mobility' }),
      item({ l: 'Öffi-Jahreskarte',      a: 365,  i: 'yearly', k: 'expense', o: 'household', c: 'cat_mobility' }),
      item({ l: 'Kindergarten',          a: 210,  k: 'expense', o: 'household', c: 'cat_kids' }),
      item({ l: 'Arzt & Medikamente',    a: 75,   k: 'expense', o: 'household', c: 'cat_health' }),
      item({ l: 'Urlaubsbudget',         a: 3000, i: 'yearly', k: 'expense', o: 'household', c: 'cat_travel' }),
      item({ l: 'ETF-Sparplan',          a: 600,  k: 'expense', o: 'household', c: 'cat_saving' }),

      // Persönliche Ausgaben
      item({ l: 'Freizeit & Ausgehen',   a: 185, k: 'expense', o: a.id, c: 'cat_leisure' }),
      item({ l: 'Kleidung',              a: 85,  k: 'expense', o: a.id, c: 'cat_shopping' }),
      item({ l: 'Fitnessstudio',         a: 45,  k: 'expense', o: a.id, c: 'cat_health' }),
      item({ l: 'Freizeit & Ausgehen',   a: 150, k: 'expense', o: r.id, c: 'cat_leisure' }),
      item({ l: 'Kleidung',              a: 110, k: 'expense', o: r.id, c: 'cat_shopping' }),
      item({ l: 'Weiterbildung',         a: 65,  k: 'expense', o: r.id, c: 'cat_kids' })
    ];

    // Der ETF-Sparplan ist zugleich Geldfluss (Posten) und Vermögen (Investment) —
    // verknüpft, damit die Rate nur einmal im Budget zählt.
    var etfItem = s.items.filter(function (i) { return i.label === 'ETF-Sparplan'; })[0];

    s.investments = [
      {
        id: U.uid('inv'), label: 'MSCI World ETF', type: 'etf', owner: 'household',
        currentValue: 21400, costBasis: 18200, expectedReturnPct: 6.5,
        linkedItemId: etfItem ? etfItem.id : null, provider: 'Depotbank', note: ''
      },
      {
        id: U.uid('inv'), label: 'Fixzinssparen 3 Jahre', type: 'fixzins', owner: 'household',
        currentValue: 6000, costBasis: 6000, expectedReturnPct: 3.1,
        linkedItemId: null, provider: 'Hausbank', note: 'Bindung bis 2028'
      },
      {
        id: U.uid('inv'), label: 'Einzelaktien', type: 'aktien', owner: a.id,
        currentValue: 4300, costBasis: 3600, expectedReturnPct: 7,
        linkedItemId: null, provider: 'Broker', note: ''
      },
      {
        id: U.uid('inv'), label: 'Bausparvertrag', type: 'bausparer', owner: r.id,
        currentValue: 1800, costBasis: 1750, expectedReturnPct: 1.5,
        linkedItemId: null, provider: 'Bausparkasse', note: ''
      }
    ];

    function tx(day, label, amount, kind, owner, cat) {
      return {
        id: U.uid('tx'), date: m + '-' + U.pad2(day), label: label, amount: amount,
        kind: kind, owner: owner, categoryId: cat, note: ''
      };
    }
    s.transactions = [
      tx(3,  'Zahnarzt (Zuzahlung)', 240, 'expense', 'household', 'cat_health'),
      tx(7,  'Konzertkarten',        118, 'expense', a.id, 'cat_leisure'),
      tx(11, 'Winterreifen',         480, 'expense', 'household', 'cat_mobility'),
      tx(14, 'Steuerausgleich',      620, 'income',  r.id, 'cat_transfer'),
      tx(19, 'Geschenk Geburtstag',   75, 'expense', r.id, 'cat_shopping'),
      tx(22, 'Dividenden',           145, 'income',  'household', 'cat_capital')
    ];

    s.plans = [
      {
        id: U.uid('pln'),
        name: 'Karenz Robin',
        active: false,
        note: 'Zwölf Monate reduziertes Einkommen, danach Wiedereinstieg mit 80 %.',
        adjustments: [
          {
            id: U.uid('adj'), label: 'Einkommen Robin −65 %', scope: 'person', targetId: r.id,
            kind: 'income', mode: 'percent', value: -65,
            from: U.addMonths(m, 4), to: U.addMonths(m, 15)
          },
          {
            id: U.uid('adj'), label: 'Einkommen Robin −20 % (Teilzeit)', scope: 'person', targetId: r.id,
            kind: 'income', mode: 'percent', value: -20,
            from: U.addMonths(m, 16), to: U.addMonths(m, 39)
          },
          {
            id: U.uid('adj'), label: 'Babyausstattung', scope: 'oneoff', targetId: null,
            kind: 'expense', mode: 'delta', value: 2400,
            from: U.addMonths(m, 3), to: U.addMonths(m, 3)
          }
        ]
      },
      {
        id: U.uid('pln'),
        name: 'Küche & Auto',
        active: false,
        note: 'Zwei größere Anschaffungen im nächsten Jahr.',
        adjustments: [
          {
            id: U.uid('adj'), label: 'Neue Küche', scope: 'oneoff', targetId: null,
            kind: 'expense', mode: 'delta', value: 9500,
            from: U.addMonths(m, 8), to: U.addMonths(m, 8)
          },
          {
            id: U.uid('adj'), label: 'Gebrauchtwagen', scope: 'oneoff', targetId: null,
            kind: 'expense', mode: 'delta', value: 14000,
            from: U.addMonths(m, 20), to: U.addMonths(m, 20)
          }
        ]
      }
    ];

    return s;
  }

  /**
   * Progression eines Postens. Nur ein vollständig brauchbarer Satz wird
   * übernommen — eine halbe Angabe (etwa ohne Startmonat) würde in der
   * Oberfläche als aktiv erscheinen, ohne je zu wirken.
   */
  function normalizeGrowth(g) {
    if (!g || typeof g !== 'object') return null;
    var pct = Number(g.pct);
    var every = Math.round(Number(g.everyMonths));
    if (!isFinite(pct) || pct === 0) return null;
    if (!isFinite(every) || every < 1) return null;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(g.from || ''))) return null;
    return {
      pct: pct,
      everyMonths: every,
      from: g.from,
      until: /^\d{4}-(0[1-9]|1[0-2])$/.test(String(g.until || '')) ? g.until : null
    };
  }

  /* --- Migration / Validierung -------------------------------------------- */

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Datei enthält kein Objekt.');
    if (!raw.people && !raw.items && !raw.categories) {
      throw new Error('Das ist keine Notgroschen-Datei (weder Personen noch Posten gefunden).');
    }

    var base = emptyState();
    var s = {
      schema: SCHEMA_VERSION,
      app: 'notgroschen',
      meta: Object.assign({}, base.meta, raw.meta || {}),
      settings: Object.assign({}, base.settings, raw.settings || {}),
      household: Object.assign({}, base.household, raw.household || {}),
      people: Array.isArray(raw.people) ? raw.people : [],
      categories: Array.isArray(raw.categories) && raw.categories.length
        ? raw.categories : base.categories,
      items: Array.isArray(raw.items) ? raw.items : [],
      transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
      investments: Array.isArray(raw.investments) ? raw.investments : [],
      plans: Array.isArray(raw.plans) ? raw.plans : [],
      fire: Object.assign(defaultFire(), raw.fire || {})
    };

    s.people = s.people.map(function (p, i) {
      return {
        id: p.id || U.uid('per'),
        name: String(p.name || 'Person ' + (i + 1)),
        colorIndex: Number.isInteger(p.colorIndex) ? p.colorIndex : i,
        budget: p.budget == null ? null : Number(p.budget),
        sharePct: p.sharePct == null ? null : Number(p.sharePct),
        note: String(p.note || '')
      };
    });

    var validOwner = {};
    s.people.forEach(function (p) { validOwner[p.id] = true; });
    var validCat = {};
    s.categories.forEach(function (c) { validCat[c.id] = true; });

    function fixOwner(o) { return o === 'household' || validOwner[o] ? o : 'household'; }
    function fixCat(c, kind) {
      if (validCat[c]) return c;
      return kind === 'income' ? 'cat_salary' : 'cat_other';
    }

    s.items = s.items.map(function (it) {
      var kind = it.kind === 'income' ? 'income' : 'expense';
      return {
        id: it.id || U.uid('itm'),
        label: String(it.label || 'Posten'),
        amount: Number(it.amount) || 0,
        interval: HB.calc && HB.calc.INTERVALS[it.interval] ? it.interval : 'monthly',
        kind: kind,
        owner: fixOwner(it.owner),
        categoryId: fixCat(it.categoryId, kind),
        start: it.start || null,
        end: it.end || null,
        growth: normalizeGrowth(it.growth),
        active: it.active !== false,
        note: String(it.note || '')
      };
    });

    s.transactions = s.transactions.map(function (t) {
      var kind = t.kind === 'income' ? 'income' : 'expense';
      return {
        id: t.id || U.uid('tx'),
        date: t.date || U.todayISO(),
        label: String(t.label || 'Buchung'),
        amount: Number(t.amount) || 0,
        kind: kind,
        owner: fixOwner(t.owner),
        categoryId: fixCat(t.categoryId, kind),
        note: String(t.note || '')
      };
    }).sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : 0; });

    var validItem = {};
    s.items.forEach(function (it) { validItem[it.id] = true; });

    s.investments = s.investments.map(function (inv, i) {
      var type = HB.calc && HB.calc.INVESTMENT_TYPES[inv.type] ? inv.type : 'sonstiges';
      return {
        id: inv.id || U.uid('inv'),
        label: String(inv.label || 'Investment ' + (i + 1)),
        type: type,
        owner: fixOwner(inv.owner),
        currentValue: Number(inv.currentValue) || 0,
        costBasis: inv.costBasis == null || inv.costBasis === '' ? null : Number(inv.costBasis),
        expectedReturnPct: inv.expectedReturnPct == null || inv.expectedReturnPct === ''
          ? null : Number(inv.expectedReturnPct),
        // Ein Verweis auf einen gelöschten Posten wird gekappt, sonst zeigt die
        // Oberfläche einen Sparplan an, den es nicht mehr gibt.
        linkedItemId: validItem[inv.linkedItemId] ? inv.linkedItemId : null,
        provider: String(inv.provider || ''),
        note: String(inv.note || '')
      };
    });

    s.plans = s.plans.map(function (p) {
      return {
        id: p.id || U.uid('pln'),
        name: String(p.name || 'Szenario'),
        active: !!p.active,
        note: String(p.note || ''),
        adjustments: (Array.isArray(p.adjustments) ? p.adjustments : []).map(function (adj) {
          return {
            id: adj.id || U.uid('adj'),
            label: String(adj.label || 'Anpassung'),
            scope: adj.scope || 'household',
            targetId: adj.targetId || null,
            kind: adj.kind || 'both',
            mode: adj.mode || 'percent',
            value: Number(adj.value) || 0,
            from: adj.from || U.monthKey(),
            to: adj.to || null
          };
        })
      };
    });

    return s;
  }

  /* --- Store -------------------------------------------------------------- */

  var listeners = [];
  var store = {
    state: emptyState(),
    dirty: false,

    subscribe: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
    },

    emit: function (reason) {
      listeners.forEach(function (fn) {
        try { fn(store.state, reason); } catch (e) { console.error(e); }
      });
    },

    /** Einzige erlaubte Schreibstelle: mutiert, speichert und benachrichtigt. */
    update: function (fn, reason) {
      fn(store.state);
      store.state.meta.updated = new Date().toISOString();
      store.persist();
      store.emit(reason || 'update');
    },

    /** Nur speichern + benachrichtigen, ohne die Views neu zu bauen. */
    touch: function () {
      store.state.meta.updated = new Date().toISOString();
      store.persist();
    },

    persist: function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
        store.dirty = false;
      } catch (e) {
        store.dirty = true;
        console.warn('localStorage nicht verfügbar:', e);
      }
      if (typeof store.onPersist === 'function') store.onPersist(store.dirty);
    },

    load: function () {
      var raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* Privatmodus */ }
      if (!raw) return false;
      try {
        store.state = migrate(JSON.parse(raw));
        return true;
      } catch (e) {
        console.warn('Gespeicherter Stand unlesbar, starte leer:', e);
        return false;
      }
    },

    replace: function (next, reason) {
      store.state = next;
      store.persist();
      store.emit(reason || 'replace');
    },

    reset: function () { store.replace(emptyState(), 'reset'); },
    loadDemo: function () { store.replace(demoState(), 'demo'); },

    /* --- Datei ------------------------------------------------------------ */

    toJSON: function () { return JSON.stringify(store.state, null, 2); },

    suggestedFilename: function () {
      var slug = String(store.state.meta.name || 'haushalt')
        .toLowerCase()
        .replace(/[äöüß]/g, function (c) {
          return { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[c];
        })
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'haushalt';
      return 'notgroschen-' + slug + '-' + U.todayISO() + '.json';
    },

    exportFile: function () {
      var blob = new Blob([store.toJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = store.suggestedFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return a.download;
    },

    importText: function (text) {
      var next = migrate(JSON.parse(text));
      store.replace(next, 'import');
      return next;
    },

    /* --- Lesehelfer ------------------------------------------------------- */

    person: function (id) { return U.byId(store.state.people, id); },
    category: function (id) { return U.byId(store.state.categories, id); },

    ownerName: function (id) {
      if (id === 'household') return 'Haushalt';
      var p = store.person(id);
      return p ? p.name : 'Unbekannt';
    },

    ownerColor: function (id) {
      if (id === 'household') return U.token('--accent');
      var p = store.person(id);
      if (!p) return U.token('--text-muted');
      return U.seriesColor(p.colorIndex % 8);
    },

    categoryName: function (id) {
      var c = store.category(id);
      return c ? c.name : 'Ohne Kategorie';
    },

    activePlans: function () {
      return store.state.plans.filter(function (p) { return p.active; });
    }
  };

  store.STORAGE_KEY = STORAGE_KEY;
  store.emptyState = emptyState;
  store.demoState = demoState;
  store.migrate = migrate;
  store.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;

  HB.store = store;
})(window.HB);
