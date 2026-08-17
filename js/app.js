/* ---------------------------------------------------------------------------
   app.js — Router, Theme, Datei-Ein-/Ausgabe, Bootstrap
   --------------------------------------------------------------------------- */

window.HB = window.HB || {};

(function (HB) {
  'use strict';

  var U = HB.util, S = HB.store, ui = HB.ui;

  var VIEWS = ['dashboard', 'people', 'items', 'transactions', 'investments', 'plans', 'fire', 'data'];
  var current = 'dashboard';
  var pendingParams = null;

  /* --- Routing ------------------------------------------------------------ */

  function go(name, params) {
    if (VIEWS.indexOf(name) === -1) name = 'dashboard';
    current = name;
    pendingParams = params || null;
    if (location.hash !== '#/' + name) location.hash = '#/' + name;
    else repaint();
    syncTabs();
  }

  function fromHash() {
    var name = (location.hash || '').replace(/^#\/?/, '');
    return VIEWS.indexOf(name) > -1 ? name : 'dashboard';
  }

  function syncTabs() {
    document.querySelectorAll('#tabs .tab').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.view === current ? 'true' : 'false');
    });
  }

  function repaint() {
    var root = document.getElementById('view');
    var scrollY = window.scrollY;
    U.clear(root);

    var mod = HB.views[current];
    if (!mod) {
      root.appendChild(ui.emptyState('Unbekannte Ansicht', current));
      return;
    }

    var params = pendingParams;
    pendingParams = null;

    try {
      mod.render(root, params);
    } catch (err) {
      console.error(err);
      root.appendChild(ui.card({
        title: 'Diese Ansicht konnte nicht aufgebaut werden',
        body: U.el('div', {}, [
          U.el('p', { text: 'Die übrigen Bereiche funktionieren weiter. Die technische Meldung lautet:' }),
          U.el('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' }, text: String(err && err.stack || err) })
        ])
      }));
    }

    // Position halten, damit Bearbeiten nicht nach oben springt.
    window.scrollTo(0, Math.min(scrollY, document.body.scrollHeight));
    document.getElementById('brandSubtitle').textContent = S.state.meta.name || 'Haushaltsplanung';
  }

  /* --- Theme -------------------------------------------------------------- */

  function applyTheme() {
    var t = (S.state.settings && S.state.settings.theme) || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function effectiveTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function toggleTheme() {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    S.update(function (st) { st.settings.theme = next; }, 'settings');
    applyTheme();
  }

  /* --- Datei -------------------------------------------------------------- */

  function pickFile() {
    var input = document.getElementById('fileInput');
    input.value = '';
    input.click();
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        S.importText(String(reader.result));
        HB.currencyCode = S.state.meta.currency || 'EUR';
        applyTheme();
        ui.toast('„' + file.name + '“ geladen.');
      } catch (e) {
        console.error(e);
        ui.toast('Datei konnte nicht gelesen werden: ' + e.message, 'err');
      }
    };
    reader.onerror = function () { ui.toast('Datei konnte nicht gelesen werden.', 'err'); };
    reader.readAsText(file);
  }

  function confirmImport(file) {
    if (!S.state.items.length && !S.state.people.length) { readFile(file); return; }
    ui.confirm({
      title: 'Datei laden',
      text: 'Der aktuelle Stand wird durch den Inhalt von „' + file.name + '“ ersetzt.',
      detail: 'Ungespeicherte Änderungen gehen dabei verloren.',
      confirmLabel: 'Ersetzen'
    }).then(function (ok) { if (ok) readFile(file); });
  }

  /* --- Speicherstatus ----------------------------------------------------- */

  var saveTimer = null;
  function flashSaved(failed) {
    var el = document.getElementById('saveState');
    if (!el) return;
    if (failed) {
      el.textContent = 'nicht gespeichert';
      el.classList.add('is-dirty');
      el.title = 'Der lokale Speicher ist nicht verfügbar (z. B. im privaten Modus). Bitte als Datei speichern.';
      return;
    }
    el.classList.remove('is-dirty');
    el.textContent = 'gespeichert ✓';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { el.textContent = 'gespeichert'; }, 1400);
  }

  /* --- Start -------------------------------------------------------------- */

  function boot() {
    var had = S.load();
    HB.currencyCode = S.state.meta.currency || 'EUR';
    applyTheme();

    S.onPersist = flashSaved;
    S.subscribe(function () {
      HB.currencyCode = S.state.meta.currency || 'EUR';
      repaint();
    });

    document.getElementById('tabs').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) go(tab.dataset.view);
    });

    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('btnExportTop').addEventListener('click', function () {
      ui.toast('Gespeichert als ' + S.exportFile() + '.');
    });
    document.getElementById('btnImportTop').addEventListener('click', pickFile);

    document.getElementById('fileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) confirmImport(file);
    });

    // Datei irgendwo ins Fenster ziehen
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      if (/\.json$/i.test(file.name) || file.type === 'application/json') confirmImport(file);
    });

    window.addEventListener('hashchange', function () {
      current = fromHash();
      syncTabs();
      repaint();
    });

    // Systemwechsel im Auto-Modus mitzeichnen (Diagrammfarben kommen aus Tokens).
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () {
        if ((S.state.settings.theme || 'auto') === 'auto') repaint();
      };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ui.toast('Gespeichert als ' + S.exportFile() + '.');
      }
    });

    current = fromHash();
    syncTabs();

    if (!had && !S.state.items.length) {
      // Erster Start: mit dem Beispielhaushalt zeigen, wofür die App gedacht ist.
      welcome();
    }
    repaint();
  }

  function welcome() {
    setTimeout(function () {
      ui.openModal({
        title: 'Willkommen bei Notgroschen',
        body: U.el('div', {}, [
          U.el('p', { text: 'Eine Haushaltsplanung für zwei und mehr Personen — vollständig lokal. Es werden keine Daten an einen Server übertragen.' }),
          U.el('ul', { style: { paddingLeft: '20px', color: 'var(--text-secondary)' } }, [
            U.el('li', { text: 'Personen anlegen, dann wiederkehrende Posten erfassen.' }),
            U.el('li', { text: 'Gemeinsame Kosten werden nach einem wählbaren Schlüssel aufgeteilt.' }),
            U.el('li', { text: 'Szenarien zeigen, was Karenz, Teilzeit oder eine Anschaffung bewirken.' }),
            U.el('li', { text: 'Der FIRE-Rechner beantwortet, wann das Vermögen die Ausgaben trägt.' })
          ]),
          U.el('p', { class: 'small muted', text: 'Der Stand wird automatisch im Browser gesichert. Für Backup und Gerätewechsel: oben rechts „Speichern“.' })
        ]),
        actions: [
          { label: 'Leer starten', variant: 'btn-ghost' },
          {
            label: 'Beispielhaushalt ansehen', variant: 'btn-primary',
            onClick: function (close) { S.loadDemo(); close(); }
          }
        ]
      });
    }, 250);
  }

  HB.app = {
    go: go, repaint: repaint, applyTheme: applyTheme,
    pickFile: pickFile, readFile: confirmImport, effectiveTheme: effectiveTheme
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.HB);
