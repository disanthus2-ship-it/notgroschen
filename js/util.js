/* ---------------------------------------------------------------------------
   util.js — Formatierung, Datums-/Monatsrechnen, DOM-Helfer
   Hängt sich an den globalen Namespace HB an (klassisches Script, kein Modul).
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var LOCALE = 'de-AT';

  /* --- IDs ---------------------------------------------------------------- */

  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  /* --- Zahlen & Währung --------------------------------------------------- */

  var fmtCache = {};
  function nf(opts) {
    var key = JSON.stringify(opts);
    if (!fmtCache[key]) fmtCache[key] = new Intl.NumberFormat(LOCALE, opts);
    return fmtCache[key];
  }

  function currency(v, opts) {
    opts = opts || {};
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    var digits = opts.digits != null ? opts.digits : (Math.abs(n) < 1000 ? 2 : 0);
    var s = nf({
      style: 'currency',
      currency: HB.currencyCode || 'EUR',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(n);
    if (opts.sign && n > 0) s = '+' + s;
    return s;
  }

  /** Kompakte Darstellung für Achsen und große Kennzahlen: 12,4 Tsd. / 1,2 Mio. */
  function compact(v) {
    var n = Number(v) || 0;
    var abs = Math.abs(n);
    if (abs >= 1e9) return nf({ maximumFractionDigits: 1 }).format(n / 1e9) + ' Mrd.';
    if (abs >= 1e6) return nf({ maximumFractionDigits: 1 }).format(n / 1e6) + ' Mio.';
    if (abs >= 1e4) return nf({ maximumFractionDigits: 0 }).format(n / 1e3) + ' Tsd.';
    if (abs >= 1e3) return nf({ maximumFractionDigits: 1 }).format(n / 1e3) + ' Tsd.';
    return nf({ maximumFractionDigits: 0 }).format(n);
  }

  function num(v, digits) {
    return nf({
      minimumFractionDigits: digits == null ? 0 : digits,
      maximumFractionDigits: digits == null ? 2 : digits
    }).format(Number(v) || 0);
  }

  function pct(v, digits) {
    return nf({
      style: 'percent',
      minimumFractionDigits: digits == null ? 0 : digits,
      maximumFractionDigits: digits == null ? 1 : digits
    }).format(Number(v) || 0);
  }

  /** Akzeptiert "1.234,56", "1234.56", "1 234,56" und leere Eingaben. */
  function parseNum(raw) {
    if (raw == null) return 0;
    if (typeof raw === 'number') return isFinite(raw) ? raw : 0;
    var s = String(raw).trim().replace(/[\s '€$]/g, '');
    if (!s) return 0;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  /* --- Monate: Schlüssel "YYYY-MM" ---------------------------------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function monthKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function monthIndex(key) {
    var p = String(key || '').split('-');
    return (parseInt(p[0], 10) || 1970) * 12 + ((parseInt(p[1], 10) || 1) - 1);
  }

  function keyFromIndex(idx) {
    var y = Math.floor(idx / 12);
    var m = idx % 12;
    return y + '-' + pad2(m + 1);
  }

  function addMonths(key, n) { return keyFromIndex(monthIndex(key) + n); }

  function monthDiff(a, b) { return monthIndex(b) - monthIndex(a); }

  function monthRange(from, count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(addMonths(from, i));
    return out;
  }

  var MONTHS_SHORT = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  var MONTHS_LONG = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];

  function monthLabel(key, style) {
    var p = String(key || '').split('-');
    var y = parseInt(p[0], 10);
    var m = (parseInt(p[1], 10) || 1) - 1;
    if (style === 'long') return MONTHS_LONG[m] + ' ' + y;
    if (style === 'tiny') return MONTHS_SHORT[m] + ' ' + String(y).slice(2);
    return MONTHS_SHORT[m] + ' ' + y;
  }

  function dateLabel(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length < 3) return iso;
    return parseInt(p[2], 10) + '. ' + MONTHS_SHORT[(parseInt(p[1], 10) || 1) - 1] + ' ' + p[0];
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function monthOfISO(iso) { return String(iso || '').slice(0, 7); }

  /** true, wenn monthKey innerhalb [start, end] liegt (leere Grenzen = offen). */
  function inRange(key, start, end) {
    var i = monthIndex(key);
    if (start && i < monthIndex(start)) return false;
    if (end && i > monthIndex(end)) return false;
    return true;
  }

  /* --- DOM ---------------------------------------------------------------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        } else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    appendAll(node, children);
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'text') { node.textContent = v; return; }
        if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
          return;
        }
        node.setAttribute(k, v);
      });
    }
    appendAll(node, children);
    return node;
  }

  function appendAll(node, children) {
    if (children == null) return;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c))
        : c);
    });
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* --- Sonstiges ---------------------------------------------------------- */

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  }

  function sum(arr, pick) {
    return arr.reduce(function (a, x) { return a + (pick ? pick(x) : x); }, 0);
  }

  function groupBy(arr, pick) {
    var out = {};
    arr.forEach(function (x) {
      var k = pick(x);
      (out[k] = out[k] || []).push(x);
    });
    return out;
  }

  function byId(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  /** Liest eine Design-Token-Variable aus dem aktuellen Theme aus. */
  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  var SERIES_SLOTS = ['--series-1', '--series-2', '--series-3', '--series-4',
    '--series-5', '--series-6', '--series-7', '--series-8'];

  /** Serienfarbe für Slot n — feste Reihenfolge, ab Slot 9 auf "Sonstige" falten. */
  function seriesToken(i) { return SERIES_SLOTS[i] || null; }
  function seriesColor(i) {
    var t = seriesToken(i);
    return t ? token(t) : token('--text-muted');
  }

  HB.util = {
    LOCALE: LOCALE,
    uid: uid,
    currency: currency, compact: compact, num: num, pct: pct, parseNum: parseNum,
    clamp: clamp, round2: round2,
    monthKey: monthKey, monthIndex: monthIndex, keyFromIndex: keyFromIndex,
    addMonths: addMonths, monthDiff: monthDiff, monthRange: monthRange,
    monthLabel: monthLabel, dateLabel: dateLabel, todayISO: todayISO,
    monthOfISO: monthOfISO, inRange: inRange, pad2: pad2,
    el: el, svgEl: svgEl, clear: clear, escapeHtml: escapeHtml,
    debounce: debounce, sum: sum, groupBy: groupBy, byId: byId, deepClone: deepClone,
    token: token, seriesToken: seriesToken, seriesColor: seriesColor,
    SERIES_SLOTS: SERIES_SLOTS
  };
})(window.HB);
