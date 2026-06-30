// ── Navigation scroll ─────────────────────────────────────────────────────────
const nav = document.getElementById('main-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

// ── Reveal on scroll ──────────────────────────────────────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 80);
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ── Mobile menu ───────────────────────────────────────────────────────────────
function toggleMenu() {
  const links = document.querySelector('.nav-links');
  const isOpen = links.dataset.open === '1';
  links.dataset.open = isOpen ? '0' : '1';
  Object.assign(links.style, isOpen
    ? { display: '' }
    : {
        display: 'flex', flexDirection: 'column', position: 'absolute',
        top: '70px', left: '0', right: '0',
        background: 'rgba(11,24,41,0.98)', padding: '1.5rem 2rem',
        gap: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(10px)'
      }
  );
}

// ── Smooth scroll ─────────────────────────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const offset = Editor.isActive() ? 44 + 70 : 70;
    window.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' });
    const links = document.querySelector('.nav-links');
    if (links) { links.style.display = ''; links.dataset.open = '0'; }
  });
});

// ── Contact form ──────────────────────────────────────────────────────────────
document.querySelector('.contact-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const btn  = form.querySelector('.btn-submit');
  const prenom  = form.querySelector('#prenom').value.trim();
  const nom     = form.querySelector('#nom').value.trim();
  const email   = form.querySelector('#email').value.trim();
  const sujet   = form.querySelector('#sujet').value;
  const message = form.querySelector('#message').value.trim();

  if (!prenom || !nom || !email || !message) return;

  btn.textContent = 'Envoi en cours…'; btn.disabled = true;

  const name = `${prenom} ${nom}${sujet ? ' — ' + sujet : ''}`;
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message })
    });
    if (!res.ok) throw new Error();
    form.reset();
    document.getElementById('form-success').style.display = 'block';
  } catch {
    alert('Une erreur est survenue, veuillez réessayer ou contacter directement par email.');
  } finally {
    btn.textContent = 'Envoyer le message'; btn.disabled = false;
  }
});

// ── Login modal ───────────────────────────────────────────────────────────────
let _firstLoginUsername = null;

function openLogin() {
  document.getElementById('login-overlay').classList.add('open');
  showLoginStep(1);
  setTimeout(() => document.getElementById('login-user').focus(), 50);
}
function closeLogin() {
  document.getElementById('login-overlay').classList.remove('open');
  showLoginStep(1);
  _firstLoginUsername = null;
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('setpwd-new').value = '';
  document.getElementById('setpwd-confirm').value = '';
}
function showLoginStep(n) {
  document.getElementById('login-step-1').style.display = n === 1 ? '' : 'none';
  document.getElementById('login-step-2').style.display = n === 2 ? '' : 'none';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('setpwd-error').style.display = 'none';
}

document.getElementById('login-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('login-overlay')) closeLogin();
});
document.getElementById('login-user').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-pass').focus();
});
document.getElementById('login-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
document.getElementById('setpwd-new').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('setpwd-confirm').focus();
});
document.getElementById('setpwd-confirm').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSetPassword();
});

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  errEl.style.display = 'none';
  btn.textContent = 'Connexion…'; btn.disabled = true;

  try {
    const result = await Auth.login(username, password);
    if (result.firstLogin) {
      _firstLoginUsername = result.username;
      showLoginStep(2);
      setTimeout(() => document.getElementById('setpwd-new').focus(), 50);
    } else {
      closeLogin();
      setEditButtonText('✎ Éditer');
    }
  } catch (err) {
    errEl.textContent = err.message || 'Identifiants incorrects';
    errEl.style.display = 'block';
    document.getElementById('login-pass').value = '';
  } finally {
    btn.textContent = 'Se connecter'; btn.disabled = false;
  }
}

async function doSetPassword() {
  const newPassword = document.getElementById('setpwd-new').value;
  const confirm     = document.getElementById('setpwd-confirm').value;
  const errEl       = document.getElementById('setpwd-error');
  const btn         = document.getElementById('setpwd-btn');

  errEl.style.display = 'none';

  if (newPassword !== confirm) {
    errEl.textContent = 'Les mots de passe ne correspondent pas';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword.length < 8) {
    errEl.textContent = 'Le mot de passe doit faire au moins 8 caractères';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Enregistrement…'; btn.disabled = true;

  try {
    await Auth.setPassword(_firstLoginUsername, newPassword);
    closeLogin();
    setEditButtonText('✎ Éditer');
  } catch (err) {
    errEl.textContent = err.message || 'Erreur lors de la définition du mot de passe';
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Définir le mot de passe'; btn.disabled = false;
  }
}

async function toggleEdit() {
  if (Editor.isActive()) {
    Editor.exit();
    return;
  }
  const user = await Auth.verify();
  if (user) {
    Editor.enter();
  } else {
    openLogin();
  }
}

async function logout() {
  await Auth.logout();
  Editor.exit();
  setEditButtonText('Connexion');
}

// ── Helpers boutons connexion ────────────────────────────────────────────────
function setEditButtonText(text) {
  document.getElementById('editToggle').textContent = text;
  const mob = document.getElementById('editToggleMobile');
  if (mob) mob.textContent = text;
  const loggedIn = text !== 'Connexion';
  ['logoutBtn', 'logoutBtnMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = loggedIn ? '' : 'none';
  });
}

// Ferme le dropdown historique si clic hors de la zone
document.addEventListener('click', e => {
  const wrap = document.querySelector('.history-wrap');
  const dd   = document.getElementById('history-dropdown');
  if (dd && dd.style.display === 'block' && wrap && !wrap.contains(e.target)) {
    dd.style.display = 'none';
  }
});

// ── Tracking visite ───────────────────────────────────────────────────────────
fetch('/api/track', { method: 'POST' }).catch(() => {});

// ── Auto-restore session ──────────────────────────────────────────────────────
(async () => {
  const user = await Auth.verify();
  if (user) setEditButtonText('✎ Éditer');
  Editor.loadContent();
})();
