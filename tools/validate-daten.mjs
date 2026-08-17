#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   validate-daten.mjs — prüft eine exportierte Notgroschen-Datei

   Werkzeug für KI-Assistenten und Skripte, die eine Datei verändern (siehe
   AGENTS.md). Die App selbst braucht dieses Skript nicht und hat keinerlei
   Node-Abhängigkeit — es liest nur, es schreibt nie.

   Aufruf:  node tools/validate-daten.mjs <datei.json> [--json]
   Exit:    0 = importierbar (ggf. mit Warnungen), 1 = Fehler, 2 = unlesbar
   --------------------------------------------------------------------------- */

import { readFileSync } from 'node:fs';

/* --- Vertrag der App (Spiegel von js/store.js und js/calc.js) ------------- */

const INTERVALS = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  bimonthly: 1 / 2,
  quarterly: 1 / 3,
  semiannual: 1 / 6,
  yearly: 1 / 12
};

const INVESTMENT_TYPES = [
  'etf', 'aktien', 'fonds', 'anleihen', 'fixzins', 'tagesgeld', 'bausparer',
  'versicherung', 'vorsorge', 'immobilie', 'edelmetall', 'krypto', 'sonstiges'
];

const KINDS = ['income', 'expense'];
const SCOPES = ['person', 'item', 'category', 'household', 'all', 'oneoff'];
const MODES = ['percent', 'delta', 'set'];
const SPLIT_MODES = ['income', 'equal', 'custom'];
const THEMES = ['auto', 'light', 'dark'];
const SANKEY_MODES = ['budget', 'direct'];

const RE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/* --- Sammelstellen -------------------------------------------------------- */

const errors = [];
const warnings = [];

