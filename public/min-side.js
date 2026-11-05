// Side-skript for min-side.html — flyttet ut for strengere CSP.
(function() {
  'use strict';

  // Pilotstatus fra serveren — én sannhetskilde for om pristilbud er åpent.
  // Meldingen vises kun når piloten faktisk er stengt (inquiries_enabled=0).
  async function visPilotstatus() {
    try {
      const r = await fetch('/api/pilot-status', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const note = document.getElementById('pilot-note');
      if (note) note.style.display = d.inquiries_enabled ? 'none' : 'block';
    } catch (e) {
      // Nettverksfeil: la meldingen være skjult (ikke skrem kunden unødig).
    }
  }

  // Check authentication on load via server-side session
  async function checkAuth() {
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
      });

      if (response.status === 401 || !response.ok) {
        window.location.href = '/innlogging';
        return;
      }

      const data = await response.json();
      if (!data.authenticated) {
        window.location.href = '/innlogging';
        return;
      }

      const user = data.user;
      document.getElementById('user-name').textContent = user.name;
      document.getElementById('user-email').textContent = user.email;

      // Load user data
      loadUserData(user);
    } catch (err) {
      console.error('Auth check failed:', err);
      window.location.href = '/innlogging';
    }
  }

  // Load user data
  // Statusoversettelse — kunden skal aldri se interne enum-verdier.
  const STATUS_INFO = {
    NEW:         { tekst: 'Mottatt',        steg: 'Vi kontrollerer glass og pris. Du hører fra oss på e-post.', farge: '#F59E0B' },
    CONTACTED:   { tekst: 'Besvart',        steg: 'Vi har svart deg. Sjekk e-posten din og svar om saken fortsatt er aktuell.', farge: '#2563EB' },
    NEEDS_INFO:  { tekst: 'Trenger svar',   steg: 'Vi mangler opplysninger fra deg for å finne riktig glass.', farge: '#EA580C' },
    QUOTED:      { tekst: 'Tilbud sendt',   steg: 'Du har fått et tilbud. Si fra om du vil gå videre.', farge: '#7C3AED' },
    CONFIRMED:   { tekst: 'Bekreftet',      steg: 'Saken er bekreftet. Levering og frakt avtales i tilbudet.', farge: '#059669' },
    COMPLETED:   { tekst: 'Fullført',       steg: 'Saken er avsluttet.', farge: '#64748B' },
    REJECTED:    { tekst: 'Avsluttet',      steg: 'Saken er avsluttet. Ta kontakt om du trenger hjelp.', farge: '#64748B' },
  };
  function statusInfo(status) {
    return STATUS_INFO[status] || { tekst: String(status || ''), steg: 'Vi kommer tilbake til deg.', farge: '#64748B' };
  }
  function statusTekst(status) { return statusInfo(status).tekst; }
  function nesteSteg(status) { return statusInfo(status).steg; }
  function statusMerke(status) {
    const i = statusInfo(status);
    return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + i.farge + ';margin-right:6px;"></span>';
  }

  async function visSakdetaljer(id) {
    const boks = document.getElementById('sak-detaljer');
    if (!boks) return;
    boks.style.display = 'block';
    boks.innerHTML = '<p style="color:#94A3B8;">Laster saksdetaljer…</p>';
    try {
      const r = await fetch('/api/customer/inquiries/' + id, { credentials: 'include' });
      if (!r.ok) throw new Error('feil');
      const d = await r.json();
      const s = d.inquiry || {};
      const hist = (d.history || []).map(h => {
        const når = new Date(h.created_at).toLocaleString('nb-NO');
        const hva = h.event_type === 'reply' ? 'Svar fra oss'
          : h.event_type === 'status' ? 'Status: ' + statusTekst(h.status)
          : h.event_type === 'note' ? 'Internt notat'
          : 'Forespørsel mottatt';
        return '<li style="margin-bottom:6px;"><strong>' + hva + '</strong> — ' + når + '</li>';
      }).join('');
      boks.innerHTML =
        '<div class="car-card" style="flex-direction:column;align-items:flex-start;gap:8px;">' +
          '<div class="car-name">Forespørsel #' + s.id + '</div>' +
          '<div class="car-regnr">' + (s.regnr || 'Ikke oppgitt') + '</div>' +
          '<div class="car-status">' + statusMerke(s.status) + statusTekst(s.status) + '</div>' +
          '<div class="car-status">Neste steg: ' + nesteSteg(s.status) + '</div>' +
          (s.melding ? '<div class="car-status">Din melding: ' + s.melding + '</div>' : '') +
          '<div style="margin-top:8px;"><strong>Historikk</strong><ul style="margin:8px 0 0 18px;padding:0;font-size:13px;color:#64748B;">' + (hist || '<li>Ingen hendelser ennå.</li>') + '</ul></div>' +
        '</div>';
    } catch (e) {
      boks.innerHTML = '<p style="color:#DC2626;">Kunne ikke hente saken. Prøv igjen.</p>';
    }
  }

  async function loadUserData(user) {
    try {
      const response = await fetch('/api/customer/inquiries', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Kunne ikke laste forespørsler');
      }
      const data = await response.json();
      const inquiries = data.inquiries || [];

      // Load cars (inquiries as car cards)
      const carsList = document.getElementById('cars-list');
      if (!inquiries.length) {
        carsList.innerHTML = '<div class="empty-state"><h3>Ingen forespørsler ennå</h3><p>Når du sender en prisforespørsel, dukker den opp her.</p></div>';
      } else {
        carsList.innerHTML = inquiries.map(inq => `
        <div class="car-card">
          <div class="car-info">
            <div class="car-name">Forespørsel #${inq.id}</div>
            <div class="car-regnr">${inq.regnr || 'Ikke oppgitt'}</div>
            <div class="car-status">${statusMerke(inq.status)} ${statusTekst(inq.status)} · ${new Date(inq.created_at).toLocaleDateString('nb-NO')}</div>
            <div class="car-status">Neste steg: ${nesteSteg(inq.status)}</div>
          </div>
          <button class="btn-primary" style="padding:8px 16px;font-size:14px;" data-sak="${inq.id}">Vis detaljer</button>
        </div>
      `).join('');
        carsList.querySelectorAll('[data-sak]').forEach(btn => {
          btn.addEventListener('click', () => visSakdetaljer(Number(btn.dataset.sak)));
        });
      }

      // Load quotes (same inquiries as quote cards)
      const quotesList = document.getElementById('quotes-list');
      quotesList.innerHTML = inquiries.map(inq => `
        <div class="quote-card">
          <div class="quote-info">
          <div class="quote-name">Forespørsel #${inq.id} — ${inq.regnr || 'Ikke oppgitt'}</div>
            <div class="quote-status">${statusMerke(inq.status)} ${statusTekst(inq.status)}</div>
          <div class="quote-status">Opprettet ${new Date(inq.created_at).toLocaleDateString('nb-NO')}</div>
          </div>
          <button class="btn-primary" style="padding:8px 16px;font-size:14px;" data-sak="${inq.id}">Vis sak</button>
        </div>
      `).join('');
      quotesList.querySelectorAll('[data-sak]').forEach(btn => {
        btn.addEventListener('click', () => visSakdetaljer(Number(btn.dataset.sak)));
      });
    } catch (err) {
      console.error('Kunne ikke laste brukerdata:', err);
      document.getElementById('cars-list').innerHTML = '<div class="empty-state"><h3>Kunne ikke laste data</h3><p>Prøv igjen senere.</p></div>';
      document.getElementById('quotes-list').innerHTML = '<div class="empty-state"><h3>Kunne ikke laste saker</h3><p>Prøv igjen senere.</p></div>';
    }
  }

  // Nav tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  navTabs.forEach(tab => {
    tab.addEventListener('click', function() {
      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      navTabs.forEach(t => {
        const active = t === tab;
        t.setAttribute('aria-selected', String(active));
        t.tabIndex = active ? 0 : -1;
      });
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      const details = document.getElementById('sak-detaljer');
      if (details) details.style.display = 'none';
    });
    tab.addEventListener('keydown', function(e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const tabs = Array.from(navTabs);
      const index = tabs.indexOf(tab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
        : (index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async function() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
    sessionStorage.clear();
    document.cookie = 'fb_session=; path=/; max-age=0';
    window.location.href = '/';
  });

  // Initialize
  visPilotstatus();
  checkAuth();
})();
