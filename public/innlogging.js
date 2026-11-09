// Side-skript for innlogging.html — flyttet ut for strengere CSP.
(function() {
  'use strict';

  const emailInput = document.getElementById('email');
  const sendOtpBtn = document.getElementById('send-otp-btn');
  const guestBtn = document.getElementById('guest-btn');
  const emailStep = document.getElementById('email-step');
  const otpStep = document.getElementById('otp-step');
  const otpInputs = document.querySelectorAll('.otp-input');
  const verifyOtpBtn = document.getElementById('verify-otp-btn');
  const backBtn = document.getElementById('back-btn');
  const resendText = document.getElementById('resend-text');
  const resendLink = document.getElementById('resend-link');
  const resendText2 = document.getElementById('resend-text-2');
  const resendLink2 = document.getElementById('resend-link-2');
  const emailError = document.getElementById('email-error');
  const otpError = document.getElementById('otp-error');

  let resendTimer = null;
  let resendSeconds = 60;

  // Email validation
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Rate limiting state
  let rateLimitUntil = 0;

  function isRateLimited() {
    return Date.now() < rateLimitUntil;
  }

  function setRateLimit(seconds) {
    rateLimitUntil = Date.now() + seconds * 1000;
  }

  // Email input change
  emailInput.addEventListener('input', function() {
    emailError.style.display = 'none';
    sendOtpBtn.disabled = !isValidEmail(emailInput.value.trim()) || isRateLimited();
    if (isRateLimited()) {
      const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
      sendOtpBtn.textContent = `Prøv igjen om ${remaining}s`;
    } else {
      sendOtpBtn.textContent = 'Send engangskode';
    }
  });

  // Start resend countdown
  function startResendTimer() {
    resendSeconds = 60;
    resendText.style.display = 'block';
    updateResendText();
    resendTimer = setInterval(() => {
      resendSeconds--;
      updateResendText();
      if (resendSeconds <= 0) {
        clearInterval(resendTimer);
        resendText.style.display = 'none';
      }
    }, 1000);
  }

  function updateResendText() {
    resendText.textContent = `Koden gjelder i 10 minutter. Kan sende på nytt om ${resendSeconds}s.`;
  }

  // Send OTP via API
  sendOtpBtn.addEventListener('click', async function() {
    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      emailError.style.display = 'block';
      return;
    }
    if (isRateLimited()) return;

    try {
      const response = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        const data = await response.json();
        emailError.textContent = data.error || 'For mange forsøk. Vent litt.';
        emailError.style.display = 'block';
        setRateLimit(data.retryAfter || 60);
        sendOtpBtn.disabled = true;
        return;
      }

      if (!response.ok) {
        emailError.textContent = 'Kunne ikke sende kode. Prøv igjen.';
        emailError.style.display = 'block';
        return;
      }

      const data = await response.json();

      emailStep.style.display = 'none';
      otpStep.style.display = 'block';
      resendText.style.display = 'block';
      startResendTimer();
      otpInputs[0].focus();
    } catch (err) {
      console.error('Feil ved sending av OTP:', err);
      emailError.textContent = 'Nettverksfeil. Prøv igjen senere.';
      emailError.style.display = 'block';
    }
  });

  // Guest button
  guestBtn.addEventListener('click', function() {
    sessionStorage.setItem('fb_guest', 'true');
    sessionStorage.setItem('fb_session_id', 'guest_' + Date.now());
    window.location.href = 'index.html';
  });

  // OTP inputs - auto-focus next
  otpInputs.forEach((input, index) => {
    input.addEventListener('input', function() {
      if (input.value && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }
      otpError.style.display = 'none';
      updateVerifyBtn();
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });
  });

  function updateVerifyBtn() {
    const code = Array.from(otpInputs).map(i => i.value).join('');
    verifyOtpBtn.disabled = code.length !== 6;
  }

  // Back button
  backBtn.addEventListener('click', function() {
    otpStep.style.display = 'none';
    emailStep.style.display = 'block';
    resendText.style.display = 'none';
  });

  // Resend links
  resendLink.addEventListener('click', function(e) {
    e.preventDefault();
    sendOtpBtn.click();
  });
  resendLink2.addEventListener('click', function(e) {
    e.preventDefault();
    sendOtpBtn.click();
  });

  // Verify OTP via API
  verifyOtpBtn.addEventListener('click', async function() {
    const code = Array.from(otpInputs).map(i => i.value).join('');
    const email = emailInput.value.trim();

    if (code.length !== 6) {
      otpError.style.display = 'block';
      return;
    }

    try {
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, ...(koblingsToken ? { linkToken: koblingsToken } : {}) }),
      });

      if (response.status === 401) {
        otpError.textContent = 'Ugyldig eller utløpt kode.';
        otpError.style.display = 'block';
        return;
      }

      if (!response.ok) {
        otpError.textContent = 'Kunne ikke verifisere koden. Prøv igjen.';
        otpError.style.display = 'block';
        return;
      }

      const data = await response.json();

      // Session cookie is set automatically by the server (HttpOnly)
      otpError.style.display = 'none';
      window.location.href = 'min-side.html';
    } catch (err) {
      console.error('Feil ved verifisering:', err);
      otpError.textContent = 'Nettverksfeil. Prøv igjen senere.';
      otpError.style.display = 'block';
    }
  });

  // Initialize
  sendOtpBtn.disabled = true;

  // ── Sosial innlogging: status fra redirect og kontokobling ────────────────
  let koblingsToken = '';
  // Knappene er skjult i markup. Kun leverandører serveren eksplisitt melder som
  // aktive blir synlige — feiler oppslaget, vises ingen av dem (OTP står alltid).
  (function visKonfigurerte() {
    fetch('/api/auth/oauth/providers', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        const p = (d && d.providers) || {};
        document.querySelectorAll('.sosial-knapp').forEach(function (a) {
          a.style.display = p[a.dataset.provider] === true ? 'flex' : 'none';
        });
      })
      .catch(function () { /* fail-closed: ingen sosial-knapper vises */ });
  })();
  (function sosialStatus() {
    const feil = document.getElementById('sosial-feil');
    const info = document.getElementById('kobling-info');
    const p = new URLSearchParams(window.location.search);
    const feilKode = p.get('feil');
    const koble = p.get('koble') || '';
    const epostKreves = p.get('epost_kreves') || '';

    const tekster = {
      avbrutt: 'Innloggingen ble avbrutt.',
      ikke_konfigurert: 'Denne innloggingsmetoden er ikke tilgjengelig akkurat nå.',
      utlopt_state: 'Innloggingen tok for lang tid. Prøv igjen.',
      ugyldig_callback: 'Innloggingen feilet. Prøv igjen.',
      token_feilet: 'Kunne ikke fullføre innloggingen hos leverandøren.',
      ugyldig_signatur: 'Kunne ikke verifisere identiteten din.',
      ugyldig_nonce: 'Kunne ikke verifisere identiteten din.',
      ugyldig_audience: 'Kunne ikke verifisere identiteten din.',
      ugyldig_utsteder: 'Kunne ikke verifisere identiteten din.',
      utlopt_token: 'Identiteten er utløpt. Prøv igjen.',
      profil_feilet: 'Kunne ikke hente profilen din.',
    };
    if (feilKode) {
      feil.textContent = tekster[feilKode] || 'Innloggingen feilet. Prøv e-post i stedet.';
      feil.style.display = 'block';
    }

    const token = koble || epostKreves;
    if (!token) return;
    koblingsToken = token;
    info.style.display = 'block';
    info.innerHTML = 'Du er identifisert, men vi må bekrefte at kontoen er din.<br>' +
      'Skriv e-postadressen din under og bekreft med engangskoden du får tilsendt.';

    fetch('/api/auth/oauth/link-info?token=' + encodeURIComponent(token))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.epostMaskert) {
          info.innerHTML = 'Du er identifisert som <strong>' + d.epostMaskert + '</strong>.<br>' +
            'Bekreft med engangskode for å koble kontoen.';
          const felt = document.getElementById('email');
          if (felt && !felt.value) { felt.value = ''; felt.placeholder = d.epostMaskert; }
        }
      })
      .catch(function () { /* info står som den er */ });
  })();
})();
