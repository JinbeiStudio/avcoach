require('dotenv').config({ quiet: true });

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const path = require('path');

const { getDb } = require('./database/db');
const { createTransporter, escapeHtml, sendWelcomeEmails } = require('./lib/mail');
const { initDatabase } = require('./database/init');
const { RENDERED_PATH } = require('./database/render');
const { getMeta } = require('./database/meta');
const { renderSite, renderSiteIfMissing, syncTemplate, pruneSaves } = require('./database/content');

const app = express();
const PORT = process.env.PORT || 3456;
const SECRET = process.env.JWT_SECRET;
const EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// Échec immédiat au démarrage réel si le secret JWT est absent
if (require.main === module && !SECRET) {
  console.error('✗ JWT_SECRET manquant : définissez-le dans les variables d’environnement.');
  process.exit(1);
}

// L'app tourne derrière le proxy Infomaniak : req.ip doit être l'IP du client
app.set('trust proxy', 1);

// Limites désactivées sous Jest sauf si ENABLE_RATE_LIMIT=true (test dédié)
const skipInTest = () => process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT !== 'true';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: skipInTest,
  message: { error: 'Trop de tentatives, réessayez plus tard' }
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Trop de messages envoyés, réessayez plus tard' }
});

app.use(express.json({ limit: '10mb' }));

// Page servie = template + contenu en base (générée), jamais le template brut
app.get(['/', '/index.html'], (req, res, next) => {
  try {
    renderSiteIfMissing();
  } catch (e) {
    return next(e);
  }
  res.sendFile(RENDERED_PATH, (err) => err && next(err));
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Retourne un entier positif, ou null si l'identifiant n'est pas valide
function parseId(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_LOGIN_ERROR = 'Identifiant ou mot de passe incorrect';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, tv: user.token_version }, SECRET, {
    expiresIn: EXPIRES
  });
}

function generateTempPassword() {
  return crypto.randomBytes(6).toString('base64url');
}

