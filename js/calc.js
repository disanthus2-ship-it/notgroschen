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

  /* --- Fälligkeit --------------------------------------------------------- */

  /** Abstand zwischen zwei Zahlungen in Monaten (jährlich = 12, quartalsweise = 3). */
  function intervalMonths(interval) {
    var iv = INTERVALS[interval] || INTERVALS.monthly;
    return 1 / iv.perMonth;
  }

  /** Fällt dieser Posten in diesem Monat tatsächlich an? */
  function dueIn(item, key) {
    var months = Math.round(intervalMonths(item.interval));
    if (months <= 1) return true;                 // wöchentlich bis monatlich
    if (item.dueMonth == null) return true;       // ohne Angabe gleichmäßig verteilt
    var m = parseInt(String(key).split('-')[1], 10);
    return ((m - item.dueMonth) % months + months) % months === 0;
  }

  /**
   * Kassenwirksamer Betrag eines Monats — im Gegensatz zu perMonthAt, das
   * Jahres- und Quartalsposten gleichmäßig verteilt. Ist am Posten eine
   * Fälligkeit hinterlegt, trifft der volle Betrag genau in seinem Monat ein
   * und in den übrigen Monaten gar nichts.
   */
  function cashAt(item, key) {
    var months = Math.round(intervalMonths(item.interval));
    if (months <= 1 || item.dueMonth == null) return perMonthAt(item, key);
    if (!dueIn(item, key)) return 0;
    return (Number(item.amount) || 0) * growthFactor(item.growth, key);
  }

  /* --- Anlagearten -------------------------------------------------------- */

  /**
   * Vorgaben je Anlageart. Alle drei Werte sind je Position überschreibbar.
   *
   * `defaultReturn` — Renditeerwartung, bewusst zurückhaltend, keine Prognose.
   *
   * `liquid` — zählt zum Notgroschen. Streng gefasst: nur was ohne Kursrisiko
   * und ohne Bindung greifbar ist.
   *
   * `tax` — österreichischer KESt-Satz auf die Erträge: 27,5 % auf Wertpapiere,
   * Fonds, Derivate und Kryptowährungen, 25 % auf Geldeinlagen bei
   * Kreditinstituten. Mit 0 sind Anlagen erfasst, bei denen keine laufende KESt
   * anfällt — betriebliche Vorsorge, Lebensversicherung (Versicherungssteuer
   * statt KESt), physische Edelmetalle nach der Behaltefrist und Immobilien,
   * bei denen erst der Verkauf ImmoESt auslöst.
   */
  var INVESTMENT_TYPES = {
    etf:         { label: 'ETF',                  defaultReturn: 6.5, liquid: false, tax: 27.5 },
    aktien:      { label: 'Aktien (Einzelwerte)', defaultReturn: 7,   liquid: false, tax: 27.5 },
    fonds:       { label: 'Investmentfonds',      defaultReturn: 5,   liquid: false, tax: 27.5 },
    anleihen:    { label: 'Anleihen',             defaultReturn: 3,   liquid: false, tax: 27.5 },
    fixzins:     { label: 'Fixzinssparen',        defaultReturn: 3,   liquid: false, tax: 25 },
    tagesgeld:   { label: 'Tages- & Festgeld',    defaultReturn: 2.5, liquid: true,  tax: 25 },
    bausparer:   { label: 'Bausparvertrag',       defaultReturn: 1.5, liquid: false, tax: 25 },
    versicherung:{ label: 'Lebens-/Rentenversicherung', defaultReturn: 2, liquid: false, tax: 0 },
    vorsorge:    { label: 'Betriebliche Vorsorge', defaultReturn: 3,  liquid: false, tax: 0 },
    immobilie:   { label: 'Immobilie',            defaultReturn: 3,   liquid: false, tax: 0 },
    edelmetall:  { label: 'Edelmetalle & Rohstoffe', defaultReturn: 3, liquid: false, tax: 0 },
    krypto:      { label: 'Kryptowährungen',      defaultReturn: 8,   liquid: false, tax: 27.5 },
    sonstiges:   { label: 'Sonstiges',            defaultReturn: 3,   liquid: false, tax: 27.5 }
  };

  /** Kreditarten. `label` erscheint in Auswahl und Tabelle. */
  var DEBT_TYPES = {
    mortgage:   { label: 'Wohnkredit / Hypothek' },
    consumer:   { label: 'Konsumkredit' },
    car:        { label: 'Auto- / Leasingfinanzierung' },
    education:  { label: 'Bildungskredit' },
    creditcard: { label: 'Kreditkarte / Überziehung' },
    privateloan:{ label: 'Privatdarlehen' },
    other:      { label: 'Sonstiges' }
  };

  function debtTypeLabel(t) {
    return (DEBT_TYPES[t] || DEBT_TYPES.other).label;
  }

  /** KESt-Satz dieser Position in Prozent. */
  function investmentTaxRate(inv) {
    if (inv.taxRatePct != null) return Number(inv.taxRatePct) || 0;
    var t = INVESTMENT_TYPES[inv.type] || INVESTMENT_TYPES.sonstiges;
    return t.tax;
  }

  /** Gilt diese Position als jederzeit verfügbare Reserve? */
  function isLiquid(inv) {
    if (inv.liquid != null) return !!inv.liquid;
    var t = INVESTMENT_TYPES[inv.type] || INVESTMENT_TYPES.sonstiges;
    return !!t.liquid;
  }

  function typeLabel(t) {
    return (INVESTMENT_TYPES[t] || INVESTMENT_TYPES.sonstiges).label;
  }

  /* --- Kategorie-Rückfall -------------------------------------------------- */

  /**
   * Kategorien sind vollständig löschbar, auch die mitgelieferten. Wo Code
   * früher fest auf `cat_other` zeigte, muss er deshalb die erste passende
   * Kategorie des Bestands nehmen.
   */
  function fallbackCategory(state, kind, prefer) {
    var cats = state.categories || [];
    var wanted = kind === 'income' ? 'income' : 'expense';
    if (prefer && U.byId(cats, prefer)) return prefer;
    var hit = cats.filter(function (c) { return c.kind === wanted; })[0];
    return hit ? hit.id : (cats[0] ? cats[0].id : null);
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

    // Ist ein Kredit abbezahlt, endet auch die verknüpfte Rate — sonst zahlt
    // die Projektion einen Kredit weiter, den es nicht mehr gibt.
    var payoff = opts.debtPayoff || debtPayoffMap(state);

    state.items.forEach(function (it) {
      if (it.active === false) return;
      if (!U.inRange(key, it.start, it.end)) return;
      if (payoff[it.id] && U.monthIndex(key) > U.monthIndex(payoff[it.id])) return;
      var amt = opts.cash ? cashAt(it, key) : perMonthAt(it, key);
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
    if (plans.length) flows = applyPlans(flows, plans, key, state);

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

  function applyPlans(flows, plans, key, state) {
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
            categoryId: fallbackCategory(state, adj.kind, adj.categoryId),
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
              categoryId: fallbackCategory(state, adj.kind, adj.categoryId),
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

  /* --- Kredite ------------------------------------------------------------ */

  /**
   * Monatliche Rate eines Kredits. Ist ein Posten verknüpft, ist er die
   * Wahrheit — der Geldfluss steht dann genau einmal im Budget, wie bei den
   * Sparplänen der Investments. Nur ohne Verknüpfung zählt `paymentMonthly`.
   */
  function debtPayment(state, debt, key) {
    var it = debt.linkedItemId ? U.byId(state.items, debt.linkedItemId) : null;
    if (it && it.active !== false) return perMonthAt(it, key || U.monthKey());
    return Number(debt.paymentMonthly) || 0;
  }

  /**
   * Tilgungsplan ab `from`. Rechnet Monat für Monat: Zins auf die Restschuld,
   * der Rest der Rate tilgt. Reicht die Rate nicht einmal für die Zinsen,
   * wächst die Schuld — das wird als `neverPaysOff` gemeldet statt endlos
   * gerechnet.
   */
  function debtSchedule(state, debt, opts) {
    opts = opts || {};
    var from = opts.from || state.settings.startMonth || U.monthKey();
    var maxMonths = opts.maxMonths || 600;
    var rate = (Number(debt.interestPct) || 0) / 100 / 12;

    var balance = Math.max(0, Number(debt.balance) || 0);
    var series = [{ key: from, balance: balance, interest: 0, principal: 0 }];
    var totalInterest = 0;
    var payoffKey = balance <= 0 ? from : null;
    var neverPaysOff = false;

    for (var i = 0; i < maxMonths && balance > 0; i++) {
      var key = U.addMonths(from, i);
      var payment = debtPayment(state, debt, key);
      var interest = balance * rate;

      if (payment <= interest + 1e-9) { neverPaysOff = true; break; }

      var principal = Math.min(payment - interest, balance);
      balance = balance - principal;
      totalInterest += interest;

      series.push({
        key: U.addMonths(from, i + 1),
        balance: balance, interest: interest, principal: principal
      });
      if (balance <= 1e-6) { payoffKey = U.addMonths(from, i); break; }
    }

    var months = payoffKey ? U.monthDiff(from, payoffKey) : null;
    return {
      from: from,
      series: series,
      payoffKey: payoffKey,
      months: months,
      years: months == null ? null : months / 12,
      totalInterest: totalInterest,
      neverPaysOff: neverPaysOff,
      monthlyPayment: debtPayment(state, debt, from),
      monthlyInterest: (Number(debt.balance) || 0) * rate
    };
  }

  /** Restschuld eines Kredits im angegebenen Monat. */
  function debtBalanceAt(state, debt, key, schedule) {
    var sch = schedule || debtSchedule(state, debt);
    var idx = U.monthDiff(sch.from, key);
    if (idx <= 0) return Number(debt.balance) || 0;
    if (idx >= sch.series.length) {
      return sch.neverPaysOff ? sch.series[sch.series.length - 1].balance : 0;
    }
    return sch.series[idx].balance;
  }

  /**
   * Zuordnung Posten-ID → Monat der letzten Rate. Wird von monthFlows genutzt,
   * um abbezahlte Kredite auslaufen zu lassen.
   */
  /**
   * Der Anker ist immer der Startmonat der Planung, nie der gerade betrachtete
   * Monat: `balance` ist der Stand von heute. Würde man den Plan ab einem
   * späteren Monat mit demselben Startsaldo rechnen, verschöbe sich das
   * Tilgungsende mit jedem Aufruf nach hinten.
   */
  function debtPayoffMap(state) {
    var out = {};
    (state.debts || []).forEach(function (d) {
      if (!d.linkedItemId) return;
      var sch = debtSchedule(state, d);
      if (sch.payoffKey && !sch.neverPaysOff) out[d.linkedItemId] = sch.payoffKey;
    });
    return out;
  }

  /** Verdichtet alle Kredite: Restschuld, Rate, Zinslast, Tilgungsfortschritt. */
  function debtSummary(state) {
    var list = state.debts || [];
    var now = U.monthKey();
    var res = {
      count: list.length,
      balance: 0, principal: 0, paidOff: 0,
      monthlyPayment: 0, monthlyInterest: 0,
      byOwner: {}, byType: {},
      weightedRate: null,
      longest: null
    };

    var weighted = 0, weightBase = 0;

    list.forEach(function (d) {
      var bal = Math.max(0, Number(d.balance) || 0);
      res.balance += bal;
      res.byOwner[d.owner] = (res.byOwner[d.owner] || 0) + bal;
      res.byType[d.type] = (res.byType[d.type] || 0) + bal;

      if (d.principal != null && Number(d.principal) > 0) {
        res.principal += Number(d.principal);
        res.paidOff += Math.max(0, Number(d.principal) - bal);
      }
      res.monthlyPayment += debtPayment(state, d, now);
      res.monthlyInterest += bal * ((Number(d.interestPct) || 0) / 100 / 12);

      if (d.interestPct != null && bal > 0) {
        weighted += bal * Number(d.interestPct);
        weightBase += bal;
      }

      var sch = debtSchedule(state, d);
      if (sch.payoffKey && !sch.neverPaysOff) {
        if (!res.longest || U.monthIndex(sch.payoffKey) > U.monthIndex(res.longest)) {
          res.longest = sch.payoffKey;
        }
      }
    });

    res.weightedRate = weightBase > 0 ? weighted / weightBase : null;
    res.paidOffPct = res.principal > 0 ? res.paidOff / res.principal : null;
    return res;
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
      liquid: 0,             // Teil des Bestands, der als Reserve zählt
      byType: {},
      byOwner: {},
      weightedReturn: null,
      weightedTax: null,     // gewichteter KESt-Satz des Bestands in Prozent
      contributionMonthly: 0 // Summe der verknüpften Sparplan-Posten
    };

    var weighted = 0;
    var weightBase = 0;
    var weightedTax = 0;
    var taxBase = 0;

    list.forEach(function (inv) {
      var v = Number(inv.currentValue) || 0;
      res.total += v;
      if (isLiquid(inv)) res.liquid += v;

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
      if (v > 0) {
        weightedTax += v * investmentTaxRate(inv);
        taxBase += v;
      }
      var it = inv.linkedItemId ? U.byId(state.items, inv.linkedItemId) : null;
      if (it && it.active !== false) res.contributionMonthly += perMonthAt(it, U.monthKey());
    });

    res.gain = res.costKnown - res.cost;
    res.gainPct = res.cost > 0 ? res.gain / res.cost : null;
    // Nur bewertete Positionen gehen in den Durchschnitt ein; ein Investment
    // ohne Renditeerwartung zieht das Ergebnis nicht künstlich nach unten.
    res.weightedReturn = weightBase > 0 ? weighted / weightBase : null;
    // Steuerfreie Anlagearten (Vorsorge, Immobilie) zählen hier mit 0 % mit —
    // anders als bei der Rendite senken sie den Durchschnitt zu Recht.
    res.weightedTax = taxBase > 0 ? weightedTax / taxBase : null;

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

  /* --- Kapitalertragsteuer ------------------------------------------------- */

  /**
   * Das Steuermodell in drei Sätzen.
   *
   * 1. Posten und Buchungen sind bereits versteuert — dort rührt die App nichts
   *    an. Besteuert werden allein die Erträge der Investments.
   * 2. Ein Teil des Ertrags fällt **laufend** an und wird jährlich besteuert:
   *    Zinsen, Dividenden und bei thesaurierenden Fonds die
   *    ausschüttungsgleichen Erträge. Der Anteil ist eine Modellannahme
   *    (`settings.tax.ongoingSharePct`) — 100 % entspricht einem Sparbuch,
   *    0 % einer Aktie, die bis zum Verkauf nichts ausschüttet.
   * 3. Der aufgeschobene Rest wird erst **bei der Entnahme** fällig, und zwar
   *    auf den Gewinnanteil des verkauften Bestands. Das entspricht dem
   *    österreichischen gleitenden Durchschnittspreis: Wer 10 % seines Depots
   *    verkauft, realisiert 10 % der stillen Reserven.
   *
   * Laufend versteuerte Erträge erhöhen die Anschaffungskosten — auf sie fällt
   * bei der Entnahme keine Steuer mehr an.
   */
  function taxSettings(state) {
    var t = (state.settings && state.settings.tax) || {};
    var portfolio = investmentSummary(state);
    var rate = portfolio.weightedTax != null
      ? portfolio.weightedTax
      : (t.defaultRatePct == null ? 27.5 : Number(t.defaultRatePct));

    return {
      enabled: t.enabled !== false,
      ratePct: t.enabled === false ? 0 : rate,
      rate: (t.enabled === false ? 0 : rate) / 100,
      ongoingSharePct: t.ongoingSharePct == null ? 30 : Number(t.ongoingSharePct),
      ongoingShare: (t.ongoingSharePct == null ? 30 : Number(t.ongoingSharePct)) / 100,
      isPortfolioRate: portfolio.weightedTax != null
    };
  }

  /** Rendite nach laufender KESt — die Zahl, mit der der Bestand tatsächlich wächst. */
  function netReturnPct(state, grossPct, tax) {
    var t = tax || taxSettings(state);
    return grossPct * (1 - t.rate * t.ongoingShare);
  }

  /**
   * Ein Monat Vermögensentwicklung inklusive Steuer.
   * Gibt den neuen Bestand, die neuen Anschaffungskosten und die gezahlte
   * Steuer zurück.
   *
   * opts.taxGainRate: Ertragsrate, auf die Steuer anfällt. Rechnet die
   *   Reihe real, wächst der Bestand mit der realen Rate, versteuert wird aber
   *   der nominelle Ertrag — die KESt kennt keinen Inflationsabschlag.
   * opts.basisDecay: Faktor, mit dem der Einstand je Monat an realem Wert
   *   verliert (1/(1+Inflation)). Nominell bleibt er konstant; in einer realen
   *   Reihe schrumpft er und lässt die stillen Reserven zu Recht wachsen.
   */
  function growAssets(assets, basis, rMonthly, contribution, tax, opts) {
    opts = opts || {};
    var taxRate = opts.taxGainRate == null ? rMonthly : opts.taxGainRate;
    var decay = opts.basisDecay == null ? 1 : opts.basisDecay;

    var gain = assets * rMonthly;
    var taxable = assets * taxRate;
    var taxedNow = taxable > 0 ? taxable * tax.ongoingShare : 0;
    var paid = taxedNow * tax.rate;

    return {
      assets: assets + gain - paid + contribution,
      // Der laufend versteuerte Ertrag zählt künftig als Einstand.
      basis: basis * decay + (taxedNow - paid) + contribution,
      tax: paid
    };
  }

  /** Anteil stiller Reserven am Bestand — die Bemessungsgrundlage der Entnahme. */
  function gainShare(assets, basis) {
    if (!(assets > 0)) return 0;
    return U.clamp((assets - basis) / assets, 0, 1);
  }

  /**
   * Zielvermögen für eine Entnahme nach Steuer. Von jeder Entnahme bleiben nur
   * (1 − Steuersatz × Gewinnanteil) übrig, also muss das Depot entsprechend
   * größer sein. Ohne Steuer bleibt es bei Jahresbedarf ÷ Entnahmerate.
   */
  function fireTarget(annualSpend, swr, tax, share) {
    if (!(swr > 0)) return Infinity;
    var net = 1 - tax.rate * U.clamp(share || 0, 0, 1);
    if (!(net > 0)) return Infinity;
    return annualSpend / (swr * net);
  }

  /**
   * Anschaffungskosten des heutigen Vermögens. Wo kein Einstandswert
   * hinterlegt ist, wird der aktuelle Wert angesetzt — dann gibt es rechnerisch
   * keine stillen Reserven, was die Steuer eher unter- als überschätzt.
   */
  function assetBasis(state) {
    var basis = Number(state.household.assets) || 0;   // Konto: kein Kursgewinn
    (state.investments || []).forEach(function (inv) {
      var v = Number(inv.currentValue) || 0;
      basis += inv.costBasis == null ? v : Math.min(Number(inv.costBasis) || 0, v);
    });
    return basis;
  }

  /**
   * Anschaffungskosten zu einem frei gesetzten Startvermögen. Wer in der
   * FIRE-Maske ein anderes Startvermögen eintippt, behält den stillen-Reserven-
   * Anteil des echten Portfolios — ohne Portfolio gilt alles als Einstand.
   */
  function startBasisFor(state, assets) {
    var real = totalAssets(state);
    if (!(assets > 0)) return 0;
    if (!(real > 0)) return assets;
    return assets * U.clamp(assetBasis(state) / real, 0, 1);
  }

  /** Summe aller Restschulden. */
  function totalDebt(state) {
    return U.sum(state.debts || [], function (d) { return Math.max(0, Number(d.balance) || 0); });
  }

  /** Vermögen abzüglich Schulden — die Zahl, die tatsächlich jemandem gehört. */
  function netWorth(state) {
    return totalAssets(state) - totalDebt(state);
  }

  /**
   * Jederzeit verfügbare Mittel: das Vermögen außerhalb der Investments
   * (Girokonto, Bargeld) plus die als liquide markierten Positionen.
   */
  function liquidAssets(state) {
    return (Number(state.household.assets) || 0) + investmentSummary(state).liquid;
  }

  /**
   * Der Notgroschen: Wie viele Monate tragen die liquiden Mittel die Ausgaben,
   * wenn das Einkommen ausbleibt? Sparbeiträge zählen nicht mit — die würde
   * man in einer solchen Lage als Erstes aussetzen. Kreditraten dagegen laufen
   * weiter und bleiben deshalb drin.
   */
  function emergencyFund(state, opts) {
    opts = opts || {};
    var key = opts.month || U.monthKey();
    var sum = opts.summary || monthSummary(state, key, { plans: opts.plans || [] });
    var burn = Math.max(0, sum.expense - sum.savingContrib);
    var available = liquidAssets(state);
    var target = Number(state.settings.emergencyMonths) || 4;

    return {
      available: available,
      burn: burn,
      months: burn > 0 ? available / burn : null,
      targetMonths: target,
      targetAmount: burn * target,
      gap: burn * target - available,
      ratio: burn > 0 ? (available / burn) / target : 0
    };
  }

  /* --- Projektion --------------------------------------------------------- */

  /**
   * Monatsreihe über einen Zeitraum. Liefert je Monat Einnahmen, Ausgaben,
   * Saldo, kumulierten Saldo und das fortgeschriebene Vermögen.
   *
   * Die Rendite wird brutto übergeben; die laufende KESt zieht die Reihe selbst
   * ab und schreibt den Einstand mit, damit die aufgeschobene Steuer sichtbar
   * bleibt. Posten und Buchungen sind bereits versteuert und bleiben unberührt.
   *
   * opts: { from, months, plans, startAssets, returnPct, includeTransactions }
   */
  function project(state, opts) {
    opts = opts || {};
    var from = opts.from || state.settings.startMonth || U.monthKey();
    var months = opts.months || state.settings.projectionMonths || 60;
    var plans = opts.plans || [];
    var assets = opts.startAssets != null ? opts.startAssets : totalAssets(state);
    var rMonthly = opts.returnPct ? Math.pow(1 + opts.returnPct / 100, 1 / 12) - 1 : 0;

    var tax = opts.tax || taxSettings(state);
    var basis = opts.startBasis != null ? opts.startBasis : startBasisFor(state, assets);
    var taxTotal = 0;

    // Einmal je Projektion statt einmal je Monat berechnen. Anker ist der
    // Startmonat der Planung, damit die Restschuld überall dieselbe bleibt.
    var payoff = debtPayoffMap(state);
    var schedules = (state.debts || []).map(function (d) {
      return { debt: d, sch: debtSchedule(state, d) };
    });

    var rows = [];
    var cum = 0;

    for (var i = 0; i < months; i++) {
      var key = U.addMonths(from, i);
      var s = summarize(state, monthFlows(state, key, {
        plans: plans,
        includeTransactions: !!opts.includeTransactions,
        debtPayoff: payoff
      }));
      var contribution = s.net + s.savingContrib;
      cum += s.net;

      var step = growAssets(assets, basis, rMonthly, contribution, tax);
      assets = step.assets;
      basis = step.basis;
      taxTotal += step.tax;

      var debt = 0;
      schedules.forEach(function (x) {
        debt += debtBalanceAt(state, x.debt, key, x.sch);
      });

      rows.push({
        key: key,
        income: s.income,
        expense: s.expense,
        net: s.net,
        savingContrib: s.savingContrib,
        contribution: contribution,
        cumulative: cum,
        assets: assets,
        basis: basis,
        gainShare: gainShare(assets, basis),
        tax: step.tax,
        taxCumulative: taxTotal,
        deferredTax: Math.max(0, assets - basis) * tax.rate,
        debt: debt,
        netWorth: assets - debt,
        summary: s
      });
    }
    return rows;
  }

  /* --- Liquiditätsvorschau ------------------------------------------------- */

  /**
   * Kontostandskurve der liquiden Mittel. Anders als die Projektion glättet
   * sie nichts: Jahresprämien und Quartalszahlungen treffen in ihrem
   * Fälligkeitsmonat mit dem vollen Betrag ein. Erst dadurch wird sichtbar,
   * ob das Konto einen teuren Monat trägt.
   */
  function liquidityProjection(state, opts) {
    opts = opts || {};
    var from = opts.from || state.settings.startMonth || U.monthKey();
    var months = opts.months || 24;
    var plans = opts.plans || [];
    var balance = opts.start != null ? opts.start : liquidAssets(state);
    var payoff = debtPayoffMap(state);

    var rows = [];
    for (var i = 0; i < months; i++) {
      var key = U.addMonths(from, i);
      var flows = monthFlows(state, key, {
        plans: plans,
        includeTransactions: opts.includeTransactions !== false,
        cash: true,
        debtPayoff: payoff
      });

      var inflow = 0, outflow = 0;
      var spikes = [];
      flows.forEach(function (f) {
        if (f.kind === 'income') inflow += f.amount;
        else outflow += f.amount;
        // Als Ausschlag gilt, was nur in diesem Monat anfällt.
        if (f.source === 'recurring') {
          var it = U.byId(state.items, f.itemId);
          if (it && it.dueMonth != null && Math.round(intervalMonths(it.interval)) > 1) {
            spikes.push({ label: it.label, amount: f.amount, kind: f.kind });
          }
        } else if (f.source !== 'recurring') {
          spikes.push({ label: f.label, amount: f.amount, kind: f.kind });
        }
      });

      balance += inflow - outflow;
      rows.push({
        key: key, inflow: inflow, outflow: outflow,
        net: inflow - outflow, balance: balance,
        spikes: spikes.sort(function (a, b) { return b.amount - a.amount; })
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
    var tax = taxSettings(state);
    var fireNumberGross = swr > 0 ? annualSpend / swr : Infinity;

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

    // Gewachsen wird real, versteuert wird der nominelle Ertrag; der Einstand
    // verliert real an Wert. So bleibt die KESt eine Steuer auf Nominalgewinne.
    var nominalMonthly = Math.pow(1 + nominal, 1 / 12) - 1;
    var inflMonthly = Math.pow(1 + infl, 1 / 12) - 1;
    var step = { taxGainRate: nominalMonthly, basisDecay: 1 / (1 + inflMonthly) };

    var nominalNet = nominal * (1 - tax.rate * tax.ongoingShare);
    var netRealAnnual = (1 + nominalNet) / (1 + infl) - 1;

    var maxMonths = (Number(f.maxYears) || 60) * 12;
    var assets = startAssets;
    var basis = startBasisFor(state, startAssets);
    var target = fireTarget(annualSpend, swr, tax, gainShare(assets, basis));

    var series = [{ month: 0, assets: assets, target: target, contributed: 0 }];
    var reachedAt = assets >= target ? 0 : null;
    var fireNumber = target;
    var gainShareAtFire = gainShare(assets, basis);
    var contributedTotal = 0;
    var taxTotal = 0;
    var c = contribution;

    for (var m = 1; m <= maxMonths; m++) {
      if (m > 1 && (m - 1) % 12 === 0) c = c * (1 + growth);
      var g = growAssets(assets, basis, realMonthly, c, tax, step);
      assets = g.assets;
      basis = g.basis;
      taxTotal += g.tax;
      contributedTotal += c;

      // Das Ziel wandert mit: je größer die stillen Reserven, desto mehr
      // Depot braucht es für dieselbe Entnahme nach Steuer.
      target = fireTarget(annualSpend, swr, tax, gainShare(assets, basis));
      if (reachedAt == null && assets >= target) {
        reachedAt = m;
        fireNumber = target;
        gainShareAtFire = gainShare(assets, basis);
      }
      if (m % 3 === 0 || m === maxMonths) {
        series.push({ month: m, assets: assets, target: target, contributed: contributedTotal });
      }
      if (reachedAt != null && m >= reachedAt + 12) break;   // etwas Nachlauf für die Kurve
    }
    if (reachedAt == null) {
      fireNumber = target;
      gainShareAtFire = gainShare(assets, basis);
    }

    var years = reachedAt == null ? null : reachedAt / 12;
    var coastYears = Number(f.coastYears) || 20;
    var coastNumber = fireNumber / Math.pow(1 + netRealAnnual, coastYears);

    return {
      fireNumber: fireNumber,
      fireNumberGross: fireNumberGross,
      taxSurcharge: fireNumber - fireNumberGross,
      tax: tax,
      taxTotal: taxTotal,
      gainShareAtFire: gainShareAtFire,
      deferredTax: Math.max(0, assets - basis) * tax.rate,
      finalBasis: basis,
      netRealAnnual: netRealAnnual,
      netReturnPct: netReturnPct(state, Number(returnPct) || 0, tax),
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
      monthlyWithdrawalNet: fireNumber * swr * (1 - tax.rate * gainShareAtFire) / 12,
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
    DEBT_TYPES: DEBT_TYPES,
    GROWTH_PRESETS: GROWTH_PRESETS,
    typeLabel: typeLabel,
    debtTypeLabel: debtTypeLabel,
    isLiquid: isLiquid,
    fallbackCategory: fallbackCategory,
    intervalMonths: intervalMonths,
    dueIn: dueIn,
    cashAt: cashAt,
    perMonth: perMonth,
    perMonthAt: perMonthAt,
    perYear: perYear,
    growthLabel: growthLabel,
    growthSteps: growthSteps,
    growthFactor: growthFactor,
    investmentSummary: investmentSummary,
    investmentTaxRate: investmentTaxRate,
    totalAssets: totalAssets,
    portfolioReturn: portfolioReturn,
    taxSettings: taxSettings,
    netReturnPct: netReturnPct,
    growAssets: growAssets,
    gainShare: gainShare,
    fireTarget: fireTarget,
    assetBasis: assetBasis,
    startBasisFor: startBasisFor,
    debtPayment: debtPayment,
    debtSchedule: debtSchedule,
    debtBalanceAt: debtBalanceAt,
    debtPayoffMap: debtPayoffMap,
    debtSummary: debtSummary,
    totalDebt: totalDebt,
    netWorth: netWorth,
    liquidAssets: liquidAssets,
    emergencyFund: emergencyFund,
    liquidityProjection: liquidityProjection,
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
