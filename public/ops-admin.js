/* Operations Center 2026 — admin-frontend.
   Autentisering: support-token (samme som før) + Cloudflare Access foran hele /ops.
   Ingen hemmeligheter lagres utenfor økten; tokenet ligger i sessionStorage. */
(function () {
  'use strict';

  var state = { saker: [], valgt: null, filter: '' };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var collator = new Intl.Collator('nb', { numeric: true, sensitivity: 'base' });
  var sortState = { col: null, dir: 'asc' };

  function sortValue(col, t) {
    if (col === 'pris') { var v = t.pris ? parseFloat(String(t.pris).replace(/[^\d.,]/g, '').replace(',', '.')) : NaN; return isNaN(v) ? Infinity : v; }
    if (col === 'varenr') return (t.varenr || t.eurokode || '');
    if (col === 'plassering') return (t.glassklasse || t.plassering || '');
    if (col === 'beskrivelse') return (t.beskrivelse || '');
    if (col === 'bil') return (t.bil || '');
    if (col === 'kilde') return (t.kilde || '');
    return '';
  }
  function isEmpty(t, col) {
    if (col === 'pris') return !t.pris || String(t.pris).trim() === '';
    var s = sortValue(col, t); return s === '' || s === null || s === undefined;
  }
  function compare(col, a, b, dir) {
    var ma = isEmpty(a, col), mb = isEmpty(b, col);
    if (ma && mb) return 0;
    if (ma) return 1;
    if (mb) return -1;
    if (col === 'pris') return dir === 'asc' ? sortValue(col, a) - sortValue(col, b) : sortValue(col, b) - sortValue(col, a);
    return dir === 'asc' ? collator.compare(String(sortValue(col, a)), String(sortValue(col, b))) : collator.compare(String(sortValue(col, b)), String(sortValue(col, a)));
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Access-identiteten bæres av HttpOnly-cookien; ingenting hemmelig lagres i JS.

  function api(sti, opts) {
    opts = opts || {};
    var h = {};
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
    if (view === 'katalog') { var f = document.getElementById('katalog-q'); if (f) f.focus(); }
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
        rad('Miljø', (pilot.environment === 'production' ? 'Produksjon'
          : pilot.environment === 'staging' ? 'Staging'
          : 'ukjent'), 'neutral');
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
              '<button class="btn ghost" id="til-katalog">Åpne glassoppslag</button>' +
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
          '</div>' +

          '<div class="detail-grid">' +
            '<div class="card"><h2>Pristilbud</h2><p class="hint">Bekreftet pris kreves før et bindende tilbud sendes.</p>' +
              '<div class="field"><label for="t-varenr">Varenr</label><input id="t-varenr" maxlength="40"></div>' +
              '<div class="field"><label for="t-eurokode">Eurokode</label><input id="t-eurokode" maxlength="40"></div>' +
              '<div class="field"><label for="t-pris">Pris (kr)</label><input id="t-pris" type="number" min="0" step="1"></div>' +
              '<div class="field"><label for="t-type">Pristype</label><select id="t-type">' +
                '<option value="VEILEDENDE">Veiledende</option><option value="BEKREFTET">Bekreftet</option>' +
              '</select></div>' +
              '<div class="field"><label for="t-levering">Leveringstid</label><input id="t-levering" maxlength="80"></div>' +
              '<div class="field"><label for="t-tillegg">Tillegg</label><input id="t-tillegg" maxlength="400" placeholder="f.eks. list, klips, montasje"></div>' +
              '<div class="field"><label for="t-gyldig">Gyldig til</label><input id="t-gyldig" maxlength="20" placeholder="2026-11-30"></div>' +
              '<div class="field"><label for="t-begrunnelse">Begrunnelse (påkrevd)</label><textarea id="t-begrunnelse" maxlength="600"></textarea></div>' +
              '<div class="row"><button class="btn ghost" id="tilbud-lagre">Lagre utkast</button>' +
              '<button class="btn teal" id="tilbud-send">Lagre og send</button>' +
              '<span id="tilbud-melding" class="muted"></span></div>' +
              '<div id="tilbud-liste" style="margin-top:12px"></div>' +
            '</div>' +
            '<div class="card"><h2>E-posthistorikk</h2><p class="hint">Svar, statusendringer og notater på saken.</p>' +
              '<div id="epost-liste"><div class="empty">Laster…</div></div>' +
            '</div>' +
          '</div>';

        $('#lagre-status').addEventListener('click', function () {
          lagreStatus(i.id);
        });
        $('#send-svar').addEventListener('click', function () {
          sendSvar(i.id);
        });
        var lagreT = document.getElementById('tilbud-lagre');
        if (lagreT) lagreT.addEventListener('click', function () { lagTilbud(i.id, false); });
        var sendT = document.getElementById('tilbud-send');
        if (sendT) sendT.addEventListener('click', function () { lagTilbud(i.id, true); });
        lastTilbud(i.id);
        lastEpost(i.id);
        var tilKat = document.getElementById('til-katalog');
        if (tilKat) tilKat.addEventListener('click', function () { fyllKatalogForSak(i); });
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
      fetch(im.thumbUrl, { credentials: 'include' })
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

  // ── Katalog ───────────────────────────────────────────
  function katalogSok() {
    var q = (document.getElementById('katalog-q').value || '').trim();
    var status = document.getElementById('katalog-status');
    var ut = document.getElementById('katalog-treff');
    if (q.length < 2) { status.textContent = 'Skriv minst to tegn.'; return; }
    status.textContent = 'Søker…';
    ut.innerHTML = '';
    var klasse = (document.getElementById('katalog-klasse') || {}).value || '';
    var side = (document.getElementById('katalog-side') || {}).value || '';
    var url = '/api/ops/katalog/sok?q=' + encodeURIComponent(q);
    if (klasse) url += '&glassklasse=' + encodeURIComponent(klasse);
    if (side) url += '&side_kilde=' + encodeURIComponent(side);
    var styring = (document.getElementById('katalog-styring') || {}).value || 'UKJENT';
    if (styring !== 'UKJENT') url += '&kjorestyring=' + encodeURIComponent(styring);
    api(url)
      .then(function (d) {
        status.innerHTML = '<strong>' + d.antall + ' treff</strong> · utfall: <span class="pill ' +
          (d.utfall === 'EXACT' ? 'CONFIRMED' : d.utfall === 'AMBIGUOUS' ? 'NEEDS_INFO' : 'NEW') + '">' +
          esc(d.utfall) + '</span>' + (d.filter && d.filter.advarsel ? ' · <span style="color:var(--danger)">' + esc(d.filter.advarsel) + '</span>' : '');
        if (!d.treff.length) { ut.innerHTML = '<div class="empty">Ingen treff.</div>'; return; }

        // Sorter treff før rendering
        var colMap = { 'varenr': 0, 'plassering': 1, 'beskrivelse': 2, 'bil': 3, 'pris': 4, 'kilde': 5 };
        var sortCol = sortState.col;
        if (sortCol && colMap[sortCol] !== undefined) {
          d.treff.sort(function (a, b) { return compare(sortCol, a, b, sortState.dir); });
        }

        function sortBtn(label, col) {
          var isActive = sortState.col === col;
          var arrow = '';
          if (isActive) arrow = sortState.dir === 'asc' ? ' <span aria-hidden="true">↑</span>' : ' <span aria-hidden="true">↓</span>';
          return '<th><button type="button" class="sort-btn" data-sort="' + col + '" aria-label="Sorter ' + label + (isActive ? (sortState.dir === 'asc' ? ', stigende' : ', synkende') : '') + '">' + esc(label) + arrow + '</button></th>';
        }

        ut.innerHTML = '<table class="list"><thead><tr>' +
          sortBtn('Varenr/Eurokode', 'varenr') +
          sortBtn('Plassering', 'plassering') +
          sortBtn('Beskrivelse', 'beskrivelse') +
          sortBtn('Bil', 'bil') +
          sortBtn('Pris', 'pris') +
          sortBtn('Kilde', 'kilde') +
          '</tr></thead><tbody>' +
          d.treff.map(function (t) {
            var id = t.varenr || t.eurokode || '';
            var detalj = [];
            if (t.side_kilde) detalj.push('kildeside: ' + (t.side_kilde === 'forer' ? 'fører' : 'passasjer'));
            if (t.side_bekreftet && t.produkt_fysisk_side_verifisert) {
              detalj.push('fysisk side: ' + t.produkt_fysisk_side_verifisert + ' (dokumentert)');
            } else if (t.fysisk_side_visning) {
              detalj.push('visning: ' + t.fysisk_side_visning + ' (antatt ' + (t.markedsstandard || 'LHD') + '-marked)');
            }
            if (t.dor_ledd) detalj.push(t.dor_ledd + ' dør');
            if (t.ventil_ledd) detalj.push(t.ventil_ledd + ' ventil');
            if (t.siderute_nummer) detalj.push('siderute ' + t.siderute_nummer);
            if (t.delt_bakrute) detalj.push('delt bakrute');
            var plassCelle = '<span class="pill' + (t.glassklasse === 'frontrute' ? ' CONFIRMED' : '') + '">' + esc(t.glassklasse || t.plassering || '—') + '</span>' +
              (t.typekode ? ' <span class="muted" title="' + esc(t.plassering_grunn || '') + '">' + esc(t.typekode) + '</span>' : ' <span class="muted">uten typekode</span>') +
              (detalj.length ? '<br><span class="muted">' + esc(detalj.join(' · ')) + '</span>' : '') +
              (t.typekode_konflikt ? '<br><span style="color:var(--danger)">konflikt — må kontrolleres</span>' : '');
            return '<tr><td><strong>' + esc(id) + '</strong>' + (t.eurokode && id !== t.eurokode ? '<br><span class="muted">' + esc(t.eurokode) + '</span>' : '') + '</td>' +
              '<td>' + plassCelle + '</td>' +
              '<td>' + esc(t.beskrivelse || '') + '</td>' +
              '<td class="muted">' + esc(t.bil || '') + '</td>' +
              '<td>' + (t.pris ? esc(t.pris) + ' kr' : '<span class="muted">—</span>') + '</td>' +
              '<td class="muted">' + esc(t.kilde) + '</td></tr>';
          }).join('') + '</tbody></table>';

        // Bind sorter-knapper
        ut.querySelectorAll('button.sort-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var col = btn.dataset.sort;
            if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            else { sortState.col = col; sortState.dir = 'asc'; }
            katalogSok(); // ny søk med samme q, men sortert
          });
        });

      })
      .catch(function (e) { status.textContent = ''; feil('#katalog-treff', e.message); });
  }

  function fyllKatalogForSak(sak) {
    vis('katalog');
    var felt = document.getElementById('katalog-q');
    if (felt) felt.value = sak.regnr || sak.navn || '';
    katalogSok();
  }

  // ── Tilbud ────────────────────────────────────────────
  function lagTilbud(inquiryId, skalSende) {
    var melding = document.getElementById('tilbud-melding');
    var kropp = {
      varenr: (document.getElementById('t-varenr').value || '').trim(),
      eurokode: (document.getElementById('t-eurokode').value || '').trim(),
      pris: parseInt(document.getElementById('t-pris').value, 10) || 0,
      prisType: document.getElementById('t-type').value,
      leveringstid: (document.getElementById('t-levering').value || '').trim(),
      tillegg: (document.getElementById('t-tillegg').value || '').trim(),
      gyldigTil: (document.getElementById('t-gyldig').value || '').trim(),
      begrunnelse: (document.getElementById('t-begrunnelse').value || '').trim(),
      av: (document.getElementById('ansvarlig').value || '').trim() || 'Tom',
      send: !!skalSende,
    };
    melding.textContent = skalSende ? 'Sender…' : 'Lagrer…';
    api('/api/ops/inquiries/' + inquiryId + '/tilbud', { method: 'POST', body: kropp })
      .then(function (d) {
        melding.textContent = d.sendt ? ('Sendt (v' + d.versjon + ').') : (d.advarsel || ('Lagret som v' + d.versjon + '.'));
      })
      .catch(function (e) { melding.textContent = ''; alert(e.message); });
  }

  function lastTilbud(inquiryId) {
    var el = document.getElementById('tilbud-liste');
    if (!el) return;
    api('/api/ops/inquiries/' + inquiryId + '/tilbud').then(function (d) {
      var t = d.tilbud || [];
      el.innerHTML = t.length
        ? '<ul class="timeline">' + t.map(function (x) {
            return '<li><time>v' + x.versjon + ' · ' + new Date(x.opprettet_at).toLocaleString('nb-NO') + ' · ' + esc(x.opprettet_av) + '</time>' +
              esc(x.pris_kr) + ' kr (' + esc(x.pris_type) + ')' + (x.varenr ? ' · ' + esc(x.varenr) : '') +
              (x.sendt_at ? ' · <span style="color:var(--ok)">sendt</span>' : ' · <span class="muted">ikke sendt</span>') + '</li>';
          }).join('') + '</ul>'
        : '<p class="muted">Ingen tilbud registrert.</p>';
    }).catch(function () { el.innerHTML = ''; });
  }

  function lastEpost(inquiryId) {
    var el = document.getElementById('epost-liste');
    if (!el) return;
    api('/api/ops/inquiries/' + inquiryId + '/epost').then(function (d) {
      var h = d.historikk || [];
      el.innerHTML = h.length
        ? '<ul class="timeline">' + h.map(function (x) {
            var navn = x.type === 'reply' ? 'Svar til kunde' : x.type === 'status' ? 'Statusendring' : 'Notat';
            return '<li><time>' + new Date(x.tid).toLocaleString('nb-NO') + ' · ' + esc(x.fra || '') + '</time><strong>' + esc(navn) + '</strong>' +
              (x.innhold ? '<br><span class="muted">' + esc(String(x.innhold).slice(0, 220)) + '</span>' : '') + '</li>';
          }).join('') + '</ul>'
        : '<p class="muted">Ingen hendelser.</p>';
    }).catch(function () { el.innerHTML = ''; });
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
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { vis(b.dataset.view); });
    });
    var filter = $('#innboks-filter');
    if (filter) {
      filter.addEventListener('change', function () {
        state.filter = filter.value;
        renderTabell('#innboks-tabell', state.saker.filter(function (s) { return !state.filter || s.status === state.filter; }));
      });
    }
    var sok = document.getElementById('katalog-sok');
    if (sok) sok.addEventListener('click', katalogSok);
    var sokFelt = document.getElementById('katalog-q');
    if (sokFelt) sokFelt.addEventListener('keydown', function (e) { if (e.key === 'Enter') katalogSok(); });
    sjekkIdentitet();
  }

  // Verifiserer Access-identiteten på serversiden via /api/ops/whoami.
  function sjekkIdentitet() {
    var el = document.getElementById('ident');
    fetch('/api/ops/whoami', { credentials: 'include' })
      .then(function (r) { return r.json().then(function (d) { return { st: r.status, d: d }; }); })
      .then(function (res) {
        if (res.st === 200 && res.d && res.d.ok) {
          if (el) el.innerHTML = '<span style="color:var(--ok);font-weight:700">●</span> ' +
            esc(res.d.epost || 'automatisering') + ' <span class="muted">(' + esc(res.d.metode) + ')</span>';
          vis('dashboard');
          return;
        }
        if (el) el.innerHTML = '<span style="color:var(--danger);font-weight:700">●</span> Ikke innlogget';
        var innhold = document.getElementById('kpi-grid');
        if (innhold) {
          innhold.innerHTML = '<div class="error-box">' +
            (res.st === 403
              ? 'Access-identiteten din har ikke administratortilgang. Kontakt eier av kontoen.'
              : 'Du er ikke innlogget. <a href="/ops">Logg inn med Cloudflare Access</a> og prøv igjen.') +
            '</div>';
        }
      })
      .catch(function () {
        if (el) el.textContent = 'Kunne ikke sjekke innlogging';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