// GET /sitemap.xml — <lastmod> basé sur la dernière sauvegarde de contenu,
// le signal que les crawlers utilisent pour prioriser le re-crawl.
// GET /robots.txt — indexation ouverte, sauf l'administration et l'API ; sitemap sur le domaine courant
app.get('/robots.txt', (req, res) => {
  const base = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
  const latest = getDb().prepare('SELECT saved_at FROM content_saves ORDER BY id DESC LIMIT 1').get();
  const lastmod = latest ? new Date(latest.saved_at + 'Z').toISOString() : new Date().toISOString();
  // Domaine défini par SITE_URL ; à défaut, celui de la requête (derrière le proxy : trust proxy)
  const base = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeHtml(base)}/</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`);
});

// ── Middleware auth ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  let payload;
  try {
    payload = jwt.verify(header.slice(7), SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
  // Le token doit correspondre à la version courante du compte (révocation)
  const user = getDb().prepare('SELECT id, username, role, token_version FROM users WHERE id = ?').get(payload.id);
  if (!user || user.token_version !== payload.tv) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

// ── Routes API ───────────────────────────────────────────────────────────────

// POST /api/login
app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string') return res.status(400).json({ error: 'Identifiant requis' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: GENERIC_LOGIN_ERROR });

  const valid = typeof password === 'string' && user.password && (await bcrypt.compare(password, user.password));
  if (!valid) return res.status(401).json({ error: GENERIC_LOGIN_ERROR });

  // Première connexion : le mot de passe temporaire est valide, on demande le définitif
  if (user.must_set_password) {
    return res.json({ firstLogin: true, username: user.username });
  }

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/set-password  (définir le mot de passe à la première connexion)
app.post('/api/set-password', authLimiter, async (req, res) => {
  const { username, tempPassword, newPassword } = req.body || {};
  if (typeof username !== 'string' || typeof tempPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Identifiant, mot de passe temporaire et nouveau mot de passe requis' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const tempOk = user && user.must_set_password && user.password && (await bcrypt.compare(tempPassword, user.password));
  if (!tempOk) return res.status(401).json({ error: 'Identifiant ou mot de passe temporaire incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare(
    `
    UPDATE users SET password = ?, must_set_password = 0, token_version = token_version + 1,
      last_login = datetime('now') WHERE id = ?
  `
  ).run(hash, user.id);

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: signToken(fresh), user: { id: fresh.id, username: fresh.username, role: fresh.role } });
});

// GET /api/verify
app.get('/api/verify', requireAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// POST /api/logout  (révoque tous les tokens du compte)
app.post('/api/logout', requireAuth, (req, res) => {
  getDb().prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  res.json({ message: 'Déconnecté' });
});

// GET /api/users  (admin seulement — liste des comptes)
app.get('/api/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const users = getDb().prepare('SELECT id, username, role, created_at, last_login FROM users').all();
  res.json(users);
});

// POST /api/users  (créer un utilisateur — admin seulement)
app.post('/api/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const { username, email, role } = req.body || {};
  if (!username || !email || typeof username !== 'string' || typeof email !== 'string') {
    return res.status(400).json({ error: 'Identifiant et email requis' });
  }
  const validRoles = ['admin', 'editor'];
  const userRole = validRoles.includes(role) ? role : 'editor';

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  const db = getDb();

  let id;
  try {
    id = db
      .prepare(
        'INSERT INTO users (username, email, password, must_set_password, welcome_email_sent, role) VALUES (?, ?, ?, 1, 0, ?)'
      )
      .run(username, email, hash, userRole).lastInsertRowid;
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Identifiant déjà utilisé' });
    console.error('Erreur création utilisateur :', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  try {
    await createTransporter().sendMail({
      from: `"Avé Coach" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Bienvenue sur Avé Coach — vos identifiants`,
      text: `Bonjour,\n\nVotre compte Avé Coach a été créé.\n\nIdentifiant : ${username}\nMot de passe temporaire : ${tempPassword}\n\nConnectez-vous sur le site et définissez votre mot de passe définitif.`,
      html: `<p>Bonjour,</p><p>Votre compte Avé Coach a été créé.</p><table><tr><td><strong>Identifiant</strong></td><td>${escapeHtml(username)}</td></tr><tr><td><strong>Mot de passe temporaire</strong></td><td><code>${escapeHtml(tempPassword)}</code></td></tr></table><p>Connectez-vous sur le site et définissez votre mot de passe définitif.</p>`
    });
    db.prepare('UPDATE users SET welcome_email_sent = 1 WHERE id = ?').run(id);
    res.status(201).json({ id, username, role: userRole, emailSent: true });
  } catch (err) {
    console.error('Échec envoi email création :', err.message);
    res.status(201).json({
      id,
      username,
      role: userRole,
      emailSent: false,
      warning: 'Utilisateur créé mais échec envoi email'
    });
  }
});

// PUT /api/users/:id/password  (changer son propre mot de passe)
app.put('/api/users/:id/password', requireAuth, async (req, res) => {
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Identifiant invalide' });
  if (req.user.id !== targetId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Interdit' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });
  }
  const db = getDb();
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(targetId)) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?').run(hash, targetId);

  // Changement de son propre mot de passe : nouveau token pour garder la session
  if (req.user.id === targetId) {
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    return res.json({ message: 'Mot de passe mis à jour', token: signToken(fresh) });
  }
  res.json({ message: 'Mot de passe mis à jour' });
});

// POST /api/users/:id/reset-password  (admin — réinitialise avec un mot de passe temporaire)
app.post('/api/users/:id/reset-password', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Identifiant invalide' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);

  db.prepare(
    'UPDATE users SET password = ?, must_set_password = 1, token_version = token_version + 1 WHERE id = ?'
  ).run(hash, targetId);

  const transporter = createTransporter();

  try {
    await transporter.sendMail({
      from: `"Avé Coach" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `Avé Coach — Réinitialisation de votre mot de passe`,
      text: `Bonjour,\n\nVotre mot de passe a été réinitialisé.\n\nIdentifiant : ${user.username}\nMot de passe temporaire : ${tempPassword}\n\nConnectez-vous et définissez un nouveau mot de passe définitif.`,
      html: `<p>Bonjour,</p><p>Votre mot de passe Avé Coach a été réinitialisé.</p><table><tr><td><strong>Identifiant</strong></td><td>${escapeHtml(user.username)}</td></tr><tr><td><strong>Mot de passe temporaire</strong></td><td><code>${escapeHtml(tempPassword)}</code></td></tr></table><p>Connectez-vous et définissez un nouveau mot de passe définitif.</p>`
    });
    res.json({ message: 'Mot de passe réinitialisé et email envoyé' });
  } catch (err) {
    console.error('Échec envoi email reset :', err.message);
    res.status(500).json({ error: 'Mot de passe réinitialisé mais échec envoi email' });
  }
});

