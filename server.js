require('dotenv').config();

const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');

const nodemailer       = require('nodemailer');
const { getDb }        = require('./database/db');
const { initDatabase } = require('./database/init');

const app    = express();
const PORT   = process.env.PORT || 3456;
const SECRET = process.env.JWT_SECRET;
const EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware auth ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── Routes API ───────────────────────────────────────────────────────────────

// POST /api/login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Identifiant requis' });

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Identifiant inconnu' });

  // Première connexion : aucun mot de passe défini
  if (user.must_set_password || !user.password) {
    return res.json({ firstLogin: true, username: user.username });
  }

  if (!password || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: EXPIRES }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/set-password  (définir le mot de passe à la première connexion)
app.post('/api/set-password', (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({ error: 'Identifiant et nouveau mot de passe requis' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!user.must_set_password && user.password) {
    return res.status(403).json({ error: 'Mot de passe déjà défini' });
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare(`
    UPDATE users SET password = ?, must_set_password = 0, last_login = datetime('now') WHERE id = ?
  `).run(hash, user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: EXPIRES }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// GET /api/verify
app.get('/api/verify', requireAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// POST /api/logout  (côté client : supprimer le token suffit, mais on trace)
app.post('/api/logout', requireAuth, (req, res) => {
  res.json({ message: 'Déconnecté' });
});

// GET /api/users  (admin seulement — liste des comptes)
app.get('/api/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const users = getDb()
    .prepare('SELECT id, username, role, created_at, last_login FROM users')
    .all();
  res.json(users);
});

// POST /api/users  (créer un utilisateur admin)
app.post('/api/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Identifiant et mot de passe (≥ 8 car.) requis' });
  }
  try {
    const hash = bcrypt.hashSync(password, 12);
    const result = getDb()
      .prepare("INSERT INTO users (username, password) VALUES (?, ?)")
      .run(username, hash);
    res.status(201).json({ id: result.lastInsertRowid, username });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Identifiant déjà utilisé' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id/password  (changer son propre mot de passe)
app.put('/api/users/:id/password', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.id !== targetId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Interdit' });
  }
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });
  }
  const hash = bcrypt.hashSync(password, 12);
  getDb().prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, targetId);
  res.json({ message: 'Mot de passe mis à jour' });
});

// DELETE /api/users/:id
app.delete('/api/users/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Interdit' });
  const targetId = parseInt(req.params.id);
  if (req.user.id === targetId) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  getDb().prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ message: 'Utilisateur supprimé' });
});

// POST /api/content  (sauvegarder le contenu édité)
app.post('/api/content', requireAuth, (req, res) => {
  const { snapshot, isBase } = req.body;
  if (!snapshot) return res.status(400).json({ error: 'Snapshot requis' });
  const db = getDb();
  db.prepare('INSERT INTO content_saves (saved_by, snapshot, is_base) VALUES (?, ?, ?)')
    .run(req.user.id, JSON.stringify(snapshot), isBase ? 1 : 0);
  // Garde V0 + les 5 dernières éditions
  db.prepare(`
    DELETE FROM content_saves
    WHERE is_base = 0
    AND id NOT IN (
      SELECT id FROM content_saves WHERE is_base = 0 ORDER BY id DESC LIMIT 5
    )
  `).run();
  res.json({ message: 'Contenu sauvegardé' });
});

// GET /api/content/latest
app.get('/api/content/latest', (req, res) => {
  const row = getDb()
    .prepare('SELECT snapshot, saved_at FROM content_saves ORDER BY id DESC LIMIT 1')
    .get();
  if (!row) return res.json({ snapshot: null });
  res.json({ snapshot: JSON.parse(row.snapshot), saved_at: row.saved_at });
});

// GET /api/content/base  (vérifie si V0 existe)
app.get('/api/content/base', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT id FROM content_saves WHERE is_base = 1 LIMIT 1').get();
  res.json({ exists: !!row });
});

// GET /api/content/history  (5 dernières éditions hors V0 — pour la barre d'édition)
app.get('/api/content/history', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare('SELECT id, saved_at FROM content_saves WHERE is_base = 0 ORDER BY id DESC LIMIT 5')
    .all();
  res.json(rows);
});

// GET /api/content/history/full  (toutes les versions avec auteur — pour admin)
app.get('/api/content/history/full', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  const rows = getDb().prepare(`
    SELECT cs.id, cs.saved_at, cs.snapshot, cs.is_base, u.username
    FROM content_saves cs
    LEFT JOIN users u ON u.id = cs.saved_by
    ORDER BY cs.id DESC
  `).all();
  res.json(rows.map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) })));
});

// GET /api/content/:id  (récupérer une version spécifique)
app.get('/api/content/:id', requireAuth, (req, res) => {
  const row = getDb()
    .prepare('SELECT snapshot, saved_at FROM content_saves WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Version introuvable' });
  res.json({ snapshot: JSON.parse(row.snapshot), saved_at: row.saved_at });
});

// POST /api/contact
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  try {
    await transporter.sendMail({
      from: `"AV Coach" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_TO,
      replyTo: `"${name}" <${email}>`,
      subject: `Message de ${name} via AVCoach`,
      text: `Nom : ${name}\nEmail : ${email}\n\n${message}`,
      html: `<p><strong>Nom :</strong> ${name}<br><strong>Email :</strong> ${email}</p><p>${message.replace(/\n/g, '<br>')}</p>`
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
  const rows = getDb()
    .prepare('SELECT * FROM contact_messages ORDER BY id DESC')
    .all();
  res.json(rows);
});

// PATCH /api/messages/:id/read
app.patch('/api/messages/:id/read', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  getDb().prepare('UPDATE contact_messages SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/messages/:id
app.delete('/api/messages/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  getDb().prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Démarrage ────────────────────────────────────────────────────────────────

initDatabase();

app.listen(PORT, () => {
  console.log(`\n🚀 AV Coach démarré sur http://localhost:${PORT}`);
  console.log(`   Base de données : database/avcoach.sqlite\n`);
});
