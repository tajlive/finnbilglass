/* Operations Center 2026 — admin-frontend.
   Autentisering: support-token (samme som før) + Cloudflare Access foran hele /ops.
   Ingen hemmeligheter lagres utenfor økten; tokenet ligger i sessionStorage. */
(function () {
  'use strict';

  var TOKEN_KEY = 'fbg_ops_token';
  var state = { saker: [], valgt: null, filter: '' };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }

  function api(sti, opts) {
    opts = opts || {};
    var h = { Authorization: 'Bearer ' + token() };
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch(sti, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.error) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  function alder(ts) {
    var t = typeof ts === 'number' ? ts : Date.parse(ts);
    var timer = Math.max(0, (Date.now() - t) / 3600000);
    if (timer < 1) return Math.round(timer * 60) + ' min';
    if (timer < 48) return Math.round(timer) + ' t';
    return Math.round(timer / 24) + ' d';
  }

  var STATUS_TEKST = {
    NEW: 'Ny', CONTACTED: 'Besvart', NEEDS_INFO: 'Trenger svar', QUOTED: 'Tilbud sendt',
    OFFERED: 'Tilbudt', CONFIRMED: 'Bekreftet', COMPLETED: 'Fullført', REJECTED: 'Avvist', CLOSED: 'Lukket',
  };

  function pill(status) {
    return '<span class="pill ' + esc(status) + '">' + esc(STATUS_TEKST[status] || status) + '</span>';
  }

  // ── Navigasjon ─────────────────────────────────────────
  function vis(view) {
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');
    $$('.nav-item').forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (view === 'dashboard') lastDashboard();
    if (view === 'innboks') lastInnboks();
    if (view === 'drift') lastDrift();
  }

  function feil(container, melding) {
    var el = document.querySelector(container);
    if (el) el.innerHTML = '<div class="error-box">' + esc(melding) + '</div>';
  }

  // ── Dashboard ──────────────────────────────────────────
  function lastDashboard() {
    var kpi = $('#kpi-grid');
    kpi.innerHTML = '<div class="empty">Laster…</div>';
    Promise.all([api('/api/ops/summary'), api('/api/ops/saker')])
      .then(function (res) {
        var s = res[0] || {};
        var saker = (res[1] && res[1].saker) || [];
        state.saker = saker;

        var nye = saker.filter(function (x) { return x.status === 'NEW' && !x.erTest; });
        var gamle = nye.filter(function (x) {
          var t = typeof x.createdAt === 'number' ? x.createdAt : Date.parse(x.createdAt);
          return Date.now() - t > 12 * 3600000;
        });
        var venter = saker.filter(function (x) { return x.status === 'NEEDS_INFO' && !x.erTest; });
        var tilbud = saker.filter(function (x) { return x.status === 'QUOTED' || x.status === 'OFFERED'; });

        kpi.innerHTML = [
          kort('Nye saker', nye.length, 'venter på første svar', nye.length ? 'alert' : ''),
          kort('Ubehandlet > 12 t', gamle.length, 'krever handling nå', gamle.length ? 'alert' : 'good'),
          kort('Trenger kundesvar', venter.length, 'mangler opplysninger', ''),
          kort('Tilbud sendt', tilbud.length, 'avventer kundens svar', ''),
        ].join('');

        renderTabell('#siste-tabell', saker.slice(0, 8));
        var merke = document.getElementById('innboks-badge');
        if (merke) merke.textContent = String(nye.length);
        renderDriftMini();
      })
      .catch(function (e) { feil('#kpi-grid', e.status === 401 ? 'Ingen tilgang. Lim inn support-token.' : e.message); });

    function kort(label, verdi, meta, klasse) {
      return '<div class="kpi ' + klasse + '"><div class="label">' + esc(label) + '</div>' +
        '<div class="value">' + esc(verdi) + '</div><div class="meta">' + esc(meta) + '</div></div>';
    }
  }

  function renderDriftMini() {
    var el = document.getElementById('drift-mini');
    if (!el) return;
    Promise.all([
      fetch('/health').then(function (r) { return r.status; }).catch(function () { return 0; }),
      fetch('/api/pilot-status').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (res) {
      var helse = res[0], pilot = res[1] || {};
      el.innerHTML =
        rad('Worker /health', helse === 200 ? 'OK' : 'FEIL (' + helse + ')', helse === 200 ? 'ok' : 'bad') +
        rad('Pristilbud', pilot.inquiries_enabled ? 'Åpent' : 'Stengt', pilot.inquiries_enabled ? 'ok' : 'bad') +
        rad('Miljø', (pilot.pilot === 'apen' ? 'Produksjon' : '—'), 'neutral');
    });
    function rad(a, b, k) {
      return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px">' +
        '<span class="muted">' + esc(a) + '</span><strong style="color:' +
        (k === 'ok' ? 'var(--ok)' : k === 'bad' ? 'var(--danger)' : 'var(--ink)') + '">' + esc(b) + '</strong></div>';
    }
  }

  // ── Tabell ─────────────────────────────────────────────
  function renderTabell(sel, rader) {
    var el = document.querySelector(sel);
    if (!el) return;
    if (!rader.length) { el.innerHTML = '<div class="empty">Ingen saker.</div>'; return; }
    el.innerHTML =
      '<table class="list"><thead><tr>' +
      '<th>Sak</th><th>Kunde</th><th>Skilt</th><th>Status</th><th>Alder</th>' +
      '</tr></thead><tbody>' +
      rader.map(function (s) {
        return '<tr class="clickable" data-key="' + esc(s.key) + '">' +
          '<td><strong>#' + esc(s.inquiryId || '—') + '</strong></td>' +
          '<td>' + esc(s.navn || '—') + (s.erTest ? ' <span class="pill test">test</span>' : '') + '</td>' +
          '<td class="muted">' + esc(s.regnr || '—') + '</td>' +
          '<td>' + pill(s.status) + '</td>' +
          '<td class="muted">' + esc(alder(s.createdAt)) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
    el.querySelectorAll('tr[data-key]').forEach(function (tr) {
      tr.addEventListener('click', function () { apneSak(tr.dataset.key); });
    });
  }

  // ── Innboks ────────────────────────────────────────────
  function lastInnboks() {
    var el = $('#innboks-tabell');
    el.innerHTML = '<div class="empty">Laster…</div>';
    if (!state.saker.length) {
      api('/api/ops/saker').then(function (d) { state.saker = d.saker || []; tegnInnboks(); })
        .catch(function (e) { feil('#innboks-tabell', e.status === 401 ? 'Ingen tilgang.' : e.message); });
    } else tegnInnboks();

    function tegnInnboks() {
      var f = state.filter;
      var rader = state.saker.filter(function (s) { return !f || s.status === f; });
      renderTabell('#innboks-tabell', rader);
    }
  }

  // ── Saksdetalj ─────────────────────────────────────────
  function apneSak(key) {
    vis('sak');
    var el = $('#sak-innhold');
    el.innerHTML = '<div class="empty">Laster sak…</div>';
    api('/api/ops/saker/' + encodeURIComponent(key))
      .then(function (d) {
        var s = d.sak || {};
        var i = s.inquiry || {};
        var bil = '';
        if (i.vehicle_json) {
          try {
            var v = JSON.parse(i.vehicle_json);
            if (v.bil) bil = [v.bil.merke, v.bil.modell, v.bil.aar].filter(Boolean).join(' ');
            if (v.resolver && v.resolver.utfall) bil += ' · ' + v.resolver.utfall;
          } catch (e) { /* ignorer */ }
        }
        var tl = (s.timeline || []).map(function (e) {
          var hva = e.event_type === 'status' ? (STATUS_TEKST[e.status] || e.status)
            : e.event_type === 'reply' ? 'Svar sendt til kunde'
            : e.event_type === 'note' ? 'Internt notat' : 'Forespørsel opprettet';
          return '<li><time>' + new Date(e.created_at).toLocaleString('nb-NO') + ' · ' + esc(e.created_by || '') + '</time>' +
            esc(hva) + (e.note ? '<br><span class="muted">' + esc(e.note) + '</span>' : '') + '</li>';
        }).join('') || '<li class="muted">Ingen hendelser.</li>';

        el.innerHTML =
          '<div class="card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
              '<h2 style="margin:0">' + esc(i.navn || i.regnr || 'Sak') + ' · #' + esc(i.id || '') + '</h2>' +
              pill(i.status) +
            '</div>' +
            (bil ? '<p class="muted" style="margin:6px 0 0">' + esc(bil) + '</p>' : '') +
          '</div>' +

          '<div class="detail-grid">' +
            '<div class="card"><h2>Kunde</h2>' +
              '<p><strong>Navn:</strong> ' + esc(i.navn || '—') + '<br>' +
              '<strong>Kontakt:</strong> ' + esc(i.kontakt || '—') + '<br>' +
              '<strong>Skilt:</strong> ' + esc(i.regnr || '—') + '<br>' +
              '<strong>Mottatt:</strong> ' + (i.created_at ? new Date(i.created_at).toLocaleString('nb-NO') : '—') + '</p>' +
              (i.melding ? '<p><strong>Melding:</strong><br>' + esc(i.melding) + '</p>' : '') +
            '</div>' +
            '<div class="card"><h2>Tidslinje</h2><ul class="timeline">' + tl + '</ul></div>' +
          '</div>' +

          '<div class="detail-grid">' +
            '<div class="card"><h2>Endre status</h2><p class="hint">Logges med ansvarlig og tidsstempel.</p>' +
              '<div class="field"><label for="ny-status">Ny status</label><select id="ny-status">' +
                ['CONTACTED', 'NEEDS_INFO', 'QUOTED', 'CONFIRMED', 'CLOSED', 'REJECTED'].map(function (x) {
                  return '<option value="' + x + '">' + esc(STATUS_TEKST[x]) + '</option>';
                }).join('') +
              '</select></div>' +
              '<div class="field"><label for="ansvarlig">Ansvarlig</label><input id="ansvarlig" value="Tom" maxlength="64"></div>' +
              '<div class="field"><label for="begrunnelse">Begrunnelse</label><textarea id="begrunnelse" maxlength="600" placeholder="Kort begrunnelse for endringen"></textarea></div>' +
              '<button class="btn teal" id="lagre-status">Lagre status</button>' +
              '<span id="status-melding" class="muted" style="margin-left:10px"></span>' +
            '</div>' +
            '<div class="card"><h2>Send svar til kunde</h2><p class="hint">Sendes på e-post og logges i saken.</p>' +
              '<div class="field"><label for="svar-tekst">Svar</label><textarea id="svar-tekst" placeholder="Skriv svaret…"></textarea></div>' +
              '<button class="btn teal" id="send-svar">Send svar</button>' +
              '<span id="svar-melding" class="muted" style="margin-left:10px"></span>' +
            '</div>' +
          '</div>';

        $('#lagre-status').addEventListener('click', function () {
          lagreStatus(i.id);
        });
        $('#send-svar').addEventListener('click', function () {
          sendSvar(i.id);
        });
        lubrikérBilder(s, el);
      })
      .catch(function (e) { feil('#sak-innhold', e.status === 401 ? 'Ingen tilgang.' : e.message); });
  }

  function lubrikérBilder(s, el) {
    var bilder = [];
    (s.evidence || []).forEach(function (ev) { (ev.images || []).forEach(function (im) { bilder.push(im); }); });
    if (!bilder.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = '<h2>Bilder (' + bilder.length + ')</h2><div class="thumb-row"></div>';
    el.appendChild(wrap);
    var rad = wrap.querySelector('.thumb-row');
    bilder.forEach(function (im) {
      var img = document.createElement('img');
      img.alt = im.imageType || 'bilde';
      rad.appendChild(img);
      fetch(im.thumbUrl, { headers: { Authorization: 'Bearer ' + token() } })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) { if (b) img.src = URL.createObjectURL(b); })
        .catch(function () { /* ignorer */ });
    });
  }

  function lagreStatus(id) {
    var melding = $('#status-melding');
    melding.textContent = 'Lagrer…';
    api('/api/ops/inquiries/' + id + '/status', {
      method: 'POST',
      body: { status: $('#ny-status').value, actor: $('#ansvarlig').value.trim(), reason: $('#begrunnelse').value.trim() || 'Statusendring fra Operations Center' },
    }).then(function () { melding.textContent = 'Lagret.'; refreshEtterEndring(); })
      .catch(function (e) { melding.textContent = ''; alert(e.message); });
  }

  function sendSvar(id) {
    var melding = $('#svar-melding');
    var tekst = $('#svar-tekst').value.trim();
    if (!tekst) { alert('Skriv et svar først.'); return; }
    melding.textContent = 'Sender…';
    api('/api/ops/inquiries/' + id + '/reply', {
      method: 'POST',
      body: { actor: $('#ansvarlig').value.trim() || 'Tom', message: tekst },
    }).then(function () { melding.textContent = 'Sendt.'; $('#svar-tekst').value = ''; refreshEtterEndring(); })
      .catch(function (e) { melding.textContent = ''; alert(e.message); });
  }

  function refreshEtterEndring() {
    api('/api/ops/saker').then(function (d) { state.saker = d.saker || []; }).catch(function () {});
  }

  // ── Drift ──────────────────────────────────────────────
  function lastDrift() {
    renderDriftMini();
    var el = $('#drift-detalj');
    el.innerHTML = '<div class="empty">Sjekker…</div>';
    var sjekker = ['/health', '/', '/innlogging', '/min-side', '/api/pilot-status'];
    Promise.all(sjekker.map(function (p) {
      return fetch(p, { redirect: 'manual' })
        .then(function (r) { return { sti: p, kode: r.status }; })
        .catch(function () { return { sti: p, kode: 0 }; });
    })).then(function (res) {
      el.innerHTML = '<table class="list"><thead><tr><th>Endepunkt</th><th>Status</th></tr></thead><tbody>' +
        res.map(function (x) {
          var ok = x.kode === 200 || x.kode === 302 || x.kode === 0;
          return '<tr><td>' + esc(x.sti) + '</td><td><strong style="color:' + (ok ? 'var(--ok)' : 'var(--danger)') + '">' +
            esc(x.kode || 'nås ikke') + '</strong></td></tr>';
        }).join('') + '</tbody></table>';
    });
  }

  // ── Oppstart ───────────────────────────────────────────
  function start() {
    var inp = $('#token');
    if (token()) inp.value = token();
    $('#load').addEventListener('click', function () {
      sessionStorage.setItem(TOKEN_KEY, inp.value.trim());
      vis('dashboard');
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#load').click(); });
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { vis(b.dataset.view); });
    });
    var filter = $('#innboks-filter');
    if (filter) filter.addEventListener('change', function () { state.filter = filter.value; renderTabell('#innboks-tabell', state.saker.filter(function (s) { return !state.filter || s.status === state.filter; })); });
    if (token()) vis('dashboard');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