const err = (where, msg) => errors.push({ where, msg });
const warn = (where, msg) => warnings.push({ where, msg });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function realDate(s) {
  if (!RE_DATE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function monthIndex(key) {
  const [y, m] = String(key).split('-');
  return parseInt(y, 10) * 12 + (parseInt(m, 10) - 1);
}

/* --- Prüfungen ------------------------------------------------------------ */

function checkTop(data) {
  if (!isObj(data)) {
    err('Wurzel', 'Die Datei enthält kein JSON-Objekt.');
    return false;
  }
  if (!data.people && !data.items && !data.categories) {
    err('Wurzel', 'Die App lehnt die Datei ab: keines der Felder people, items oder categories ist vorhanden.');
    return false;
  }
  if (data.schema != null && data.schema !== 1) {
    warn('schema', `Unerwartete Schema-Version ${JSON.stringify(data.schema)}; erwartet wird 1.`);
  }
  if (data.app != null && data.app !== 'notgroschen') {
    warn('app', `Feld "app" ist ${JSON.stringify(data.app)}, erwartet wird "notgroschen".`);
  }
  for (const key of ['people', 'categories', 'items', 'transactions', 'investments', 'plans']) {
    if (data[key] != null && !Array.isArray(data[key])) {
      err(key, 'Muss ein Array sein.');
    }
  }
  for (const key of ['meta', 'settings', 'household', 'fire']) {
    if (data[key] != null && !isObj(data[key])) err(key, 'Muss ein Objekt sein.');
  }
  return errors.length === 0;
}

function checkSettings(data) {
  const s = isObj(data.settings) ? data.settings : {};
  if (s.theme != null && !THEMES.includes(s.theme)) {
    warn('settings.theme', `${JSON.stringify(s.theme)} ist unbekannt; erlaubt: ${THEMES.join(', ')}.`);
  }
  if (s.splitMode != null && !SPLIT_MODES.includes(s.splitMode)) {
    err('settings.splitMode', `${JSON.stringify(s.splitMode)} ist unbekannt; erlaubt: ${SPLIT_MODES.join(', ')}.`);
  }
  if (s.sankeyMode != null && !SANKEY_MODES.includes(s.sankeyMode)) {
    warn('settings.sankeyMode', `${JSON.stringify(s.sankeyMode)} ist unbekannt.`);
  }
  if (s.startMonth != null && !RE_MONTH.test(s.startMonth)) {
    err('settings.startMonth', `${JSON.stringify(s.startMonth)} ist kein Monat im Format JJJJ-MM.`);
  }

  const h = isObj(data.household) ? data.household : {};
  if (h.budget != null && (!isNum(h.budget) || h.budget < 0)) {
    err('household.budget', 'Muss null oder eine Zahl ≥ 0 sein.');
  }
  if (h.assets != null && !isNum(h.assets)) {
    err('household.assets', 'Muss eine Zahl sein.');
  }

  const f = isObj(data.fire) ? data.fire : {};
  for (const k of ['startAssets', 'contributionGrowthPct', 'returnPct', 'inflationPct',
                   'withdrawalPct', 'spendFactor', 'coastYears', 'maxYears']) {
    if (f[k] != null && !isNum(f[k])) err(`fire.${k}`, 'Muss eine Zahl sein.');
  }
  if (f.withdrawalPct != null && isNum(f.withdrawalPct) && f.withdrawalPct <= 0) {
    err('fire.withdrawalPct', 'Muss größer als 0 sein, sonst ist die FIRE-Zahl unendlich.');
  }
}

function uniqueIds(list, label) {
  const seen = new Map();
  (list || []).forEach((x, i) => {
    const id = x && x.id;
    if (id == null || id === '') {
      err(`${label}[${i}]`, 'Feld "id" fehlt.');
      return;
    }
    if (seen.has(id)) {
      err(`${label}[${i}]`, `Doppelte id ${JSON.stringify(id)} (bereits in ${label}[${seen.get(id)}]).`);
    } else {
      seen.set(id, i);
    }
  });
  return new Set(seen.keys());
}

function checkPeople(data) {
  const people = data.people || [];
  const ids = uniqueIds(people, 'people');
  people.forEach((p, i) => {
    const at = `people[${i}]${p?.name ? ` (${p.name})` : ''}`;
    if (!isObj(p)) { err(`people[${i}]`, 'Muss ein Objekt sein.'); return; }
    if (typeof p.name !== 'string' || !p.name.trim()) err(at, 'Feld "name" fehlt oder ist leer.');
    if (p.colorIndex != null) {
      if (!Number.isInteger(p.colorIndex)) err(at, '"colorIndex" muss eine ganze Zahl sein.');
      else if (p.colorIndex < 0 || p.colorIndex > 7) {
        warn(at, `"colorIndex" ${p.colorIndex} liegt außerhalb von 0–7; die App rechnet modulo 8.`);
      }
    }
    if (p.budget != null && (!isNum(p.budget) || p.budget < 0)) {
      err(at, '"budget" muss null oder eine Zahl ≥ 0 sein.');
    }
    if (p.sharePct != null && (!isNum(p.sharePct) || p.sharePct < 0 || p.sharePct > 100)) {
      err(at, '"sharePct" muss null oder eine Zahl zwischen 0 und 100 sein.');
    }
  });

  const used = new Set(people.map((p) => p?.colorIndex).filter((c) => Number.isInteger(c)));
  if (used.size && used.size < people.length) {
    warn('people', 'Mehrere Personen teilen sich denselben colorIndex — in Diagrammen sind sie dann nicht unterscheidbar.');
  }
  if (data.settings?.splitMode === 'custom') {
    const total = people.reduce((a, p) => a + (isNum(p?.sharePct) ? p.sharePct : 0), 0);
    if (total <= 0) {
      warn('people', 'splitMode ist "custom", aber keine Person hat einen sharePct > 0 — die App fällt auf gleiche Teile zurück.');
    }
  }
  return ids;
}

function checkCategories(data) {
  const cats = data.categories || [];
  if (!cats.length) {
    warn('categories', 'Leer — die App setzt beim Import ihren Standardsatz ein. Verweise auf eigene Kategorien gingen dabei verloren.');
  }
  const ids = uniqueIds(cats, 'categories');
  const byId = new Map();
  cats.forEach((c, i) => {
    const at = `categories[${i}]${c?.name ? ` (${c.name})` : ''}`;
    if (!isObj(c)) { err(`categories[${i}]`, 'Muss ein Objekt sein.'); return; }
    if (typeof c.name !== 'string' || !c.name.trim()) err(at, 'Feld "name" fehlt oder ist leer.');
    if (!KINDS.includes(c.kind)) err(at, `"kind" muss "income" oder "expense" sein, ist ${JSON.stringify(c.kind)}.`);
    byId.set(c.id, c);
  });
  return { ids, byId };
}

function checkRef(at, ownerId, personIds) {
  if (ownerId === 'household') return;
  if (!personIds.has(ownerId)) {
    err(at, `"owner" ${JSON.stringify(ownerId)} ist weder "household" noch eine bekannte Personen-ID. Die App würde daraus stillschweigend "household" machen.`);
  }
}

function checkCat(at, catId, kind, cats) {
  if (!cats.ids.has(catId)) {
    err(at, `"categoryId" ${JSON.stringify(catId)} existiert nicht. Die App würde sie durch ${kind === 'income' ? 'cat_salary' : 'cat_other'} ersetzen.`);
    return;
  }
  const c = cats.byId.get(catId);
  if (c && KINDS.includes(c.kind) && c.kind !== kind) {
    warn(at, `Art "${kind}", aber Kategorie "${c.name}" ist als "${c.kind}" angelegt — der Eintrag erscheint in der falschen Auswertung.`);
  }
}

function checkItems(data, personIds, cats) {
  const items = data.items || [];
  const ids = uniqueIds(items, 'items');
  items.forEach((it, i) => {
    const at = `items[${i}]${it?.label ? ` („${it.label}")` : ''}`;
    if (!isObj(it)) { err(`items[${i}]`, 'Muss ein Objekt sein.'); return; }
    if (typeof it.label !== 'string' || !it.label.trim()) err(at, 'Feld "label" fehlt oder ist leer.');
    if (!KINDS.includes(it.kind)) {
      err(at, `"kind" muss "income" oder "expense" sein, ist ${JSON.stringify(it.kind)}.`);
    }
    if (!isNum(it.amount)) err(at, `"amount" muss eine Zahl sein, ist ${JSON.stringify(it.amount)}.`);
    else if (it.amount < 0) err(at, '"amount" ist negativ. Beträge sind immer positiv; die Richtung steckt in "kind".');
    else if (it.amount === 0) warn(at, '"amount" ist 0 — der Posten wirkt sich nirgends aus.');

    if (!Object.prototype.hasOwnProperty.call(INTERVALS, it.interval)) {
      err(at, `"interval" ${JSON.stringify(it.interval)} ist unbekannt. Die App würde daraus "monthly" machen — ein Jahresbetrag zählte dann zwölffach. Erlaubt: ${Object.keys(INTERVALS).join(', ')}.`);
    }
    checkRef(at, it.owner, personIds);
    checkCat(at, it.categoryId, it.kind, cats);

    for (const k of ['start', 'end']) {
      if (it[k] != null && !RE_MONTH.test(it[k])) {
        err(at, `"${k}" ${JSON.stringify(it[k])} ist kein Monat im Format JJJJ-MM.`);
      }
    }
    if (it.start && it.end && RE_MONTH.test(it.start) && RE_MONTH.test(it.end) &&
        monthIndex(it.end) < monthIndex(it.start)) {
      err(at, `"end" (${it.end}) liegt vor "start" (${it.start}) — der Posten zählt in keinem Monat.`);
    }
    if (it.active != null && typeof it.active !== 'boolean') {
      warn(at, '"active" sollte true oder false sein; alles außer false gilt der App als aktiv.');
    }
  });
  return ids;
}

function checkTransactions(data, personIds, cats) {
  const txs = data.transactions || [];
  uniqueIds(txs, 'transactions');
  const seen = new Map();

  txs.forEach((t, i) => {
    const at = `transactions[${i}]${t?.label ? ` („${t.label}")` : ''}`;
    if (!isObj(t)) { err(`transactions[${i}]`, 'Muss ein Objekt sein.'); return; }
    if (typeof t.label !== 'string' || !t.label.trim()) err(at, 'Feld "label" fehlt oder ist leer.');
    if (!KINDS.includes(t.kind)) err(at, `"kind" muss "income" oder "expense" sein, ist ${JSON.stringify(t.kind)}.`);
    if (!isNum(t.amount)) err(at, `"amount" muss eine Zahl sein, ist ${JSON.stringify(t.amount)}.`);
    else if (t.amount < 0) err(at, '"amount" ist negativ. Beträge sind immer positiv; die Richtung steckt in "kind".');
    if (!realDate(t.date)) err(at, `"date" ${JSON.stringify(t.date)} ist kein gültiges Datum im Format JJJJ-MM-TT.`);
    checkRef(at, t.owner, personIds);
    checkCat(at, t.categoryId, t.kind, cats);

    const key = [t.date, t.amount, t.kind, String(t.label).trim().toLowerCase()].join('|');
    if (seen.has(key)) {
      warn(at, `Sieht aus wie ein Duplikat von transactions[${seen.get(key)}] — gleiches Datum, gleicher Betrag, gleiche Bezeichnung.`);
    } else {
      seen.set(key, i);
    }
  });
}

function checkInvestments(data, personIds, itemIds) {
  const list = data.investments || [];
  uniqueIds(list, 'investments');

  // Ein Posten, der an mehreren Investments als Sparplan hängt, erscheint dort
  // mehrfach — erlaubt, aber fast immer ein Versehen.
  const linkUse = new Map();

  list.forEach((inv, i) => {
    const at = `investments[${i}]${inv?.label ? ` („${inv.label}")` : ''}`;
    if (!isObj(inv)) { err(`investments[${i}]`, 'Muss ein Objekt sein.'); return; }
    if (typeof inv.label !== 'string' || !inv.label.trim()) err(at, 'Feld "label" fehlt oder ist leer.');

    if (!INVESTMENT_TYPES.includes(inv.type)) {
      err(at, `"type" ${JSON.stringify(inv.type)} ist unbekannt. Die App würde daraus "sonstiges" machen. Erlaubt: ${INVESTMENT_TYPES.join(', ')}.`);
    }
    if (!isNum(inv.currentValue)) {
      err(at, `"currentValue" muss eine Zahl sein, ist ${JSON.stringify(inv.currentValue)}.`);
    } else if (inv.currentValue < 0) {
      err(at, '"currentValue" ist negativ. Ein Bestand kann nicht kleiner als 0 sein.');
    }
    if (inv.costBasis != null && (!isNum(inv.costBasis) || inv.costBasis < 0)) {
      err(at, '"costBasis" muss null oder eine Zahl ≥ 0 sein.');
    }
    if (inv.expectedReturnPct != null && !isNum(inv.expectedReturnPct)) {
      err(at, '"expectedReturnPct" muss null oder eine Zahl sein.');
    }
    checkRef(at, inv.owner, personIds);

    if (inv.linkedItemId != null) {
      if (!itemIds.has(inv.linkedItemId)) {
        err(at, `"linkedItemId" ${JSON.stringify(inv.linkedItemId)} ist kein bekannter Posten. Die App würde die Verknüpfung beim Import kappen.`);
      } else {
        const it = (data.items || []).find((x) => x.id === inv.linkedItemId);
        if (it && it.kind !== 'expense') {
          warn(at, 'Der verknüpfte Sparplan-Posten ist als Einnahme angelegt — eine Einzahlung ist eine Ausgabe.');
        }
        if (linkUse.has(inv.linkedItemId)) {
          warn(at, `Der Posten ist bereits bei investments[${linkUse.get(inv.linkedItemId)}] als Sparplan hinterlegt; die Rate erscheint dann bei beiden.`);
        } else {
          linkUse.set(inv.linkedItemId, i);
        }
      }
    }
  });
}

function checkPlans(data, personIds, itemIds, cats) {
  const plans = data.plans || [];
  uniqueIds(plans, 'plans');
  plans.forEach((p, i) => {
    const at = `plans[${i}]${p?.name ? ` („${p.name}")` : ''}`;
    if (!isObj(p)) { err(`plans[${i}]`, 'Muss ein Objekt sein.'); return; }
    if (typeof p.name !== 'string' || !p.name.trim()) err(at, 'Feld "name" fehlt oder ist leer.');
    if (p.adjustments != null && !Array.isArray(p.adjustments)) {
      err(at, '"adjustments" muss ein Array sein.');
      return;
    }
    (p.adjustments || []).forEach((a, j) => {
      const aat = `${at} → adjustments[${j}]${a?.label ? ` („${a.label}")` : ''}`;
      if (!isObj(a)) { err(aat, 'Muss ein Objekt sein.'); return; }

      if (!SCOPES.includes(a.scope)) {
        err(aat, `"scope" ${JSON.stringify(a.scope)} ist unbekannt — die Anpassung bliebe wirkungslos. Erlaubt: ${SCOPES.join(', ')}.`);
      }
      if (a.scope !== 'oneoff' && !MODES.includes(a.mode)) {
        err(aat, `"mode" ${JSON.stringify(a.mode)} ist unbekannt. Erlaubt: ${MODES.join(', ')}.`);
      }
      if (!isNum(a.value)) err(aat, `"value" muss eine Zahl sein, ist ${JSON.stringify(a.value)}.`);

      if (a.scope === 'person' && !personIds.has(a.targetId)) {
        err(aat, `"targetId" ${JSON.stringify(a.targetId)} ist keine bekannte Person — die Anpassung bliebe wirkungslos.`);
      }
      if (a.scope === 'item' && !itemIds.has(a.targetId)) {
        err(aat, `"targetId" ${JSON.stringify(a.targetId)} ist kein bekannter Posten — die Anpassung bliebe wirkungslos.`);
      }
      if (a.scope === 'category' && !cats.ids.has(a.targetId)) {
        err(aat, `"targetId" ${JSON.stringify(a.targetId)} ist keine bekannte Kategorie — die Anpassung bliebe wirkungslos.`);
      }
      if (a.scope === 'oneoff') {
        if (!KINDS.includes(a.kind)) err(aat, 'Bei "oneoff" muss "kind" "income" oder "expense" sein.');
        if (isNum(a.value) && a.value <= 0) err(aat, 'Bei "oneoff" muss "value" größer als 0 sein.');
        if (a.targetId != null) checkRef(aat, a.targetId, personIds);
      } else if (a.kind != null && !KINDS.includes(a.kind) && a.kind !== 'both') {
        err(aat, `"kind" muss "income", "expense" oder "both" sein, ist ${JSON.stringify(a.kind)}.`);
      }

      if (!RE_MONTH.test(a.from || '')) {
        err(aat, `"from" ${JSON.stringify(a.from)} ist kein Monat im Format JJJJ-MM.`);
      }
      if (a.to != null && !RE_MONTH.test(a.to)) {
        err(aat, `"to" ${JSON.stringify(a.to)} ist kein Monat im Format JJJJ-MM.`);
      }
      if (RE_MONTH.test(a.from || '') && a.to && RE_MONTH.test(a.to) &&
          monthIndex(a.to) < monthIndex(a.from)) {
        err(aat, `"to" (${a.to}) liegt vor "from" (${a.from}) — die Anpassung wirkt nie.`);
      }
      if (a.mode === 'percent' && isNum(a.value) && a.value < -100) {
        warn(aat, `"value" ${a.value} % unterschreitet −100 %; die App kappt die Beträge bei 0.`);
      }
    });
  });
}

/* --- Bilanz --------------------------------------------------------------- */

function inRange(key, start, end) {
  const i = monthIndex(key);
  if (start && RE_MONTH.test(start) && i < monthIndex(start)) return false;
  if (end && RE_MONTH.test(end) && i > monthIndex(end)) return false;
  return true;
}

function summarise(data, month) {
  const cats = new Map((data.categories || []).map((c) => [c?.id, c]));
  const names = new Map((data.people || []).map((p) => [p?.id, p?.name || p?.id]));
  names.set('household', 'Haushalt');

  const byOwner = new Map();
  const byCat = new Map();
  let income = 0, expense = 0, saving = 0;

  const add = (owner, kind, catId, amount) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!KINDS.includes(kind)) return;
    const key = names.has(owner) ? owner : 'household';
    const rec = byOwner.get(key) || { income: 0, expense: 0 };
    rec[kind] += amount;
    byOwner.set(key, rec);
    if (kind === 'income') income += amount;
    else {
      expense += amount;
      byCat.set(catId, (byCat.get(catId) || 0) + amount);
      if (cats.get(catId)?.saving) saving += amount;
    }
  };

  let activeItems = 0;
  for (const it of data.items || []) {
    if (!isObj(it) || it.active === false) continue;
    if (!inRange(month, it.start, it.end)) continue;
    const factor = INTERVALS[it.interval];
    if (factor == null) continue;
    activeItems++;
    add(it.owner, it.kind, it.categoryId, it.amount * factor);
  }

  let monthTx = 0;
  for (const t of data.transactions || []) {
    if (!isObj(t) || String(t.date || '').slice(0, 7) !== month) continue;
    monthTx++;
    add(t.owner, t.kind, t.categoryId, t.amount);
  }

  // Portfolio: Bestand, Einstand und gewichtete Renditeerwartung
  let invTotal = 0, invCost = 0, invCostKnown = 0, weighted = 0, weightBase = 0;
  for (const inv of data.investments || []) {
    if (!isObj(inv)) continue;
    const v = Number(inv.currentValue) || 0;
    invTotal += v;
    if (inv.costBasis != null && Number.isFinite(Number(inv.costBasis))) {
      invCost += Number(inv.costBasis);
      invCostKnown += v;
    }
    if (inv.expectedReturnPct != null && Number.isFinite(Number(inv.expectedReturnPct)) && v > 0) {
      weighted += v * Number(inv.expectedReturnPct);
      weightBase += v;
    }
  }
  const otherAssets = Number(data.household?.assets) || 0;

  const topCats = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, v]) => [cats.get(id)?.name || id, v]);

  return {
    month, income, expense, net: income - expense, saving,
    savingsRate: income > 0 ? (income - expense + saving) / income : 0,
    activeItems, monthTx, byOwner, names, topCats,
    invTotal, invCost, invGain: invCostKnown - invCost,
    invReturn: weightBase > 0 ? weighted / weightBase : null,
    otherAssets, totalAssets: otherAssets + invTotal
  };
}

/* --- Ausgabe -------------------------------------------------------------- */

const eur = new Intl.NumberFormat('de-AT', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0
});
const pct = new Intl.NumberFormat('de-AT', { style: 'percent', maximumFractionDigits: 1 });

function report(file, data, sum, asJson) {
  if (asJson) {
    console.log(JSON.stringify({
      file,
      ok: errors.length === 0,
      errors, warnings,
      summary: {
        month: sum.month,
        income: sum.income, expense: sum.expense, net: sum.net,
        savingContributions: sum.saving, savingsRate: sum.savingsRate,
        totalAssets: sum.totalAssets, otherAssets: sum.otherAssets,
        investmentTotal: sum.invTotal, investmentGain: sum.invGain,
        portfolioReturnPct: sum.invReturn,
        counts: {
          people: (data.people || []).length,
          categories: (data.categories || []).length,
          items: (data.items || []).length,
          activeItemsThisMonth: sum.activeItems,
          transactions: (data.transactions || []).length,
          transactionsThisMonth: sum.monthTx,
          investments: (data.investments || []).length,
          plans: (data.plans || []).length
        }
      }
    }, null, 2));
    return;
  }

  console.log(`\nNotgroschen — Prüfbericht für ${file}\n${'─'.repeat(64)}`);

  console.log(`\nBestand`);
  console.log(`  Haushalt              ${data.meta?.name ?? '—'}`);
  console.log(`  Personen              ${(data.people || []).length}`);
  console.log(`  Kategorien            ${(data.categories || []).length}`);
  console.log(`  Wiederkehrende Posten ${(data.items || []).length}  (${sum.activeItems} wirksam in ${sum.month})`);
  console.log(`  Einzelbuchungen       ${(data.transactions || []).length}  (${sum.monthTx} in ${sum.month})`);
  console.log(`  Investments           ${(data.investments || []).length}`);
  console.log(`  Szenarien             ${(data.plans || []).length}`);

  console.log(`\nVermögen`);
  console.log(`  Investments           ${eur.format(sum.invTotal).padStart(12)}`);
  console.log(`  Sonstiges Vermögen    ${eur.format(sum.otherAssets).padStart(12)}`);
  console.log(`  Gesamt                ${eur.format(sum.totalAssets).padStart(12)}`);
  if (sum.invCost > 0) {
    console.log(`  Gewinn / Verlust      ${eur.format(sum.invGain).padStart(12)}`);
  }
  if (sum.invReturn != null) {
    console.log(`  Erwartete Rendite     ${(sum.invReturn.toFixed(2) + ' %').padStart(12)}`);
  }

  console.log(`\nMonatsbilanz ${sum.month}`);
  console.log(`  Einnahmen             ${eur.format(sum.income).padStart(12)}`);
  console.log(`  Ausgaben              ${eur.format(sum.expense).padStart(12)}`);
  console.log(`  Saldo                 ${eur.format(sum.net).padStart(12)}`);
  console.log(`  davon Sparbeiträge    ${eur.format(sum.saving).padStart(12)}`);
  console.log(`  Sparquote             ${pct.format(sum.savingsRate).padStart(12)}`);

  if (sum.byOwner.size) {
    console.log(`\nNach Träger`);
    for (const [id, v] of sum.byOwner) {
      const label = (sum.names.get(id) || id).padEnd(20);
      console.log(`  ${label}  ein ${eur.format(v.income).padStart(11)}   aus ${eur.format(v.expense).padStart(11)}`);
    }
  }

  if (sum.topCats.length) {
    console.log(`\nGrößte Ausgabenkategorien`);
    for (const [name, v] of sum.topCats) {
      console.log(`  ${String(name).padEnd(28)} ${eur.format(v).padStart(11)}`);
    }
  }

  if (errors.length) {
    console.log(`\n✗ ${errors.length} Fehler — die Datei sollte so nicht importiert werden`);
    for (const e of errors) console.log(`  · ${e.where}: ${e.msg}`);
  }
  if (warnings.length) {
    console.log(`\n! ${warnings.length} Warnung${warnings.length === 1 ? '' : 'en'} — prüfen, aber importierbar`);
    for (const w of warnings) console.log(`  · ${w.where}: ${w.msg}`);
  }
  if (!errors.length && !warnings.length) {
    console.log(`\n✓ Keine Beanstandungen. Die Datei ist importierbar.`);
  } else if (!errors.length) {
    console.log(`\n✓ Keine Fehler. Die Datei ist importierbar.`);
  }
  console.log('');
}

/* --- Hauptprogramm -------------------------------------------------------- */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('Aufruf: node tools/validate-daten.mjs <datei.json> [--json]');
  process.exit(2);
}

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Datei nicht lesbar: ${e.message}`);
  process.exit(2);
}

if (checkTop(data)) {
  checkSettings(data);
  const personIds = checkPeople(data);
  const cats = checkCategories(data);
  const itemIds = checkItems(data, personIds, cats);
  checkTransactions(data, personIds, cats);
  checkInvestments(data, personIds, itemIds);
  checkPlans(data, personIds, itemIds, cats);
}

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
report(file, data, summarise(data, month), asJson);

process.exit(errors.length ? 1 : 0);
