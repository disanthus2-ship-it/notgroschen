/* ---------------------------------------------------------------------------
   sankey.js — Layout und SVG-Rendering für Flussdiagramme
   Eigenständige Implementierung (keine externe Bibliothek), damit die App
   ohne Build und ohne Netzwerkzugriff läuft.
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util;

  var NODE_W = 13;
  var NODE_PAD = 22;   // Luft genug, damit zweizeilige Beschriftungen nicht kollidieren
  var PAD_L = 138;
  var PAD_R = 168;
  var PAD_T = 30;   // Platz für die Beschriftung über den mittleren Knoten
  var PAD_B = 14;

  /* --- Layout ------------------------------------------------------------- */

  function layout(graph, width, height) {
    var nodes = graph.nodes.map(function (n) {
      return Object.assign({}, n, { sourceLinks: [], targetLinks: [], value: 0 });
    });
    var index = {};
    nodes.forEach(function (n, i) { n.i = i; index[n.id] = n; });

    var links = graph.links
      .filter(function (l) { return index[l.source] && index[l.target]; })
      .map(function (l, i) {
        return {
          i: i, value: l.value, color: l.color,
          source: index[l.source], target: index[l.target]
        };
      });

    links.forEach(function (l) {
      l.source.sourceLinks.push(l);
      l.target.targetLinks.push(l);
    });

    nodes.forEach(function (n) {
      n.value = Math.max(
        U.sum(n.sourceLinks, function (l) { return l.value; }),
        U.sum(n.targetLinks, function (l) { return l.value; })
      );
    });

    // Ebenen: längster Pfad von den Quellen aus.
    nodes.forEach(function (n) { n.layer = 0; });
    for (var pass = 0; pass < nodes.length; pass++) {
      var changed = false;
      links.forEach(function (l) {
        if (l.target.layer < l.source.layer + 1) {
          l.target.layer = l.source.layer + 1;
          changed = true;
        }
      });
      if (!changed) break;
    }

    var maxLayer = 0;
    nodes.forEach(function (n) { maxLayer = Math.max(maxLayer, n.layer); });
    // Senken ganz nach rechts ziehen, damit die Endkategorien bündig stehen.
    nodes.forEach(function (n) { if (!n.sourceLinks.length) n.layer = maxLayer; });

    var byLayer = [];
    for (var i = 0; i <= maxLayer; i++) byLayer.push([]);
    nodes.forEach(function (n) { byLayer[n.layer].push(n); });

    var innerW = width - PAD_L - PAD_R;
    var innerH = height - PAD_T - PAD_B;
    var stepX = maxLayer > 0 ? (innerW - NODE_W) / maxLayer : 0;

    nodes.forEach(function (n) {
      n.x0 = PAD_L + n.layer * stepX;
      n.x1 = n.x0 + NODE_W;
    });

    // Maßstab so wählen, dass die vollste Ebene mit Abständen hineinpasst.
    var scale = Infinity;
    byLayer.forEach(function (col) {
      if (!col.length) return;
      var free = innerH - (col.length - 1) * NODE_PAD;
      var total = U.sum(col, function (n) { return n.value; });
      if (total > 0) scale = Math.min(scale, free / total);
    });
    if (!isFinite(scale) || scale <= 0) scale = 1;

    byLayer.forEach(function (col) {
      col.sort(function (a, b) { return b.value - a.value; });
      var y = PAD_T;
      col.forEach(function (n) {
        n.y0 = y;
        n.y1 = y + Math.max(2, n.value * scale);
        y = n.y1 + NODE_PAD;
      });
    });

    // Kreuzungen reduzieren: gewichteter Schwerpunkt, abwechselnd vor/zurück.
    for (var it = 0; it < 8; it++) {
      var alpha = 1 - it / 10;
      relax(byLayer, alpha, it % 2 === 0 ? 'left' : 'right');
      byLayer.forEach(function (col) { resolve(col, innerH); });
    }

    orderLinks(nodes);

    return { nodes: nodes, links: links, byLayer: byLayer, width: width, height: height };
  }

  function center(n) { return (n.y0 + n.y1) / 2; }

  function weightedCenter(links, side) {
    var v = U.sum(links, function (l) { return l.value; });
    if (!v) return null;
    return U.sum(links, function (l) {
      return center(side === 'left' ? l.source : l.target) * l.value;
    }) / v;
  }

  function relax(byLayer, alpha, dir) {
    var cols = dir === 'left' ? byLayer : byLayer.slice().reverse();
    cols.forEach(function (col, ci) {
      if (ci === 0) return;
      col.forEach(function (n) {
        var target = weightedCenter(dir === 'left' ? n.targetLinks : n.sourceLinks, dir);
        if (target == null) return;
        var dy = (target - center(n)) * alpha;
        n.y0 += dy;
        n.y1 += dy;
      });
    });
  }

  function resolve(col, innerH) {
    col.sort(function (a, b) { return a.y0 - b.y0; });
    var y = PAD_T;
    col.forEach(function (n) {
      var dy = y - n.y0;
      if (dy > 0) { n.y0 += dy; n.y1 += dy; }
      y = n.y1 + NODE_PAD;
    });
    // Von unten zurückschieben, falls die Spalte überläuft.
    var bottom = PAD_T + innerH;
    y = bottom;
    for (var i = col.length - 1; i >= 0; i--) {
      var n = col[i];
      var d = n.y1 - y;
      if (d > 0) { n.y0 -= d; n.y1 -= d; }
      y = n.y0 - NODE_PAD;
    }
  }

  function orderLinks(nodes) {
    nodes.forEach(function (n) {
      n.sourceLinks.sort(function (a, b) { return center(a.target) - center(b.target); });
      n.targetLinks.sort(function (a, b) { return center(a.source) - center(b.source); });

      var scale = (n.y1 - n.y0) / Math.max(1e-6, n.value);
      var y = n.y0;
      n.sourceLinks.forEach(function (l) {
        l.sy = y;
        l.w = Math.max(1, l.value * scale);
        y += l.w;
      });
      y = n.y0;
      n.targetLinks.forEach(function (l) {
        l.ty = y;
        l.tw = Math.max(1, l.value * scale);
        y += l.tw;
      });
    });
  }

  function ribbon(l) {
    var x0 = l.source.x1, x1 = l.target.x0;
    var xc = (x0 + x1) / 2;
    var a0 = l.sy, a1 = l.sy + l.w;
    var b0 = l.ty, b1 = l.ty + (l.tw || l.w);
    return 'M' + x0 + ',' + a0 +
      'C' + xc + ',' + a0 + ' ' + xc + ',' + b0 + ' ' + x1 + ',' + b0 +
      'L' + x1 + ',' + b1 +
      'C' + xc + ',' + b1 + ' ' + xc + ',' + a1 + ' ' + x0 + ',' + a1 + 'Z';
  }

  /* --- Rendering ---------------------------------------------------------- */

  /**
   * render(graph, opts) → DOM-Element
   * opts: { total, valueLabel(v), height }
   */
  function render(graph, opts) {
    opts = opts || {};

    if (!graph.nodes.length || !graph.links.length) {
      return U.el('div', { class: 'empty' }, [
        U.el('strong', { text: 'Noch kein Fluss darstellbar' }),
        'Sobald Einnahmen und Ausgaben erfasst sind, erscheint hier das Sankey-Diagramm.'
      ]);
    }

    var width = 1000;
    var maxPerLayer = 1;

    // Die Ebenenverteilung steht erst nach dem Layout fest — Probelauf, um die
    // endgültige Höhe an der vollsten Spalte auszurichten.
    var probe = layout(graph, width, 480);
    probe.byLayer.forEach(function (col) { maxPerLayer = Math.max(maxPerLayer, col.length); });
    var height = opts.height || U.clamp(maxPerLayer * 40 + 40, 320, 760);

    var L = layout(graph, width, height);
    var total = opts.total || U.sum(L.nodes.filter(function (n) { return !n.targetLinks.length; }),
      function (n) { return n.value; });

    var wrap = U.el('div', { class: 'chart-wrap sankey-scroll' });
    var tip = U.el('div', { class: 'chart-tooltip' });

    var svg = U.svgEl('svg', {
      class: 'sankey',
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': 'Sankey-Diagramm der Geldflüsse'
    });

    var gLinks = U.svgEl('g', { class: 'links' });
    var gNodes = U.svgEl('g', { class: 'nodes' });

    L.links.forEach(function (l) {
      var path = U.svgEl('path', {
        class: 'sankey-link',
        d: ribbon(l),
        fill: l.color || U.token('--text-muted'),
        'fill-opacity': 0.3
      });
      path.__link = l;
      gLinks.appendChild(path);
    });

    var maxLayer = L.byLayer.length - 1;

    L.nodes.forEach(function (n) {
      var g = U.svgEl('g', { class: 'sankey-node' });
      var h = Math.max(2, n.y1 - n.y0);

      var fill = n.color || U.token('--text-muted');
      var isSink = n.kind === 'expense';

      g.appendChild(U.svgEl('rect', {
        x: n.x0, y: n.y0, width: NODE_W, height: h,
        rx: 3,
        fill: fill,
        'fill-opacity': isSink ? 0.5 : 0.95
      }));

      // Beschriftung: außen an den Rändern, sonst über dem Knoten.
      var label, sub;
      if (n.layer === 0) {
        label = U.svgEl('text', {
          class: 'sankey-label', x: n.x0 - 9, y: (n.y0 + n.y1) / 2 - 1,
          'text-anchor': 'end', 'dominant-baseline': 'middle', text: n.name
        });
        sub = U.svgEl('text', {
          class: 'sankey-sub', x: n.x0 - 9, y: (n.y0 + n.y1) / 2 + 12,
          'text-anchor': 'end',
          text: fmtValue(n.value, opts) + (n.sub ? ' · ' + n.sub : '')
        });
      } else if (n.layer === maxLayer) {
        label = U.svgEl('text', {
          class: 'sankey-label', x: n.x1 + 9, y: (n.y0 + n.y1) / 2 - 1,
          'dominant-baseline': 'middle', text: n.name
        });
        sub = U.svgEl('text', {
          class: 'sankey-sub', x: n.x1 + 9, y: (n.y0 + n.y1) / 2 + 12,
          text: fmtValue(n.value, opts) + (total ? ' · ' + U.pct(n.value / total, 0) : '') +
                (n.sub ? ' · ' + n.sub : '')
        });
      } else {
        label = U.svgEl('text', {
          class: 'sankey-label', x: n.x0 + NODE_W / 2, y: n.y0 - 14,
          'text-anchor': 'middle', 'font-weight': '600', text: n.name
        });
        sub = U.svgEl('text', {
          class: 'sankey-sub', x: n.x0 + NODE_W / 2, y: n.y0 - 3,
          'text-anchor': 'middle', text: fmtValue(n.value, opts)
        });
      }
      g.appendChild(label);
      g.appendChild(sub);
      g.__node = n;
      gNodes.appendChild(g);
    });

    svg.appendChild(gLinks);
    svg.appendChild(gNodes);
    wrap.appendChild(svg);
    wrap.appendChild(tip);

    /* Hover: Fluss hervorheben, Rest zurücknehmen. */
    function showTip(html, evt) {
      tip.innerHTML = html;
      tip.classList.add('is-on');
      var r = wrap.getBoundingClientRect();
      var x = evt.clientX - r.left + 14;
      var y = evt.clientY - r.top + 14;
      tip.style.left = Math.min(x, r.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(y, r.height - tip.offsetHeight - 8) + 'px';
    }
    function hideTip() {
      tip.classList.remove('is-on');
      svg.classList.remove('is-hovering');
      Array.prototype.forEach.call(gLinks.children, function (p) { p.classList.remove('is-hot'); });
    }

    Array.prototype.forEach.call(gLinks.children, function (path) {
      var l = path.__link;
      path.addEventListener('mousemove', function (e) {
        svg.classList.add('is-hovering');
        Array.prototype.forEach.call(gLinks.children, function (p) { p.classList.remove('is-hot'); });
        path.classList.add('is-hot');
        showTip(
          '<div class="tt-title">' + U.escapeHtml(l.source.name) + ' → ' + U.escapeHtml(l.target.name) + '</div>' +
          '<div class="tt-row"><span class="k">Betrag</span><span class="v">' +
          U.escapeHtml(fmtValue(l.value, opts)) + '</span></div>' +
          (total ? '<div class="tt-row"><span class="k">Anteil</span><span class="v">' +
            U.pct(l.value / total, 1) + '</span></div>' : ''),
          e);
      });
      path.addEventListener('mouseleave', hideTip);
    });

    Array.prototype.forEach.call(gNodes.children, function (g) {
      var n = g.__node;
      g.addEventListener('mousemove', function (e) {
        svg.classList.add('is-hovering');
        Array.prototype.forEach.call(gLinks.children, function (p) {
          var l = p.__link;
          p.classList.toggle('is-hot', l.source === n || l.target === n);
        });
        showTip(
          '<div class="tt-title">' + U.escapeHtml(n.name) + '</div>' +
          (n.sub ? '<div class="tt-row"><span class="k">' + U.escapeHtml(n.sub) + '</span></div>' : '') +
          '<div class="tt-row"><span class="k">Volumen</span><span class="v">' +
          U.escapeHtml(fmtValue(n.value, opts)) + '</span></div>' +
          (total ? '<div class="tt-row"><span class="k">Anteil</span><span class="v">' +
            U.pct(n.value / total, 1) + '</span></div>' : ''),
          e);
      });
      g.addEventListener('mouseleave', hideTip);
    });

    return wrap;
  }

  function fmtValue(v, opts) {
    return opts && opts.valueLabel ? opts.valueLabel(v) : U.currency(v, { digits: 0 });
  }

  /** Tabellenansicht als barrierefreies Gegenstück zum Diagramm. */
  function table(graph, opts) {
    opts = opts || {};
    var names = {};
    graph.nodes.forEach(function (n) { names[n.id] = n.name; });
    var rows = graph.links.slice().sort(function (a, b) { return b.value - a.value; });
    var total = U.sum(rows, function (l) { return l.value; });

    return U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'tbl' }, [
        U.el('thead', {}, U.el('tr', {}, [
          U.el('th', { text: 'Von' }),
          U.el('th', { text: 'Nach' }),
          U.el('th', { class: 'num', text: 'Betrag / Monat' }),
          U.el('th', { class: 'num', text: 'Anteil' })
        ])),
        U.el('tbody', {}, rows.map(function (l) {
          return U.el('tr', {}, [
            U.el('td', { text: names[l.source] || l.source }),
            U.el('td', { text: names[l.target] || l.target }),
            U.el('td', { class: 'num', text: fmtValue(l.value, opts) }),
            U.el('td', { class: 'num', text: total ? U.pct(l.value / total, 1) : '—' })
          ]);
        }))
      ])
    ]);
  }

  HB.sankey = { layout: layout, render: render, table: table };
})(window.HB);