// DELETE /api/users/:id
app.delete('/api/users/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const targetId = parseId(req.params.id);
  if (targetId === null) return res.status(400).json({ error: 'Identifiant invalide' });
  if (req.user.id === targetId) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  getDb().prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ message: 'Utilisateur supprimé' });
});

// Un snapshot valide est un objet { el_<id>|img_<id>: string }
function isValidSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  return Object.entries(snapshot).every(([key, value]) => /^(el|img)_[\w-]+$/.test(key) && typeof value === 'string');
}

// POST /api/content  (sauvegarder le contenu édité)
app.post('/api/content', requireAuth, (req, res) => {
  const { snapshot: delta, isBase } = req.body || {};
  if (!delta) return res.status(400).json({ error: 'Snapshot requis' });
  if (!isValidSnapshot(delta)) return res.status(400).json({ error: 'Snapshot invalide' });
  const db = getDb();

  // Le client n'envoie que les champs réellement modifiés (delta). On le
  // fusionne avec le dernier état complet connu pour que chaque ligne de
  // content_saves reste un instantané complet (historique/diff/restauration).
  const save = db.transaction(() => {
    let fullSnapshot = delta;
    if (!isBase) {
      const latest = db.prepare('SELECT snapshot FROM content_saves ORDER BY id DESC LIMIT 1').get();
      fullSnapshot = latest ? { ...JSON.parse(latest.snapshot), ...delta } : delta;
    }

    db.prepare('INSERT INTO content_saves (saved_by, snapshot, is_base) VALUES (?, ?, ?)').run(
      req.user.id,
      JSON.stringify(fullSnapshot),
      isBase ? 1 : 0
    );
    pruneSaves(db);
  });
  save();

  try {
    renderSite();
  } catch (e) {
    console.error('Échec régénération de la page :', e.message);
    return res.status(500).json({ error: 'Contenu sauvegardé mais échec de la mise à jour de la page' });
  }
  res.json({ message: 'Contenu sauvegardé' });
});

// GET /api/content/latest
app.get('/api/content/latest', (req, res) => {
  const row = getDb().prepare('SELECT snapshot, saved_at FROM content_saves ORDER BY id DESC LIMIT 1').get();
  if (!row) return res.json({ snapshot: null });
  res.json({ snapshot: JSON.parse(row.snapshot), saved_at: row.saved_at });
});

// GET /api/content/base  (vérifie si V0 existe)
app.get('/api/content/base', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT id FROM content_saves WHERE is_base = 1 LIMIT 1').get();
  res.json({ exists: !!row });
});

// GET /api/content/history/full  (toutes les versions avec auteur — pour admin)
app.get('/api/content/history/full', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  const rows = getDb()
    .prepare(
      `
    SELECT cs.id, cs.saved_at, cs.snapshot, cs.is_base, u.username
    FROM content_saves cs
    LEFT JOIN users u ON u.id = cs.saved_by
    ORDER BY cs.id DESC
  `
    )
    .all();
  res.json(rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) })));
});

// GET /api/content/export  (admin — sauvegarde complète du contenu en JSON)
app.get('/api/content/export', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  const rows = getDb()
    .prepare(
      `
    SELECT cs.id, cs.saved_at, cs.snapshot, cs.is_base, u.username
    FROM content_saves cs
    LEFT JOIN users u ON u.id = cs.saved_by
    ORDER BY cs.id DESC
  `
    )
    .all();
  const defaults = getMeta('template_defaults');
  const now = new Date();
  res.setHeader('Content-Disposition', `attachment; filename="avcoach-contenu-${now.toISOString().slice(0, 10)}.json"`);
  res.json({
    exported_at: now.toISOString(),
    template_defaults: defaults ? JSON.parse(defaults) : null,
    saves: rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) }))
  });
});

