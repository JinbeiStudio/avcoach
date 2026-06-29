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
document.querySelector('.contact-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const btn = e.target.querySelector('.btn-submit');
  btn.textContent = 'Envoi en cours…'; btn.disabled = true;
  setTimeout(() => {
    e.target.reset();
    document.getElementById('form-success').style.display = 'block';
    btn.textContent = 'Envoyer le message'; btn.disabled = false;
  }, 1200);
});

// ── Login modal ───────────────────────────────────────────────────────────────
function openLogin() {
  document.getElementById('login-overlay').classList.add('open');
  setTimeout(() => document.getElementById('login-user').focus(), 50);
}
function closeLogin() {
  document.getElementById('login-overlay').classList.remove('open');
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
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

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  errEl.style.display = 'none';
  btn.textContent = 'Connexion…'; btn.disabled = true;

  try {
    await Auth.login(username, password);
    closeLogin();
    Editor.enter();
  } catch (err) {
    errEl.textContent = err.message || 'Identifiants incorrects';
    errEl.style.display = 'block';
    document.getElementById('login-pass').value = '';
  } finally {
    btn.textContent = 'Se connecter'; btn.disabled = false;
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
}

// ── Auto-restore session ──────────────────────────────────────────────────────
(async () => {
  const user = await Auth.verify();
  if (user) Editor.loadContent();
  else       Editor.loadContent();
})();
