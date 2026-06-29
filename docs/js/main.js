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
    const offset = 70;
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
