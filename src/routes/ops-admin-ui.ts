/**
 * Operations Center 2026 — skall.
 *
 * Selve grensesnittet ligger i public/ops-admin.css + public/ops-admin.js
 * (eksterne filer, fordi CSP ikke tillater inline skript eller stilblokker).
 * Denne modulen leverer bare HTML-stillaset, slik at /ops fortsatt kan
 * beskyttes av Cloudflare Access og av support-tokenet.
 */
export function opsAdminUi(): Response {
  const html = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Operations Center — Finnbilglass</title>
<link rel="stylesheet" href="/ops-admin.css?v=20261102">
</head>
<body class="admin">
<div class="admin-shell">

  <aside class="sidebar">
    <div class="brand">
      <strong>finn<span>bilglass</span></strong>
      <em>Operations</em>
    </div>
    <button class="nav-item" data-view="dashboard" aria-current="page">Oversikt</button>
    <button class="nav-item" data-view="innboks">Innboks <span class="badge" id="innboks-badge">–</span></button>
    <button class="nav-item" data-view="sak">Saksdetalj</button>
    <button class="nav-item" data-view="drift">Drift</button>
    <div class="sidebar-foot">
      Intern arbeidsflate.<br>
      AI og kandidater er observasjoner — mennesket beslutter.
    </div>
  </aside>

  <main class="main">
    <div class="topbar">
      <div>
        <h1>Operations Center</h1>
        <p class="sub">Kundesaker, glasskontroll og oppfølging</p>
      </div>
      <div class="token-bar">
        <span class="ident" id="ident">Sjekker innlogging…</span>
      </div>
    </div>

    <section class="view active" id="view-dashboard">
      <div class="alert-box">
        Kandidat- og AI-data er observasjoner. De kan aldri velge glass, endre fitment eller endre kundens ordre.
      </div>
      <div class="kpi-grid" id="kpi-grid">
        <div class="empty">Last kontrollpanelet for status.</div>
      </div>
      <div class="columns">
        <div class="card">
          <h2>Siste henvendelser</h2>
          <p class="hint">Klikk en rad for hele kundereisen.</p>
          <div id="siste-tabell" class="empty">Ingen saker lastet.</div>
        </div>
        <div class="card">
          <h2>Driftsstatus</h2>
          <p class="hint">Sanntidssjekk av tjenesten.</p>
          <div id="drift-mini"><div class="empty">—</div></div>
        </div>
      </div>
    </section>

    <section class="view" id="view-innboks">
      <div class="card">
        <h2>Innboks</h2>
        <p class="hint">Alle henvendelser, én rad per kunde.</p>
        <div class="token-bar" style="margin-bottom:12px">
          <select id="innboks-filter">
            <option value="">Alle statuser</option>
            <option value="NEW">Ny</option>
            <option value="CONTACTED">Besvart</option>
            <option value="NEEDS_INFO">Trenger svar</option>
            <option value="QUOTED">Tilbud sendt</option>
            <option value="CONFIRMED">Bekreftet</option>
          </select>
        </div>
        <div id="innboks-tabell" class="empty">Ingen saker lastet.</div>
      </div>
    </section>

    <section class="view" id="view-sak">
      <div id="sak-innhold"><div class="empty">Velg en sak i innboksen.</div></div>
    </section>

    <section class="view" id="view-drift">
      <div class="card">
        <h2>Drift</h2>
        <p class="hint">Tjenestestatus nå.</p>
        <div id="drift-mini-2"></div>
        <div id="drift-detalj" class="empty">Sjekker…</div>
      </div>
    </section>
  </main>
</div>
<script src="/ops-admin.js?v=20261102" defer></script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
