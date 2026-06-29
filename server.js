require('dotenv').config();

const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');

const { getDb }        = require('./database/db');
const { initDatabase } = require('./database/init');

const app    = express();
const PORT   = process.env.PORT || 3456;
const SECRET = process.env.JWT_SECRET;
const EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

app.use(cors());
app.use(express.json());
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
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: EXPIRES }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
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
  const { snapshot } = req.body;
  if (!snapshot) return res.status(400).json({ error: 'Snapshot requis' });
  getDb()
    .prepare('INSERT INTO content_saves (saved_by, snapshot) VALUES (?, ?)')
    .run(req.user.id, JSON.stringify(snapshot));
  res.json({ message: 'Contenu sauvegardé' });
});

// GET /api/content/latest  (récupérer le dernier contenu)
app.get('/api/content/latest', (req, res) => {
  const row = getDb()
    .prepare('SELECT snapshot, saved_at FROM content_saves ORDER BY id DESC LIMIT 1')
    .get();
  if (!row) return res.json({ snapshot: null });
  res.json({ snapshot: JSON.parse(row.snapshot), saved_at: row.saved_at });
});

// ── Démarrage ────────────────────────────────────────────────────────────────

initDatabase();

app.listen(PORT, () => {
  console.log(`\n🚀 AV Coach démarré sur http://localhost:${PORT}`);
  console.log(`   Base de données : database/avcoach.sqlite\n`);
});
