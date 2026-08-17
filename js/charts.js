/* ---------------------------------------------------------------------------
   charts.js — Linien- und Säulendiagramme als reines SVG
   Gemeinsame Regeln: eine Y-Achse, dünne Marken, ruhige Hairline-Gitter,
   Legende ab zwei Serien, Hover-Tooltip, Tabellenansicht als Gegenstück.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util;

  // Breite des Koordinatensystems. Sie bestimmt, wie groß Achsentexte relativ
  // zur gerenderten Kartenbreite ausfallen — schmale Karten brauchen einen
  // schmaleren viewBox, sonst schrumpft die Schrift beim Skalieren.
  var DEFAULT_W = 900;
  var PAD = { t: 16, r: 22, b: 34, l: 62 };

  /* --- Skalen ------------------------------------------------------------- */

  function niceStep(raw) {
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function scaleY(min, max, targetTicks) {
    if (min === max) { max = min + 1; }
    var step = niceStep((max - min) / (targetTicks || 5));
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { lo: lo, hi: hi, ticks: ticks };
  }

  function xLabelIndexes(n, maxLabels) {
    if (n <= maxLabels) {
      var all = [];
      for (var i = 0; i < n; i++) all.push(i);
      return all;
    }
    var stride = Math.ceil(n / maxLabels);
    var out = [];
    for (var j = 0; j < n; j += stride) out.push(j);

    // Die letzte Beschriftung soll am Rand stehen, aber nicht mit ihrer
    // Vorgängerin kollidieren — zu nah beieinander wird ersetzt statt ergänzt.
    var last = out[out.length - 1];
    if (last !== n - 1) {
      if (n - 1 - last < stride * 0.6) out[out.length - 1] = n - 1;
      else out.push(n - 1);
    }
    return out;
  }

  /* --- Gemeinsames Gerüst ------------------------------------------------- */

  function frame(opts, yScale) {
    var h = opts.height || 300;
    var W = opts.width || DEFAULT_W;
    var svg = U.svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + h,
      role: 'img',
      'aria-label': opts.ariaLabel || 'Diagramm'
    });
    var innerW = W - PAD.l - PAD.r;
    var innerH = h - PAD.t - PAD.b;

    function y(v) {
      return PAD.t + innerH * (1 - (v - yScale.lo) / (yScale.hi - yScale.lo));
    }

    var gGrid = U.svgEl('g', {});
    yScale.ticks.forEach(function (t) {
      var yy = y(t);
      gGrid.appendChild(U.svgEl('line', {
        class: t === 0 ? 'axis-line' : 'grid-line',
        x1: PAD.l, x2: W - PAD.r, y1: yy, y2: yy
      }));
      gGrid.appendChild(U.svgEl('text', {
        class: 'axis-label', x: PAD.l - 9, y: yy + 3.5,
        'text-anchor': 'end',
        style: 'font-variant-numeric: tabular-nums',
        text: opts.yFormat ? opts.yFormat(t) : U.compact(t)
      }));
    });
    svg.appendChild(gGrid);

    return { svg: svg, y: y, innerW: innerW, innerH: innerH, height: h, w: W };
  }

  function xAxis(f, labels, xOf) {
    var g = U.svgEl('g', {});
    xLabelIndexes(labels.length, 9).forEach(function (i) {
      g.appendChild(U.svgEl('text', {
        class: 'axis-label', x: xOf(i), y: f.height - PAD.b + 16,
        'text-anchor': 'middle', text: labels[i]
      }));
    });
    f.svg.appendChild(g);
  }

  /* --- Tooltip-Infrastruktur ---------------------------------------------- */

  function attachHover(wrap, svg, f, count, xOf, buildHtml, onIndex) {
    var tip = U.el('div', { class: 'chart-tooltip' });
    wrap.appendChild(tip);

    var cross = U.svgEl('line', { class: 'crosshair', y1: PAD.t, y2: f.height - PAD.b, opacity: 0 });
    var dots = U.svgEl('g', { class: 'hover-dot' });
    svg.appendChild(cross);
    svg.appendChild(dots);

    var overlay = U.svgEl('rect', {
      class: 'chart-overlay',
      x: PAD.l - 6, y: PAD.t, width: f.innerW + 12, height: f.innerH
    });
    svg.appendChild(overlay);

    function idxFromEvent(e) {
      var r = svg.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width * f.w;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < count; i++) {
        var d = Math.abs(xOf(i) - px);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    overlay.addEventListener('mousemove', function (e) {
      var i = idxFromEvent(e);
      cross.setAttribute('x1', xOf(i));
      cross.setAttribute('x2', xOf(i));
      cross.setAttribute('opacity', 1);
      U.clear(dots);
      if (onIndex) onIndex(i, dots);

      tip.innerHTML = buildHtml(i);
      tip.classList.add('is-on');
      var wr = wrap.getBoundingClientRect();
      var left = e.clientX - wr.left + 16;
      if (left + tip.offsetWidth > wr.width - 6) left = e.clientX - wr.left - tip.offsetWidth - 16;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = U.clamp(e.clientY - wr.top - 10, 4, Math.max(4, wr.height - tip.offsetHeight - 6)) + 'px';
    });

    overlay.addEventListener('mouseleave', function () {
      cross.setAttribute('opacity', 0);
      U.clear(dots);
      tip.classList.remove('is-on');
    });
  }

  /* --- Liniendiagramm ----------------------------------------------------- */

  /**
   * line({ labels, series:[{name,color,values,area,dashed}], height,
   *        yFormat, valueFormat, ariaLabel, labelLast })
   */
  function line(opts) {
    var labels = opts.labels || [];
    var series = (opts.series || []).filter(function (s) { return s.values && s.values.length; });
    if (!labels.length || !series.length) return emptyChart();

    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { all.push(v); }); });
    var yScale = scaleY(Math.min(0, Math.min.apply(null, all)), Math.max(0, Math.max.apply(null, all)), 5);

    var f = frame(opts, yScale);
    var n = labels.length;
    function xOf(i) { return PAD.l + (n === 1 ? f.innerW / 2 : f.innerW * i / (n - 1)); }

    xAxis(f, labels, xOf);

    var surface = U.token('--surface-1');

    series.forEach(function (s) {
      var d = s.values.map(function (v, i) {
        return (i ? 'L' : 'M') + xOf(i).toFixed(1) + ',' + f.y(v).toFixed(1);
      }).join('');

      if (s.area) {
        f.svg.appendChild(U.svgEl('path', {
          d: d + 'L' + xOf(n - 1).toFixed(1) + ',' + f.y(Math.max(0, yScale.lo)).toFixed(1) +
             'L' + xOf(0).toFixed(1) + ',' + f.y(Math.max(0, yScale.lo)).toFixed(1) + 'Z',
          fill: s.color, 'fill-opacity': 0.1, stroke: 'none'
        }));
      }

      f.svg.appendChild(U.svgEl('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': s.dashed ? '6 5' : null
      }));

      // Endpunkt markieren — mit Ring in Flächenfarbe, damit er über Kreuzungen liest.
      var last = s.values.length - 1;
      f.svg.appendChild(U.svgEl('circle', {
        cx: xOf(last), cy: f.y(s.values[last]), r: 4.5,
        fill: s.color, stroke: surface, 'stroke-width': 2
      }));
    });

    // Sparsame Direktbeschriftung: nur der Endwert, nur bei ≤ 3 Serien.
    if (opts.labelLast !== false && series.length <= 3) {
      series.forEach(function (s) {
        var last = s.values.length - 1;
        var yy = f.y(s.values[last]);
        f.svg.appendChild(U.svgEl('text', {
          class: 'axis-label', x: xOf(last) - 8, y: yy - 10,
          'text-anchor': 'end', 'font-weight': '600',
          style: 'fill: var(--text-primary)',
          text: (opts.valueFormat || U.compact)(s.values[last])
        }));
      });
    }

    var wrap = U.el('div', { class: 'chart-wrap' }, f.svg);

    attachHover(wrap, f.svg, f, n, xOf, function (i) {
      var rows = series.map(function (s) {
        return '<div class="tt-row"><span class="k"><span class="dot" style="background:' +
          s.color + '"></span>' + U.escapeHtml(s.name) + '</span><span class="v">' +
          U.escapeHtml((opts.valueFormat || U.compact)(s.values[i])) + '</span></div>';
      }).join('');
      return '<div class="tt-title">' + U.escapeHtml(opts.tooltipTitle ? opts.tooltipTitle(i) : labels[i]) +
        '</div>' + rows;
    }, function (i, dots) {
      series.forEach(function (s) {
        dots.appendChild(U.svgEl('circle', {
          cx: xOf(i), cy: f.y(s.values[i]), r: 4.5,
          fill: s.color, stroke: surface, 'stroke-width': 2
        }));
      });
    });

    return wrap;
  }

  /* --- Säulendiagramm ----------------------------------------------------- */

  /**
   * bars({ labels, values, colorOf(v,i), height, yFormat, valueFormat })
   * Säulen wachsen aus der Nulllinie, Datenende gerundet, Sockel bündig.
   */
  function bars(opts) {
    var labels = opts.labels || [];
    var values = opts.values || [];
    if (!labels.length) return emptyChart();

    var yScale = scaleY(Math.min(0, Math.min.apply(null, values)),
      Math.max(0, Math.max.apply(null, values)), 5);
    var f = frame(opts, yScale);
    var n = labels.length;
    var band = f.innerW / n;
    var bw = Math.min(24, Math.max(2, band - 4));

    function cx(i) { return PAD.l + band * i + band / 2; }
    xAxis(f, labels, cx);

    var zeroY = f.y(0);
    var g = U.svgEl('g', {});

    values.forEach(function (v, i) {
      var yv = f.y(v);
      var top = Math.min(yv, zeroY);
      var h = Math.max(1, Math.abs(yv - zeroY));
      var color = opts.colorOf ? opts.colorOf(v, i) : U.token('--series-1');
      var r = Math.min(4, bw / 2, h);

      // Nur das Datenende runden, der Sockel bleibt an der Nulllinie eckig.
      var x = cx(i) - bw / 2;
      var d = v >= 0
        ? 'M' + x + ',' + (top + h) + 'V' + (top + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
          'h' + (bw - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'V' + (top + h) + 'Z'
        : 'M' + x + ',' + top + 'V' + (top + h - r) + 'a' + r + ',' + r + ' 0 0 0 ' + r + ',' + r +
          'h' + (bw - 2 * r) + 'a' + r + ',' + r + ' 0 0 0 ' + r + ',' + (-r) + 'V' + top + 'Z';

      g.appendChild(U.svgEl('path', { d: d, fill: color }));
    });
    f.svg.appendChild(g);

    var wrap = U.el('div', { class: 'chart-wrap' }, f.svg);

    attachHover(wrap, f.svg, f, n, cx, function (i) {
      return '<div class="tt-title">' + U.escapeHtml(opts.tooltipTitle ? opts.tooltipTitle(i) : labels[i]) +
        '</div><div class="tt-row"><span class="k">' + U.escapeHtml(opts.valueName || 'Wert') +
        '</span><span class="v">' + U.escapeHtml((opts.valueFormat || U.compact)(values[i])) + '</span></div>' +
        (opts.extraRows ? opts.extraRows(i) : '');
    }, function (i, dots) {
      dots.appendChild(U.svgEl('rect', {
        x: cx(i) - band / 2, y: PAD.t, width: band, height: f.innerH,
        fill: U.token('--text-primary'), 'fill-opacity': 0.05
      }));
    });

    return wrap;
  }

  /* --- Legende & Tabelle -------------------------------------------------- */

  function legend(series) {
    if (!series || series.length < 2) return null;
    return U.el('div', { class: 'chart-legend' }, series.map(function (s) {
      return U.el('span', { class: 'lg' }, [
        U.el('span', { class: 'swatch', style: { background: s.color } }),
        s.name
      ]);
    }));
  }

  function seriesTable(labels, series, fmt) {
    return U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'tbl' }, [
        U.el('thead', {}, U.el('tr', {}, [U.el('th', { text: 'Monat' })].concat(
          series.map(function (s) { return U.el('th', { class: 'num', text: s.name }); })
        ))),
        U.el('tbody', {}, labels.map(function (lb, i) {
          return U.el('tr', {}, [U.el('td', { text: lb })].concat(
            series.map(function (s) {
              return U.el('td', { class: 'num', text: (fmt || U.compact)(s.values[i]) });
            })
          ));
        }))
      ])
    ]);
  }

  function emptyChart() {
    return U.el('div', { class: 'empty' }, [
      U.el('strong', { text: 'Keine Daten' }),
      'Für diesen Zeitraum liegen noch keine Werte vor.'
    ]);
  }

  HB.charts = {
    line: line,
    bars: bars,
    legend: legend,
    seriesTable: seriesTable,
    scaleY: scaleY,
    empty: emptyChart
  };
})(window.HB);
