// Side-skript for admin-innlogging.html — flyttet ut for strengere CSP.
(function() {
  'use strict';

  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('login-btn');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const loginError = document.getElementById('login-error');

  // OTP elements
  const otpInputs = document.querySelectorAll('.otp-input');
  const verifyOtpBtn = document.getElementById('verify-otp-btn');
  // Manglet tidligere: siden kastet «sendOtpBtn is not defined» og virket ikke.
  const sendOtpBtn = document.getElementById('send-otp-btn');
  const backBtn = document.getElementById('back-btn');
  const resendText = document.getElementById('resend-text');
  const resendLink = document.getElementById('resend-link');
  const resendText2 = document.getElementById('resend-text-2');
  const resendLink2 = document.getElementById('resend-link-2');
  const otpError = document.getElementById('otp-error');

  let resendTimer = null;
  let resendSeconds = 60;
  let rateLimitUntil = 0;

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isRateLimited() {
    return Date.now() < rateLimitUntil;
  }

  function setRateLimit(seconds) {
    rateLimitUntil = Date.now() + seconds * 1000;
  }

  // Email input change
  emailInput.addEventListener('input', function() {
    emailError.style.display = 'none';
    loginError.style.display = 'none';
    loginBtn.disabled = !isValidEmail(emailInput.value.trim()) || isRateLimited();
    if (isRateLimited()) {
      const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
      loginBtn.textContent = `Prøv igjen om ${remaining}s`;
    } else {
      loginBtn.textContent = 'Send engangskode';
    }
  });

  // Start resend timer
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
        loginBtn.disabled = true;
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
        body: JSON.stringify({ email, code }),
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

      const user = data.user;

      // Check role - only ADMIN, REVIEWER, OPERATOR can access admin
      if (user.role === 'CUSTOMER') {
        otpError.textContent = 'Du har ikke administratortilgang.';
        otpError.style.display = 'block';
        return;
      }

      // Session cookie is set automatically by the server (HttpOnly)
      otpError.style.display = 'none';
      window.location.href = 'admin-dashboard.html';
    } catch (err) {
      console.error('Feil ved verifisering:', err);
      otpError.textContent = 'Nettverksfeil. Prøv igjen senere.';
      otpError.style.display = 'block';
    }
  });

  // Initialize
  sendOtpBtn.disabled = true;
})();
