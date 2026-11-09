// Side-skript for index.html — flyttet ut for strengere CSP.
// Topplenken viser «Min side» når kunden allerede er innlogget.
  (function () {
    var lenke = document.getElementById('topp-konto');
    var bunn = document.getElementById('bunn-konto');
    if (!lenke) return;
    fetch('/api/auth/session', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.authenticated) {
          lenke.textContent = 'Min side';
          lenke.href = '/min-side';
          if (bunn) bunn.textContent = 'Min side';
        } else {
          lenke.textContent = 'Logg inn';
          lenke.href = '/innlogging';
        }
      })
      .catch(function () { /* ikke innlogget – la «Logg inn» stå */ });
  })();
