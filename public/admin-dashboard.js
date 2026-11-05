// Side-skript for admin-dashboard.html — flyttet ut for strengere CSP.
(function() {
  'use strict';

  // Check admin authentication via server-side session
  async function checkAuth() {
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'include',
      });

      if (response.status === 401 || !response.ok) {
        window.location.href = 'admin-innlogging.html';
        return;
      }

      const data = await response.json();
      if (!data.authenticated) {
        window.location.href = 'admin-innlogging.html';
        return;
      }

      const user = data.user;

      // Check role - only ADMIN, REVIEWER, OPERATOR can access admin
      if (user.role === 'CUSTOMER') {
        window.location.href = 'min-side.html';
        return;
      }

      document.getElementById('admin-user-name').textContent = user.name;
      document.getElementById('admin-user-role').textContent = '· ' + user.role;
    } catch (err) {
      console.error('Auth check failed:', err);
      window.location.href = 'admin-innlogging.html';
    }
  }

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
    document.cookie = 'fb_admin_session=; path=/; max-age=0';
    window.location.href = 'admin-innlogging.html';
  });

  // Initialize
  checkAuth();
})();