// POST /api/track  (enregistre une visite — public)
app.post('/api/track', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  // IP hachée avec la date : pas de stockage d'IP brute, unicité valable un jour
  const ipHash = crypto
    .createHash('sha256')
    .update(today + (req.ip || 'unknown') + SECRET)
    .digest('hex');
  const db = getDb();

  db.prepare('DELETE FROM visitor_ips WHERE date < ?').run(today);
  const isNew = db.prepare('INSERT OR IGNORE INTO visitor_ips (date, ip) VALUES (?, ?)').run(today, ipHash).changes > 0;

  db.prepare(
    `
    INSERT INTO page_views (date, count, unique_count) VALUES (?, 1, ?)
    ON CONFLICT(date) DO UPDATE SET
      count        = count + 1,
      unique_count = unique_count + ?
  `
  ).run(today, isNew ? 1 : 0, isNew ? 1 : 0);

  res.json({ ok: true });
});

// GET /api/stats  (admin seulement)
app.get('/api/stats', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const totals = db.prepare('SELECT SUM(count) as t, SUM(unique_count) as u FROM page_views').get();
  const todayRow = db.prepare('SELECT count, unique_count FROM page_views WHERE date = ?').get(today);
  const last30 = db
    .prepare(
      `
    SELECT date, count, unique_count FROM page_views
    WHERE date >= date('now', '-29 days')
    ORDER BY date ASC
  `
    )
    .all();
  const messages = db.prepare('SELECT COUNT(*) as n FROM contact_messages').get()?.n || 0;
  res.json({
    total: totals?.t || 0,
    totalUnique: totals?.u || 0,
    today: todayRow?.count || 0,
    todayUnique: todayRow?.unique_count || 0,
    last30,
    messages
  });
});

// POST /api/contact
app.post('/api/contact', contactLimiter, async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'Champs invalides' });
  }
  if (name.length > 200 || email.length > 254 || message.length > 5000) {
    return res.status(400).json({ error: 'Un des champs est trop long' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }

  const transporter = createTransporter();
  const safeName = name.replace(/[\r\n]+/g, ' ');

  try {
    await transporter.sendMail({
      from: `"Avé Coach" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_TO,
      replyTo: { name: safeName, address: email },
      subject: `Message de ${safeName} via Avé Coach`,
      text: `Nom : ${name}\nEmail : ${email}\n\n${message}`,
      html: `<p><strong>Nom :</strong> ${escapeHtml(name)}<br><strong>Email :</strong> ${escapeHtml(email)}</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    });
  } catch (err) {
    console.error('Erreur email :', err.message);
  }

  // Sauvegarde en base dans tous les cas
  getDb().prepare('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)').run(name, email, message);
  res.json({ message: 'Message reçu' });
});

// GET /api/messages  (liste des messages de contact — admin seulement)
app.get('/api/messages', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  const rows = getDb().prepare('SELECT * FROM contact_messages ORDER BY id DESC').all();
  res.json(rows);
});

// PATCH /api/messages/:id/read
app.patch('/api/messages/:id/read', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Identifiant invalide' });
  getDb().prepare('UPDATE contact_messages SET read = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// DELETE /api/messages/:id
app.delete('/api/messages/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Identifiant invalide' });
  getDb().prepare('DELETE FROM contact_messages WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Démarrage ────────────────────────────────────────────────────────────────

const { newUsers } = initDatabase();

sendWelcomeEmails(newUsers);

if (require.main === module) {
  // Réconcilie le template avec la base puis génère la page servie
  try {
    syncTemplate();
    renderSite();
  } catch (e) {
    console.error('✗ Échec de la génération de la page au démarrage :', e.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Avé Coach démarré sur http://localhost:${PORT}`);
    console.log(`   Base de données : ${process.env.DATABASE_PATH || 'database/avcoach.sqlite'}\n`);
  });
}

module.exports = app;
