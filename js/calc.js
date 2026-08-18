/* ---------------------------------------------------------------------------
   calc.js — Normalisierung, Monatsaggregation, Kostenschlüssel,
             Szenario-Anwendung, Projektion, FIRE
   Reine Funktionen: nehmen den State entgegen, verändern ihn nie.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util;

  /* --- Intervalle --------------------------------------------------------- */

  var INTERVALS = {
    weekly:     { label: 'wöchentlich',    perMonth: 52 / 12 },
    biweekly:   { label: 'alle 2 Wochen',  perMonth: 26 / 12 },
    monthly:    { label: 'monatlich',      perMonth: 1 },
    bimonthly:  { label: 'alle 2 Monate',  perMonth: 1 / 2 },
    quarterly:  { label: 'quartalsweise',  perMonth: 1 / 3 },
    semiannual: { label: 'halbjährlich',   perMonth: 1 / 6 },
    yearly:     { label: 'jährlich',       perMonth: 1 / 12 }
  };

  function perMonth(item) {
    var iv = INTERVALS[item.interval] || INTERVALS.monthly;
    return (Number(item.amount) || 0) * iv.perMonth;
  }

  function perYear(item) { return perMonth(item) * 12; }

  /* --- Progression -------------------------------------------------------- */

  /**
   * Wiederkehrende Steigerung eines Postens — Gehaltsprogression, indexierte
   * Miete, valorisierte Versicherungsprämie. Das Feld `growth` sieht so aus:
   *
   *   { pct: 3, everyMonths: 12, from: "2027-01", until: null }
   *
   * `from` ist der Monat der **ersten** Steigerung. Danach greift alle
   * `everyMonths` Monate eine weitere, jeweils auf den bereits gestiegenen
   * Betrag — die Steigerungen wirken also zinseszinsartig, wie in der Realität.
   */
  var GROWTH_PRESETS = [
    { value: 6,  label: 'halbjährlich' },
    { value: 12, label: 'jährlich' },
    { value: 24, label: 'alle 2 Jahre' },
    { value: 36, label: 'alle 3 Jahre' }
  ];

  function growthLabel(g) {
    if (!g) return '';
    var preset = GROWTH_PRESETS.filter(function (x) { return x.value === g.everyMonths; })[0];
    var rhythm = preset ? preset.label : 'alle ' + g.everyMonths + ' Monate';
    return (g.pct >= 0 ? '+' : '−') + U.num(Math.abs(g.pct), 1) + ' % ' + rhythm;
  }

  /** Anzahl der bis zu diesem Monat wirksam gewordenen Steigerungen. */
  function growthSteps(g, key) {
    if (!g || !g.pct || !g.everyMonths || !g.from) return 0;
    var every = Math.max(1, Math.round(g.everyMonths));
    var first = U.monthIndex(g.from);
    var at = U.monthIndex(key);
    // Nach dem Ende der Progression bleibt der zuletzt erreichte Stand stehen.
    if (g.until) at = Math.min(at, U.monthIndex(g.until));
    if (at < first) return 0;
    return Math.floor((at - first) / every) + 1;
  }

  function growthFactor(g, key) {
    var steps = growthSteps(g, key);
    if (!steps) return 1;
    return Math.pow(1 + (Number(g.pct) || 0) / 100, steps);
  }

  /** Monatsbetrag eines Postens im angegebenen Monat, inklusive Progression. */
  function perMonthAt(item, key) {
    return perMonth(item) * growthFactor(item.growth, key);
  }

  /* --- Anlagearten -------------------------------------------------------- */

  /**
   * Die Renditen sind Vorgaben für das Formular, keine Prognosen — sie lassen
   * sich je Investment überschreiben und sind bewusst zurückhaltend gewählt.
   */
  var INVESTMENT_TYPES = {
    etf:         { label: 'ETF',                  defaultReturn: 6.5 },
    aktien:      { label: 'Aktien (Einzelwerte)', defaultReturn: 7 },
    fonds:       { label: 'Investmentfonds',      defaultReturn: 5 },
    anleihen:    { label: 'Anleihen',             defaultReturn: 3 },
    fixzins:     { label: 'Fixzinssparen',        defaultReturn: 3 },
    tagesgeld:   { label: 'Tages- & Festgeld',    defaultReturn: 2.5 },
    bausparer:   { label: 'Bausparvertrag',       defaultReturn: 1.5 },
    versicherung:{ label: 'Lebens-/Rentenversicherung', defaultReturn: 2 },
    vorsorge:    { label: 'Betriebliche Vorsorge', defaultReturn: 3 },
    immobilie:   { label: 'Immobilie',            defaultReturn: 3 },
    edelmetall:  { label: 'Edelmetalle & Rohstoffe', defaultReturn: 3 },
    krypto:      { label: 'Kryptowährungen',      defaultReturn: 8 },
    sonstiges:   { label: 'Sonstiges',            defaultReturn: 3 }
  };

  function typeLabel(t) {
    return (INVESTMENT_TYPES[t] || INVESTMENT_TYPES.sonstiges).label;
  }

  /* --- Flüsse eines Monats ------------------------------------------------ */

  /**
   * Baut die Liste aller Geldflüsse eines Monats.
   * opts: { plans: [], includeTransactions: bool, state }
   * Ein Fluss ist { id, itemId, label, kind, owner, categoryId, amount, source }.
   */
  function monthFlows(state, key, opts) {
    opts = opts || {};
    var flows = [];

    state.items.forEach(function (it) {
      if (it.active === false) return;
      if (!U.inRange(key, it.start, it.end)) return;
      var amt = perMonthAt(it, key);
      if (!amt) return;
      flows.push({
        id: it.id, itemId: it.id, label: it.label, kind: it.kind,
        owner: it.owner, categoryId: it.categoryId,
        amount: amt, source: 'recurring'
      });
    });

    if (opts.includeTransactions) {
      state.transactions.forEach(function (t) {
        if (U.monthOfISO(t.date) !== key) return;
        var amt = Number(t.amount) || 0;
        if (!amt) return;
        flows.push({
          id: t.id, itemId: null, label: t.label, kind: t.kind,
          owner: t.owner, categoryId: t.categoryId,
          amount: amt, source: 'transaction'
        });
      });
    }

    var plans = opts.plans || [];
    if (plans.length) flows = applyPlans(flows, plans, key);

    return flows;
  }

  /* --- Szenarien ---------------------------------------------------------- */

  function matchesScope(flow, adj) {
    if (adj.kind && adj.kind !== 'both' && flow.kind !== adj.kind) return false;
    switch (adj.scope) {
      case 'item':      return flow.itemId === adj.targetId;
      case 'person':    return flow.owner === adj.targetId;
      case 'category':  return flow.categoryId === adj.targetId;
      case 'household': return flow.owner === 'household';
      case 'all':       return true;
      default:          return false;
    }
  }

  function applyPlans(flows, plans, key) {
    var out = flows.map(function (f) { return Object.assign({}, f); });

    plans.forEach(function (plan) {
      (plan.adjustments || []).forEach(function (adj) {
        if (!U.inRange(key, adj.from, adj.to)) return;

        // Einmalige Ereignisse sind eigene Flüsse, keine Änderung bestehender.
        if (adj.scope === 'oneoff') {
          out.push({
            id: adj.id, itemId: null,
            label: adj.label || plan.name,
            kind: adj.kind === 'income' ? 'income' : 'expense',
            owner: adj.targetId || 'household',
            categoryId: adj.categoryId || (adj.kind === 'income' ? 'cat_sidejob' : 'cat_shopping'),
            amount: Math.abs(Number(adj.value) || 0),
            source: 'plan', planId: plan.id
          });
          return;
        }

        var hits = out.filter(function (f) { return matchesScope(f, adj); });

        if (adj.mode === 'percent') {
          var factor = 1 + (Number(adj.value) || 0) / 100;
          hits.forEach(function (f) {
            f.amount = Math.max(0, f.amount * factor);
            f.adjusted = true;
          });
          return;
        }

        if (adj.mode === 'set') {
          var target = Math.abs(Number(adj.value) || 0);
          if (adj.scope === 'item') {
            hits.forEach(function (f) { f.amount = target; f.adjusted = true; });
          } else {
            // Gruppenweise proportional auf die Zielsumme skalieren.
            var total = U.sum(hits, function (f) { return f.amount; });
            if (total > 0) {
              hits.forEach(function (f) { f.amount = f.amount * (target / total); f.adjusted = true; });
            }
          }
          return;
        }

        if (adj.mode === 'delta') {
          var delta = Number(adj.value) || 0;
          if (adj.scope === 'item' && hits.length) {
            hits.forEach(function (f) { f.amount = Math.max(0, f.amount + delta); f.adjusted = true; });
          } else {
            // Auf Gruppenebene ist ein Delta ein zusätzlicher Posten.
            out.push({
              id: adj.id, itemId: null,
              label: adj.label || plan.name,
              kind: adj.kind === 'income' ? 'income' : 'expense',
              owner: adj.scope === 'person' ? adj.targetId : 'household',
              categoryId: adj.categoryId || (adj.kind === 'income' ? 'cat_sidejob' : 'cat_other'),
              amount: Math.abs(delta),
              source: 'plan', planId: plan.id
            });
          }
        }
      });
    });

    return out;
  }

  /* --- Kostenschlüssel ---------------------------------------------------- */

  /**
   * Verteilungsschlüssel der Haushaltskosten auf die Personen.
   * 'income' = proportional zum Einkommen, 'equal' = zu gleichen Teilen,
   * 'custom' = nach den hinterlegten Prozentsätzen (normalisiert).
   */
  function shares(state, incomeByPerson) {
    var people = state.people;
    var out = {};
    if (!people.length) return out;

    var mode = state.settings.splitMode || 'income';

    if (mode === 'custom') {
      var totalPct = U.sum(people, function (p) { return Math.max(0, Number(p.sharePct) || 0); });
      if (totalPct > 0) {
        people.forEach(function (p) { out[p.id] = Math.max(0, Number(p.sharePct) || 0) / totalPct; });
        return out;
      }
      mode = 'equal';
    }

    if (mode === 'income') {
      var totalInc = U.sum(people, function (p) { return incomeByPerson[p.id] || 0; });
      if (totalInc > 0) {
        people.forEach(function (p) { out[p.id] = (incomeByPerson[p.id] || 0) / totalInc; });
        return out;
      }
    }

    people.forEach(function (p) { out[p.id] = 1 / people.length; });
    return out;
  }

  /* --- Aggregation -------------------------------------------------------- */

  function isSavingCategory(state, catId) {
    var c = U.byId(state.categories, catId);
    return !!(c && c.saving);
  }

  /**
   * Verdichtet Flüsse zu einer Monatsbilanz mit Personen-, Haushalts-
   * und Kategoriesicht.
   */
  function summarize(state, flows) {
    var res = {
      flows: flows,
      income: 0, expense: 0, net: 0,
      savingContrib: 0,             // planmäßige Sparbeiträge (Kategorie „Sparen“)
      household: { income: 0, expense: 0, net: 0 },
      byPerson: {},
      incomeByCategory: {},
      expenseByCategory: {},
      expenseByOwner: {},
      incomeByOwner: {}
    };

    state.people.forEach(function (p) {
      res.byPerson[p.id] = {
        id: p.id, name: p.name, income: 0, expense: 0, net: 0,
        budget: p.budget, share: 0, householdShare: 0, personalNet: 0,
        budgetUsed: 0, budgetLeft: null
      };
    });

    flows.forEach(function (f) {
      var isInc = f.kind === 'income';
      var bucket = isInc ? 'income' : 'expense';

      res[bucket] += f.amount;

      var ownerMap = isInc ? res.incomeByOwner : res.expenseByOwner;
      ownerMap[f.owner] = (ownerMap[f.owner] || 0) + f.amount;

      var catMap = isInc ? res.incomeByCategory : res.expenseByCategory;
      catMap[f.categoryId] = (catMap[f.categoryId] || 0) + f.amount;

      if (!isInc && isSavingCategory(state, f.categoryId)) res.savingContrib += f.amount;

      if (f.owner === 'household') {
        res.household[bucket] += f.amount;
      } else if (res.byPerson[f.owner]) {
        res.byPerson[f.owner][bucket] += f.amount;
      } else {
        // Unbekannter Träger (z. B. gelöschte Person) zählt zum Haushalt.
        res.household[bucket] += f.amount;
      }
    });

    res.net = res.income - res.expense;
    res.household.net = res.household.income - res.household.expense;

    var incomeByPerson = {};
    state.people.forEach(function (p) { incomeByPerson[p.id] = res.byPerson[p.id].income; });
    var sh = shares(state, incomeByPerson);

    // Was die Personen gemeinsam für den Haushalt aufbringen müssen.
    res.householdNetCost = res.household.expense - res.household.income;

    state.people.forEach(function (p) {
      var b = res.byPerson[p.id];
      b.net = b.income - b.expense;
      b.share = sh[p.id] || 0;
      b.householdShare = res.householdNetCost * b.share;
      b.personalNet = b.income - b.expense - b.householdShare;
      if (b.budget != null && b.budget > 0) {
        b.budgetUsed = b.expense / b.budget;
        b.budgetLeft = b.budget - b.expense;
      } else {
        b.budgetUsed = 0;
        b.budgetLeft = null;
      }
    });

    var hb = state.household.budget;
    res.householdBudget = hb;
    res.householdBudgetUsed = hb && hb > 0 ? res.household.expense / hb : 0;
    res.householdBudgetLeft = hb && hb > 0 ? hb - res.household.expense : null;

    // Sparquote: was tatsächlich nicht verkonsumiert wird.
    res.savingsTotal = res.net + res.savingContrib;
    res.savingsRate = res.income > 0 ? res.savingsTotal / res.income : 0;

    return res;
  }

  /** Bequemer Einstieg: Bilanz eines Monats inkl. Szenarien. */
  function monthSummary(state, key, opts) {
    return summarize(state, monthFlows(state, key, opts));
  }

  /* --- Investments -------------------------------------------------------- */

  /**
   * Verdichtet das Portfolio: Bestand, Einstand, Gewinn, Aufteilung nach
   * Anlageart und Träger sowie die nach Wert gewichtete Renditeerwartung.
   */
  function investmentSummary(state) {
    var list = state.investments || [];
    var res = {
      count: list.length,
      total: 0,
      cost: 0,
      costKnown: 0,          // Bestandswert der Posten mit bekanntem Einstand
      gain: 0,
      gainPct: null,
      byType: {},
      byOwner: {},
      weightedReturn: null,
      contributionMonthly: 0 // Summe der verknüpften Sparplan-Posten
    };

    var weighted = 0;
    var weightBase = 0;

    list.forEach(function (inv) {
      var v = Number(inv.currentValue) || 0;
      res.total += v;

      res.byType[inv.type] = (res.byType[inv.type] || 0) + v;
      res.byOwner[inv.owner] = (res.byOwner[inv.owner] || 0) + v;

      if (inv.costBasis != null) {
        res.cost += Number(inv.costBasis) || 0;
        res.costKnown += v;
      }
      if (inv.expectedReturnPct != null && v > 0) {
        weighted += v * Number(inv.expectedReturnPct);
        weightBase += v;
      }
      var it = inv.linkedItemId ? U.byId(state.items, inv.linkedItemId) : null;
      if (it && it.active !== false) res.contributionMonthly += perMonthAt(it, U.monthKey());
    });

    res.gain = res.costKnown - res.cost;
    res.gainPct = res.cost > 0 ? res.gain / res.cost : null;
    // Nur bewertete Positionen gehen in den Durchschnitt ein; ein Investment
    // ohne Renditeerwartung zieht das Ergebnis nicht künstlich nach unten.
    res.weightedReturn = weightBase > 0 ? weighted / weightBase : null;

    return res;
  }

  /** Vermögen außerhalb der Investments plus Portfoliobestand. */
  function totalAssets(state) {
    return (Number(state.household.assets) || 0) + investmentSummary(state).total;
  }

  /** Gewichtete Renditeerwartung des Portfolios, oder null ohne Investments. */
  function portfolioReturn(state) {
    return investmentSummary(state).weightedReturn;
  }

  /* --- Projektion --------------------------------------------------------- */

  /**
   * Monatsreihe über einen Zeitraum. Liefert je Monat Einnahmen, Ausgaben,
   * Saldo, kumulierten Saldo und das fortgeschriebene Vermögen.
   * opts: { from, months, plans, startAssets, returnPct, includeTransactions }
   */
  function project(state, opts) {
    opts = opts || {};
    var from = opts.from || state.settings.startMonth || U.monthKey();
    var months = opts.months || state.settings.projectionMonths || 60;
    var plans = opts.plans || [];
    var assets = opts.startAssets != null ? opts.startAssets : totalAssets(state);
    var rMonthly = opts.returnPct ? Math.pow(1 + opts.returnPct / 100, 1 / 12) - 1 : 0;

    var rows = [];
    var cum = 0;

    for (var i = 0; i < months; i++) {
      var key = U.addMonths(from, i);
      var s = summarize(state, monthFlows(state, key, {
        plans: plans,
        includeTransactions: !!opts.includeTransactions
      }));
      var contribution = s.net + s.savingContrib;
      cum += s.net;
      assets = assets * (1 + rMonthly) + contribution;

      rows.push({
        key: key,
        income: s.income,
        expense: s.expense,
        net: s.net,
        savingContrib: s.savingContrib,
        contribution: contribution,
        cumulative: cum,
        assets: assets,
        summary: s
      });
    }
    return rows;
  }

  /* --- FIRE --------------------------------------------------------------- */

  /**
   * FIRE-Rechnung in heutiger Kaufkraft (real).
   * Sparrate: entweder fix vorgegeben oder automatisch aus dem Haushaltssaldo
   * plus den planmäßigen Sparbeiträgen.
   */
  function fireCalc(state, opts) {
    opts = opts || {};
    var f = Object.assign({}, state.fire, opts.overrides || {});
    var plans = opts.plans || [];
    var base = monthSummary(state, opts.month || state.settings.startMonth || U.monthKey(), { plans: plans });

    // Ausgaben ohne Sparbeiträge — im Ruhestand wird nicht mehr gespart.
    var monthlySpend = base.expense - base.savingContrib;
    var annualSpendToday = monthlySpend * 12;
    var spendFactor = (f.spendFactor == null ? 100 : f.spendFactor) / 100;
    var annualSpend = f.annualSpendOverride != null && f.annualSpendOverride !== ''
      ? Number(f.annualSpendOverride)
      : annualSpendToday * spendFactor;

    var swr = (Number(f.withdrawalPct) || 3.5) / 100;
    var fireNumber = swr > 0 ? annualSpend / swr : Infinity;

    var autoContribution = base.net + base.savingContrib;
    var contribution = (f.monthlyContribution != null && f.monthlyContribution !== '')
      ? Number(f.monthlyContribution)
      : autoContribution;

    // Startvermögen und Rendite dürfen leer bleiben: dann kommen sie aus dem
    // erfassten Vermögen bzw. aus der gewichteten Renditeerwartung des Portfolios.
    var portfolio = investmentSummary(state);
    var assetsIsAuto = f.startAssets == null || f.startAssets === '';
    var startAssets = assetsIsAuto ? totalAssets(state) : Number(f.startAssets);

    var returnIsAuto = f.returnPct == null || f.returnPct === '';
    var autoReturn = portfolio.weightedReturn == null ? 6 : portfolio.weightedReturn;
    var returnPct = returnIsAuto ? autoReturn : Number(f.returnPct);

    var nominal = (Number(returnPct) || 0) / 100;
    var infl = (Number(f.inflationPct) || 0) / 100;
    var realAnnual = (1 + nominal) / (1 + infl) - 1;
    var realMonthly = Math.pow(1 + realAnnual, 1 / 12) - 1;
    var growth = (Number(f.contributionGrowthPct) || 0) / 100;

    var maxMonths = (Number(f.maxYears) || 60) * 12;
    var assets = startAssets;
    var series = [{ month: 0, assets: assets, target: fireNumber, contributed: 0 }];
    var reachedAt = assets >= fireNumber ? 0 : null;
    var contributedTotal = 0;
    var c = contribution;

    for (var m = 1; m <= maxMonths; m++) {
      if (m > 1 && (m - 1) % 12 === 0) c = c * (1 + growth);
      assets = assets * (1 + realMonthly) + c;
      contributedTotal += c;
      if (reachedAt == null && assets >= fireNumber) reachedAt = m;
      if (m % 3 === 0 || m === maxMonths) {
        series.push({ month: m, assets: assets, target: fireNumber, contributed: contributedTotal });
      }
      if (reachedAt != null && m >= reachedAt + 12) break;   // etwas Nachlauf für die Kurve
    }

    var years = reachedAt == null ? null : reachedAt / 12;
    var coastYears = Number(f.coastYears) || 20;
    var coastNumber = fireNumber / Math.pow(1 + realAnnual, coastYears);

    return {
      fireNumber: fireNumber,
      annualSpend: annualSpend,
      annualSpendToday: annualSpendToday,
      monthlySpend: monthlySpend,
      contribution: contribution,
      autoContribution: autoContribution,
      contributionIsAuto: !(f.monthlyContribution != null && f.monthlyContribution !== ''),
      startAssets: startAssets,
      startAssetsIsAuto: assetsIsAuto,
      returnPct: returnPct,
      returnIsAuto: returnIsAuto,
      portfolioReturn: portfolio.weightedReturn,
      portfolioTotal: portfolio.total,
      otherAssets: Number(state.household.assets) || 0,
      realAnnual: realAnnual,
      swr: swr,
      reached: reachedAt != null,
      months: reachedAt,
      years: years,
      targetMonthKey: reachedAt == null ? null : U.addMonths(U.monthKey(), reachedAt),
      finalAssets: assets,
      contributedTotal: contributedTotal,
      coastYears: coastYears,
      coastNumber: coastNumber,
      monthlyWithdrawal: fireNumber * swr / 12,
      series: series,
      maxYears: Number(f.maxYears) || 60
    };
  }

  /* --- Sankey-Graph ------------------------------------------------------- */

  /**
   * Übersetzt eine Monatsbilanz in Knoten/Kanten für das Sankey-Diagramm.
   * mode 'budget': Einkommen → Träger → Gesamtbudget → Ausgaben/Überschuss
   * mode 'direct': Einkommen → Träger → Ausgaben/Überschuss
   */
  function sankeyGraph(state, summary, opts) {
    opts = opts || {};
    var mode = opts.mode || 'budget';
    var minShare = (opts.minShare == null ? 1.5 : opts.minShare) / 100;

    var nodes = [];
    var index = {};
    var links = [];

    function node(id, name, kind, color, sub) {
      if (!index[id]) {
        index[id] = { id: id, name: name, kind: kind, color: color, sub: sub || '' };
        nodes.push(index[id]);
      }
      return index[id];
    }
    function link(a, b, value, color, label) {
      if (!(value > 0.005)) return;
      links.push({ source: a, target: b, value: value, color: color, label: label || '' });
    }

    var totalIncome = summary.income;
    if (totalIncome <= 0) return { nodes: [], links: [] };

    var ownerColor = HB.store.ownerColor;
    var ownerName = HB.store.ownerName;

    // 1) Einkommensquellen → Träger
    var owners = {};
    summary.flows.filter(function (f) { return f.kind === 'income'; }).forEach(function (f) {
      owners[f.owner] = true;
    });

    var incomeGroups = {};
    summary.flows.filter(function (f) { return f.kind === 'income'; }).forEach(function (f) {
      var key = f.owner + '|' + f.categoryId;
      if (!incomeGroups[key]) {
        incomeGroups[key] = { owner: f.owner, cat: f.categoryId, amount: 0, labels: [] };
      }
      incomeGroups[key].amount += f.amount;
      incomeGroups[key].labels.push(f.label);
    });

    Object.keys(owners).forEach(function (o) {
      node('own:' + o, ownerName(o), 'owner', ownerColor(o));
    });

    Object.keys(incomeGroups).forEach(function (k) {
      var g = incomeGroups[k];
      var id = 'inc:' + k;
      // Dieselbe Einkommensart kommt oft bei mehreren Personen vor — der
      // Trägername in der Unterzeile hält die Quellen auseinander.
      node(id, HB.store.categoryName(g.cat), 'income', ownerColor(g.owner), ownerName(g.owner));
      link(id, 'own:' + g.owner, g.amount, ownerColor(g.owner));
    });

    // 2) Träger → Verteilstufe
    var poolId = 'pool';
    if (mode === 'budget') {
      node(poolId, 'Gesamtbudget', 'pool', U.token('--accent'),
        U.currency(totalIncome, { digits: 0 }));
      Object.keys(owners).forEach(function (o) {
        var amt = summary.incomeByOwner[o] || 0;
        link('own:' + o, poolId, amt, ownerColor(o));
      });
    }

    // 3) Ausgaben nach Kategorie, kleine Posten falten
    var expByCatOwner = {};
    summary.flows.filter(function (f) { return f.kind === 'expense'; }).forEach(function (f) {
      var key = mode === 'budget' ? f.categoryId : (f.owner + '|' + f.categoryId);
      if (!expByCatOwner[key]) {
        expByCatOwner[key] = { cat: f.categoryId, owner: f.owner, amount: 0 };
      }
      expByCatOwner[key].amount += f.amount;
    });

    var expenseColor = U.token('--text-muted');
    var savingColor = U.token('--pos');
    var otherBuckets = {};

    Object.keys(expByCatOwner).forEach(function (k) {
      var g = expByCatOwner[k];
      var src = mode === 'budget' ? poolId : 'own:' + g.owner;
      var linkColor = mode === 'budget' ? U.token('--accent') : ownerColor(g.owner);

      if (g.amount / totalIncome < minShare) {
        var ob = otherBuckets[src] = otherBuckets[src] || { amount: 0, n: 0, color: linkColor };
        ob.amount += g.amount;
        ob.n += 1;
        return;
      }

      var isSaving = isSavingCategory(state, g.cat);
      var id = 'exp:' + k;
      // In der Direktansicht existiert dieselbe Kategorie je Träger einmal —
      // der Name muss sie unterscheidbar machen.
      var nm = HB.store.categoryName(g.cat) +
        (mode === 'direct' ? ' · ' + ownerName(g.owner) : '');
      node(id, nm, isSaving ? 'saving' : 'expense', isSaving ? savingColor : expenseColor);
      link(src, id, g.amount, linkColor);
    });

    Object.keys(otherBuckets).forEach(function (src) {
      var ob = otherBuckets[src];
      var id = 'exp:other:' + src;
      var nm = 'Sonstige' + (mode === 'direct'
        ? ' · ' + ownerName(src.replace(/^own:/, '')) : '');
      node(id, nm, 'expense', expenseColor, ob.n + ' Kategorien');
      link(src, id, ob.amount, ob.color);
    });

    // 4) Überschuss bzw. Deckungslücke
    if (summary.net > 0.005) {
      node('surplus', 'Überschuss', 'saving', U.token('--pos'),
        'frei verfügbar');
      if (mode === 'budget') {
        link(poolId, 'surplus', summary.net, U.token('--accent'));
      } else {
        // proportional zu den Einnahmen der Träger
        Object.keys(owners).forEach(function (o) {
          var part = summary.net * ((summary.incomeByOwner[o] || 0) / totalIncome);
          link('own:' + o, 'surplus', part, ownerColor(o));
        });
      }
    }

    return { nodes: nodes, links: links, deficit: summary.net < 0 ? -summary.net : 0 };
  }

  HB.calc = {
    INTERVALS: INTERVALS,
    INVESTMENT_TYPES: INVESTMENT_TYPES,
    GROWTH_PRESETS: GROWTH_PRESETS,
    typeLabel: typeLabel,
    perMonth: perMonth,
    perMonthAt: perMonthAt,
    perYear: perYear,
    growthLabel: growthLabel,
    growthSteps: growthSteps,
    growthFactor: growthFactor,
    investmentSummary: investmentSummary,
    totalAssets: totalAssets,
    portfolioReturn: portfolioReturn,
    monthFlows: monthFlows,
    applyPlans: applyPlans,
    summarize: summarize,
    monthSummary: monthSummary,
    shares: shares,
    isSavingCategory: isSavingCategory,
    project: project,
    fireCalc: fireCalc,
    sankeyGraph: sankeyGraph
  };
})(window.HB);
