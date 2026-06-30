/* exported Auth */
const Auth = (() => {
  const TOKEN_KEY = 'avcoach_token';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function login(username, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
    if (data.firstLogin) return { firstLogin: true, username: data.username };
    setToken(data.token);
    return data.user;
  }

  async function setPassword(username, newPassword) {
    const res = await fetch('/api/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    setToken(data.token);
    return data.user;
  }

  async function logout() {
    const token = getToken();
    if (token) {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    clearToken();
  }

  async function verify() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch('/api/verify', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) { clearToken(); return null; }
      const data = await res.json();
      return data.user;
    } catch {
      return null;
    }
  }

  function authHeaders() {
    return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
  }

  return { login, setPassword, logout, verify, getToken, authHeaders };
})();
